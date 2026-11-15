'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  db, getSettings, saveSettings, setConsent, addTx, addClosing, track, wipeLocal,
  defaultSettings, type Settings, type Tx, type Closing, type Drawer, type TxType,
} from '@/lib/db';
import { fmt, fmt0, toCents, today, monthKey } from '@/lib/money';
import { startAutoSync, syncNow, pullAll } from '@/lib/sync';
import { enablePush, pushSupported } from '@/lib/push';
import { supabase, CONTACT } from '@/lib/supabase';

type Screen = 'welcome' | 'consent' | 'setup' | 'home' | 'add' | 'close' | 'pay' | 'month' | 'more' | 'login';
const TABBED: Screen[] = ['home', 'close', 'month', 'more'];

const CATS: Record<TxType, Record<Drawer, string[]>> = {
  in: { biz: ['Venda', 'Recebimento', 'Outro'], home: ['Pagar a mim', 'Outro'] },
  out: { biz: ['Insumos', 'Transporte', 'Conta do negócio', 'DAS', 'Outro'], home: ['Mercado', 'Conta da casa', 'Outro'] },
};
const PAY_LABEL: Record<number, string> = { 4: 'toda semana', 2: 'a cada 15 dias', 1: 'uma vez por mês' };

export default function App() {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [ready, setReady] = useState(false);
  const [s, setS] = useState<Settings>(defaultSettings);
  const [txs, setTxs] = useState<Tx[]>([]);
  const [closings, setClosings] = useState<Closing[]>([]);
  const [toast, setToast] = useState('');
  const [email, setEmail] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [st, t, c] = await Promise.all([getSettings(), db.tx.toArray(), db.closings.toArray()]);
    setS(st); setTxs(t.filter((x) => !x.deleted)); setClosings(c);
    return st;
  }, []);

  useEffect(() => {
    (async () => {
      const st = await reload();
      setScreen(st.onboarded ? 'home' : 'welcome');
      setReady(true);
      void track('app_open');
    })();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const stop = startAutoSync();
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => setEmail(data.session?.user.email ?? null));
      const { data: sub } = supabase.auth.onAuthStateChange(async (ev, session) => {
        setEmail(session?.user.email ?? null);
        if (ev === 'SIGNED_IN') { await pullAll(); await syncNow(); await reload(); }
      });
      return () => { sub.subscription.unsubscribe(); stop?.(); };
    }
    return () => stop?.();
  }, [reload]);

  const say = (t: string) => { setToast(t); window.setTimeout(() => setToast(''), 2600); };
  const go = (x: Screen) => { setScreen(x); window.scrollTo(0, 0); };

  // Saldos e números do mês
  const d0 = today();
  const mk = monthKey(d0);
  const calc = useMemo(() => {
    const sum = (f: (t: Tx) => boolean) => txs.filter(f).reduce((a, t) => a + (t.type === 'in' ? t.cents : -t.cents), 0);
    const biz = s.opening_biz_cents + sum((t) => t.drawer === 'biz');
    const todayIn = txs.filter((t) => t.day === d0 && t.drawer === 'biz' && t.type === 'in').reduce((a, t) => a + t.cents, 0);
    const todayOut = txs.filter((t) => t.day === d0 && t.drawer === 'biz' && t.type === 'out').reduce((a, t) => a + t.cents, 0);
    const paid = txs.filter((t) => t.category === 'Pagar a mim' && t.drawer === 'biz' && monthKey(t.day) === mk).reduce((a, t) => a + t.cents, 0);
    const month = txs.filter((t) => t.drawer === 'biz' && monthKey(t.day) === mk && t.category !== 'Pagar a mim' && t.category !== 'Ajuste do caixa');
    const mIn = month.filter((t) => t.type === 'in').reduce((a, t) => a + t.cents, 0);
    const mOut = month.filter((t) => t.type === 'out').reduce((a, t) => a + t.cents, 0);
    const mix = month.filter((t) => t.type === 'out' && t.category === 'Conta da casa').length;
    const closedDays = new Set(closings.map((c) => c.day));
    return { biz, todayIn, todayOut, paid, mIn, mOut, mix, closedDays, closedToday: closedDays.has(d0) };
  }, [txs, closings, s.opening_biz_cents, d0, mk]);

  if (!ready) return <div className="app" aria-busy="true" />;

  const parcel = Math.round(s.salary_cents / s.pay_per_month);

  return (
    <div className="app">
      {screen === 'welcome' && <Welcome go={go} />}
      {screen === 'consent' && <Consent go={go} onAnswer={async (a) => { await setConsent(a); await reload(); go('setup'); }} />}
      {screen === 'setup' && (
        <Setup s={s} go={go} onSave={async (n) => { await saveSettings({ ...n, onboarded: true }); await reload(); void track('setup_done'); go('home'); say('Pronto. Vamos te lembrar às ' + n.close_time + '.'); }} />
      )}
      {screen === 'home' && (
        <Home s={s} calc={calc} txs={txs.filter((t) => t.day === d0).reverse()} go={go} parcel={parcel} />
      )}
      {screen === 'add' && (
        <Add go={go} onSave={async (t) => { await addTx({ ...t, day: d0 }); void track('tx_add', { drawer: t.drawer, type: t.type, category: t.category }); await reload(); go('home'); say((t.type === 'in' ? 'Anotado: entrou ' : 'Anotado: saiu ') + fmt(t.cents) + '.'); }} />
      )}
      {screen === 'close' && (
        <Close expected={calc.biz} closedDays={calc.closedDays} go={go}
          onClose={async (counted) => {
            if (counted !== null && Math.abs(counted - calc.biz) >= 100) {
              const diff = counted - calc.biz;
              await addTx({ day: d0, type: diff > 0 ? 'in' : 'out', drawer: 'biz', category: 'Ajuste do caixa', cents: Math.abs(diff) });
            }
            await addClosing({ day: d0, expected_cents: calc.biz, counted_cents: counted });
            void track('day_close', { matched: counted === null ? null : Math.abs(counted - calc.biz) < 100 });
            await reload(); go('home'); say('Caixa de hoje fechado. Até amanhã!');
          }} />
      )}
      {screen === 'pay' && (
        <Pay biz={calc.biz} parcel={parcel} s={s} go={go}
          onPay={async () => {
            const v = Math.min(parcel, Math.max(0, calc.biz));
            if (v <= 0) { say('Não há saldo no negócio para pagar agora.'); return; }
            await addTx({ day: d0, type: 'out', drawer: 'biz', category: 'Pagar a mim', cents: v });
            await addTx({ day: d0, type: 'in', drawer: 'home', category: 'Pagar a mim', cents: v });
            void track('pay_self', { full: v === parcel });
            await reload(); go('month'); say('Pago: ' + fmt(v) + ' foi para a casa.');
          }} />
      )}
      {screen === 'month' && <Month s={s} calc={calc} txs={txs} closings={closings} go={go} />}
      {screen === 'more' && (
        <More s={s} email={email} go={go} say={say}
          onConsent={async (a) => { await setConsent(a); await reload(); say(a ? 'Obrigado por participar.' : 'Você saiu da pesquisa. O app continua igual.'); }}
          onWipe={async () => {
            if (supabase && email) await supabase.rpc('delete_my_data');
            await wipeLocal(); await reload(); go('welcome'); say('Seus dados foram apagados.');
          }}
          txs={txs} />
      )}
      {screen === 'login' && <Login go={go} />}

      {toast && <div className="toast on" role="status">{toast}</div>}
      {TABBED.includes(screen) && <Tabs screen={screen} go={go} />}
    </div>
  );
}

