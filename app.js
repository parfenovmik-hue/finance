'use strict';

/* =========================================================
   Финансы — PWA для личного учёта.
   Данные: IndexedDB на телефоне + синхронизация с Google Sheets
   через Apps Script (см. google-apps-script/Code.gs).
   ========================================================= */

const APP_VERSION = '1.1.0';

/* ---------------- Утилиты ---------------- */

const $ = (s, r = document) => r.querySelector(s);
const uid = (p) => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthOf = (dateStr) => String(dateStr).slice(0, 7);
const byOrder = (a, b) => (a.order || 0) - (b.order || 0);
// Счета: сначала рублёвые, потом USDT, внутри — по порядку добавления
const CUR_ORDER = { RUB: 0, USDT: 1 };
const byAcc = (a, b) => (CUR_ORDER[a.currency] ?? 9) - (CUR_ORDER[b.currency] ?? 9) || byOrder(a, b);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/[\s  ]/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}

const CUR = { RUB: { sym: '₽' }, USDT: { sym: 'USDT' } };
const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtNum(x, cur) {
  x = round2(x);
  if (cur === 'USDT') return nf2.format(x);
  return Number.isInteger(x) ? nf0.format(x) : nf2.format(x);
}
function fmt(x, cur = 'RUB', sign = false) {
  const s = x < 0 ? '−' : sign && x > 0 ? '+' : '';
  return s + fmtNum(Math.abs(x), cur) + ' ' + (CUR[cur] || CUR.RUB).sym;
}
const fmtRub = (x, sign) => fmt(Math.round(x), 'RUB', sign);

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

