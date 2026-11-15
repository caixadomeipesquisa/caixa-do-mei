# Caixa do MEI

Aplicativo web gratuito do protocolo aberto **Manter simples**, uma rotina financeira mínima para microempreendedores individuais. Faz parte de uma pesquisa de mestrado.

> Anote o que entra e o que sai, separe o seu salário e feche o caixa. Leva 5 minutos por dia, e o app lembra você.

Contato do projeto: caixadomeipesquisa@gmail.com

## O que o app faz (versão 0.1)

1. **Duas gavetas:** cada lançamento é do negócio ou da casa.
2. **Salário fixo:** o MEI define quanto tira por mês e de quanto em quanto tempo; o app mostra a parcela e registra a passagem do negócio para a casa.
3. **Fechar o caixa:** compara o saldo calculado com o que o MEI tem de fato e registra o ajuste.
4. **Lembretes:** fechamento do caixa (Web Push, ou e-mail se não houver push) e DAS 5 dias antes do vencimento.
5. **Resumo do mês:** entrou, saiu, sobrou, dias com caixa fechado, salário pago e contas da casa pagas pelo negócio.
6. **Pesquisa:** consentimento no primeiro acesso, eventos de uso só de quem consentiu, sem nome; o usuário baixa (CSV) ou apaga os dados quando quiser.

Fora da versão 0.1, de propósito: IA, integração bancária, nota fiscal, várias empresas.

## Stack

| Camada | Escolha |
|---|---|
| App | PWA instalável (Next.js 16, exportação estática, React 19) |
| Sem internet | IndexedDB (Dexie) com fila de sincronização; service worker guarda as telas |
| Back-end | Supabase: Postgres com RLS, login por código no e-mail, Edge Function, pg_cron |
| Lembretes | Web Push (VAPID) e e-mail pela Brevo |
| Hospedagem | Vercel (Hobby) |

Sem as variáveis do Supabase, o app roda em **modo local** (dados só no aparelho), útil para testar.

## Rodar no computador

```bash
npm install
cp .env.example .env.local   # preencha depois de criar o Supabase
npm run dev                   # http://localhost:3000
```

## Implantação, passo a passo

Tudo com a conta do projeto (caixadomeipesquisa@gmail.com), separada de qualquer outro produto.

### 1. GitHub
1. Crie o repositório `caixa-do-mei` (público, licença MIT) e suba esta pasta.

### 2. Supabase (plano gratuito)
1. Crie a organização e o projeto `caixa-do-mei`, região **South America (São Paulo)**.
2. SQL Editor: rode `supabase/migrations/0001_init.sql`.
3. Authentication › Providers › Email: deixe ligado e **desligue "Confirm email"**; em Email Templates › Magic Link, use o código `{{ .Token }}` no corpo (o app pede o código de 6 números).
4. Authentication › URL Configuration: Site URL = endereço final (ex.: `https://caixadomei.com.br`).
5. Gere as chaves de push: `npx web-push generate-vapid-keys`.
6. Edge Functions: publique `supabase/functions/send-reminders` (`supabase functions deploy send-reminders`) e cadastre os segredos: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:caixadomeipesquisa@gmail.com`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME=Caixa do MEI`, `APP_URL`.
7. Database › Extensions: ligue `pg_cron` e `pg_net`; guarde a service role key no Vault (`service_role_key`) e rode `supabase/migrations/0002_reminders_cron.sql` com o endereço do seu projeto.

### 3. Brevo
1. Valide o remetente (o e-mail do projeto ou, depois, um do domínio caixadomei.com.br).
2. Crie a chave de API e cadastre como `BREVO_API_KEY` no Supabase.
3. Opcional: em Supabase › Authentication › SMTP, use o SMTP da Brevo para os e-mails de código (o SMTP padrão do Supabase tem limite baixo por hora).

### 4. Vercel (Hobby)
1. Importe o repositório do GitHub; o framework é detectado (Next.js).
2. Cadastre as variáveis de `.env.example`.
3. Domínio: aponte `caixadomei.com.br` para a Vercel (registro A/CNAME indicado no painel).

## Dados da pesquisa

- Tabelas do app: `profiles`, `transactions`, `closings`, `consents`, `events`, `push_subscriptions`, `reminder_log`.
- O esquema `research` não é exposto pela API: o pesquisador consulta pelo painel do Supabase.
  - `research.participants`: um pseudônimo por participante que consentiu.
  - `research.daily`: por dia, se lançou, se fechou o caixa, contas da casa pagas pelo negócio e pagamentos a si mesmo.
- Sem nome, e-mail ou descrição dos lançamentos nas visões de pesquisa.
- "Apagar todos os meus dados" remove tudo do usuário e registra a retirada do consentimento.

## Licenças

- Código: MIT (arquivo `LICENSE`).
- Protocolo (`docs/protocolo.md`): CC BY 4.0.