/* ---------- Telas ---------- */

function Top({ title, back, go }: { title: string; back?: Screen; go: (s: Screen) => void }) {
  return (
    <div className="top">
      {back && (
        <button className="back" onClick={() => go(back)} aria-label="Voltar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
      )}
      <h2>{title}</h2>
    </div>
  );
}

function Welcome({ go }: { go: (s: Screen) => void }) {
  return (
    <div className="scroll" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <div className="brand"><span className="logo" aria-hidden="true"><i /><i /></span>Caixa do MEI</div>
      <p className="lead">Saiba quanto entrou, quanto saiu e quanto pode tirar para você.</p>
      <p className="muted">Cinco minutos por dia. Sem planilha, sem contador, sem cartão.</p>
      <div className="card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>As 3 regras</h3>
        <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
          <li><b>Duas gavetas:</b> o dinheiro do negócio não se mistura com o da casa.</li>
          <li><b>Seu salário fixo:</b> você tira um valor combinado, não &quot;quando precisa&quot;.</li>
          <li><b>Feche o caixa:</b> todo dia, confira se o que tem bate com o anotado.</li>
        </ol>
      </div>
      <div style={{ flex: 1 }} />
      <div className="stack" style={{ marginTop: 20 }}>
        <button className="btn primary" onClick={() => go('consent')}>Começar</button>
        {supabase && <button className="btn ghost" onClick={() => go('login')}>Já uso, entrar</button>}
      </div>
    </div>
  );
}

