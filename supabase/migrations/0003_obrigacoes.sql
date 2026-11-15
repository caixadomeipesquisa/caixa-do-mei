-- Obrigações do MEI: nota fiscal e atividade nas vendas; relatório mensal, DASN e limite (opcional) no perfil.
alter table public.transactions
  add column if not exists nf boolean,
  add column if not exists activity text check (activity in ('comercio', 'industria', 'servicos'));

alter table public.profiles
  add column if not exists activity text not null default 'comercio' check (activity in ('comercio', 'industria', 'servicos')),
  add column if not exists has_employee boolean not null default false,
  add column if not exists kept_reports text[] not null default '{}',
  add column if not exists dasn_done int[] not null default '{}',
  add column if not exists track_limit boolean not null default false,
  add column if not exists limit_year int,
  add column if not exists revenue_before_cents integer not null default 0,
  add column if not exists opened_month smallint check (opened_month between 1 and 12);

-- Indicador de pesquisa: relatórios guardados por participante
create or replace view research.reports as
select encode(digest(p.id::text || 'caixadomei', 'sha256'), 'hex') as pid,
       cardinality(p.kept_reports) as reports_kept,
       p.track_limit,
       cardinality(p.dasn_done) as dasn_marked
from public.profiles p
where public.has_consent(p.id);
