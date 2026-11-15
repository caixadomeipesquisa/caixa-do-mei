// Edge Function: envia os lembretes do Caixa do MEI.
// Chamada pelo pg_cron a cada 15 minutos (migração 0002).
// - Fechar o caixa: no horário escolhido pelo usuário, se ainda não fechou hoje (Web Push; sem push, e-mail).
// - DAS: 5 dias antes do vencimento, por e-mail (Brevo) e push.
// Segredos (Supabase > Edge Functions > Secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT,
// BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME, APP_URL.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const APP_URL = Deno.env.get('APP_URL') ?? 'https://caixadomei.com.br';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT') ?? 'mailto:caixadomeipesquisa@gmail.com',
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

function localNow(tz: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return { day: `${g('year')}-${g('month')}-${g('day')}`, minutes: Number(g('hour')) * 60 + Number(g('minute')), dom: Number(g('day')) };
}

async function alreadySent(user_id: string, kind: string, day: string) {
  const { error } = await supabase.from('reminder_log').insert({ user_id, kind, day });
  return !!error; // conflito de chave = já enviado hoje
}

async function push(user_id: string, title: string, body: string) {
  const { data: subs } = await supabase.from('push_subscriptions').select('*').eq('user_id', user_id);
  let ok = false;
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ title, body, url: APP_URL }));
      ok = true;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await supabase.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    }
  }
  return ok;
}

async function email(to: string, subject: string, text: string) {
  const key = Deno.env.get('BREVO_API_KEY');
  if (!key) return false;
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'Content-Type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: Deno.env.get('BREVO_SENDER_EMAIL') ?? 'caixadomeipesquisa@gmail.com', name: Deno.env.get('BREVO_SENDER_NAME') ?? 'Caixa do MEI' },
      to: [{ email: to }],
      subject,
      textContent: text + `\n\nAbrir o app: ${APP_URL}\nPara parar os lembretes, desligue em Mais › Conta e lembretes.`,
    }),
  });
  return res.ok;
}

Deno.serve(async () => {
  const { data: profiles, error } = await supabase.from('profiles').select('id, close_time, timezone, das_day');
  if (error) return new Response(error.message, { status: 500 });
  let sent = 0;
  for (const p of profiles ?? []) {
    const now = localNow(p.timezone || 'America/Sao_Paulo');
    const [h, m] = String(p.close_time).split(':').map(Number);
    const target = h * 60 + m;

    // 1) Fechar o caixa: janela de 15 minutos a partir do horário escolhido
    if (now.minutes >= target && now.minutes < target + 15) {
      const { count } = await supabase.from('closings').select('id', { count: 'exact', head: true }).eq('user_id', p.id).eq('day', now.day);
      if (!count && !(await alreadySent(p.id, 'close', now.day))) {
        const viaPush = await push(p.id, 'Feche o caixa de hoje', 'Leva 1 minuto: confira se o que tem bate com o anotado.');
        if (!viaPush) {
          const { data: u } = await supabase.auth.admin.getUserById(p.id);
          if (u.user?.email) await email(u.user.email, 'Feche o caixa de hoje', 'Leva 1 minuto: abra o Caixa do MEI e confira se o que tem bate com o anotado.');
        }
        sent++;
      }
    }

    // 2) DAS: 5 dias antes do vencimento, às 9h
    if (now.dom === (p.das_day ?? 20) - 5 && now.minutes >= 540 && now.minutes < 555) {
      if (!(await alreadySent(p.id, 'das', now.day))) {
        await push(p.id, 'O DAS vence em 5 dias', 'Separe o valor na gaveta do negócio.');
        const { data: u } = await supabase.auth.admin.getUserById(p.id);
        if (u.user?.email) await email(u.user.email, 'O DAS vence em 5 dias', 'Lembrete do Caixa do MEI: o DAS do mês vence em 5 dias. Separe o valor na gaveta do negócio.');
        sent++;
      }
    }
  }
  return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'Content-Type': 'application/json' } });
});
