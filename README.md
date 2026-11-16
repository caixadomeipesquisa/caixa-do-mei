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
6. **Obrigações do MEI:** cada venda registra "com nota" ou "sem nota" e a atividade (comércio, indústria ou serviços). O app monta o Relatório Mensal das Receitas Brutas (linhas I a X do modelo oficial), lembra de conferir e guardar até o dia 20, prepara os números da DASN-SIMEI (até 31 de maio) e, como opção, acompanha o limite anual de faturamento com a receita anterior ao uso do app. O app não transmite a declaração: o MEI entrega no Portal do Simples ou no App MEI.
7. **Pesquisa:** consentimento no primeiro acesso, eventos de uso só de quem consentiu, sem nome; o usuário baixa (CSV) ou apaga os dados quando quiser.

Fora da versão 0.1, de propósito: IA, integração bancária, nota fiscal, várias empresas.

## Independente do ano

- O ano vem sempre da data do aparelho: relatório mensal, DASN (ano anterior), limite e lembretes funcionam em 2026, 2027 ou depois sem mudar código.
- O teto do MEI vem de uma tabela de vigência (`public.mei_rules`: a partir de que ano, valor, lei). O app lê a tabela ao abrir e guarda uma cópia no aparelho; sem internet, usa a tabela padrão de `lib/mei.ts`.
- Lei nova: insira uma linha em `mei_rules` (ex.: `insert into public.mei_rules values (2030, 15000000, 'LC xxx/20xx')`). Não precisa publicar o app de novo.
- Se o MEI começou a usar o app no meio do ano, a declaração anual mostra o aviso de que faltam os meses anteriores, em vez de apresentar um total incompleto como se fosse o do ano.

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
2. SQL Editor: rode `supabase/migrations/0001_init.sql`, depois `0003_obrigacoes.sql` e `0004_mei_rules.sql`.
3. Authentication › Providers › Email: deixe ligado e **desligue "Confirm email"**; em Email Templates, cole `supabase/templates/codigo-de-acesso.html` no **Magic Link** e também no **Confirm signup** (assunto: `Seu código de acesso ao Caixa do MEI`). O app pede o código (`{{ .Token }}`), não o link. Em Authentication › Providers › Email, deixe **Email OTP Length = 6** (o app aceita de 6 a 10 números, mas 6 é mais fácil de digitar).
4. Authentication › URL Configuration: Site URL = endereço final (ex.: `https://caixadomei.com.br`).
5. Gere as chaves de push: `npx web-push generate-vapid-keys` (a pública vai também para a Vercel).
6. Edge Functions: crie `send-reminders` (pelo editor do painel, colando `supabase/functions/send-reminders/index.ts`, ou `supabase functions deploy send-reminders`) com a **verificação de JWT desligada** (`supabase/config.toml` já faz isso no deploy pela linha de comando).
7. Edge Functions › Secrets: `CRON_SECRET` (uma senha longa inventada por você), `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:caixadomeipesquisa@gmail.com`, `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME=Caixa do MEI`, `APP_URL`.
8. SQL Editor: `select vault.create_secret('<a mesma senha do CRON_SECRET>', 'cron_secret');` e depois `supabase/migrations/0002_reminders_cron.sql`, trocando SEU-PROJETO.

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
