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