function Consent({ go, onAnswer }: { go: (s: Screen) => void; onAnswer: (a: boolean) => void }) {
  const [ok, setOk] = useState(false);
  return (
    <>
      <Top title="Este app faz parte de uma pesquisa" back="welcome" go={go} />
      <div className="scroll">
        <p>O Caixa do MEI é gratuito e faz parte de uma pesquisa de mestrado que estuda se uma rotina simples ajuda o MEI a organizar o dinheiro.</p>
        <div className="card small">
          <p><b>Se você participar:</b> usamos dados de uso (por exemplo, em quantos dias você fechou o caixa), sem seu nome, para a pesquisa.</p>
          <p><b>Nunca:</b> vendemos dados, mostramos anúncios ou pedimos senha de banco.</p>
          <p><b>Você pode sair</b> da pesquisa ou apagar seus dados quando quiser, em Mais › Meus dados.</p>
          <p style={{ margin: 0 }}><b>Dúvidas:</b> {CONTACT}</p>
        </div>
        <p className="small muted" style={{ marginTop: 10 }}>[Texto completo do termo de consentimento aprovado pelo comitê de ética]</p>
        <label className="check" style={{ marginTop: 12 }}>
          <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Li e aceito participar da pesquisa.
        </label>
        <div className="stack" style={{ marginTop: 20 }}>
          <button className="btn primary" disabled={!ok} onClick={() => onAnswer(true)}>Aceito participar</button>
          <button className="btn" onClick={() => onAnswer(false)}>Usar sem participar</button>
        </div>
      </div>
    </>
  );
}

function Setup({ s, go, onSave }: { s: Settings; go: (s: Screen) => void; onSave: (n: Settings) => void }) {
  const [name, setName] = useState(s.business_name);
  const [pay, setPay] = useState(String(s.salary_cents / 100));
  const [freq, setFreq] = useState<1 | 2 | 4>(s.pay_per_month);
  const [time, setTime] = useState(s.close_time);
  const [open, setOpen] = useState(s.opening_biz_cents ? String(s.opening_biz_cents / 100) : '');
  return (
    <>
      <Top title="Quatro perguntas rápidas" back="consent" go={go} />
      <div className="scroll stack" style={{ gap: 18 }}>
        <label className="field">Nome do seu negócio
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Salgados da Ana" />
        </label>
        <label className="field">Quanto tem hoje no negócio?
          <span className="hint">Dinheiro em mãos mais o saldo da conta do negócio.</span>
          <input type="number" inputMode="decimal" value={open} onChange={(e) => setOpen(e.target.value)} placeholder="0,00" />
        </label>
        <label className="field">Quanto você quer tirar por mês para a casa?
          <span className="hint">Seu salário fixo. Dá para mudar depois.</span>
          <input type="number" inputMode="decimal" value={pay} onChange={(e) => setPay(e.target.value)} />
        </label>
        <label className="field">De quanto em quanto tempo você se paga?
          <select value={freq} onChange={(e) => setFreq(Number(e.target.value) as 1 | 2 | 4)}>
            <option value={4}>Toda semana</option><option value={2}>A cada 15 dias</option><option value={1}>Uma vez por mês</option>
          </select>
        </label>
        <label className="field">Que horas fechar o caixa?
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <button className="btn primary" onClick={() => onSave({ ...s, business_name: name.trim() || 'Meu negócio', salary_cents: toCents(pay), pay_per_month: freq, close_time: time || '19:00', opening_biz_cents: toCents(open || '0') })}>Pronto</button>
      </div>
    </>
  );
}

