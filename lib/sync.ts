// Sobe a fila local para o Supabase e baixa os dados do usuário ao entrar.
import { db, type Tx, type Closing, type Settings } from './db';
import { supabase } from './supabase';

let running = false;

export async function syncNow(): Promise<{ sent: number; ok: boolean }> {
  if (!supabase || running || (typeof navigator !== 'undefined' && !navigator.onLine)) return { sent: 0, ok: false };
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return { sent: 0, ok: false };
  running = true;
  let sent = 0;
  try {
    const items = await db.outbox.orderBy('seq').limit(200).toArray();
    for (const it of items) {
      const row = { ...it.row, user_id: user.id } as Record<string, unknown>;
      if (it.table === 'profiles') { row.id = user.id; delete row.user_id; row.updated_at = new Date().toISOString(); }
      // Eventos e consentimentos só entram (nunca são alterados): insert simples.
      const insertOnly = it.table === 'events' || it.table === 'consents';
      const q =
        it.op === 'delete'
          ? supabase.from(it.table).delete().eq('id', row.id as string)
          : insertOnly
            ? supabase.from(it.table).insert(row)
            : supabase.from(it.table).upsert(row);
      const { error } = await q;
      if (error) {
        // Evento recusado (ex.: sem consentimento no servidor) não trava a fila.
        if (it.table === 'events') { await db.outbox.delete(it.seq!); continue; }
        console.warn('sync', it.table, error.message);
        break;
      }
      await db.outbox.delete(it.seq!);
      sent++;
    }
    return { sent, ok: true };
  } finally {
    running = false;
  }
}

/** Ao entrar num aparelho novo, traz os dados do servidor. */
export async function pullAll() {
  if (!supabase) return;
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return;
  const [tx, cl, pr] = await Promise.all([
    supabase.from('transactions').select('*').eq('user_id', user.id),
    supabase.from('closings').select('*').eq('user_id', user.id),
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
  ]);
  if (tx.data) await db.tx.bulkPut(tx.data.map(({ user_id, ...r }) => r as Tx));
  if (cl.data) await db.closings.bulkPut(cl.data.map(({ user_id, ...r }) => r as Closing));
  if (pr.data) {
    const cur = (await db.settings.get('me')) as Settings | undefined;
    await db.settings.put({
      key: 'me',
      business_name: pr.data.business_name ?? '',
      salary_cents: pr.data.salary_cents ?? 0,
      pay_per_month: pr.data.pay_per_month ?? 4,
      close_time: pr.data.close_time ?? '19:00',
      opening_biz_cents: pr.data.opening_biz_cents ?? 0,
      consent_research: cur?.consent_research ?? pr.data.consent_research ?? null,
      onboarded: true,
    });
  }
}

export function startAutoSync() {
  if (typeof window === 'undefined') return;
  const run = () => { void syncNow(); };
  window.addEventListener('online', run);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') run(); });
  const t = window.setInterval(run, 60_000);
  run();
  return () => { window.removeEventListener('online', run); window.clearInterval(t); };
}
