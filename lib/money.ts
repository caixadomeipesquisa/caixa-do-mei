// Valores guardados em centavos (inteiros) para evitar erro de arredondamento.
export const fmt = (cents: number) =>
  (cents < 0 ? '−' : '') +
  'R$ ' +
  (Math.abs(cents) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmt0 = (cents: number) =>
  (cents < 0 ? '−' : '') + 'R$ ' + Math.round(Math.abs(cents) / 100).toLocaleString('pt-BR');

export const toCents = (reais: string | number) => {
  const n = typeof reais === 'number' ? reais : parseFloat(String(reais).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

/** Data local no formato AAAA-MM-DD (fuso do aparelho). */
export const today = (d = new Date()) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

export const monthKey = (day: string) => day.slice(0, 7);

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
