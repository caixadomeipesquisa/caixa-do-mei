// Regras do MEI usadas pelo app. Conferir a cada ano: valores mudam por lei.
// Limite anual: R$ 81 mil (até 2026); LC 238/2026: R$ 110 mil em 2027 e R$ 140 mil a partir de 2028.
import type { Tx, Activity, Settings } from './db';

export const LIMIT_CENTS: Record<number, number> = { 2025: 8100000, 2026: 8100000, 2027: 11000000, 2028: 14000000 };
export const limitFor = (year: number) => LIMIT_CENTS[year] ?? (year > 2028 ? LIMIT_CENTS[2028] : LIMIT_CENTS[2026]);

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