type Calc = { biz: number; todayIn: number; todayOut: number; paid: number; mIn: number; mOut: number; mix: number; closedDays: Set<string>; closedToday: boolean };

function Home({ s, calc, txs, go, parcel }: { s: Settings; calc: Calc; txs: Tx[]; go: (x: Screen) => void; parcel: number }) {
  const dias = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const now = new Date();
  const pct = s.salary_cents ? Math.min(100, (calc.paid / s.salary_cents) * 100) : 0;
  return (
    <>
      <div className="top" style={{ paddingBottom: 0 }}>
        <div style={{ flex: 1 }}>
          <div className="small muted">Hoje, {dias[now.getDay()]} {now.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long' })}</div>
          <h2>{s.business_name}</h2>
        </div>
        <span className="offline"><i aria-hidden="true" />salvo no aparelho</span>
      </div>
      <div className="scroll">
        <div className="drawer biz">
          <div className="lbl"><span className="dot biz" aria-hidden="true" />Gaveta do negócio</div>
          <div className="money big">{fmt(calc.biz)}</div>
          <div className="small muted">Hoje entrou {fmt(calc.todayIn)} e saiu {fmt(calc.todayOut)}</div>
        </div>
        <div className="drawer home" style={{ marginTop: 10 }}>
          <div className="lbl"><span className="dot home" aria-hidden="true" />Seu salário este mês</div>
          <div className="money" style={{ fontSize: 20, marginTop: 4 }}>{fmt0(calc.paid)} de {fmt0(s.salary_cents)}</div>
          <div className="bar" aria-hidden="true"><i style={{ width: pct + '%' }} /></div>
          <div className="small">{calc.paid >= s.salary_cents ? 'Salário do mês completo.' : 'Próxima parcela: ' + fmt0(parcel) + ' (' + PAY_LABEL[s.pay_per_month] + ')'}</div>
        </div>
        <div className="cta">
          <button className="in" onClick={() => { sessionStorage.setItem('add-type', 'in'); go('add'); }}>+ Entrou<small>venda, recebimento</small></button>
          <button className="out" onClick={() => { sessionStorage.setItem('add-type', 'out'); go('add'); }}>− Saiu<small>compra, conta, gasto</small></button>
        </div>
        {!calc.closedToday && (
          <div className="banner">
            <div><b>Feche o caixa de hoje</b><span className="small muted">Leva 1 minuto</span></div>
            <button className="go" onClick={() => go('close')}>Fechar</button>
          </div>
        )}
        <h3>Hoje</h3>
        <ul className="list">
          {txs.length === 0 && <li className="muted small">Nada anotado hoje ainda.</li>}
          {txs.map((t) => (
            <li key={t.id}>
              <span className={'tag ' + t.drawer}>{t.drawer === 'biz' ? 'Negócio' : 'Casa'}</span>
              <div className="desc"><b>{t.category}</b><span>{t.type === 'in' ? 'Entrou' : 'Saiu'}</span></div>
              <span className={'money ' + (t.type === 'in' ? 'pos' : 'neg')}>{(t.type === 'in' ? '+' : '−') + fmt(t.cents)}</span>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function Add({ go, onSave }: { go: (x: Screen) => void; onSave: (t: { type: TxType; drawer: Drawer; category: string; cents: number }) => void }) {
  const initial = (typeof window !== 'undefined' && (sessionStorage.getItem('add-type') as TxType)) || 'in';
  const [type, setType] = useState<TxType>(initial);
  const [drawer, setDrawer] = useState<Drawer>('biz');
  const [digits, setDigits] = useState('');
  const [cat, setCat] = useState('');
  const cents = parseInt(digits || '0', 10);
  const key = (k: string) => {
    if (k === '⌫') setDigits(digits.slice(0, -1));
    else if (digits.length < 8) setDigits((digits + k).replace(/^0+/, ''));
  };
  return (
    <>
      <Top title="Anotar" back="home" go={go} />
      <div className="scroll">
        <div className="seg" role="group" aria-label="Tipo">
          <button aria-pressed={type === 'in'} onClick={() => { setType('in'); setCat(''); }}>Entrou</button>
          <button aria-pressed={type === 'out'} onClick={() => { setType('out'); setCat(''); }}>Saiu</button>
        </div>
        <div className="amount money" aria-live="polite">{fmt(cents)}</div>
        <div className="seg" role="group" aria-label="De qual gaveta">
          <button className="biz" aria-pressed={drawer === 'biz'} onClick={() => { setDrawer('biz'); setCat(''); }}>Negócio</button>
          <button className="home" aria-pressed={drawer === 'home'} onClick={() => { setDrawer('home'); setCat(''); }}>Casa</button>
        </div>
        <p className="small muted" style={{ margin: '8px 2px 0' }}>
          {drawer === 'biz' ? 'Dinheiro do negócio: vendas, insumos, contas da atividade.' : 'Dinheiro da casa: mercado, aluguel, contas da família.'}
        </p>
        <h3>O que foi?</h3>
        <div className="chips">
          {CATS[type][drawer].map((c) => <button key={c} className="chip" aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <div className="keypad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'].map((k) => (
            <button key={k} onClick={() => key(k)} aria-label={k === '⌫' ? 'Apagar' : k}>{k}</button>
          ))}
        </div>
        <button className="btn primary" style={{ marginTop: 12 }} disabled={!(cents > 0 && cat)} onClick={() => onSave({ type, drawer, category: cat, cents })}>Salvar</button>
      </div>
    </>
  );
}

function Close({ expected, closedDays, go, onClose }: { expected: number; closedDays: Set<string>; go: (x: Screen) => void; onClose: (counted: number | null) => void }) {
  const [real, setReal] = useState('');
  const counted = real.trim() ? toCents(real) : null;
  const diff = counted === null ? null : counted - expected;
  const last14 = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (13 - i)); return today(d); });
  const n = last14.filter((d) => closedDays.has(d)).length;
  return (
    <>
      <Top title="Fechar o caixa" back="home" go={go} />
      <div className="scroll">
        <div className="card">
          <div className="small muted">Pelo que você anotou, a gaveta do negócio deveria ter</div>
          <div className="money big">{fmt(expected)}</div>
        </div>
        <label className="field" style={{ marginTop: 16 }}>Quanto tem de verdade agora?
          <span className="hint">Some o dinheiro em mãos e o saldo da conta do negócio.</span>
          <input type="number" inputMode="decimal" step="0.01" placeholder="0,00" value={real} onChange={(e) => setReal(e.target.value)} />
        </label>
        {diff !== null && (
          Math.abs(diff) < 100
            ? <div className="diff ok">Bateu. Seu caixa está certo.</div>
            : <div className="diff bad">{diff < 0 ? 'Faltam ' : 'Sobram '}{fmt(Math.abs(diff))}. Algum gasto ou venda ficou sem anotar? Se não achar, feche assim mesmo: o app registra o ajuste.</div>
        )}
        <button className="btn primary" style={{ marginTop: 16 }} onClick={() => onClose(counted)}>Fechar o dia</button>
        <h3>Últimos 14 dias</h3>
        <div className="streak" aria-label={'Caixa fechado em ' + n + ' dos últimos 14 dias'}>
          {last14.map((d) => <i key={d} className={closedDays.has(d) ? 'd' : ''} title={d} />)}
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>Você fechou o caixa em {n} dos últimos 14 dias.</p>
      </div>
    </>
  );
}

function Pay({ biz, parcel, s, go, onPay }: { biz: number; parcel: number; s: Settings; go: (x: Screen) => void; onPay: () => void }) {
  return (
    <>
      <Top title="Pagar a si mesmo" back="month" go={go} />
      <div className="scroll">
        <p>Hoje é dia de passar seu salário da gaveta do negócio para a da casa.</p>
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="small muted">Valor desta vez</div>
          <div className="money big">{fmt(parcel)}</div>
          <div className="small muted">{fmt0(s.salary_cents)} por mês, {PAY_LABEL[s.pay_per_month]}</div>
        </div>
        {biz < parcel && <div className="diff bad">A gaveta do negócio não tem o suficiente. Pague só o que der: tirar a mais agora é o que desorganiza o mês.</div>}
        <div className="stack" style={{ marginTop: 16 }}>
          <button className="btn primary" onClick={onPay}>Passei para a casa</button>
          <button className="btn ghost" onClick={() => go('month')}>Agora não</button>
        </div>
      </div>
    </>
  );
}

function Month({ s, calc, txs, closings, go }: { s: Settings; calc: Calc; txs: Tx[]; closings: Closing[]; go: (x: Screen) => void }) {
  const mk = monthKey(today());
  const closedMonth = new Set(closings.filter((c) => monthKey(c.day) === mk).map((c) => c.day)).size;
  const pct = s.salary_cents ? Math.min(100, (calc.paid / s.salary_cents) * 100) : 0;
  const weeks = [0, 0, 0, 0];
  const now = Date.now();
  txs.forEach((t) => {
    if (t.drawer !== 'biz' || t.type !== 'in' || t.category === 'Pagar a mim' || t.category === 'Ajuste do caixa') return;
    const ago = Math.floor((now - new Date(t.day + 'T12:00:00').getTime()) / 864e5);
    if (ago < 28) weeks[3 - Math.floor(ago / 7)] += t.cents;
  });
  const mx = Math.max(...weeks) || 1;
  return (
    <>
      <Top title={'Resumo de ' + new Date().toLocaleDateString('pt-BR', { month: 'long' })} go={go} />
      <div className="scroll">
        <div className="kpis">
          <div className="kpi"><span>Entrou</span><b className="money pos">{fmt0(calc.mIn)}</b></div>
          <div className="kpi"><span>Saiu</span><b className="money neg">{fmt0(calc.mOut)}</b></div>
          <div className="kpi"><span>Sobrou no negócio</span><b className="money">{fmt0(calc.mIn - calc.mOut)}</b></div>
          <div className="kpi"><span>Caixa fechado</span><b className="money">{closedMonth} dias</b></div>
        </div>
        <h3>Entradas por semana</h3>
        <div className="chart" role="img" aria-label="Entradas das últimas quatro semanas">
          {weeks.map((v, i) => (
            <div key={i}><span className="money" style={{ fontSize: 11 }}>{fmt0(v)}</span><span className="b" style={{ height: Math.max(4, (v / mx) * 80) }} /><span>{i === 3 ? 'esta' : 3 - i + ' atrás'}</span></div>
          ))}
        </div>
        <div className="drawer home" style={{ marginTop: 18 }}>
          <div className="lbl"><span className="dot home" aria-hidden="true" />Seu salário</div>
          <div className="money" style={{ fontSize: 20, marginTop: 4 }}>{fmt0(calc.paid)} de {fmt0(s.salary_cents)}</div>
          <div className="bar" aria-hidden="true"><i style={{ width: pct + '%' }} /></div>
          <button className="btn" style={{ marginTop: 8 }} onClick={() => go('pay')}>Pagar a mim mesmo</button>
        </div>
        <p className="small muted" style={{ marginTop: 12 }}>Conta da casa paga com dinheiro do negócio este mês: <b>{calc.mix} {calc.mix === 1 ? 'vez' : 'vezes'}</b>. A meta é zero.</p>
      </div>
    </>
  );
}

function More({ s, email, go, say, onConsent, onWipe, txs }: { s: Settings; email: string | null; go: (x: Screen) => void; say: (t: string) => void; onConsent: (a: boolean) => void; onWipe: () => void; txs: Tx[] }) {
  const [armed, setArmed] = useState(false);
  const exportCsv = () => {
    const rows = [['data', 'tipo', 'gaveta', 'categoria', 'valor']].concat(
      txs.map((t) => [t.day, t.type === 'in' ? 'entrou' : 'saiu', t.drawer === 'biz' ? 'negocio' : 'casa', t.category, (t.cents / 100).toFixed(2).replace('.', ',')]),
    );
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(';')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'caixa-do-mei.csv'; a.click();
    say('Arquivo baixado.');
  };
  return (
    <>
      <Top title="Mais" go={go} />
      <div className="scroll">
        <h3 style={{ marginTop: 4 }}>Conta e lembretes</h3>
        <div className="card small">
          {supabase ? (
            email ? <p style={{ margin: 0 }}>Entrou como <b>{email}</b>. Seus dados ficam guardados com segurança e aparecem em outro celular.</p>
              : <><p>Crie uma conta só com seu e-mail para guardar seus dados e receber lembretes.</p><button className="btn" onClick={() => go('login')}>Entrar com e-mail</button></>
          ) : <p style={{ margin: 0 }}>Modo local: seus dados ficam só neste aparelho.</p>}
        </div>
        {pushSupported() && (
          <button className="btn" style={{ marginTop: 10 }} onClick={async () => {
            const r = await enablePush();
            say(r === 'ok' ? 'Lembretes ligados. O fechamento será lembrado às ' + s.close_time + '.' : r === 'no-login' ? 'Entre com seu e-mail para receber lembretes.' : r === 'denied' ? 'As notificações estão bloqueadas no celular.' : 'Este navegador não recebe notificações.');
          }}>Ligar lembretes no celular</button>
        )}
        <h3>Meus dados</h3>
        <div className="stack">
          <button className="btn" onClick={exportCsv}>Baixar meus lançamentos (CSV)</button>
          <button className="btn" style={{ color: 'var(--bad)' }} onClick={() => { if (!armed) { setArmed(true); window.setTimeout(() => setArmed(false), 4000); return; } setArmed(false); onWipe(); }}>
            {armed ? 'Toque de novo para apagar tudo' : 'Apagar todos os meus dados'}
          </button>
        </div>
        <h3>Pesquisa</h3>
        <div className="card small">
          <p>{s.consent_research ? 'Você participa da pesquisa. Seus dados de uso vão sem seu nome.' : 'Você usa o app sem participar da pesquisa.'}</p>
          <button className="btn" onClick={() => onConsent(!s.consent_research)}>{s.consent_research ? 'Sair da pesquisa' : 'Participar da pesquisa'}</button>
        </div>
        <h3>Configuração</h3>
        <button className="btn" onClick={() => go('setup')}>Mudar salário, horário ou nome</button>
        <h3>Sobre</h3>
        <p className="small muted">Caixa do MEI · protocolo aberto &quot;Manter simples&quot; · pesquisa de mestrado. Gratuito, sem anúncios. Dúvidas: <a href={'mailto:' + CONTACT}>{CONTACT}</a></p>
      </div>
    </>
  );
}

function Login({ go }: { go: (x: Screen) => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState('');
  if (!supabase) return null;
  return (
    <>
      <Top title="Entrar com e-mail" back="more" go={go} />
      <div className="scroll stack" style={{ gap: 16 }}>
        <p className="small muted">Sem senha: mandamos um código de 6 números para o seu e-mail.</p>
        <label className="field">Seu e-mail
          <input type="text" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} />
        </label>
        {!sent ? (
          <button className="btn primary" disabled={!email.includes('@')} onClick={async () => {
            setErr('');
            const { error } = await supabase!.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
            if (error) setErr('Não deu para enviar o código. Confira o e-mail e tente de novo.'); else setSent(true);
          }}>Mandar código</button>
        ) : (
          <>
            <label className="field">Código que chegou no e-mail
              <input type="text" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            </label>
            <button className="btn primary" disabled={code.length < 6} onClick={async () => {
              setErr('');
              const { error } = await supabase!.auth.verifyOtp({ email, token: code, type: 'email' });
              if (error) setErr('Código inválido ou vencido.'); else go('home');
            }}>Entrar</button>
          </>
        )}
        {err && <p className="err">{err}</p>}
      </div>
    </>
  );
}

function Tabs({ screen, go }: { screen: Screen; go: (x: Screen) => void }) {
  const item = (id: Screen, label: string, path: React.ReactNode) => (
    <button onClick={() => go(id)} aria-current={screen === id ? 'page' : undefined}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">{path}</svg>{label}
    </button>
  );
  return (
    <nav className="tabs" aria-label="Navegação">
      {item('home', 'Hoje', <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />)}
      {item('close', 'Fechar', <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M3 11h18M8 7V4h8v3" /></>)}
      {item('month', 'Mês', <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />)}
      {item('more', 'Mais', <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></>)}
    </nav>
  );
}
