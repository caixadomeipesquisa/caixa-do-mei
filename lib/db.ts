// Banco local (IndexedDB via Dexie): o app funciona sem internet.
// Tudo o que muda entra na fila "outbox" e sobe para o Supabase quando houver conexão e login.
import Dexie, { type Table } from 'dexie';
import { uid, today } from './money';

export type Drawer = 'biz' | 'home';
export type Activity = 'comercio' | 'industria' | 'servicos';
export type TxType = 'in' | 'out';

export interface Tx {
  id: string;
  day: string; // AAAA-MM-DD
  type: TxType;
  drawer: Drawer;
  category: string;
  cents: number;
  created_at: string;
  deleted?: boolean;
  nf?: boolean; // venda com nota fiscal
  activity?: Activity; // atividade da receita (relatório mensal)
}

export interface Closing {
  id: string;
  day: string;
  expected_cents: number;
  counted_cents: number | null;
  created_at: string;
}

export interface Settings {
  key: 'me';
  business_name: string;
  salary_cents: number; // salário fixo por mês
  pay_per_month: 1 | 2 | 4;
  close_time: string; // HH:MM
  opening_biz_cents: number; // saldo inicial informado na configuração
  consent_research: boolean | null; // null = ainda não respondeu
  onboarded: boolean;
  // Obrigações (opcionais, configuradas fora do onboarding)
  activity: Activity; // atividade principal (padrão da venda)
  has_employee: boolean;
  kept_reports: string[]; // meses AAAA-MM marcados como guardados
  dasn_done: number[]; // anos-calendário com DASN entregue
  // Acompanhamento do limite (opcional)
  track_limit: boolean;
  limit_year: number; // ano a que se refere a receita anterior
  revenue_before_cents: number; // faturamento do ano antes de usar o app
  opened_month: number | null; // 1-12 se o MEI abriu no ano acompanhado
}

export interface OutboxItem {
  seq?: number;
  table: 'transactions' | 'closings' | 'profiles' | 'events' | 'consents';
  row: Record<string, unknown>;
  op: 'upsert' | 'delete';
}

class CaixaDB extends Dexie {
  tx!: Table<Tx, string>;
  closings!: Table<Closing, string>;
  settings!: Table<Settings, string>;
  outbox!: Table<OutboxItem, number>;
  constructor() {
    super('caixa-do-mei');
    this.version(1).stores({
      tx: 'id, day, drawer, type, category',
      closings: 'id, day',
      settings: 'key',
      outbox: '++seq, table',
    });
  }
}

export const db = new CaixaDB();

export const defaultSettings: Settings = {
  key: 'me',
  business_name: '',
  salary_cents: 200000,
  pay_per_month: 4,
  close_time: '19:00',
  opening_biz_cents: 0,
  consent_research: null,
  onboarded: false,
  activity: 'comercio',
  has_employee: false,
  kept_reports: [],
  dasn_done: [],
  track_limit: false,
  limit_year: new Date().getFullYear(),
  revenue_before_cents: 0,
  opened_month: null,
};

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('me');
  return { ...defaultSettings, ...(s ?? {}) };
}

export async function saveSettings(s: Settings) {
  await db.settings.put(s);
  await db.outbox.add({
    table: 'profiles',
    op: 'upsert',
    row: {
      business_name: s.business_name,
      salary_cents: s.salary_cents,
      pay_per_month: s.pay_per_month,
      close_time: s.close_time,
      opening_biz_cents: s.opening_biz_cents,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      activity: s.activity,
      has_employee: s.has_employee,
      kept_reports: s.kept_reports,
      dasn_done: s.dasn_done,
      track_limit: s.track_limit,
      limit_year: s.limit_year,
      revenue_before_cents: s.revenue_before_cents,
      opened_month: s.opened_month,
    },
  });
}

export async function setConsent(accepted: boolean) {
  const s = await getSettings();
  await db.settings.put({ ...s, consent_research: accepted });
  await db.outbox.add({
    table: 'consents',
    op: 'upsert',
    row: { id: uid(), accepted, terms_version: 'v1', created_at: new Date().toISOString() },
  });
}

export async function addTx(t: Omit<Tx, 'id' | 'created_at'>) {
  const row: Tx = { ...t, id: uid(), created_at: new Date().toISOString() };
  await db.tx.put(row);
  await db.outbox.add({ table: 'transactions', op: 'upsert', row: { ...row } });
  return row;
}

export async function addClosing(c: Omit<Closing, 'id' | 'created_at'>) {
  const row: Closing = { ...c, id: uid(), created_at: new Date().toISOString() };
  await db.closings.put(row);
  await db.outbox.add({ table: 'closings', op: 'upsert', row: { ...row } });
  return row;
}

/** Evento de uso para a pesquisa. Só sobe se houver consentimento (checado no servidor também). */
export async function track(kind: string, props: Record<string, unknown> = {}) {
  const s = await getSettings();
  if (!s.consent_research) return;
  await db.outbox.add({
    table: 'events',
    op: 'upsert',
    row: { id: uid(), kind, props, day: today(), created_at: new Date().toISOString() },
  });
}

export async function wipeLocal() {
  await Promise.all([db.tx.clear(), db.closings.clear(), db.outbox.clear(), db.settings.clear()]);
}
