-- Caixa do MEI: esquema inicial.
-- Princípios: cada usuário só vê os próprios dados (RLS); dados de pesquisa só de quem consentiu, sem nome nem e-mail.

create extension if not exists pgcrypto;

-- Perfil (configuração do protocolo)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  user_id uuid generated always as (id) stored,
  business_name text,
  salary_cents integer not null default 0 check (salary_cents >= 0),
  pay_per_month smallint not null default 4 check (pay_per_month in (1, 2, 4)),
  close_time time not null default '19:00',
  opening_biz_cents integer not null default 0,
  timezone text not null default 'America/Sao_Paulo',
  das_day smallint not null default 20 check (das_day between 1 and 28),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Lançamentos (duas gavetas)
create table public.transactions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  type text not null check (type in ('in', 'out')),
  drawer text not null check (drawer in ('biz', 'home')),
  category text not null,
  cents integer not null check (cents > 0),
  created_at timestamptz not null default now(),
  deleted boolean not null default false
);
create index on public.transactions (user_id, day);

-- Fechamentos de caixa
create table public.closings (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  expected_cents integer not null,
  counted_cents integer,
  created_at timestamptz not null default now()
);
create index on public.closings (user_id, day);

-- Consentimento (histórico: cada mudança é uma linha; vale a mais recente)
create table public.consents (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  accepted boolean not null,
  terms_version text not null,
  created_at timestamptz not null default now()
);
create index on public.consents (user_id, created_at desc);

create or replace function public.has_consent(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select accepted from consents where user_id = uid order by created_at desc limit 1), false)
$$;

-- Eventos de uso para a pesquisa (só entram com consentimento)
create table public.events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  props jsonb not null default '{}',
  day date not null,
  created_at timestamptz not null default now()
);
create index on public.events (user_id, day);

-- Assinaturas de Web Push
create table public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- Registro dos lembretes enviados (evita mandar duas vezes no mesmo dia)
create table public.reminder_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, kind, day)
);

-- RLS: dono vê e altera só o que é seu
alter table public.profiles enable row level security;
alter table public.transactions enable row level security;
alter table public.closings enable row level security;
alter table public.consents enable row level security;
alter table public.events enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.reminder_log enable row level security;

create policy "own profile" on public.profiles for all using (id = auth.uid()) with check (id = auth.uid());
create policy "own tx" on public.transactions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own closings" on public.closings for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own consents read" on public.consents for select using (user_id = auth.uid());
create policy "own consents insert" on public.consents for insert with check (user_id = auth.uid());
-- Evento só entra se o usuário consentiu; o usuário não lê nem altera eventos depois de enviados.
create policy "events with consent" on public.events for insert with check (user_id = auth.uid() and public.has_consent(auth.uid()));
create policy "own push" on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
-- reminder_log: sem política = só o service role (Edge Function) acessa.

-- Apagar tudo do próprio usuário (botão "Apagar todos os meus dados")
create or replace function public.delete_my_data() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from transactions where user_id = auth.uid();
  delete from closings where user_id = auth.uid();
  delete from events where user_id = auth.uid();
  delete from push_subscriptions where user_id = auth.uid();
  delete from reminder_log where user_id = auth.uid();
  delete from profiles where id = auth.uid();
  insert into consents (id, user_id, accepted, terms_version) values (gen_random_uuid(), auth.uid(), false, 'withdrawn');
end $$;
revoke all on function public.delete_my_data() from public;
grant execute on function public.delete_my_data() to authenticated;

-- ---------- Camada de pesquisa (só o pesquisador, pelo painel/SQL; nada exposto à API) ----------
create schema if not exists research;
revoke all on schema research from anon, authenticated;

-- Pseudônimo estável por participante, sem nome nem e-mail.
create or replace view research.participants as
select encode(digest(p.id::text || 'caixadomei', 'sha256'), 'hex') as pid,
       p.pay_per_month, p.salary_cents > 0 as has_salary, p.created_at::date as entry_day
from public.profiles p
where public.has_consent(p.id);

-- Indicadores diários por participante (o que o projeto mede)
create or replace view research.daily as
select encode(digest(u.id::text || 'caixadomei', 'sha256'), 'hex') as pid,
       d.day,
       exists (select 1 from public.transactions t where t.user_id = u.id and t.day = d.day and not t.deleted) as logged,
       exists (select 1 from public.closings c where c.user_id = u.id and c.day = d.day) as closed,
       (select count(*) from public.transactions t where t.user_id = u.id and t.day = d.day and t.drawer = 'biz' and t.type = 'out' and t.category = 'Conta da casa') as home_paid_by_biz,
       (select count(*) from public.transactions t where t.user_id = u.id and t.day = d.day and t.category = 'Pagar a mim' and t.drawer = 'biz') as pay_self
from auth.users u
cross join lateral (select distinct day from public.events e where e.user_id = u.id) d
where public.has_consent(u.id);
