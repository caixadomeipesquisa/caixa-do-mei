-- Agenda os lembretes: a cada 15 minutos o banco chama a Edge Function send-reminders.
-- Antes de rodar: Supabase > Database > Extensions, ligar pg_cron e pg_net.
-- Troque SEU-PROJETO e guarde a service role key no Vault com o nome 'service_role_key'
-- (Supabase > Project Settings > Vault): select vault.create_secret('<chave>', 'service_role_key');

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
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