function plural(n, forms) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function dayLabel(s) {
  const d = parseYmd(s), t = new Date();
  const y = new Date(); y.setDate(t.getDate() - 1);
  if (s === ymd(t)) return 'Сегодня';
  if (s === ymd(y)) return 'Вчера';
  const yr = d.getFullYear() !== t.getFullYear() ? ' ' + d.getFullYear() : '';
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${yr}, ${WD[d.getDay()]}`;
}
function monthLabel(m) { const [y, mm] = m.split('-').map(Number); return `${MONTHS[mm - 1]} ${y}`; }
function shiftMonth(m, delta) { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + delta, 1); return ymd(d).slice(0, 7); }

const ICON = {
  transfer: '<svg viewBox="0 0 24 24"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>',
  debt: '<svg viewBox="0 0 24 24"><path d="M4 7h16v12H4zM4 11h16M8 15h3"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  sync: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg>',
};

// Линейные иконки категорий (24×24, обводка)
const CAT_ICONS = {
  cart: '<circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M2.5 3h2.6l2.4 12h11l2-8H6.2"/>',
  bag: '<path d="M5 7h14l-1 14H6z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  cup: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3"/>',
  food: '<path d="M5 3v7a2 2 0 0 0 4 0V3M7 12v9M17 21V3c-2 1-3 3.5-3 7h3"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 21v-3M16 21v-3"/><circle cx="8" cy="14.5" r=".8"/><circle cx="16" cy="14.5" r=".8"/>',
  fuel: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/>',
  plane: '<path d="M22 16v-2l-8.5-5V3.5a1.5 1.5 0 0 0-3 0V9L2 14v2l8.5-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5l-2-1.5v-5.5z"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  phone: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  repeat: '<path d="M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4"/>',
  health: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7.5 3c0 5.4-7.5 10-7.5 10z"/>',
  scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5 20 18M8 16.5 20 6"/>',
  shirt: '<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z"/>',
  sport: '<path d="M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13M12 8S10.5 3 8 3.5 7 8 12 8zM12 8s1.5-5 4-4.5S17 8 12 8z"/>',
  book: '<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H20v15H5.5A1.5 1.5 0 0 0 4 19.5zM4 19.5A1.5 1.5 0 0 0 5.5 21H20v-3"/>',
  paw: '<circle cx="7" cy="10" r="1.8"/><circle cx="12" cy="7" r="1.8"/><circle cx="17" cy="10" r="1.8"/><path d="M8 17c0-2.5 1.8-4.5 4-4.5s4 2 4 4.5a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  doc: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  tag: '<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.3"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  laptop: '<rect x="5" y="4" width="14" height="11" rx="1.5"/><path d="M2.5 19h19"/>',
  percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  coins: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>',
  bank: '<path d="M3 9.5 12 4l9 5.5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20.5h18"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
};
const EMOJI_TO_ICON = { '🛒': 'cart', '☕': 'cup', '🚕': 'bus', '🏠': 'home', '📱': 'phone', '💊': 'health', '👕': 'shirt', '🎉': 'star', '🎁': 'gift', '✈️': 'plane', '📚': 'book', '📦': 'box', '💼': 'briefcase', '💻': 'laptop', '💸': 'percent' };
const svgIcon = (k) => `<svg viewBox="0 0 24 24">${CAT_ICONS[k] || CAT_ICONS.box}</svg>`;
const catIcon = (c) => (c && !c.icon && c.emoji ? esc(c.emoji) : svgIcon(c?.icon));

/* ---------------- Хранилище (IndexedDB с запасным localStorage) ---------------- */

const Store = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('finpanel', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(r.result); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(k) {
    try {
      const db = await this.open();
      return await new Promise((res, rej) => {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
    } catch (e) {
      try { const v = localStorage.getItem('fp_' + k); return v ? JSON.parse(v) : undefined; } catch (_) { return undefined; }
    }
  },
  async set(k, v) {
    try {
      const db = await this.open();
      await new Promise((res, rej) => {
        const t = db.transaction('kv', 'readwrite');
        t.objectStore('kv').put(v, k);
        t.oncomplete = res;
        t.onerror = () => rej(t.error);
      });
    } catch (e) {
      try { localStorage.setItem('fp_' + k, JSON.stringify(v)); } catch (_) { toast('Не удалось сохранить данные'); }
    }
  },
};

/* ---------------- Состояние ---------------- */

const KINDS = ['accounts', 'categories', 'debts', 'txs'];
let state;
const ui = { reveal: false, tab: 'home', month: monthOf(ymd()), histAccount: '', sync: { status: 'idle', msg: '' }, sheets: [] };

function defaultSettings() {
  return { rate: 0, rateAuto: true, rateAt: 0, syncUrl: '', syncSecret: '', lastSync: 0, last: {}, quietDays: [], hideInstallTip: false };
}

function defaultState() {
  const now = Date.now();
  const mk = (p, o, i) => ({ id: uid(p), ...o, order: i, updatedAt: now, deleted: false, _dirty: true });
  const exp = [['cart', 'Продукты'], ['cup', 'Кафе и рестораны'], ['bus', 'Транспорт'], ['home', 'Жильё'], ['phone', 'Связь и подписки'], ['health', 'Здоровье'],
    ['shirt', 'Одежда'], ['star', 'Развлечения'], ['gift', 'Подарки'], ['plane', 'Путешествия'], ['book', 'Обучение'], ['box', 'Другое']];
  const inc = [['briefcase', 'Зарплата'], ['laptop', 'Подработка'], ['percent', 'Кэшбэк и %'], ['gift', 'Подарки'], ['box', 'Другое']];
  return {
    v: 1,
    accounts: [
      mk('a', { name: 'Карта', currency: 'RUB', initial: 0, archived: false }, 0),
      mk('a', { name: 'Наличные', currency: 'RUB', initial: 0, archived: false }, 1),
      mk('a', { name: 'USDT', currency: 'USDT', initial: 0, archived: false }, 2),
    ],
    categories: [
      ...exp.map(([ic, n], i) => mk('c', { name: n, icon: ic, emoji: '', kind: 'expense' }, i)),
      ...inc.map(([ic, n], i) => mk('c', { name: n, icon: ic, emoji: '', kind: 'income' }, i)),
    ],
    debts: [],
    txs: [],
    settings: defaultSettings(),
  };
}

function save() { Store.set('state', state); }

const live = (k) => state[k].filter((e) => !e.deleted);
const byId = (k, id) => (id ? state[k].find((e) => e.id === id) : undefined);
const accCur = (id) => byId('accounts', id)?.currency || 'RUB';

function upsert(k, obj) {
  obj.updatedAt = Math.max(Date.now(), (byId(k, obj.id)?.updatedAt || 0) + 1);
  obj._dirty = true;
  const i = state[k].findIndex((e) => e.id === obj.id);
  if (i < 0) state[k].push(obj); else state[k][i] = obj;
  save();
  scheduleSync();
}
function softDelete(k, id) {
  const e = byId(k, id);
  if (!e) return;
  upsert(k, { ...e, deleted: true });
}

/* ---------------- Расчёты ---------------- */

const toRub = (x, cur) => (cur === 'USDT' ? x * (state.settings.rate || 0) : x);

// Уходят ли деньги со счёта при операции по долгу
function debtMoneyOut(t) {
  const d = byId('debts', t.debt);
  return ((d?.direction || 'owe') === 'owe') === (t.debtAction === 'pay');
}
function debtActionLabel(d, action) {
  const lent = d?.direction === 'lent';
  if (action === 'pay') return lent ? 'Мне вернули' : 'Платёж по долгу';
  return lent ? 'Дал в долг' : 'Занял';
}
// Валюта, в которой записана сумма операции
function txCur(t) {
  if (t.type === 'debt' && !t.account) return byId('debts', t.debt)?.currency || 'RUB';
  return accCur(t.account);
}

function accountDeltas(t) {
  switch (t.type) {
    case 'expense': return [[t.account, -t.amount]];
    case 'income': return [[t.account, t.amount]];
    case 'transfer': return [[t.account, -t.amount], [t.toAccount, t.toAmount]];
    case 'debt': return t.account ? [[t.account, debtMoneyOut(t) ? -t.amount : t.amount]] : [];
  }
  return [];
}

function balances() {
  const m = {};
  for (const a of state.accounts) m[a.id] = a.initial || 0;
  for (const t of state.txs) {
    if (t.deleted) continue;
    for (const [id, d] of accountDeltas(t)) if (id in m) m[id] += d;
  }
  return m;
}

function debtStats() {
  const m = {};
  for (const d of state.debts) m[d.id] = { rest: d.initial || 0, start: d.initial || 0, added: 0, paid: 0 };
  for (const t of state.txs) {
    if (t.deleted || t.type !== 'debt' || !m[t.debt]) continue;
    const amt = t.debtAmount || t.amount;
    if (t.debtAction === 'pay') { m[t.debt].rest -= amt; m[t.debt].paid += amt; }
    else { m[t.debt].rest += amt; m[t.debt].added += amt; }
  }
  return m;
}

function totals() {
  const bal = balances();
  let rub = 0, usdt = 0;
  for (const a of live('accounts')) { if (a.currency === 'USDT') usdt += bal[a.id]; else rub += bal[a.id]; }
  const ds = debtStats();
  let owe = 0, lent = 0;
  for (const d of live('debts')) {
    const r = Math.max(0, ds[d.id].rest);
    if (d.direction === 'lent') lent += toRub(r, d.currency); else owe += toRub(r, d.currency);
  }
  return { bal, rub, usdt, total: rub + toRub(usdt, 'USDT'), owe, lent, ds };
}

function monthStats(m) {
  const r = { inc: 0, exp: 0, debtPaid: 0, debtTaken: 0, lentOut: 0, lentBack: 0, byExp: {}, byInc: {}, count: 0 };
  for (const t of state.txs) {
    if (t.deleted || monthOf(t.date) !== m) continue;
    r.count++;
    const v = toRub(t.amount, txCur(t));
    if (t.type === 'expense') { r.exp += v; r.byExp[t.category] = (r.byExp[t.category] || 0) + v; }
    else if (t.type === 'income') { r.inc += v; r.byInc[t.category] = (r.byInc[t.category] || 0) + v; }
    else if (t.type === 'debt') {
      const lent = byId('debts', t.debt)?.direction === 'lent';
      if (t.debtAction === 'pay') lent ? (r.lentBack += v) : (r.debtPaid += v);
      else lent ? (r.lentOut += v) : (r.debtTaken += v);
    }
  }
  return r;
}

function streakInfo() {
  const days = new Set(state.txs.filter((t) => !t.deleted).map((t) => t.date));
  (state.settings.quietDays || []).forEach((d) => days.add(d));
  const today = ymd();
  const d = new Date();
  if (!days.has(today)) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(ymd(d))) { n++; d.setDate(d.getDate() - 1); }
  const last7 = [];
  for (let i = 6; i >= 0; i--) { const x = new Date(); x.setDate(x.getDate() - i); last7.push(days.has(ymd(x))); }
  return { n, last7, today: days.has(today) };
}

/* ---------------- Курс USDT ---------------- */

async function refreshRate(manual) {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=rub', { cache: 'no-store' });
    const j = await r.json();
    const v = j?.tether?.rub;
    if (!v) throw new Error('no rate');
    state.settings.rate = round2(v);
    state.settings.rateAt = Date.now();
    state.settings.rateAuto = true;
    save();
    render();
    refreshTopSheet();
    if (manual) toast(`Курс: 1 USDT = ${fmtNum(v, 'USDT')} ₽`);
  } catch (e) {
    if (manual) toast('Не удалось получить курс — введи вручную');
  }
}

/* ---------------- Синхронизация с Google Sheets ---------------- */

const FIELDS = {
  accounts: { s: ['id', 'name', 'currency'], n: ['initial', 'order', 'updatedAt'], b: ['archived', 'deleted'] },
  categories: { s: ['id', 'name', 'emoji', 'icon', 'kind'], n: ['order', 'updatedAt'], b: ['deleted'] },
  debts: { s: ['id', 'name', 'currency', 'direction', 'creditor', 'note'], n: ['initial', 'updatedAt'], b: ['deleted'] },
  txs: { s: ['id', 'type', 'date', 'account', 'category', 'toAccount', 'debt', 'debtAction', 'note'], n: ['amount', 'toAmount', 'debtAmount', 'createdAt', 'updatedAt'], b: ['deleted'] },
};
const TYPE_RU = { expense: 'Расход', income: 'Доход', transfer: 'Между счетами', debt: 'Долг' };

function norm(k, r) {
  const f = FIELDS[k], o = {};
  f.s.forEach((x) => (o[x] = r[x] == null ? '' : String(r[x])));
  f.n.forEach((x) => (o[x] = parseNum(r[x])));
  f.b.forEach((x) => (o[x] = r[x] === true || String(r[x]).toUpperCase() === 'TRUE'));
  return o;
}

// Строка для таблицы: технические поля + читаемые названия для отчётов
function outRow(k, e) {
  const o = norm(k, e);
  if (k === 'txs') {
    const a = byId('accounts', e.account), b = byId('accounts', e.toAccount);
    const c = byId('categories', e.category), d = byId('debts', e.debt);
    Object.assign(o, {
      typeName: e.type === 'transfer' && b && a && a.currency !== b.currency ? 'Обмен' : TYPE_RU[e.type] || e.type,
      accountName: a?.name || '',
      currency: txCur(e),
      amountRub: round2(toRub(e.amount, txCur(e))),
      categoryName: c ? c.name : '',
      toAccountName: b?.name || '',
      toCurrency: b?.currency || '',
      debtName: d?.name || '',
      debtActionName: e.type === 'debt' ? debtActionLabel(d, e.debtAction) : '',
    });
  }
  return o;
}

let syncBusy = false, syncTimer;
function scheduleSync(delay = 2500) {
  if (!state.settings.syncUrl) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(false), delay);
}
function setSync(status, msg = '') {
  ui.sync = { status, msg };
  const dot = $('#sync-dot');
  if (dot) dot.className = 'sync-dot ' + ({ ok: 'ok', error: 'err', busy: 'wait' }[status] || '');
  refreshTopSheet();
}
const hasDirty = () => KINDS.some((k) => state[k].some((e) => e._dirty));

async function syncPost(changes) {
  const s = state.settings;
  let r;
  try {
    r = await fetch(s.syncUrl.trim(), {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ secret: s.syncSecret, changes }),
    });
  } catch (e) { throw new Error('Нет связи с таблицей'); }
  let j;
  try { j = await r.json(); } catch (e) { throw new Error('Скрипт ответил не JSON — проверь адрес и доступ «Все»'); }
  if (!j.ok) throw new Error(j.error || 'Ошибка скрипта');
  return j.data || {};
}

function collectChanges() {
  const changes = {}, sent = [];
  for (const k of KINDS) {
    changes[k] = [];
    for (const e of state[k]) if (e._dirty) { changes[k].push(outRow(k, e)); sent.push([k, e.id, e.updatedAt]); }
  }
  return { changes, sent };
}

function mergeRemote(data) {
  for (const k of KINDS) {
    for (const raw of data[k] || []) {
      const r = norm(k, raw);
      if (!r.id) continue;
      const i = state[k].findIndex((e) => e.id === r.id);
      if (i < 0) state[k].push(r);
      else if (!state[k][i]._dirty && r.updatedAt > state[k][i].updatedAt) state[k][i] = r;
    }
  }
}

async function syncNow(manual) {
  const s = state.settings;
  if (!s.syncUrl) { if (manual) toast('Сначала укажи адрес скрипта'); return; }
  if (syncBusy) return;
  if (!navigator.onLine) { setSync('error', 'Нет интернета'); if (manual) toast('Нет интернета'); return; }
  syncBusy = true;
  clearTimeout(syncTimer);
  setSync('busy');
  try {
    const fresh = !s.lastSync && !state.txs.some((t) => !t.deleted);
    if (fresh) {
      // Первое подключение: если в таблице уже есть данные — берём их, иначе заливаем свои
      const data = await syncPost({});
      if (KINDS.some((k) => (data[k] || []).length)) {
        for (const k of KINDS) state[k] = (data[k] || []).map((r) => norm(k, r)).filter((e) => e.id);
      } else {
        const { changes, sent } = collectChanges();
        mergeRemote(await syncPost(changes));
        clearDirty(sent);
      }
    } else {
      const { changes, sent } = collectChanges();
      const data = await syncPost(changes);
      clearDirty(sent);
      mergeRemote(data);
    }
    s.lastSync = Date.now();
    save();
    setSync('ok');
    render();
    if (manual) toast('Синхронизировано ✓');
  } catch (e) {
    setSync('error', e.message);
    if (manual) toast(e.message);
  } finally {
    syncBusy = false;
  }
}
function clearDirty(sent) {
  for (const [k, id, upd] of sent) {
    const e = byId(k, id);
    if (e && e.updatedAt === upd) delete e._dirty;
  }
}

/* ---------------- Листы (модальные окна) ---------------- */

function openSheet({ title, left = 'Отмена', right = '', onRight, actions = {}, onInput, refresh }) {
  const root = $('#sheet-root');
  const bd = document.createElement('div');
  bd.className = 'backdrop';
  const sh = document.createElement('div');
  sh.className = 'sheet';
  sh.setAttribute('role', 'dialog');
  sh.innerHTML = `<div class="sheet-head"><button data-act="sheet-close">${esc(left)}</button><h2>${esc(title)}</h2><button data-act="sheet-right">${esc(right)}</button></div><div class="sheet-body"></div>`;
  root.append(bd, sh);
  const entry = { bd, sh, body: $('.sheet-body', sh), onRight, actions, refresh };
  ui.sheets.push(entry);
  bd.addEventListener('click', () => closeSheet());
  if (onInput) sh.addEventListener('input', onInput);
  if (onInput) sh.addEventListener('change', onInput);
  entry.refresh?.(entry);
  sh.getBoundingClientRect();
  bd.classList.add('show');
  sh.classList.add('show');
  return entry;
}
function closeSheet() {
  const e = ui.sheets.pop();
  if (!e) return;
  e.bd.classList.remove('show');
  e.sh.classList.remove('show');
  setTimeout(() => { e.bd.remove(); e.sh.remove(); }, 280);
  refreshTopSheet();
  render();
}
function refreshTopSheet() {
  const top = ui.sheets[ui.sheets.length - 1];
  if (!top?.refresh) return;
  // Сохраняем прокрутку горизонтальных лент и самого листа
  const keep = {};
  top.body.querySelectorAll('[data-keep]').forEach((el) => (keep[el.dataset.keep] = el.scrollLeft));
  const st = top.body.scrollTop;
  top.refresh(top);
  top.body.querySelectorAll('[data-keep]').forEach((el) => (el.scrollLeft = keep[el.dataset.keep] || 0));
  top.body.scrollTop = st;
}

// Поле суммы растягивается по длине числа, чтобы знак валюты стоял рядом
function fitAmount(el) { el.style.width = Math.max(1, el.value.length || 1) + 0.6 + 'ch'; }

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------------- Строки списков ---------------- */

function txRow(t) {
  const a = byId('accounts', t.account);
  const cur = txCur(t);
  let ico, cls = '', title, meta, amt, amtCls = '', sub = '';
  if (t.type === 'expense' || t.type === 'income') {
    const c = byId('categories', t.category);
    ico = catIcon(c);
    cls = t.type === 'income' ? 'inc' : '';
    title = esc(c?.name || 'Без категории');
    meta = esc(a?.name || '—');
    amt = fmt(t.type === 'income' ? t.amount : -t.amount, cur, true);
    amtCls = t.type === 'income' ? 'pos' : '';
  } else if (t.type === 'transfer') {
    const b = byId('accounts', t.toAccount);
    const tc = b?.currency || 'RUB';
    ico = ICON.transfer; cls = 'trf';
    title = tc !== cur ? 'Обмен' : 'Между счетами';
    meta = esc(`${a?.name || '—'} → ${b?.name || '—'}`);
    amt = fmt(t.amount, cur);
    if (tc !== cur) sub = '→ ' + fmt(t.toAmount, tc);
  } else {
    const d = byId('debts', t.debt);
    const out = debtMoneyOut(t);
    ico = ICON.debt; cls = 'dbt';
    title = esc(d?.name || 'Долг');
    meta = esc(debtActionLabel(d, t.debtAction) + (a ? ' · ' + a.name : ''));
    amt = fmt(out ? -t.amount : t.amount, cur, true);
    amtCls = out ? '' : 'pos';
  }
  if (t.note) meta += ' · ' + esc(t.note);
  return `<button class="row" data-act="edit-tx" data-id="${t.id}">
    <div class="ico ${cls}">${ico}</div>
    <div class="main"><div class="title">${title}</div><div class="meta">${meta}</div></div>
    <div class="amt num ${amtCls}">${amt}${sub ? `<small>${sub}</small>` : ''}</div>
  </button>`;
}

const sortTx = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0));

function monthSwitch() {
  return `<div class="month-switch"><button data-act="m-prev" aria-label="Предыдущий месяц">‹</button><span>${monthLabel(ui.month)}</span><button data-act="m-next" aria-label="Следующий месяц">›</button></div>`;
}

/* ---------------- Экраны ---------------- */

function viewHome() {
  const T = totals();
  const s = state.settings;
  const st = monthStats(monthOf(ymd()));
  const sk = streakInfo();
  const accs = live('accounts').filter((a) => !a.archived).sort(byAcc);
  const hasUsdt = live('accounts').some((a) => a.currency === 'USDT' && Math.abs(T.bal[a.id]) > 0.004);
  const recent = live('txs').sort(sortTx).slice(0, 5);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  const syncCls = { ok: 'ok', error: 'err', busy: 'wait' }[ui.sync.status] || '';
  const mask = ui.reveal ? '' : 'masked';

  return `
  <div class="topbar">
    <h1>Финансы</h1>
    <div style="display:flex;gap:8px">
      ${s.syncUrl ? `<button class="icon-btn" data-act="sync-now" aria-label="Синхронизировать"><span style="position:relative;display:grid;place-items:center">${ICON.sync}<i id="sync-dot" class="sync-dot ${syncCls}" style="position:absolute;right:-6px;top:-4px;margin:0"></i></span></button>` : ''}
      <button class="icon-btn" data-act="settings" aria-label="Настройки">${ICON.gear}</button>
    </div>
  </div>

  <div class="card hero">
    <div class="hero-head"><span class="label">На всех счетах</span><span class="label">${MONTHS[new Date().getMonth()]}</span></div>
    <button class="big num ${mask}" data-act="reveal" aria-label="${ui.reveal ? 'Скрыть сумму' : 'Показать сумму'}">${fmtRub(T.total)}</button>
    ${hasUsdt ? `<div class="sub num ${mask}">${fmt(T.rub, 'RUB')} + ${fmt(T.usdt, 'USDT')}</div>` : ''}
    ${hasUsdt && !s.rate ? `<div class="hint warn">Укажи курс USDT в настройках, чтобы посчитать итог</div>` : ''}
    <div class="hero-grid cols-2">
      <div><div class="k">Доходы</div><div class="v num pos">${fmtRub(st.inc)}</div></div>
      <div><div class="k">Расходы</div><div class="v num">${fmtRub(st.exp)}</div></div>
    </div>
    <div class="streak">
      <span>Серия: <b>${sk.n} ${plural(sk.n, ['день', 'дня', 'дней'])}</b></span>
      <span class="dots">${sk.last7.map((x) => `<i class="${x ? 'on' : ''}"></i>`).join('')}</span>
    </div>
    ${!sk.today && new Date().getHours() >= 18 ? `<button class="btn secondary small" data-act="quiet-day">Сегодня трат не было</button>` : ''}
  </div>

  ${!standalone && !s.hideInstallTip ? `<div class="card install-tip"><div><b>Установи на экран «Домой»:</b> в Safari нажми «Поделиться» → «На экран Домой». Так приложение откроется на весь экран и будет работать без интернета.</div><button data-act="hide-tip" aria-label="Скрыть">×</button></div>` : ''}

  <div class="section-title"><span>Счета</span><button data-act="accounts">Изменить</button></div>
  <div class="card">
    ${accs.map((a) => `<button class="row plain" data-act="open-account" data-id="${a.id}">
      <div class="main"><div class="title">${esc(a.name)}</div><div class="meta">${a.currency === 'USDT' && s.rate ? `<span class="${mask}">≈ ${fmtRub(toRub(T.bal[a.id], 'USDT'))}</span>` : a.currency}</div></div>
      <div class="amt num ${mask} ${T.bal[a.id] < 0 ? 'neg' : ''}">${fmt(T.bal[a.id], a.currency)}</div><span class="chev">›</span>
    </button>`).join('') || `<div class="empty">Нет счетов</div>`}
  </div>

  <div class="section-title"><span>Последние операции</span>${recent.length ? `<button data-act="tab" data-tab="history">Все</button>` : ''}</div>
  <div class="card">
    ${recent.map(txRow).join('') || `<div class="empty">Пока пусто. Нажми <b>+</b> внизу, чтобы записать первую операцию.</div>`}
  </div>`;
}

function viewHistory() {
  const accs = live('accounts').sort(byAcc);
  const list = live('txs')
    .filter((t) => monthOf(t.date) === ui.month)
    .filter((t) => !ui.histAccount || t.account === ui.histAccount || t.toAccount === ui.histAccount)
    .sort(sortTx);
  const groups = [];
  for (const t of list) {
    if (!groups.length || groups[groups.length - 1].date !== t.date) groups.push({ date: t.date, items: [] });
    groups[groups.length - 1].items.push(t);
  }
  return `
  <div class="topbar"><h1>История</h1></div>
  ${monthSwitch()}
  <div class="chips scroll" data-keep="hist" style="margin-top:12px">
    <button class="chip ${!ui.histAccount ? 'on' : ''}" data-act="hist-acc" data-id="">Все счета</button>
    ${accs.map((a) => `<button class="chip ${ui.histAccount === a.id ? 'on' : ''}" data-act="hist-acc" data-id="${a.id}">${esc(a.name)}</button>`).join('')}
  </div>
  ${groups.map((g) => {
    const spent = g.items.filter((t) => t.type === 'expense').reduce((s, t) => s + toRub(t.amount, txCur(t)), 0);
    return `<div class="day-head"><span>${dayLabel(g.date)}</span><span class="num">${spent ? '−' + fmtRub(spent) : ''}</span></div>
      <div class="card">${g.items.map(txRow).join('')}</div>`;
  }).join('') || `<div class="card" style="margin-top:14px"><div class="empty">В этом месяце операций нет</div></div>`}`;
}

const debtGroup = (d) => (d.direction === 'lent' ? 'lent' : d.creditor === 'person' ? 'person' : 'bank');

function viewDebts() {
  const ds = debtStats();
  const all = live('debts');
  const isOpen = (d) => ds[d.id].rest > 0.004;
  const sum = { bank: 0, person: 0, lent: 0 };
  for (const d of all) if (isOpen(d)) sum[debtGroup(d)] += toRub(ds[d.id].rest, d.currency);

  const card = (d) => {
    const x = ds[d.id];
    const base = x.start + x.added;
    const pct = base > 0 ? Math.min(100, Math.max(0, (x.paid / base) * 100)) : 100;
    const lentD = d.direction === 'lent';
    return `<div class="debt-card">
      <div class="top"><button class="name" data-act="debt-edit" data-id="${d.id}">${esc(d.name)} <span class="chev" style="color:var(--faint)">›</span></button>
      <div class="rest num ${x.rest > 0.004 ? (lentD ? 'pos' : 'dbt') : ''}">${fmt(Math.max(0, x.rest), d.currency)}</div></div>
      <div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>
      <div class="foot"><span>${esc(d.note)}</span><span class="num">${lentD ? 'вернули' : 'выплачено'} ${fmt(x.paid, d.currency)} · ${Math.round(pct)}%</span></div>
      ${x.rest > 0.004 ? `<div class="actions">
        <button data-act="debt-tx" data-id="${d.id}" data-a="pay">${lentD ? 'Мне вернули' : 'Внести платёж'}</button>
        <button data-act="debt-tx" data-id="${d.id}" data-a="add">${lentD ? 'Дать ещё' : 'Занять ещё'}</button>
      </div>` : ''}
    </div>`;
  };
  const section = (key, title) => {
    const list = all.filter((d) => isOpen(d) && debtGroup(d) === key);
    return list.length ? `<div class="section-title"><span>${title}</span><span class="num">${fmtRub(sum[key])}</span></div><div class="card">${list.map(card).join('')}</div>` : '';
  };
  const closed = all.filter((d) => !isOpen(d));

  return `
  <div class="topbar"><h1>Долги</h1><button class="icon-btn" data-act="debt-new" aria-label="Добавить долг"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button></div>
  <div class="card hero">
    <div class="hero-grid" style="margin-top:0;padding-top:0;border-top:0">
      <div><div class="k">Банкам</div><div class="v num ${sum.bank ? 'dbt' : ''}">${fmtRub(sum.bank)}</div></div>
      <div><div class="k">Людям</div><div class="v num ${sum.person ? 'dbt' : ''}">${fmtRub(sum.person)}</div></div>
      <div><div class="k">Мне должны</div><div class="v num ${sum.lent ? 'pos' : ''}">${fmtRub(sum.lent)}</div></div>
    </div>
  </div>
  ${section('bank', 'Банкам')}${section('person', 'Людям')}${section('lent', 'Мне должны')}
  ${!all.some(isOpen) ? `<div class="card" style="margin-top:14px"><div class="empty">Активных долгов нет. Если есть кредит, рассрочка или займ, добавь его, чтобы следить за остатком.<button class="btn small" data-act="debt-new">Добавить долг</button></div></div>` : ''}
  ${closed.length ? `<div class="section-title"><span>Закрытые</span></div><div class="card">${closed.map(card).join('')}</div>` : ''}`;
}

function viewReport() {
  const s = state.settings;
  const st = monthStats(ui.month);
  const net = st.inc - st.exp;
  const bars = (map, cls) => {
    const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
    const total = entries.reduce((x, [, v]) => x + v, 0);
    return entries.map(([id, v]) => {
      const c = byId('categories', id);
      const p = total ? (v / total) * 100 : 0;
      return `<div class="bar-row"><div class="bar-top"><span class="bar-name"><span class="bar-ico">${catIcon(c)}</span>${esc(c?.name || 'Без категории')}</span><span class="num">${fmtRub(v)}<span class="pct">${Math.round(p)}%</span></span></div><div class="bar ${cls}"><i style="width:${p.toFixed(1)}%"></i></div></div>`;
    }).join('');
  };

  // Последние 6 месяцев
  const months = [];
  for (let i = 5; i >= 0; i--) { const m = shiftMonth(ui.month, -i); months.push({ m, ...monthStats(m) }); }
  const max = Math.max(1, ...months.map((x) => Math.max(x.inc, x.exp)));
  const usesUsdt = state.accounts.some((a) => a.currency === 'USDT');

  return `
  <div class="topbar"><h1>Отчёт</h1><button class="icon-btn" data-act="csv" aria-label="Экспорт CSV" title="Экспорт CSV"><svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg></button></div>
  ${monthSwitch()}
  <div class="kpis" style="margin-top:12px">
    <div class="card kpi"><div class="k">Доходы</div><div class="v num pos">${fmtRub(st.inc)}</div></div>
    <div class="card kpi"><div class="k">Расходы</div><div class="v num">${fmtRub(st.exp)}</div></div>
    <div class="card kpi"><div class="k">Разница</div><div class="v num ${net >= 0 ? 'pos' : 'neg'}">${fmtRub(net, true)}</div><div class="s">${st.inc > 0 ? `отложено ${Math.round((net / st.inc) * 100)}% дохода` : '&nbsp;'}</div></div>
    <div class="card kpi"><div class="k">Погашено долгов</div><div class="v num ${st.debtPaid ? 'dbt' : ''}">${fmtRub(st.debtPaid)}</div><div class="s">${st.debtTaken ? 'занято ' + fmtRub(st.debtTaken) : '&nbsp;'}</div></div>
  </div>
  ${usesUsdt ? `<div class="hint">USDT пересчитан по курсу ${s.rate ? fmtNum(s.rate, 'USDT') + ' ₽' : '— (не задан)'}</div>` : ''}

  <div class="section-title"><span>Расходы по категориям</span></div>
  <div class="card">${bars(st.byExp, '') || `<div class="empty">Расходов нет</div>`}</div>

  <div class="section-title"><span>Доходы</span></div>
  <div class="card">${bars(st.byInc, 'inc') || `<div class="empty">Доходов нет</div>`}</div>

  <div class="section-title"><span>Полгода</span></div>
  <div class="card">
    <div class="mini-chart">${months.map((x) => `<div class="col"><div class="pair"><i class="a" style="height:${((x.inc / max) * 100).toFixed(1)}%"></i><i class="b" style="height:${((x.exp / max) * 100).toFixed(1)}%"></i></div></div>`).join('')}</div>
    <div class="mini-chart-labels">${months.map((x) => `<span>${MONTHS_SHORT[Number(x.m.slice(5)) - 1]}</span>`).join('')}</div>
    <div class="legend"><span><i style="background:var(--income)"></i>доходы</span><span><i style="background:var(--expense)"></i>расходы</span></div>
  </div>`;
}

function render() {
  const v = $('#view');
  const keep = {};
  v.querySelectorAll('[data-keep]').forEach((el) => (keep[el.dataset.keep] = el.scrollLeft));
  v.innerHTML = { home: viewHome, history: viewHistory, debts: viewDebts, report: viewReport }[ui.tab]();
  v.querySelectorAll('[data-keep]').forEach((el) => (el.scrollLeft = keep[el.dataset.keep] || 0));
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === ui.tab));
}

/* ---------------- Форма операции ---------------- */

function firstAccount(exclude) {
  return live('accounts').filter((a) => !a.archived && a.id !== exclude).sort(byAcc)[0]?.id || '';
}
function usable(id) { const a = byId('accounts', id); return a && !a.deleted && !a.archived ? id : ''; }

function openTxSheet(opts = {}) {
  const s = state.settings;
  const editing = opts.id ? byId('txs', opts.id) : null;
  const f = editing
    ? { ...editing, amountStr: String(editing.amount), toAmountStr: editing.toAmount ? String(editing.toAmount) : '', debtAmountStr: editing.debtAmount ? String(editing.debtAmount) : '' }
    : { id: uid('t'), type: opts.type || 'expense', date: ymd(), account: '', category: '', toAccount: '', debt: opts.debt || '', debtAction: opts.debtAction || 'pay', amountStr: '', toAmountStr: '', debtAmountStr: '', note: '' };

  const applyDefaults = () => {
    if (editing) return;
    if (f.type !== 'debt' && !usable(f.account)) f.account = usable(s.last[f.type]) || firstAccount();
    if (f.type === 'debt' && f.account === '' && s.last.debt !== '') f.account = usable(s.last.debt) || firstAccount();
    if (f.type === 'transfer' && (!f.toAccount || f.toAccount === f.account)) {
      f.toAccount = (s.last.transferTo !== f.account && usable(s.last.transferTo)) || firstAccount(f.account);
    }
    if (f.type === 'debt' && !f.debt) f.debt = live('debts').find((d) => debtStats()[d.id].rest > 0.004)?.id || live('debts')[0]?.id || '';
  };
  applyDefaults();

  const accChips = (key, value, { exclude, allowNone } = {}) => {
    const accs = live('accounts').filter((a) => (!a.archived || a.id === value) && a.id !== exclude).sort(byAcc);
    const bal = balances();
    return `<div class="chips scroll" data-keep="${key}">
      ${allowNone ? `<button class="chip ${!value ? 'on' : ''}" data-act="f-set" data-k="${key}" data-v="">Без счёта</button>` : ''}
      ${accs.map((a) => `<button class="chip ${value === a.id ? 'on' : ''}" data-act="f-set" data-k="${key}" data-v="${a.id}">${esc(a.name)}<small class="num ${ui.reveal ? '' : 'masked'}">${fmt(bal[a.id], a.currency)}</small></button>`).join('')}
    </div>`;
  };

  const amountCur = () => (f.type === 'debt' && !f.account ? byId('debts', f.debt)?.currency || 'RUB' : accCur(f.account));

  const rateHint = () => {
    if (f.type !== 'transfer') return '';
    const c1 = accCur(f.account), c2 = accCur(f.toAccount);
    if (c1 === c2) return '';
    const a = parseNum(f.amountStr), b = parseNum(f.toAmountStr);
    if (!(a > 0 && b > 0)) return 'Введи обе суммы — курс посчитается сам';
    const r = c1 === 'RUB' ? a / b : b / a;
    return `Курс обмена: 1 USDT = ${fmtNum(r, 'USDT')} ₽`;
  };

  const body = () => {
    const cur = amountCur();
    let dyn = '';
    if (f.type === 'expense' || f.type === 'income') {
      const cats = live('categories').filter((c) => c.kind === f.type).sort(byOrder);
      dyn = `<div class="field-label">Счёт</div>${accChips('account', f.account)}
        <div class="field-label"><span>Категория</span></div>
        <div class="cat-grid">${cats.map((c) => `<button class="cat ${f.category === c.id ? 'on' : ''}" data-act="f-set" data-k="category" data-v="${c.id}"><span class="em">${catIcon(c)}</span>${esc(c.name)}</button>`).join('')}
          <button class="cat" data-act="cat-new-inline"><span class="em" style="color:var(--accent)"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></span>Новая</button></div>`;
    } else if (f.type === 'transfer') {
      const diff = accCur(f.account) !== accCur(f.toAccount);
      dyn = `<div class="field-label">Откуда</div>${accChips('account', f.account)}
        <div class="field-label">Куда</div>${accChips('toAccount', f.toAccount, { exclude: f.account })}
        ${diff ? `<div class="field-label">Зачислено</div>
          <div class="amount-box" style="padding:6px 0"><input id="f-to-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.toAmountStr)}" style="font-size:32px"><span class="cur">${CUR[accCur(f.toAccount)].sym}</span></div>
          <div class="hint" id="rate-hint" style="text-align:center">${rateHint()}</div>` : ''}`;
    } else {
      const debts = live('debts');
      if (!debts.length) {
        dyn = `<div class="card" style="margin-top:14px"><div class="empty">Сначала добавь долг — кредит, рассрочку или кому ты должен.<button class="btn small" data-act="debt-new">Добавить долг</button></div></div>`;
      } else {
        const d = byId('debts', f.debt);
        const ds = debtStats();
        const needDebtAmt = d && f.account && accCur(f.account) !== d.currency;
        dyn = `<div class="field-label">Долг</div>
          <div class="chips scroll" data-keep="debt">${debts.map((x) => `<button class="chip ${f.debt === x.id ? 'on' : ''}" data-act="f-set" data-k="debt" data-v="${x.id}">${esc(x.name)}<small class="num">${fmt(Math.max(0, ds[x.id].rest), x.currency)}</small></button>`).join('')}</div>
          <div class="field-label">Действие</div>
          <div class="seg">
            <button class="${f.debtAction === 'pay' ? 'on' : ''}" data-act="f-set" data-k="debtAction" data-v="pay">${debtActionLabel(d, 'pay')}</button>
            <button class="${f.debtAction === 'add' ? 'on' : ''}" data-act="f-set" data-k="debtAction" data-v="add">${debtActionLabel(d, 'add')}</button>
          </div>
          <div class="field-label">${debtMoneyOut({ debt: f.debt, debtAction: f.debtAction }) ? 'С какого счёта' : 'На какой счёт'}</div>
          ${accChips('account', f.account, { allowNone: true })}
          ${needDebtAmt ? `<div class="field-label">Сумма в валюте долга (${d.currency})</div><input class="input num" id="f-debt-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.debtAmountStr)}">` : ''}`;
      }
    }
    const typeCls = f.type === 'expense' ? 'exp' : f.type === 'income' ? 'inc' : '';
    return `
      <div class="seg types">
        ${[['expense', 'Расход'], ['income', 'Доход'], ['transfer', 'Между счетами'], ['debt', 'Долг']].map(([k, l]) => `<button class="${f.type === k ? 'on' : ''}" data-act="f-type" data-v="${k}">${l}</button>`).join('')}
      </div>
      <div class="amount-box ${typeCls}"><input id="f-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(f.amountStr)}"><span class="cur">${CUR[cur].sym}</span></div>
      ${dyn}
      <div class="field-label">Дата и комментарий</div>
      <div class="two"><input class="input" type="date" id="f-date" value="${esc(f.date)}"><input class="input" id="f-note" placeholder="Комментарий" value="${esc(f.note)}"></div>
      <button class="btn" data-act="tx-save">${editing ? 'Сохранить' : 'Записать'}</button>
      ${editing ? `<button class="btn danger small" data-act="tx-delete">Удалить операцию</button>` : ''}`;
  };

  const saveTx = () => {
    const amount = round2(parseNum(f.amountStr));
    if (!(amount > 0)) return toast('Введи сумму');
    const t = {
      id: f.id, type: f.type, date: f.date || ymd(), account: f.account || '', amount,
      category: '', toAccount: '', toAmount: 0, debt: '', debtAction: '', debtAmount: 0,
      note: (f.note || '').trim(), createdAt: editing?.createdAt || Date.now(), deleted: false,
    };
    if (f.type === 'expense' || f.type === 'income') {
      if (!t.account) return toast('Выбери счёт');
      if (!f.category) return toast('Выбери категорию');
      t.category = f.category;
    } else if (f.type === 'transfer') {
      if (!t.account || !f.toAccount) return toast('Выбери оба счёта');
      if (t.account === f.toAccount) return toast('Счета должны отличаться');
      t.toAccount = f.toAccount;
      t.toAmount = accCur(t.account) === accCur(t.toAccount) ? amount : round2(parseNum(f.toAmountStr));
      if (!(t.toAmount > 0)) return toast('Введи сумму зачисления');
    } else {
      const d = byId('debts', f.debt);
      if (!d) return toast('Выбери долг');
      t.debt = d.id;
      t.debtAction = f.debtAction;
      t.debtAmount = !t.account || accCur(t.account) === d.currency ? amount : round2(parseNum(f.debtAmountStr));
      if (!(t.debtAmount > 0)) return toast('Введи сумму в валюте долга');
    }
    upsert('txs', t);
    s.last[f.type] = t.account;
    if (f.type === 'transfer') s.last.transferTo = t.toAccount;
    // Если в «Сегодня без трат» был отмечен этот день — снимаем отметку
    s.quietDays = (s.quietDays || []).filter((d) => d !== t.date);
    save();
    closeSheet();
    toast(editing ? 'Изменено' : 'Записано ✓');
  };

  const entry = openSheet({
    title: editing ? 'Операция' : 'Новая операция',
    right: '',
    refresh: (entry) => { entry.body.innerHTML = body(); entry.body.querySelectorAll('.amount-box input').forEach(fitAmount); },
    onInput: (e) => {
      const map = { 'f-amount': 'amountStr', 'f-to-amount': 'toAmountStr', 'f-debt-amount': 'debtAmountStr', 'f-date': 'date', 'f-note': 'note' };
      const k = map[e.target.id];
      if (!k) return;
      f[k] = e.target.value;
      if (e.target.closest('.amount-box')) fitAmount(e.target);
      const h = $('#rate-hint', entry.sh);
      if (h) h.textContent = rateHint();
    },
    actions: {
      'f-type': (el) => { f.type = el.dataset.v; applyDefaults(); if (f.type !== 'expense' && f.type !== 'income') f.category = ''; refreshTopSheet(); },
      'f-set': (el) => {
        const k = el.dataset.k;
        f[k] = el.dataset.v;
        if (k === 'account' && f.type === 'transfer' && f.toAccount === f.account) f.toAccount = firstAccount(f.account);
        refreshTopSheet();
        if (k === 'category' && !editing && parseNum(f.amountStr) > 0 && f.account) saveTx();
      },
      'tx-save': saveTx,
      'tx-delete': () => { if (confirm('Удалить операцию?')) { softDelete('txs', f.id); closeSheet(); toast('Удалено'); } },
      'debt-new': () => openDebtSheet(null, (id) => { f.debt = id; applyDefaults(); }),
      'cat-new-inline': () => openCategorySheet(null, f.type, (id) => { f.category = id; }),
    },
  });
  if (!editing) $('#f-amount', entry.sh)?.focus({ preventScroll: true });
}

/* ---------------- Счета, категории, долги ---------------- */

function openAccountSheet(id) {
  const orig = id ? byId('accounts', id) : null;
  const a = orig ? { ...orig } : { id: uid('a'), name: '', currency: 'RUB', initial: 0, archived: false, order: state.accounts.length, deleted: false };
  const hasTx = !!orig && state.txs.some((t) => !t.deleted && (t.account === a.id || t.toAccount === a.id));
  let initialStr = a.initial ? String(a.initial) : '';

  const entry = openSheet({
    title: orig ? 'Счёт' : 'Новый счёт',
    right: 'Готово',
    onRight: () => doSave(),
    refresh: (entry) => {
      entry.body.innerHTML = `
      <div class="field-label">Название</div>
      <input class="input" id="a-name" placeholder="Например, Тинькофф" value="${esc(a.name)}">
      <div class="field-label">Валюта</div>
      <div class="seg">${['RUB', 'USDT'].map((c) => `<button class="${a.currency === c ? 'on' : ''}" data-act="a-cur" data-v="${c}">${c === 'RUB' ? 'Рубли ₽' : 'USDT'}</button>`).join('')}</div>
      ${hasTx ? `<div class="hint warn">По счёту уже есть операции — смена валюты изменит их смысл.</div>` : ''}
      <div class="field-label">Остаток на старте учёта</div>
      <input class="input num" id="a-initial" inputmode="decimal" placeholder="0" value="${esc(initialStr)}">
      <div class="hint">Сколько денег было на счёте, когда начал вести учёт. Дальше баланс считается сам.</div>
      <button class="btn" data-act="a-save">Сохранить</button>
      ${orig ? `<button class="btn secondary small" data-act="a-archive">${a.archived ? 'Вернуть из архива' : 'Скрыть в архив'}</button>` : ''}
      ${orig && !hasTx ? `<button class="btn danger small" data-act="a-delete">Удалить счёт</button>` : ''}`;
    },
    onInput: (e) => {
      if (e.target.id === 'a-name') a.name = e.target.value;
      if (e.target.id === 'a-initial') initialStr = e.target.value;
    },
    actions: {
      'a-cur': (el) => { a.currency = el.dataset.v; refreshTopSheet(); },
      'a-save': () => doSave(),
      'a-archive': () => { a.archived = !a.archived; doSave(); },
      'a-delete': () => { if (confirm('Удалить счёт?')) { softDelete('accounts', a.id); closeSheet(); } },
    },
  });
  const doSave = () => {
    a.name = a.name.trim();
    if (!a.name) return toast('Введи название');
    a.initial = round2(parseNum(initialStr));
    upsert('accounts', a);
    closeSheet();
  };
}

function openCategorySheet(id, kind = 'expense', onCreated) {
  const orig = id ? byId('categories', id) : null;
  const c = orig ? { ...orig } : { id: uid('c'), name: '', icon: 'box', emoji: '', kind, order: state.categories.length, deleted: false };
  if (!c.icon) c.icon = EMOJI_TO_ICON[c.emoji] || 'box';
  const entry = openSheet({
    title: orig ? 'Категория' : 'Новая категория',
    right: 'Готово',
    onRight: () => doSave(),
    refresh: (entry) => {
      entry.body.innerHTML = `
      <div class="field-label">Название</div>
      <input class="input" id="c-name" placeholder="Название" value="${esc(c.name)}">
      <div class="field-label">Тип</div>
      <div class="seg">${[['expense', 'Расход'], ['income', 'Доход']].map(([k, l]) => `<button class="${c.kind === k ? 'on' : ''}" data-act="c-kind" data-v="${k}">${l}</button>`).join('')}</div>
      <div class="field-label">Значок</div>
      <div class="icon-grid">${Object.keys(CAT_ICONS).map((k) => `<button class="icon-opt ${c.icon === k ? 'on' : ''}" data-act="c-icon" data-v="${k}" aria-label="${k}">${svgIcon(k)}</button>`).join('')}</div>
      <button class="btn" data-act="c-save">Сохранить</button>
      ${orig ? `<button class="btn danger small" data-act="c-delete">Удалить категорию</button><div class="hint">Старые операции сохранят название категории.</div>` : ''}`;
    },
    onInput: (e) => {
      if (e.target.id === 'c-name') c.name = e.target.value;
    },
    actions: {
      'c-kind': (el) => { c.kind = el.dataset.v; refreshTopSheet(); },
      'c-icon': (el) => { c.icon = el.dataset.v; refreshTopSheet(); },
      'c-save': () => doSave(),
      'c-delete': () => { if (confirm('Удалить категорию?')) { softDelete('categories', c.id); closeSheet(); } },
    },
  });
  const doSave = () => {
    c.name = c.name.trim();
    if (!c.name) return toast('Введи название');
    c.emoji = '';
    upsert('categories', c);
    closeSheet();
    if (!orig) onCreated?.(c.id);
    refreshTopSheet();
  };
}

function openCategoriesSheet() {
  const entry = openSheet({
    title: 'Категории',
    left: 'Назад',
    refresh: (entry) => {
      const list = (kind) => live('categories').filter((c) => c.kind === kind).sort(byOrder)
        .map((c) => `<button class="row" data-act="cat-edit" data-id="${c.id}"><div class="ico">${catIcon(c)}</div><div class="main"><div class="title">${esc(c.name)}</div></div><span class="chev">›</span></button>`).join('');
      entry.body.innerHTML = `
        <div class="section-title"><span>Расходы</span><button data-act="cat-add" data-v="expense">+ Добавить</button></div>
        <div class="card">${list('expense')}</div>
        <div class="section-title"><span>Доходы</span><button data-act="cat-add" data-v="income">+ Добавить</button></div>
        <div class="card">${list('income')}</div>`;
    },
    actions: {
      'cat-edit': (el) => openCategorySheet(el.dataset.id),
      'cat-add': (el) => openCategorySheet(null, el.dataset.v),
    },
  });
}

function openAccountsSheet() {
  const entry = openSheet({
    title: 'Счета',
    left: 'Назад',
    refresh: (entry) => {
      const bal = balances();
      const row = (a) => `<button class="row plain" data-act="acc-edit" data-id="${a.id}"><div class="main"><div class="title">${esc(a.name)}</div><div class="meta">${a.currency}${a.initial ? ' · на старте ' + fmt(a.initial, a.currency) : ''}</div></div><div class="amt num">${fmt(bal[a.id], a.currency)}</div><span class="chev">›</span></button>`;
      const accs = live('accounts').sort(byAcc);
      const active = accs.filter((a) => !a.archived), arch = accs.filter((a) => a.archived);
      entry.body.innerHTML = `
        <div class="section-title"><span>Активные</span><button data-act="acc-add">+ Добавить</button></div>
        <div class="card">${active.map(row).join('') || '<div class="empty">Нет счетов</div>'}</div>
        ${arch.length ? `<div class="section-title"><span>Архив</span></div><div class="card">${arch.map(row).join('')}</div>` : ''}`;
    },
    actions: {
      'acc-edit': (el) => openAccountSheet(el.dataset.id),
      'acc-add': () => openAccountSheet(null),
    },
  });
}

function openDebtSheet(id, onCreated) {
  const orig = id ? byId('debts', id) : null;
  const d = orig ? { ...orig } : { id: uid('d'), name: '', currency: 'RUB', direction: 'owe', creditor: 'bank', initial: 0, note: '', deleted: false };
  if (!d.creditor) d.creditor = 'bank';
  let initialStr = d.initial ? String(d.initial) : '';
  const txCount = orig ? state.txs.filter((t) => !t.deleted && t.debt === d.id).length : 0;

  const entry = openSheet({
    title: orig ? 'Долг' : 'Новый долг',
    right: 'Готово',
    onRight: () => doSave(),
    refresh: (entry) => {
      const payments = orig ? live('txs').filter((t) => t.debt === d.id).sort(sortTx) : [];
      entry.body.innerHTML = `
      <div class="seg">${[['owe', 'Я должен'], ['lent', 'Мне должны']].map(([k, l]) => `<button class="${d.direction === k ? 'on' : ''}" data-act="d-dir" data-v="${k}">${l}</button>`).join('')}</div>
      ${d.direction === 'owe' ? `<div class="field-label">Кому</div>
      <div class="seg">${[['bank', 'Банку'], ['person', 'Человеку']].map(([k, l]) => `<button class="${d.creditor === k ? 'on' : ''}" data-act="d-cred" data-v="${k}">${l}</button>`).join('')}</div>` : ''}
      <div class="field-label">Название</div>
      <input class="input" id="d-name" placeholder="${d.direction === 'lent' ? 'Кто должен' : d.creditor === 'person' ? 'Кому должен' : 'Кредитка, ипотека, рассрочка…'}" value="${esc(d.name)}">
      <div class="field-label">Валюта</div>
      <div class="seg">${['RUB', 'USDT'].map((c) => `<button class="${d.currency === c ? 'on' : ''}" data-act="d-cur" data-v="${c}">${c === 'RUB' ? 'Рубли ₽' : 'USDT'}</button>`).join('')}</div>
      <div class="field-label">Остаток долга на старте учёта</div>
      <input class="input num" id="d-initial" inputmode="decimal" placeholder="0" value="${esc(initialStr)}">
      <div class="hint">Сколько осталось отдать на сегодня. Платежи будут уменьшать остаток.</div>
      <div class="field-label">Заметка</div>
      <input class="input" id="d-note" placeholder="Ставка, дата платежа…" value="${esc(d.note)}">
      <button class="btn" data-act="d-save">Сохранить</button>
      ${orig ? `<button class="btn danger small" data-act="d-delete">Удалить долг</button>` : ''}
      ${payments.length ? `<div class="section-title"><span>Операции по долгу</span></div><div class="card">${payments.map(txRow).join('')}</div>` : ''}`;
    },
    onInput: (e) => {
      if (e.target.id === 'd-name') d.name = e.target.value;
      if (e.target.id === 'd-initial') initialStr = e.target.value;
      if (e.target.id === 'd-note') d.note = e.target.value;
    },
    actions: {
      'd-dir': (el) => { d.direction = el.dataset.v; refreshTopSheet(); },
      'd-cur': (el) => { d.currency = el.dataset.v; refreshTopSheet(); },
      'd-cred': (el) => { d.creditor = el.dataset.v; refreshTopSheet(); },
      'd-save': () => doSave(),
      'd-delete': () => {
        const msg = txCount ? `Удалить долг? Операции по нему (${txCount}) останутся в истории.` : 'Удалить долг?';
        if (confirm(msg)) { softDelete('debts', d.id); closeSheet(); }
      },
    },
  });
  const doSave = () => {
    d.name = d.name.trim();
    if (!d.name) return toast('Введи название');
    d.initial = round2(parseNum(initialStr));
    upsert('debts', d);
    closeSheet();
    if (!orig) onCreated?.(d.id);
    refreshTopSheet();
  };
}

/* ---------------- Настройки ---------------- */

function openSettings() {
  const entry = openSheet({
    title: 'Настройки',
    left: 'Закрыть',
    refresh: (entry) => {
      const s = state.settings;
      const syncState = { ok: ['ok', 'Синхронизировано'], error: ['err', ui.sync.msg || 'Ошибка'], busy: ['wait', 'Синхронизация…'] }[ui.sync.status];
      const last = s.lastSync ? new Date(s.lastSync).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'ещё не было';
      entry.body.innerHTML = `
      <div class="card" style="margin-top:8px">
        <button class="row plain" data-act="accounts"><div class="main"><div class="title">Счета</div></div><span class="meta">${live('accounts').length}</span><span class="chev">›</span></button>
        <button class="row plain" data-act="categories"><div class="main"><div class="title">Категории</div></div><span class="meta">${live('categories').length}</span><span class="chev">›</span></button>
      </div>

      <div class="section-title"><span>Курс USDT → ₽</span></div>
      <div class="card pad">
        <div class="two" style="align-items:center">
          <input class="input num" id="s-rate" inputmode="decimal" placeholder="Например, 95.5" value="${s.rate || ''}">
          <button class="btn secondary small" style="margin:0" data-act="rate-refresh">Обновить</button>
        </div>
        <div class="hint">${s.rateAuto && s.rateAt ? 'Рыночный курс (CoinGecko), обновлён ' + new Date(s.rateAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Задан вручную'}. Нужен только для пересчёта итогов — реальный курс обмена записывается в каждой операции.</div>
      </div>

      <div class="section-title"><span>Google Таблица</span></div>
      <div class="card pad">
        <div class="field-label" style="margin-top:0">Адрес веб-приложения Apps Script</div>
        <input class="input" id="s-url" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(s.syncUrl)}" autocapitalize="off" autocorrect="off" spellcheck="false">
        <div class="field-label">Секретный ключ</div>
        <input class="input" id="s-secret" placeholder="Тот же, что в скрипте" value="${esc(s.syncSecret)}" autocapitalize="off" autocorrect="off" spellcheck="false">
        <div class="hint">${syncState ? `<span class="sync-dot ${syncState[0]}"></span>${esc(syncState[1])} · ` : ''}последняя синхронизация: ${last}</div>
        <button class="btn small" data-act="sync-now">Синхронизировать сейчас</button>
      </div>

      <div class="section-title"><span>Данные</span></div>
      <div class="card">
        <button class="row plain list-btn" data-act="csv">Экспорт операций в CSV</button>
        <button class="row plain list-btn" data-act="backup-export">Сохранить резервную копию (JSON)</button>
        <button class="row plain list-btn" data-act="backup-import">Восстановить из копии</button>
        <button class="row plain list-btn danger" data-act="reset">Стереть данные на этом устройстве</button>
      </div>
      <div class="hint" style="text-align:center;margin:18px 0 0">Финансы ${APP_VERSION} · данные хранятся на телефоне${s.syncUrl ? ' и в твоей Google-таблице' : ''}</div>`;
    },
    onInput: (e) => {
      if (e.type !== 'change') return;
      const s = state.settings;
      if (e.target.id === 's-rate') { s.rate = round2(parseNum(e.target.value)); s.rateAuto = false; s.rateAt = Date.now(); save(); refreshTopSheet(); }
      if (e.target.id === 's-url') { s.syncUrl = e.target.value.trim(); save(); }
      if (e.target.id === 's-secret') { s.syncSecret = e.target.value.trim(); save(); }
    },
    actions: {
      categories: () => openCategoriesSheet(),
      'rate-refresh': () => refreshRate(true),
    },
  });
}

/* ---------------- Экспорт / импорт ---------------- */

async function shareFile(text, name, type) {
  const blob = new Blob([text], { type });
  try {
    const file = new File([blob], name, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
  } catch (e) {
    if (e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportCSV() {
  const num = (x) => (x ? String(round2(x)).replace('.', ',') : '');
  const cell = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = [['Дата', 'Тип', 'Счёт', 'Сумма', 'Валюта', 'Сумма в ₽', 'Категория', 'Счёт зачисления', 'Сумма зачисления', 'Валюта зачисления', 'Долг', 'Действие', 'Сумма по долгу', 'Комментарий']];
  for (const t of live('txs').sort(sortTx).reverse()) {
    const o = outRow('txs', t);
    rows.push([t.date, o.typeName, o.accountName, num(t.amount), o.currency, num(o.amountRub), o.categoryName, o.toAccountName, num(t.toAmount), o.toCurrency, o.debtName, o.debtActionName, num(t.debtAmount), t.note]);
  }
  shareFile('﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n'), `finance-${ymd()}.csv`, 'text/csv');
}

function exportBackup() {
  const data = { app: 'finpanel', version: APP_VERSION, exportedAt: new Date().toISOString() };
  for (const k of KINDS) data[k] = state[k];
  data.settings = { ...state.settings, syncSecret: '' };
  shareFile(JSON.stringify(data, null, 1), `finance-backup-${ymd()}.json`, 'application/json');
}

function importBackup() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.json,application/json';
  inp.onchange = async () => {
    try {
      const data = JSON.parse(await inp.files[0].text());
      if (!KINDS.every((k) => Array.isArray(data[k]))) throw new Error();
      if (!confirm('Заменить текущие данные на устройстве данными из копии?')) return;
      const keepSync = { syncUrl: state.settings.syncUrl, syncSecret: state.settings.syncSecret };
      for (const k of KINDS) state[k] = data[k].map((e) => ({ ...e, _dirty: true }));
      state.settings = { ...defaultSettings(), ...(data.settings || {}), ...keepSync, lastSync: 1 };
      save();
      closeSheet();
      render();
      scheduleSync(500);
      toast('Данные восстановлены');
    } catch (e) {
      toast('Не удалось прочитать файл');
    }
  };
  inp.click();
}

function resetAll() {
  if (!confirm('Стереть все данные на этом устройстве? Таблица Google не изменится — при следующей синхронизации данные загрузятся из неё.')) return;
  const keep = { syncUrl: state.settings.syncUrl, syncSecret: state.settings.syncSecret };
  state = defaultState();
  Object.assign(state.settings, keep);
  save();
  closeSheet();
  render();
  toast('Данные стёрты');
}

/* ---------------- Действия ---------------- */

const ACTIONS = {
  'sheet-close': () => closeSheet(),
  'sheet-right': () => ui.sheets[ui.sheets.length - 1]?.onRight?.(),
  tab: (el) => { ui.tab = el.dataset.tab; render(); window.scrollTo(0, 0); },
  'm-prev': () => { ui.month = shiftMonth(ui.month, -1); render(); },
  'm-next': () => { ui.month = shiftMonth(ui.month, 1); render(); },
  'hist-acc': (el) => { ui.histAccount = el.dataset.id; render(); },
  'open-account': (el) => { ui.histAccount = el.dataset.id; ui.month = monthOf(ymd()); ui.tab = 'history'; render(); window.scrollTo(0, 0); },
  'edit-tx': (el) => openTxSheet({ id: el.dataset.id }),
  'debt-tx': (el) => openTxSheet({ type: 'debt', debt: el.dataset.id, debtAction: el.dataset.a }),
  'debt-new': () => openDebtSheet(null),
  'debt-edit': (el) => openDebtSheet(el.dataset.id),
  settings: () => openSettings(),
  accounts: () => openAccountsSheet(),
  'sync-now': () => syncNow(true),
  csv: () => exportCSV(),
  'backup-export': () => exportBackup(),
  'backup-import': () => importBackup(),
  reset: () => resetAll(),
  'hide-tip': () => { state.settings.hideInstallTip = true; save(); render(); },
  'quiet-day': () => { state.settings.quietDays = [...new Set([...(state.settings.quietDays || []), ymd()])]; save(); render(); toast('Отмечено, серия продолжается'); },
  reveal: () => { ui.reveal = !ui.reveal; render(); },
};

document.addEventListener('click', (e) => {
  const tabBtn = e.target.closest('.tab');
  if (tabBtn) { ui.tab = tabBtn.dataset.tab; if (tabBtn.dataset.tab !== 'history') ui.histAccount = ''; render(); window.scrollTo(0, 0); return; }
  if (e.target.closest('#fab')) { openTxSheet(); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  // Сначала ищем обработчик у листа, в котором произошёл клик
  const sheet = ui.sheets.find((s) => s.sh.contains(el));
  const fn = sheet?.actions?.[act] || ACTIONS[act];
  if (fn) { e.preventDefault(); fn(el); }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeSheet();
  if (e.key === 'Enter' && e.target.matches?.('.sheet input:not([type=date])')) {
    const top = ui.sheets[ui.sheets.length - 1];
    const saveBtn = top?.sh.querySelector('[data-act="tx-save"],[data-act="a-save"],[data-act="c-save"],[data-act="d-save"]');
    if (saveBtn) { e.preventDefault(); e.target.blur(); saveBtn.click(); }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    ui.reveal = false;
    if (state && state.settings.syncUrl && hasDirty()) syncNow(false);
  } else if (state) {
    render();
    if (state.settings.syncUrl) scheduleSync(800);
  }
});
window.addEventListener('online', () => state && scheduleSync(500));

/* ---------------- Запуск ---------------- */

// Обновление данных, сохранённых старыми версиями
function migrate() {
  let changed = false;
  for (const c of state.categories) {
    if (!c.icon) { c.icon = EMOJI_TO_ICON[c.emoji] || 'box'; c.emoji = ''; c._dirty = true; changed = true; }
  }
  for (const d of state.debts) {
    if (d.direction !== 'lent' && !d.creditor) { d.creditor = 'bank'; d._dirty = true; changed = true; }
  }
  if (changed) save();
}

async function init() {
  const saved = await Store.get('state');
  if (saved && Array.isArray(saved.txs)) {
    state = saved;
    for (const k of KINDS) state[k] = state[k] || [];
    state.settings = { ...defaultSettings(), ...(state.settings || {}) };
    migrate();
  } else {
    state = defaultState();
    save();
  }
  render();
  try { navigator.storage?.persist?.(); } catch (e) {}
  const s = state.settings;
  if (s.rateAuto && Date.now() - (s.rateAt || 0) > 6 * 3600e3) refreshRate(false);
  if (s.syncUrl) scheduleSync(600);
}

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

init();
