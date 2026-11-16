-- Agenda os lembretes: a cada 15 minutos o banco chama a Edge Function send-reminders.
-- Antes de rodar:
--   1. Database > Extensions: ligar pg_cron e pg_net (ou deixar as duas linhas abaixo ligarem).
--   2. Inventar uma senha longa (ex.: gerada por um gerenciador de senhas) e guardar em dois lugares:
--      - Edge Functions > Secrets: CRON_SECRET = <senha>
--      - Vault, rodando aqui no SQL Editor: select vault.create_secret('<senha>', 'cron_secret');
--   3. Trocar SEU-PROJETO pelo identificador do projeto (o que aparece em https://SEU-PROJETO.supabase.co).

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'caixa-do-mei-lembretes',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Conferir: select * from cron.job;  ·  últimas chamadas: select * from net._http_response order by created desc limit 5;
-- Desligar: select cron.unschedule('caixa-do-mei-lembretes');
