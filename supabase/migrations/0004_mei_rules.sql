-- Caixa do MEI · 0004: tabela de vigência do limite anual do MEI.
-- O app lê esta tabela ao abrir (leitura pública, sem login) e guarda uma cópia no aparelho.
-- Quando a lei mudar, basta inserir uma linha nova: o app passa a usar o valor sem nova publicação.
-- Regra: vale a linha com o maior from_year <= ano corrente.

create table if not exists public.mei_rules (
  from_year   int primary key check (from_year between 2000 and 2100),
  limit_cents bigint not null check (limit_cents > 0),
  source      text not null,
  updated_at  timestamptz not null default now()
);

alter table public.mei_rules enable row level security;

drop policy if exists "mei_rules leitura publica" on public.mei_rules;
create policy "mei_rules leitura publica" on public.mei_rules
  for select to anon, authenticated using (true);

grant select on public.mei_rules to anon, authenticated;

insert into public.mei_rules (from_year, limit_cents, source) values
  (2018, 8100000,  'LC 155/2016'),
  (2027, 11000000, 'LC 238/2026'),
  (2028, 14000000, 'LC 238/2026')
on conflict (from_year) do nothing;

-- Exemplo para uma mudança futura (não rodar sem lei publicada):
-- insert into public.mei_rules (from_year, limit_cents, source) values (2030, 15000000, 'LC xxx/20xx');
