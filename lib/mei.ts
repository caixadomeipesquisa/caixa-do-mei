// Regras do MEI usadas pelo app. Nada depende de um ano fixo: o ano vem da data do aparelho
// e o teto vem de uma tabela de vigência ("a partir de"). A tabela padrão abaixo vale sem internet;
// a tabela public.mei_rules no Supabase (migração 0004) a substitui, sem precisar publicar o app de novo.
import type { Tx, Activity, Settings } from './db';

export interface LimitRule { from_year: number; limit_cents: number; source: string }

export const DEFAULT_RULES: LimitRule[] = [
  { from_year: 2018, limit_cents: 8100000, source: 'LC 155/2016' },
  { from_year: 2027, limit_cents: 11000000, source: 'LC 238/2026' },
  { from_year: 2028, limit_cents: 14000000, source: 'LC 238/2026' },
];

const RULES_KEY = 'caixa-mei-rules';
let rules: LimitRule[] = DEFAULT_RULES;
try {
  const c = typeof localStorage !== 'undefined' ? localStorage.getItem(RULES_KEY) : null;
  if (c) { const r = JSON.parse(c) as LimitRule[]; if (Array.isArray(r) && r.length) rules = r; }
} catch { /* sem cache: usa a tabela padrão */ }

/** Troca a tabela (vinda do Supabase) e guarda no aparelho. */
export function setRules(r: LimitRule[]) {
  const ok = r.filter((x) => Number.isInteger(x.from_year) && x.limit_cents > 0);
  if (!ok.length) return;
  rules = ok.sort((a, b) => a.from_year - b.from_year);
  try { localStorage.setItem(RULES_KEY, JSON.stringify(rules)); } catch { /* sem armazenamento */ }
}

const sorted = () => [...rules].sort((a, b) => a.from_year - b.from_year);
/** Regra vigente no ano: a última com from_year <= ano (anos anteriores à tabela usam a primeira). */
export const ruleFor = (year: number) => sorted().filter((r) => r.from_year <= year).pop() ?? sorted()[0];
export const limitFor = (year: number) => ruleFor(year).limit_cents;
/** Próxima mudança de teto já prevista em lei depois do ano informado, se houver. */
export const nextChange = (year: number) => {
  const cur = limitFor(year);
  return sorted().find((r) => r.from_year > year && r.limit_cents !== cur) ?? null;
};

/** Limite do ano; no ano de abertura, proporcional aos meses de atividade (do mês de abertura a dezembro). */
export function yearLimit(year: number, openedMonth: number | null) {
  const full = limitFor(year);
  if (!openedMonth) return full;
  return Math.round((full / 12) * (13 - openedMonth));
}

export const REVENUE_CATS = ['Venda', 'Recebimento'];
export const isRevenue = (t: Tx) => !t.deleted && t.drawer === 'biz' && t.type === 'in' && REVENUE_CATS.includes(t.category);

export const ACT_LABEL: Record<Activity, string> = { comercio: 'Comércio', industria: 'Indústria', servicos: 'Serviços' };

/** Linhas do Relatório Mensal das Receitas Brutas (mesma estrutura do modelo oficial). */
export function monthlyReport(txs: Tx[], month: string, s: Settings) {
  const rows: Record<Activity, { sem: number; com: number }> = {
    comercio: { sem: 0, com: 0 }, industria: { sem: 0, com: 0 }, servicos: { sem: 0, com: 0 },
  };
  txs.filter((t) => isRevenue(t) && t.day.slice(0, 7) === month).forEach((t) => {
    const a = t.activity ?? s.activity;
    if (t.nf) rows[a].com += t.cents; else rows[a].sem += t.cents;
  });
  const total = (['comercio', 'industria', 'servicos'] as Activity[]).reduce((x, a) => x + rows[a].sem + rows[a].com, 0);
  return { rows, total };
}

/** Números que a DASN-SIMEI pede para o ano-calendário. */
export function annualSummary(txs: Tx[], year: number, s: Settings) {
  let comInd = 0, serv = 0;
  txs.filter((t) => isRevenue(t) && t.day.startsWith(String(year))).forEach((t) => {
    const a = t.activity ?? s.activity;
    if (a === 'servicos') serv += t.cents; else comInd += t.cents;
  });
  const before = s.track_limit && s.limit_year === year ? s.revenue_before_cents : 0;
  return { comInd, serv, before, total: comInd + serv + before };
}

export function revenueYear(txs: Tx[], year: number) {
  return txs.filter((t) => isRevenue(t) && t.day.startsWith(String(year))).reduce((a, t) => a + t.cents, 0);
}

export const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export const monthName = (ym: string, cap = false) => { const n = MONTHS[Number(ym.slice(5, 7)) - 1]; return (cap ? n[0].toUpperCase() + n.slice(1) : n) + ' de ' + ym.slice(0, 4); };
export const prevMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

export const PORTAL_SIMPLES = 'https://www8.receita.fazenda.gov.br/SimplesNacional/';

/**
 * Quanto do ano os registros do app cobrem, para não apresentar como completo um total que não é.
 * 'none': o app começou depois do ano; 'partial': começou no meio do ano e a receita anterior não foi informada.
 */
export function coverage(txs: Tx[], year: number, s: Settings): { kind: 'full' | 'partial' | 'none'; since: string | null } {
  const days = txs.filter((t) => !t.deleted).map((t) => t.day).sort();
  const first = days[0] ?? null;
  if (!first || first.slice(0, 4) > String(year)) return { kind: 'none', since: first ? first.slice(0, 7) : null };
  if (first.slice(0, 4) < String(year)) return { kind: 'full', since: first.slice(0, 7) };
  const informed = s.limit_year === year && (s.revenue_before_cents > 0 || (!!s.opened_month && Number(first.slice(5, 7)) <= s.opened_month));
  return { kind: first.slice(5, 7) === '01' || informed ? 'full' : 'partial', since: first.slice(0, 7) };
}
