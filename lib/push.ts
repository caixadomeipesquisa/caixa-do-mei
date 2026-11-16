// Web Push: no Android funciona no navegador; no iPhone, só com o app instalado na tela inicial (iOS 16.4+).
import { supabase } from './supabase';

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

function b64ToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export function pushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID;
}

export async function enablePush(): Promise<'ok' | 'denied' | 'unsupported' | 'no-login'> {
  if (!pushSupported()) return 'unsupported';
  if (!supabase) return 'no-login';
  const { data } = await supabase.auth.getSession();
  const user = data.session?.user;
  if (!user) return 'no-login';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(VAPID) }));
  const json = sub.toJSON();
  await supabase.from('push_subscriptions').upsert({
    user_id: user.id,
    endpoint: json.endpoint,
    p256dh: json.keys?.p256dh,
    auth: json.keys?.auth,
  }, { onConflict: 'endpoint' });
  return 'ok';
}

export type PushStatus = 'on' | 'off' | 'blocked' | 'unsupported' | 'no-login';

/** Situação real dos lembretes neste aparelho: permissão do celular + inscrição ativa + conta. */
export async function pushStatus(): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  if (!supabase) return 'no-login';
  const { data } = await supabase.auth.getSession();
  if (!data.session?.user) return 'no-login';
  if (Notification.permission === 'denied') return 'blocked';
  if (Notification.permission !== 'granted') return 'off';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? 'on' : 'off';
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** Mostra uma notificação local, só para conferir que o celular exibe os avisos. */
export async function testNotification(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification('Caixa do MEI', { body: 'Os lembretes estão ligados neste celular.', icon: '/icon-192.png', badge: '/icon-192.png' });
  return true;
}
