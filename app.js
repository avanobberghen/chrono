/* Chrono: training stopwatch for coaches.
   How it works: every tap (start, split, lap, finish, undo) is appended as one row to the "events" log.
   Times are always recomputed from that log. Rows are never modified, so two phones that were offline
   cannot overwrite each other: each one simply sends its rows when the network comes back. */
(() => {
'use strict';

/* ---------- settings, connection and language ---------- */
const CFG = self.CHRONO_CONFIG || {};
// Accept a project URL pasted with a path (e.g. .../rest/v1/): keep only https://xxx.supabase.co
try { if (CFG.SUPABASE_URL) CFG.SUPABASE_URL = new URL(String(CFG.SUPABASE_URL).trim()).origin; } catch (e) {}
const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(CFG.SUPABASE_URL || '') && (CFG.SUPABASE_KEY || '').length > 20 && !/YOUR/.test((CFG.SUPABASE_URL || '') + (CFG.SUPABASE_KEY || ''));
const sb = configured && self.supabase ? self.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY) : null;

const SET = Object.assign({ appName: 'Chrono', clubName: '', logo: '', language: 'auto', languages: ['en'], mode: 'auto', dark: {}, light: {} }, self.CHRONO_SETTINGS || {});
const VERSION = self.CHRONO_VERSION || '';

/* ---------- local storage ---------- */
const L = {
  get(k, d) { try { const v = localStorage.getItem('chrono:' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('chrono:' + k, JSON.stringify(v)); } catch (e) { console.warn('local storage full or unavailable', e); } }
};
const db = {
  me: L.get('me', null), riders: L.get('riders', []), sessions: L.get('sessions', []), events: L.get('events', {}),
  gpx: L.get('gpx', {}), outbox: L.get('outbox', []), failed: L.get('failed', []), offset: L.get('offset', 0),
  coaches: L.get('coaches', []), pend: L.get('pend', {})
};
const save = (...keys) => keys.forEach(k => L.set(k, db[k]));

/* ---------- translations (files in lang/) ---------- */
let LANGS = {}, LANG = 'en', DICT = {}, LOC = 'en';
function pickLang() {
  const avail = SET.languages.filter(c => LANGS[c]), saved = L.get('lang', null);
  if (saved && LANGS[saved]) return saved;
  if (SET.language !== 'auto' && LANGS[SET.language]) return SET.language;
  for (const l of (navigator.languages || [navigator.language || ''])) { const c = String(l).toLowerCase().split('-')[0]; if (avail.includes(c)) return c; }
  return avail[0] || Object.keys(LANGS)[0] || 'en';
}
function setLang(code) { LANG = code; DICT = LANGS[code] || {}; LOC = DICT._locale || code; try { document.documentElement.lang = code; } catch (e) {} }
// t('key', {n: 3, name: 'Léo'}): a value may be a string with {placeholders}, a {one, other} plural object, or a function.
function t(k, p) {
  p = p || {}; let v = DICT[k]; if (v == null) v = (LANGS.en || {})[k]; if (v == null) return k;
  if (typeof v === 'function') return String(v(p));
  if (typeof v === 'object') { let cat = 'other'; try { cat = new Intl.PluralRules(LOC).select(Number(p.n)); } catch (e) {} v = v[cat] != null ? v[cat] : v.other; }
  return String(v).replace(/\{(\w+)\}/g, (m, x) => p[x] != null ? p[x] : m);
}

/* ---------- theme (settings.js) ---------- */
function applyTheme() {
  const map = { bg: 'bg', surface: 'surface', line: 'line', ink: 'ink', muted: 'muted', accent: 'accent', accentInk: 'accent-ink', go: 'go', stop: 'stop', split: 'split', lap: 'lap', actInk: 'act-ink' };
  const ok = v => typeof v === 'string' && /^#[0-9a-f]{3,8}$|^rgba?\([\d\s.,%]+\)$/i.test(v.trim());
  const vars = (pal, scheme) => Object.keys(map).filter(k => ok(pal[k])).map(k => '--' + map[k] + ':' + pal[k].trim() + ';').join('') + 'color-scheme:' + scheme + ';';
  const Lt = vars(SET.light || {}, 'light'), Dk = vars(SET.dark || {}, 'dark');
  const css = SET.mode === 'dark' ? ':root{' + Dk + '}' : SET.mode === 'light' ? ':root{' + Lt + '}' : ':root{' + Lt + '}@media (prefers-color-scheme:dark){:root{' + Dk + '}}';
  const st = document.createElement('style'); st.id = 'theme'; st.textContent = css; (document.head || document.documentElement).appendChild(st);
  const dark = SET.mode === 'dark' || (SET.mode !== 'light' && self.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector && document.querySelector('meta[name="theme-color"]'), pal = dark ? SET.dark : SET.light;
  if (meta && pal && ok(pal.bg)) meta.setAttribute('content', pal.bg);
  document.title = SET.appName + (SET.clubName ? ' · ' + SET.clubName : '');
}
const logoImg = cls => SET.logo ? `<img class="${cls}" src="${String(SET.logo).replace(/["<>]/g, '')}" alt="${esc(SET.clubName)}">` : '';

/* ---------- helpers ---------- */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uuid = () => (self.crypto && crypto.randomUUID) ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
const now = () => Date.now() + db.offset;
const iso = ms => { const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const today = () => iso(Date.now());
function fmt(ms, dec) {
  dec = dec == null ? 2 : dec; if (ms == null || isNaN(ms)) return '–'; ms = Math.max(0, ms);
  const m = Math.floor(ms / 60000), s = (ms % 60000) / 1000, k = dec === 1 ? 10 : 100, f = Math.floor(s * k) / k;
  return m + ':' + (f < 10 ? '0' : '') + f.toFixed(dec);
}
const nRiders = n => t('riders.count', { n });
const nRuns = n => t('runs.count', { n });
const fDate = d => { try { return new Date(d + 'T12:00:00').toLocaleDateString(LOC, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); } catch (e) { return d; } };
const buzz = () => { try { navigator.vibrate && navigator.vibrate(25); } catch (e) {} };
const $ = id => document.getElementById(id);

/* ---------- screen state ---------- */
const ui = { view: db.me ? 'home' : 'login', sid: null, tab: 'chrono', poste: L.get('poste', 'start'), sheet: null, adminTab: 'youth',
  multi: false, sel: [], showArch: false, det: {}, loginMode: 'in', undo: null, confirmDel: false, busy: false };
const app = $('app');
let R = [], ORPH = {};            // runs computed for the open session, taps received before their start
let netOK = navigator.onLine !== false, authed = false, pushing = false;
let holding = false, dirty = false, downTs = 0;

const cur = () => db.sessions.find(s => s.id === ui.sid);
const rname = id => { const r = db.riders.find(r => r.id === id); return r ? r.name : t('riders.unknown'); };
const isAdmin = () => db.me && db.me.role === 'admin';

/* ---------- runs, computed from the event log ---------- */
function runsOf(sid) {
  const evs = db.events[sid] || [], voided = new Set(evs.filter(e => e.type === 'void').map(e => e.target));
  const list = evs.filter(e => e.type !== 'void' && !voided.has(e.id)).sort((a, b) => a.ts - b.ts);
  const open = {}, runs = [], orph = {};
  for (const e of list) {
    const o = open[e.rider_id];
    if (e.type === 'start') {
      if (!o) { const r = { id: e.id, riderId: e.rider_id, start: e.ts, splits: [], laps: [], end: null, evs: [e.id] }; open[e.rider_id] = r; runs.push(r); orph[e.rider_id] = 0; }
    } else if (o) {
      o.evs.push(e.id);
      if (e.type === 'split') o.splits.push(e.ts); else if (e.type === 'lap') o.laps.push(e.ts);
      else if (e.type === 'finish') { o.end = e.ts; delete open[e.rider_id]; }
    } else orph[e.rider_id] = (orph[e.rider_id] || 0) + 1;
  }
  ORPH = orph;
  return runs;
}
const active = r => R.find(x => x.riderId === r && x.end == null);
const times = r => R.filter(x => x.riderId === r && x.end != null).map(x => x.end - x.start);
const best = r => { const ts = times(r); return ts.length ? Math.min(...ts) : null; };

/* ---------- event log: record a tap ---------- */
function emit(type, riderId, ts, target) {
  const ev = { id: uuid(), session_id: ui.sid, rider_id: riderId, type, ts: Math.round(ts), target: target || null };
  (db.events[ui.sid] = db.events[ui.sid] || []).push(ev);
  db.outbox.push({ k: 'ins', t: 'events', row: ev });
  save('events', 'outbox'); push();
  return ev;
}
const fresh = new Map();           // rows changed a moment ago: keep the local version for one minute
function queue(op) { fresh.set(op.k === 'ins' ? op.row.id : op.id, Date.now()); db.outbox.push(op); save('outbox'); push(); }

/* ---------- synchronisation ---------- */
const isNetErr = e => !e || (!e.code && /fetch|network|load failed|timeout|abort/i.test(e.message || ''));
const isAuthErr = res => res.status === 401 || res.status === 403 || (res.error && /^(42501|PGRST30[0-3])$/.test(res.error.code || ''));
function setNet(v) { netOK = v; paintNet(); }
function netLabel() {
  const n = db.outbox.length, pend = n ? ' · ' + t('net.pending', { n }) : '';
  if (db.me && sb && !authed && netOK) return ['off', t('net.reconnect') + pend];
  if (!netOK) return ['off', t('net.offline') + pend];
  if (n) return ['off', t('net.sending') + pend];
  return ['', t('net.synced')];
}
function paintNet() { const el = $('net'); if (!el) return; const [c, l] = netLabel(); el.className = 'net ' + c; el.innerHTML = '<i></i>' + esc(l); }

async function push() {
  if (!sb || !authed || pushing || !db.outbox.length) { paintNet(); return; }
  pushing = true;
  try {
    while (db.outbox.length) {
      const op = db.outbox[0]; let n = 1, res;
      if (op.k === 'ins') {
        while (n < db.outbox.length && n < 200 && db.outbox[n].k === 'ins' && db.outbox[n].t === op.t) n++;
        res = await sb.from(op.t).upsert(db.outbox.slice(0, n).map(o => o.row), { onConflict: 'id', ignoreDuplicates: true });
      } else if (op.k === 'upd') res = await sb.from(op.t).update(op.patch).eq('id', op.id);
      else res = await sb.from(op.t).delete().eq('id', op.id);
      if (res.error) {
        if (isNetErr(res.error)) { setNet(false); break; }
        if (isAuthErr(res)) { authed = false; toast(t('toast.sessionExpired')); break; }
        console.warn('change rejected', op, res.error);
        db.failed.push(...db.outbox.slice(0, n).map(o => ({ op: o, error: res.error.message }))); save('failed');
        toast(t('toast.rejected', { msg: res.error.message }));
      } else netOK = true;
      db.outbox.splice(0, n); save('outbox'); paintNet();
    }
  } catch (e) { setNet(false); } finally { pushing = false; paintNet(); }
}

const pendIds = (tb, k) => new Set(db.outbox.filter(o => o.t === tb && (!k || o.k === k)).map(o => o.k === 'ins' ? o.row.id : o.id));
function mergeRows(local, server, tb) {
  const keep = pendIds(tb), gone = pendIds(tb, 'del'), m = new Map(server.map(x => [x.id, x]));
  local.forEach(x => { if (keep.has(x.id) || Date.now() - (fresh.get(x.id) || 0) < 60000) m.set(x.id, x); });
  return [...m.values()].filter(x => !gone.has(x.id));
}
async function pull() {
  if (!sb || !authed) return;
  try {
    const [r, s] = await Promise.all([
      sb.from('riders').select('id,name,grp,active').order('name'),
      sb.from('sessions').select('id,name,date,archived,rider_ids').order('date', { ascending: false })
    ]);
    const err = r.error || s.error;
    if (err) { if (isNetErr(err)) setNet(false); else if (isAuthErr(r.error ? r : s)) authed = false; paintNet(); return; }
    setNet(true);
    db.riders = mergeRows(db.riders, r.data, 'riders'); db.sessions = mergeRows(db.sessions, s.data, 'sessions');
    save('riders', 'sessions');
    if (ui.view === 'session' && !cur()) { ui.view = 'home'; toast(t('toast.sessionGone')); }
    if (ui.view === 'session') await pullEvents(ui.sid);
    if (isAdmin()) await pullCoaches();
    render(true);
  } catch (e) { setNet(false); }
}
async function pullEvents(sid) {
  if (!sb || !authed || !sid) return;
  try {
    let all = [], from = 0;
    for (;;) {
      const { data, error } = await sb.from('events').select('id,session_id,rider_id,type,ts,target').eq('session_id', sid).order('created_at').order('id').range(from, from + 999);
      if (error) { if (isNetErr(error)) setNet(false); return; }
      all = all.concat(data); if (data.length < 1000) break; from += 1000;
    }
    setNet(true);
    const have = new Set(all.map(e => e.id));     // the log only grows: keep everything known locally too
    (db.events[sid] || []).forEach(e => { if (!have.has(e.id)) all.push(e); });
    const changed = all.length !== (db.events[sid] || []).length;
    db.events[sid] = all.map(e => ({ ...e, ts: Number(e.ts) })); save('events');
    if (changed) render(true);
  } catch (e) { setNet(false); }
}
async function pullCoaches() {
  if (!sb) return null;
  const { data, error } = await sb.from('allowed_users').select('email,name,role,user_id').order('name');
  if (!error) { db.coaches = data; save('coaches'); }
  return error;
}
async function pullGpx(sid) {
  if (!sb || !authed || pendIds('sessions').has(sid)) return;
  const { data, error } = await sb.from('sessions').select('gpx').eq('id', sid).maybeSingle();
  if (error || !data) return;
  if (data.gpx) db.gpx[sid] = data.gpx; else delete db.gpx[sid];
  save('gpx'); render(true);
}
async function syncClock() {
  if (!sb) return;
  try {
    let bestS = null;
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now(), { data, error } = await sb.rpc('server_time'), t1 = Date.now();
      if (error || data == null) return;
      if (!bestS || t1 - t0 < bestS.rtt) bestS = { rtt: t1 - t0, off: Number(data) - (t0 + t1) / 2 };
    }
    db.offset = Math.round(bestS.off); save('offset');
  } catch (e) {}
}

/* realtime: taps from other coaches arrive without waiting */
let chanSession = null, chanMeta = null, pullTimer = null;
function subscribeSession(sid) {
  if (!sb) return;
  if (chanSession) { sb.removeChannel(chanSession); chanSession = null; }
  if (!sid) return;
  chanSession = sb.channel('session-' + sid)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'events', filter: 'session_id=eq.' + sid }, p => {
      const e = p.new, list = db.events[sid] = db.events[sid] || [];
      if (!e || list.some(x => x.id === e.id)) return;
      list.push({ id: e.id, session_id: e.session_id, rider_id: e.rider_id, type: e.type, ts: Number(e.ts), target: e.target });
      save('events'); render(true);
    })
    .subscribe(st => { if (st === 'SUBSCRIBED') pullEvents(sid); });
}
function subscribeMeta() {
  if (!sb || chanMeta) return;
  const soon = () => { clearTimeout(pullTimer); pullTimer = setTimeout(pull, 600); };
  chanMeta = sb.channel('meta')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions' }, soon)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'riders' }, soon)
    .subscribe();
}

/* ---------- sign-in ---------- */
async function afterLogin(user) {
  authed = true;
  const { data, error } = await sb.from('allowed_users').select('email,name,role').eq('user_id', user.id).maybeSingle();
  if (error) { if (isNetErr(error)) setNet(false); if (!db.me || db.me.id !== user.id) { authed = false; toast(t('toast.serverUnreachable')); } paintNet(); return; }
  if (!data) { authed = false; db.me = null; save('me'); await sb.auth.signOut(); ui.view = 'login'; render(); toast(t('toast.notCoach')); return; }
  db.me = { id: user.id, email: data.email, name: data.name, role: data.role }; save('me');
  if (ui.view === 'login') ui.view = 'home';
  render(); subscribeMeta(); syncClock(); await push(); await pull();
  if (ui.view === 'session') subscribeSession(ui.sid);
}
function initAuth() {
  if (!sb) return;
  sb.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (event === 'PASSWORD_RECOVERY') { ui.view = 'newpass'; render(); return; }
      if (session && session.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) {
        if (!authed || !db.me || db.me.id !== session.user.id) afterLogin(session.user);
      } else if (event === 'INITIAL_SESSION' && !session && navigator.onLine !== false && ui.view !== 'newpass') {
        authed = false; if (db.me) { ui.view = 'login'; render(); toast(t('toast.signInAgain')); }
      } else if (event === 'SIGNED_OUT') { authed = false; paintNet(); }
    }, 0);
  });
}
const authMsg = e => /invalid login/i.test(e.message) ? t('auth.wrong')
  : /not confirmed/i.test(e.message) ? t('auth.notConfirmed')
  : /already registered/i.test(e.message) ? t('auth.exists')
  : /rate limit/i.test(e.message) ? t('auth.rateLimit')
  : isNetErr(e) ? t('auth.noNetwork')
  : null;

/* ---------- views ---------- */
const V = {
  setup() {
    return `<div class="login">${logoImg('logo')}<h1>${esc(SET.appName)}</h1><div class="hint">${t('setup.notConfigured')}${configured && !sb ? '<br><br>' + t('setup.libMissing') : ''}</div></div>`;
  },
  login() {
    const m = ui.loginMode, T = { in: t('login.signIn'), up: t('login.create'), forgot: t('login.sendLink') };
    return `<form class="login" data-form="auth">${logoImg('logo')}<h1>${esc(SET.appName)}</h1><div>${esc(SET.clubName ? t('login.clubArea', { club: SET.clubName }) : t('login.area'))}</div>
      <div class="field">${t('login.email')}<input id="l-mail" type="email" autocomplete="username" required value="${esc(L.get('lastmail', ''))}"></div>
      ${m !== 'forgot' ? `<div class="field">${m === 'up' ? t('login.newPassword') : t('login.password')}<input id="l-pass" type="password" autocomplete="${m === 'up' ? 'new-password' : 'current-password'}" required minlength="${m === 'up' ? 8 : 1}"></div>` : ''}
      <button class="primary" type="submit" ${ui.busy ? 'disabled' : ''}>${ui.busy ? t('login.wait') : T[m]}</button>
      ${m === 'up' ? `<div class="note">${t('login.mustBeAdded')}</div>` : ''}
      <div class="tools">${m !== 'in' ? `<button type="button" class="ghost" data-act="lmode" data-id="in">${t('login.haveAccount')}</button>` : ''}${m !== 'up' ? `<button type="button" class="ghost" data-act="lmode" data-id="up">${t('login.firstTime')}</button>` : ''}${m === 'in' ? `<button type="button" class="ghost" data-act="lmode" data-id="forgot">${t('login.forgot')}</button>` : ''}</div></form>${footer()}`;
  },
  newpass() {
    return `<form class="login" data-form="newpass"><h1>${t('newpass.title')}</h1>
      <div class="field">${t('newpass.label')}<input id="np" type="password" autocomplete="new-password" required minlength="8"></div>
      <button class="primary" type="submit">${t('common.save')}</button></form>`;
  },
  home() {
    const td = today(), live = db.sessions.filter(s => !s.archived), arch = db.sessions.filter(s => s.archived).sort((a, b) => a.date < b.date ? 1 : -1);
    const up = live.filter(s => s.date >= td).sort((a, b) => a.date < b.date ? -1 : 1), past = live.filter(s => s.date < td).sort((a, b) => a.date < b.date ? 1 : -1);
    const card = s => `<li><button class="card" data-act="open" data-id="${s.id}"><span class="grow"><b>${esc(s.name)}</b><small>${fDate(s.date)} · ${nRiders(s.rider_ids.length)}</small></span>${s.archived ? `<span class="tag">${t('home.archivedTag')}</span>` : s.date === td ? `<span class="tag today">${t('home.todayTag')}</span>` : s.date > td ? `<span class="tag">${t('home.upcomingTag')}</span>` : ''}</button></li>`;
    const [c, lab] = netLabel();
    return `<header class="bar"><div class="brand">${logoImg('')}<h1>${esc(SET.appName)}<small>${esc([SET.clubName, db.me ? db.me.name : ''].filter(Boolean).join(' · '))}</small></h1></div>${isAdmin() ? `<button class="ghost" data-act="admin">${t('home.admin')}</button>` : ''}<button class="ghost" data-act="logout">${t('home.signOut')}</button></header>
    <div class="tools"><button class="net ${c}" id="net" data-act="sync"><i></i>${esc(lab)}</button></div>
    <h2>${t('home.upcoming')}</h2><ul class="list">${up.map(card).join('') || `<li class="hint">${t('home.noUpcoming')}</li>`}</ul>
    <h2>${t('home.past')}</h2><ul class="list">${past.map(card).join('') || `<li class="hint">${t('home.noPast')}</li>`}</ul>
    ${arch.length ? `<div class="tools"><button class="ghost" data-act="arch">${t(ui.showArch ? 'home.hideArchived' : 'home.showArchived', { n: arch.length })}</button></div>${ui.showArch ? `<ul class="list">${arch.map(card).join('')}</ul>` : ''}` : ''}
    ${footer()}<button class="fab" data-act="new" aria-label="${t('home.newSession')}">+</button>`;
  },
  session() {
    const s = cur(), P = [['start', t('post.start')], ['inter', t('post.split')], ['finish', t('post.finish')], ['both', t('post.both')]];
    const T = [['chrono', t('tab.chrono')], ['results', t('tab.results')], ['analysis', t('tab.analysis')], ['gpx', t('tab.gpx')]], [c, lab] = netLabel();
    return `<header class="bar"><button class="back" data-act="home">‹ ${t('session.back')}</button><span style="flex:1"></span>
      <button class="net ${c}" id="net" data-act="sync"><i></i>${esc(lab)}</button></header>
    <header class="bar" style="padding-top:0"><h1>${esc(s.name)}<small>${fDate(s.date)} · ${nRiders(s.rider_ids.length)}${s.archived ? ' · ' + t('session.archived') : ''}</small></h1></header>
    <div class="tabs" role="tablist">${T.map(([k, l]) => `<button role="tab" aria-selected="${ui.tab === k}" data-act="tab" data-id="${k}">${l}</button>`).join('')}</div>
    ${ui.tab === 'chrono' ? `<div class="label">${t('session.myPost')}</div><div class="seg">${P.map(([k, l]) => `<button aria-pressed="${ui.poste === k}" data-act="poste" data-id="${k}">${l}</button>`).join('')}</div>${chrono(s)}` : ui.tab === 'results' ? results(s) : ui.tab === 'analysis' ? analysis(s) : gpxView(s)}`;
  },
  admin() {
    const y = ui.adminTab === 'youth', riders = db.riders.filter(r => r.active !== false).sort((a, b) => a.name.localeCompare(b.name, LOC));
    return `<header class="bar"><button class="back" data-act="home">‹ ${t('session.back')}</button></header>
    <header class="bar" style="padding-top:0"><h1>${t('admin.title')}<small>${t('admin.subtitle')}</small></h1></header>
    <div class="tabs" role="tablist"><button role="tab" aria-selected="${y}" data-act="atab" data-id="youth">${t('admin.ridersTab', { n: riders.length })}</button><button role="tab" aria-selected="${!y}" data-act="atab" data-id="coach">${t('admin.coachesTab', { n: db.coaches.length })}</button></div>
    ${y ? `<form class="inline" data-form="youth"><input id="new-youth" placeholder="${t('admin.fullName')}" autocomplete="off" required><input id="new-grp" placeholder="${t('admin.group')}" autocomplete="off" style="flex:0 1 110px"><button class="primary" type="submit">${t('common.add')}</button></form>
      <div class="tools"><label class="ghost file">${t('admin.importCsv')}<input type="file" id="csv-youth" accept=".csv,text/csv,text/plain"></label></div><div class="note">${t('admin.ridersCsvHelp')}</div>
      <ul class="list">${riders.map(r => `<li class="line"><span class="grow">${esc(r.name)}<small>${esc(r.grp || t('admin.noGroup'))}</small></span><button data-act="delyouth" data-id="${r.id}">${t('common.remove')}</button></li>`).join('') || `<li class="hint">${t('admin.noRiders')}</li>`}</ul>`
    : `<form class="stack" data-form="coach"><div class="field">${t('admin.name')}<input id="c-name" autocomplete="off" required></div><div class="field">${t('login.email')}<input id="c-mail" type="email" autocomplete="off" required></div>
      <div class="field">${t('admin.role')}<select id="c-role"><option value="coach">${t('role.coach')}</option><option value="admin">${t('role.admin')}</option></select></div><button class="primary" type="submit">${t('admin.addCoach')}</button></form>
      <div class="tools"><label class="ghost file">${t('admin.importCsv')}<input type="file" id="csv-coach" accept=".csv,text/csv,text/plain"></label></div><div class="note">${t('admin.coachesCsvHelp')}</div>
      <ul class="list">${db.coaches.map(c => `<li class="line"><span class="grow">${esc(c.name)}<small>${esc(c.email)} · ${t(c.role === 'admin' ? 'role.admin' : 'role.coach')} · ${t(c.user_id ? 'admin.accountCreated' : 'admin.notYet')}</small></span>${db.me && c.email === db.me.email ? '' : `<button data-act="delcoach" data-id="${esc(c.email)}">${t('common.remove')}</button>`}</li>`).join('')}</ul>`}`;
  }
};

function footer() {
  const langs = SET.languages.filter(c => LANGS[c]);
  const pick = langs.length > 1 ? `<label class="langpick">${t('footer.language')} <select id="lang-pick">${langs.map(c => `<option value="${c}" ${c === LANG ? 'selected' : ''}>${esc(LANGS[c]._name || c)}</option>`).join('')}</select></label>` : '';
  return `<footer class="foot">${pick}<span>${VERSION ? t('footer.version', { v: esc(VERSION) }) : ''}</span><button class="linkish" data-act="checkupdate">${t('footer.checkUpdate')}</button></footer>`;
}

function chrono(s) {
  const p = ui.poste, canStart = p === 'start' || p === 'both', pend = db.pend[s.id] || {};
  const cp = r => { const a = active(r); return a.splits.length + a.laps.length; }, last = r => { const a = active(r); return Math.max(a.start, ...a.splits, ...a.laps); };
  const running = s.rider_ids.filter(r => active(r)).sort((a, b) => cp(b) - cp(a) || last(a) - last(b));
  let idle = s.rider_ids.filter(r => !active(r));
  if (p === 'start') idle = idle.map((r, i) => [r, i]).sort((a, b) => times(a[0]).length - times(b[0]).length || a[1] - b[1]).map(x => x[0]);
  else idle.sort((a, b) => (best(a) ?? 1e15) - (best(b) ?? 1e15));
  const ranked = s.rider_ids.filter(r => best(r) != null).sort((a, b) => best(a) - best(b));
  const row = r => {
    const a = active(r), ts = times(r); let sub, time = '', btn = '';
    if (a) {
      if (a.laps.length) { const l = a.laps, d = l[l.length - 1] - (l[l.length - 2] ?? a.start); sub = t('chrono.onLap', { lap: l.length + 1, time: fmt(d) }); }
      else if (a.splits.length) { const i = a.splits.length - 1, e = a.splits[i] - a.start, rk = 1 + R.filter(x => x !== a && x.splits[i] != null && x.splits[i] - x.start < e).length; sub = t('chrono.atSplit', { i: i + 1, time: fmt(e), rank: t('ordinal', { n: rk }) }); }
      else sub = t('chrono.running');
      time = `<span class="time" data-start="${a.start}">${fmt(now() - a.start, 1)}</span>`;
      const pd = pend[r];
      if (pd != null) { time = ''; sub = t('chrono.stoppedAt', { time: fmt(pd - a.start) }); btn = `<span class="duo"><button class="act lap" data-act="lap" data-id="${r}">${t('btn.lap')}</button><button class="act stop" data-act="fin" data-id="${r}">${t('btn.finish')}</button><button class="act x" data-act="nostop" data-id="${r}" aria-label="${t('chrono.cancelStop')}">✕</button></span>`; }
      else if (p === 'inter') btn = `<button class="act split" data-act="split" data-id="${r}">${t('btn.split')}</button>`;
      else if (p === 'finish' || p === 'both') btn = `<button class="act stop" data-act="stop" data-id="${r}">${t('btn.stop')}</button>`;
    } else {
      sub = ORPH[r] ? t('chrono.waitingStart') : ts.length ? t('chrono.runsBest', { runs: nRuns(ts.length), time: fmt(Math.min(...ts)) }) : t('chrono.notStarted');
      if (ts.length) time = `<span class="time">${fmt(ts[ts.length - 1])}</span>`;
      if (canStart) btn = ui.multi ? `<button class="act pick" aria-pressed="${ui.sel.includes(r)}" data-act="pick" data-id="${r}" aria-label="${esc(t('chrono.select', { name: rname(r) }))}">${ui.sel.includes(r) ? '✓' : '+'}</button>` : `<button class="act go" data-act="start" data-id="${r}">${t('btn.start')}</button>`;
      else btn = `<button class="act late" data-act="${p === 'inter' ? 'split' : 'stop'}" data-id="${r}">${t(p === 'inter' ? 'btn.split' : 'btn.stop')}</button>`;
    }
    const pos = a ? '●' : (ranked.indexOf(r) >= 0 ? ranked.indexOf(r) + 1 : '–');
    return `<li class="row ${a ? 'run' : ''}"><span class="pos">${pos}</span><div class="who"><b>${esc(rname(r))}</b><small>${sub}</small></div>${time || '<span></span>'}${btn || '<span></span>'}</li>`;
  };
  const order = p === 'start' ? [...idle, ...running] : [...running, ...idle];
  const wait = !canStart && !running.length && s.rider_ids.length ? `<div class="hint">${t('chrono.waitHint')}</div>` : '';
  const n = ui.sel.length, multi = canStart && idle.length ? `<div class="tools"><button class="ghost" data-act="multi">${t(ui.multi ? 'chrono.leaveGroup' : 'chrono.groupStart')}</button>${ui.multi ? `<button class="ghost" data-act="pickall">${t('chrono.selectAll')}</button>` : ''}</div>` : '';
  const bar = ui.multi && canStart ? `<div class="gobar"><button class="act go" data-act="startsel" ${n ? '' : 'disabled'}>${n ? t('chrono.startN', { riders: nRiders(n) }) : t('chrono.selectRiders')}</button></div>` : '';
  return `${wait}${multi}<ul class="list tight">${order.map(row).join('') || `<li class="hint">${t('chrono.noRiders')}</li>`}</ul>
  <div class="tools"><button class="ghost" data-act="people">${t('chrono.peopleBtn')}</button><button class="ghost" data-act="archive">${t(s.archived ? 'chrono.unarchive' : 'chrono.archive')}</button></div>${bar}`;
}

function results(s) {
  const ids = [...new Set([...s.rider_ids, ...R.map(r => r.riderId)])].filter(r => times(r).length).sort((a, b) => best(a) - best(b));
  if (!ids.length) return `<div class="hint">${t('results.none')}</div>`;
  return `<ul class="list">${ids.map((r, i) => {
    const ts = times(r), avg = ts.reduce((a, b) => a + b, 0) / ts.length, runs = R.filter(x => x.riderId === r && x.end != null);
    return `<li><details class="res"><summary><span class="pos">${i + 1}</span><div class="who"><b>${esc(rname(r))}</b><small>${nRuns(ts.length)} · ${t('results.details')}</small></div>
      <div class="stats"><span>${t('results.best')}</span><span>${t('results.avg')}</span><span>${t('results.max')}</span><b class="best">${fmt(Math.min(...ts))}</b><b>${fmt(avg)}</b><b>${fmt(Math.max(...ts))}</b></div></summary>
      <div class="runs">${runs.map((x, k) => { const ex = [...x.splits.map((v, j) => t('results.splitN', { i: j + 1, time: fmt(v - x.start) })), ...x.laps.map((v, j) => t('results.lapN', { i: j + 1, time: fmt(v - (x.laps[j - 1] ?? x.start)) }))];
        return `<div><span>${k + 1}.</span><b>${fmt(x.end - x.start)}</b><em>${ex.join(' · ')}</em><button data-act="delrun" data-id="${x.id}">${t('results.delete')}</button></div>`; }).join('')}</div></details></li>`; }).join('')}</ul>
  <div class="tools"><button class="ghost" data-act="csv">${t('results.exportCsv')}</button><button class="ghost" data-act="copy">${t('results.copy')}</button></div>`;
}

/* ---------- GPS tracks (GPX and FIT) ---------- */
// A track is a list of points [lat, lon, elevation|null, time in ms|null], at most MAXPTS points.
const MAXPTS = 4000, RAD = Math.PI / 180, RE = 6371000, FIT_EPOCH = 631065600; // FIT time counts from 1989-12-31 UTC
function thin(pts) {
  if (pts.length <= MAXPTS) return pts;
  const k = pts.length / MAXPTS; return pts.filter((_, i) => Math.floor(i / k) !== Math.floor((i - 1) / k) || i === pts.length - 1);
}
const roundPt = p => [+p[0].toFixed(6), +p[1].toFixed(6), p[2] == null || isNaN(p[2]) ? null : +p[2].toFixed(1), p[3] || null];
function parseGpx(txt) {
  const doc = new DOMParser().parseFromString(txt, 'application/xml'); let n = [...doc.getElementsByTagName('trkpt')]; if (!n.length) n = [...doc.getElementsByTagName('rtept')];
  const pts = n.map(p => { const e = p.getElementsByTagName('ele')[0], tm = p.getElementsByTagName('time')[0]; return [+p.getAttribute('lat'), +p.getAttribute('lon'), e ? +e.textContent : null, tm ? Date.parse(tm.textContent) : null]; }).filter(p => isFinite(p[0]) && isFinite(p[1]));
  return thin(pts).map(roundPt);
}
// Minimal FIT decoder: reads only the "record" messages (global number 20) and their
// timestamp (253), position_lat (0), position_long (1), altitude (2) and enhanced_altitude (78).
function parseFit(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf), hs = u8[0];
  if (hs < 12 || String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) !== '.FIT') throw new Error('not a FIT file');
  const end = Math.min(hs + dv.getUint32(4, true), u8.length), defs = {}, pts = [];
  let p = hs, lastTs = 0;
  const read = (d, at) => {
    const v = {};
    for (const f of d.fields) {
      if (f.num !== 253 && f.num !== 0 && f.num !== 1 && f.num !== 2 && f.num !== 78) continue;
      const o = at + f.off;
      if (f.sz === 4) { const x = (f.num === 0 || f.num === 1) ? dv.getInt32(o, d.le) : dv.getUint32(o, d.le); if (x !== 0x7FFFFFFF && x !== 0xFFFFFFFF) v[f.num] = x; }
      else if (f.sz === 2) { const x = dv.getUint16(o, d.le); if (x !== 0xFFFF) v[f.num] = x; }
    }
    return v;
  };
  const record = (v, ts) => {
    if (v[0] == null || v[1] == null) return;
    const ele = v[78] != null ? v[78] / 5 - 500 : v[2] != null ? v[2] / 5 - 500 : null;
    pts.push([v[0] * 180 / 2147483648, v[1] * 180 / 2147483648, ele, ts ? (ts + FIT_EPOCH) * 1000 : null]);
  };
  while (p < end) {
    const h = u8[p++];
    if (h & 0x80) {                                   // data message with a compressed timestamp
      const d = defs[(h >> 5) & 3]; if (!d || p + d.size > end) break;
      const off = h & 0x1F; lastTs = lastTs + ((off - (lastTs & 0x1F)) & 0x1F);
      const v = read(d, p); p += d.size; if (d.g === 20) record(v, lastTs);
    } else if (h & 0x40) {                            // definition message
      const le = u8[p + 1] === 0, g = dv.getUint16(p + 2, le), nf = u8[p + 4]; p += 5;
      const fields = []; let size = 0;
      for (let i = 0; i < nf; i++) { fields.push({ num: u8[p], sz: u8[p + 1], off: size }); size += u8[p + 1]; p += 3; }
      if (h & 0x20) { const nd = u8[p++]; for (let i = 0; i < nd; i++) { size += u8[p + 1]; p += 3; } }   // developer fields: skipped
      defs[h & 0x0F] = { le, g, fields, size };
    } else {                                          // normal data message
      const d = defs[h & 0x0F]; if (!d || p + d.size > end) break;
      const v = read(d, p); p += d.size; if (v[253] != null) lastTs = v[253]; if (d.g === 20) record(v, lastTs);
    }
  }
  return thin(pts).map(roundPt);
}
async function readTrackFile(file) {
  let buf = await file.arrayBuffer(), u8 = new Uint8Array(buf);
  if (u8[0] === 0x1F && u8[1] === 0x8B && self.DecompressionStream) {   // .gz export (Strava, etc.)
    buf = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(); u8 = new Uint8Array(buf);
  }
  if (u8.length > 12 && String.fromCharCode(u8[8], u8[9], u8[10], u8[11]) === '.FIT') return parseFit(buf);
  return parseGpx(new TextDecoder().decode(u8));
}

// Tracks of a session. Older data held a single track as {name, riderId, pts}.
function tracksOf(sid) {
  const g = db.gpx[sid]; if (!g) return [];
  if (!g.tracks && g.pts) { db.gpx[sid] = { tracks: [{ id: 't0', name: g.name, riderId: g.riderId || null, pts: g.pts }] }; return db.gpx[sid].tracks; }
  return g.tracks || [];
}
function saveTracks(sid, tracks) { db.gpx[sid] = { tracks }; save('gpx'); queue({ k: 'upd', t: 'sessions', id: sid, patch: { gpx: tracks.length ? db.gpx[sid] : null } }); }

const hav = (a, b) => { const x = Math.sin((b[0] - a[0]) * RAD / 2) ** 2 + Math.cos(a[0] * RAD) * Math.cos(b[0] * RAD) * Math.sin((b[1] - a[1]) * RAD / 2) ** 2; return 2 * RE * Math.asin(Math.sqrt(x)); };
const cumCache = new WeakMap();
function cum(pts) { let c = cumCache.get(pts); if (c) return c; c = new Float64Array(pts.length); for (let i = 1; i < pts.length; i++) c[i] = c[i - 1] + hav(pts[i - 1], pts[i]); cumCache.set(pts, c); return c; }
const timed = pts => pts.length > 1 && pts[0][3] && pts[pts.length - 1][3];
// Where the rider was at time ts (linear interpolation), and the distance travelled since the start of the track.
function at(pts, ts) {
  const n = pts.length; if (!timed(pts) || ts < pts[0][3] - 2000 || ts > pts[n - 1][3] + 2000) return null;
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if ((pts[m][3] || 0) <= ts) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], f = b[3] > a[3] ? Math.min(1, Math.max(0, (ts - a[3]) / (b[3] - a[3]))) : 0, c = cum(pts);
  return { lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f, d: c[lo] + (c[hi] - c[lo]) * f };
}
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/* The course: start, split and finish points found by matching the timed runs with the position
   of the rider who carried the device. Distances are measured along the track. */
const segKey = (a, b) => a + '>' + b;
function course(sid) {
  const tracks = tracksOf(sid).filter(tk => tk.riderId && timed(tk.pts));
  const G = {}, S = {}, laps = [], refs = new Set(); let n = 0;
  const add = (o, k, v) => (o[k] = o[k] || []).push(v);
  for (const tk of tracks) for (const r of R.filter(x => x.riderId === tk.riderId && x.end != null)) {
    const a0 = at(tk.pts, r.start), a1 = at(tk.pts, r.end); if (!a0 || !a1) continue;
    n++; refs.add(tk.riderId); add(G, 'start', a0);
    let prev = a0, pk = 'start';
    r.splits.forEach((ts, i) => { const a = at(tk.pts, ts); if (!a) return; const k = 'split' + (i + 1); add(G, k, a); add(S, segKey(pk, k), a.d - prev.d); prev = a; pk = k; });
    add(G, 'finish', a1);
    if (r.laps.length) { let q = a0; [...r.laps, r.end].forEach(ts => { const a = at(tk.pts, ts); if (a) { laps.push(a.d - q.d); q = a; } }); }
    else { add(S, segKey(pk, 'finish'), a1.d - prev.d); add(S, 'total', a1.d - a0.d); }
  }
  if (!n) return null;
  const order = k => k === 'start' ? 0 : k === 'finish' ? 1e3 : +k.slice(5);
  const gates = Object.keys(G).sort((a, b) => order(a) - order(b)).map(k => ({ key: k, lat: med(G[k].map(x => x.lat)), lon: med(G[k].map(x => x.lon)), n: G[k].length }));
  const seg = {}; Object.keys(S).forEach(k => { seg[k] = med(S[k]); });
  const st = gates.find(g => g.key === 'start'), fi = gates.find(g => g.key === 'finish');
  return { gates, seg, total: seg.total || null, lap: laps.length ? med(laps) : null, circuit: !!(st && fi && hav([st.lat, st.lon], [fi.lat, fi.lon]) < 30), runs: n, refs: [...refs] };
}
// Distance covered by a run, from the course: one lap length per lap, or the start-to-finish length.
function runDist(r, C) { if (!C) return null; if (r.laps.length) return C.lap ? C.lap * (r.laps.length + 1) : null; return C.total; }
const kmh = (m, ms) => m && ms > 0 ? m / (ms / 1000) * 3.6 : null;

// Times when a track passes within `rad` metres of a gate (closest point of each pass).
function passes(pts, g, rad) {
  const out = [], kx = Math.cos(g.lat * RAD) * RE * RAD, ky = RE * RAD; let bestP = null;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i]; if (!a[3] || !b[3]) continue;
    const ax = (a[1] - g.lon) * kx, ay = (a[0] - g.lat) * ky, dx = (b[1] - a[1]) * kx, dy = (b[0] - a[0]) * ky, L = dx * dx + dy * dy;
    const f = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0, d = Math.hypot(ax + dx * f, ay + dy * f);
    if (d < rad) { const ts = a[3] + (b[3] - a[3]) * f; if (!bestP || d < bestP.d) bestP = { d, ts }; }
    else if (bestP) { out.push(Math.round(bestP.ts)); bestP = null; }
  }
  if (bestP) out.push(Math.round(bestP.ts));
  return out.filter((v, i, arr) => !i || v - arr[i - 1] > 5000);
}
/* Runs found on a track by the course points alone: this is how the start, split and finish found
   on one rider's track are applied to the other riders who recorded their ride. */
function detectRuns(tk, C) {
  if (!C || !timed(tk.pts)) return [];
  const G = k => C.gates.find(g => g.key === k), RADIUS = 20, found = [];
  const known = r => tk.riderId && R.some(x => x.riderId === tk.riderId && Math.abs(x.start - r.start) < 10000);
  if (C.circuit) {
    const P = passes(tk.pts, G('start'), RADIUS); let grp = [];
    const flush = () => { if (grp.length > 1) found.push({ start: grp[0], splits: [], laps: grp.slice(1, -1), end: grp[grp.length - 1] }); grp = []; };
    P.forEach(v => { if (grp.length && v - grp[grp.length - 1] > 600000) flush(); grp.push(v); }); flush();
  } else if (G('start') && G('finish')) {
    const S = passes(tk.pts, G('start'), RADIUS), F = passes(tk.pts, G('finish'), RADIUS);
    const splitGates = C.gates.filter(g => g.key.startsWith('split')).map(g => passes(tk.pts, g, RADIUS));
    S.forEach((s, i) => {
      const f = F.find(v => v > s + 3000); if (!f || f - s > 1200000 || (S[i + 1] && S[i + 1] < f)) return;
      const splits = []; for (const P of splitGates) { const v = P.find(x => x > s && x < f); if (v == null) break; splits.push(v); }
      found.push({ start: s, splits, laps: [], end: f });
    });
  }
  return found.filter(r => !known(r));
}

function trackStats(pts) {
  const xy = [], seg = [], step = Math.max(1, Math.floor(pts.length / 400)), c = cum(pts); let up = 0, down = 0, ref = pts[0][2];
  pts.forEach((p, i) => {
    if (i % step === 0 || i === pts.length - 1) xy.push(p);
    if (!i) return; const q = pts[i - 1];
    if (p[2] != null && ref != null) { const de = p[2] - ref; if (de > 1) { up += de; ref = p[2]; } else if (de < -1) { down -= de; ref = p[2]; } } else if (ref == null) ref = p[2];
    if (p[3] && q[3] && p[3] > q[3]) { const v = (c[i] - c[i - 1]) / ((p[3] - q[3]) / 1000) * 3.6; if (v < 150) seg.push([c[i], v]); }   // ignore GPS jumps
  });
  const sm = seg.map((s, i) => { const w = seg.slice(Math.max(0, i - 2), i + 3); return [s[0], w.reduce((a, b) => a + b[1], 0) / w.length]; }), ss = Math.max(1, Math.floor(sm.length / 200));
  const dist = c[c.length - 1], dur = timed(pts) ? pts[pts.length - 1][3] - pts[0][3] : null;
  return { dist, up, down, dur, vavg: dur ? dist / (dur / 1000) * 3.6 : 0, vmax: sm.length ? Math.max(...sm.map(s => s[1])) : 0, xy, sp: sm.filter((_, i) => i % ss === 0) };
}
const num = (v, d) => { try { return v.toLocaleString(LOC, { minimumFractionDigits: d, maximumFractionDigits: d }); } catch (e) { return v.toFixed(d); } };
const metres = m => m >= 1000 ? num(m / 1000, 2) + ' km' : Math.round(m) + ' m';
const gateLabel = k => k === 'start' ? t('gate.start') : k === 'finish' ? t('gate.finish') : t('gate.split', { i: k.slice(5) });
const gateShort = k => k === 'start' ? t('gate.startShort') : k === 'finish' ? t('gate.finishShort') : t('gate.splitShort', { i: k.slice(5) });

function mapSvg(tracks, C) {
  const all = tracks.flatMap(tk => trackStats(tk.pts).xy); if (!all.length) return '';
  const c0 = Math.cos(all[0][0] * RAD), X = p => p[1] * c0, Y = p => p[0];
  const pts = all.concat(C ? C.gates.map(g => [g.lat, g.lon]) : []), xs = pts.map(X), ys = pts.map(Y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), sc = Math.min(296 / ((x1 - x0) || 1e-9), 176 / ((y1 - y0) || 1e-9));
  const ox = 12 + (296 - (x1 - x0) * sc) / 2, oy = 188 - (176 - (y1 - y0) * sc) / 2;
  const P = p => [(ox + (X(p) - x0) * sc).toFixed(1), (oy - (Y(p) - y0) * sc).toFixed(1)];
  const lines = tracks.map(tk => { const ref = C && C.refs.includes(tk.riderId); return `<polyline points="${trackStats(tk.pts).xy.map(p => P(p).join(',')).join(' ')}" fill="none" stroke="${ref ? 'var(--accent)' : 'var(--muted)'}" stroke-width="${ref ? 3 : 2}" stroke-opacity="${ref ? 1 : .6}" stroke-linejoin="round" stroke-linecap="round"><title>${esc(tk.name)}</title></polyline>`; }).join('');
  const gates = C ? C.gates.map(g => { const [x, y] = P([g.lat, g.lon]), col = g.key === 'start' ? 'var(--go)' : g.key === 'finish' ? 'var(--stop)' : 'var(--split)';
    return `<g><circle cx="${x}" cy="${y}" r="7" fill="${col}" stroke="var(--surface)" stroke-width="2"><title>${esc(gateLabel(g.key))}</title></circle><text x="${x}" y="${(+y - 11).toFixed(1)}" text-anchor="middle" class="gtext">${esc(gateShort(g.key))}</text></g>`; }).join('') : '';
  return `<div class="plot"><svg viewBox="0 0 320 200" role="img" aria-label="${t('gpx.trackAria')}">${lines}${gates}</svg></div>`;
}
function speedSvg(st) {
  if (st.sp.length < 2) return '';
  const vm = Math.max(st.vmax, 1), D = st.dist || 1, sp = st.sp.map(p => (30 + p[0] / D * 280).toFixed(1) + ',' + (95 - p[1] / vm * 80).toFixed(1));
  return `<div class="plot"><svg viewBox="0 0 320 112" role="img" aria-label="${t('gpx.speedAria')}"><line x1="30" y1="15" x2="310" y2="15" stroke="var(--line)"/><line x1="30" y1="95" x2="310" y2="95" stroke="var(--line)"/>
    <polygon points="30,95 ${sp.join(' ')} 310,95" fill="var(--accent)" opacity=".18"/><polyline points="${sp.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    <text x="26" y="18" text-anchor="end">${Math.round(vm)}</text><text x="26" y="98" text-anchor="end">0</text><text x="30" y="108">${t('gpx.speedAxis')}</text><text x="310" y="108" text-anchor="end">${metres(st.dist)}</text></svg></div>`;
}
const importBtn = cls => `<label class="${cls} file">${t('gpx.import')}<input type="file" id="gpx-file" accept=".gpx,.fit,.gz,application/gpx+xml,application/octet-stream,text/xml,application/xml"></label>`;

function gpxView(s) {
  const tracks = tracksOf(s.id);
  if (!tracks.length) return `<div class="hint">${t('gpx.intro')}</div><div class="tools">${importBtn('primary')}</div>`;
  const C = course(s.id), k = (l, v) => `<div class="kpi"><span>${l}</span><b>${v}</b></div>`;
  ui.det = {};
  let head;
  if (C) {
    const segs = Object.keys(C.seg).filter(x => x !== 'total').map(x => { const [a, b] = x.split('>'); return `<div><span>${esc(gateLabel(a))} → ${esc(gateLabel(b))}</span><b>${metres(C.seg[x])}</b></div>`; }).join('');
    head = `<div class="kpis">${C.total ? k(t('gpx.courseLength'), metres(C.total)) : ''}${C.lap ? k(t('gpx.lapLength'), metres(C.lap)) : ''}${k(t('gpx.gatesFound'), C.gates.length)}</div>
      ${segs ? `<div class="res"><div class="runs segs">${segs}</div></div>` : ''}
      <div class="note">${t('gpx.courseFrom', { runs: nRuns(C.runs), names: esc(C.refs.map(rname).join(', ')) })}</div>`;
  } else head = `<div class="hint">${t('gpx.noCourse')}</div>`;
  const cards = tracks.map((tk, ti) => {
    const st = trackStats(tk.pts), mine = tk.riderId ? R.filter(x => x.riderId === tk.riderId && x.end != null) : [];
    const rows = mine.map((x, i) => { const sl = timed(tk.pts) ? tk.pts.filter(p => p[3] && p[3] >= x.start && p[3] <= x.end) : []; if (sl.length < 2) return `<div><span>${i + 1}.</span><b>${fmt(x.end - x.start)}</b><em>${t('gpx.noPoints')}</em></div>`; const ss = trackStats(sl); return `<div><span>${i + 1}.</span><b>${fmt(x.end - x.start)}</b><em>${t('gpx.runLine', { m: Math.round(ss.dist), avg: num(kmh(ss.dist, x.end - x.start), 1), max: num(ss.vmax, 1) })}</em></div>`; }).join('');
    const det = detectRuns(tk, C);
    const detRows = det.map((r, i) => { const id = tk.id + ':' + i; ui.det[id] = { r, rider: tk.riderId }; const d = runDist(r, C);
      return `<div><span>${new Date(r.start).toLocaleTimeString(LOC, { hour: '2-digit', minute: '2-digit' })}</span><b>${fmt(r.end - r.start)}</b><em>${[r.laps.length ? t('results.lapsCount', { n: r.laps.length + 1 }) : '', d ? num(kmh(d, r.end - r.start), 1) + ' km/h' : ''].filter(Boolean).join(' · ')}</em>${tk.riderId ? `<button data-act="gpsadd" data-id="${esc(id)}">${t('gpx.addRun')}</button>` : ''}</div>`; }).join('');
    return `<details class="res trk" ${ti === 0 ? 'open' : ''}><summary class="trk-head"><div class="who"><b>${esc(tk.name)}</b><small>${tk.riderId ? esc(rname(tk.riderId)) : t('gpx.riderNotSet')} · ${metres(st.dist)}</small></div></summary>
      <div class="trk-body">
      <div class="field">${t('gpx.carriedBy')}<select data-track="${esc(tk.id)}"><option value="">${t('gpx.notSpecified')}</option>${s.rider_ids.map(r => `<option value="${r}" ${tk.riderId === r ? 'selected' : ''}>${esc(rname(r))}</option>`).join('')}</select></div>
      ${!timed(tk.pts) ? `<div class="note">${t('gpx.noTime')}</div>` : ''}
      <div class="kpis">${k(t('gpx.distance'), metres(st.dist))}${k(t('gpx.duration'), st.dur ? fmt(st.dur, 1) : '–')}${k(t('gpx.avgSpeed'), st.dur ? num(st.vavg, 1) + ' km/h' : '–')}${k(t('gpx.maxSpeed'), st.vmax ? num(st.vmax, 1) + ' km/h' : '–')}${k(t('gpx.climb'), Math.round(st.up) + ' m')}${k(t('gpx.descent'), Math.round(st.down) + ' m')}</div>
      ${speedSvg(st)}
      ${rows ? `<h2>${t('gpx.timedRuns')}</h2><div class="runs">${rows}</div>` : ''}
      ${detRows ? `<h2>${t('gpx.detectedRuns')}</h2><div class="note">${t(tk.riderId ? 'gpx.detectedHelp' : 'gpx.detectedNoRider')}</div><div class="runs">${detRows}</div>` : ''}
      <div class="tools"><button class="ghost" data-act="trkdel" data-id="${esc(tk.id)}">${t('gpx.remove')}</button></div></div></details>`;
  }).join('');
  return `${mapSvg(tracks, C)}${head}<h2>${t('gpx.tracks', { n: tracks.length })}</h2><ul class="list"><li>${cards}</li></ul><div class="tools">${importBtn('ghost')}</div>`;
}

/* ---------- Analysis ---------- */
// Small SVG helpers. Colours come from the theme; one hue per chart, identity is carried by row labels.
function sparkSvg(vals, bestI, w, h) {
  if (vals.length < 2) return '';
  const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1, X = i => 4 + i * (w - 8) / (vals.length - 1), Y = v => 4 + (v - lo) / span * (h - 8);  // faster = higher
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${vals.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>${vals.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="${i === bestI ? 4 : 2.5}" fill="${i === bestI ? 'var(--accent)' : 'var(--surface)'}" stroke="var(--accent)" stroke-width="1.5"><title>${t('analysis.runN', { i: i + 1 })} : ${fmt(v)}</title></circle>`).join('')}</svg>`;
}
function analysis(s) {
  const fin = R.filter(x => x.end != null);
  if (!fin.length) return `<div class="hint">${t('analysis.none')}</div>`;
  const C = course(s.id), riders = [...new Set(fin.map(x => x.riderId))];
  const byRider = r => fin.filter(x => x.riderId === r).sort((a, b) => a.start - b.start);
  const bestOf = r => Math.min(...byRider(r).map(x => x.end - x.start));
  riders.sort((a, b) => bestOf(a) - bestOf(b));
  const top = bestOf(riders[0]), allT = fin.map(x => x.end - x.start), bests = riders.map(bestOf);
  const tile = (l, v, sub) => `<div class="kpi"><span>${l}</span><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const bestRun = byRider(riders[0]).find(x => x.end - x.start === top), bestSpeed = C ? kmh(runDist(bestRun, C), top) : null;
  let h = `<div class="kpis k4">${tile(t('analysis.runs'), fin.length, nRiders(riders.length))}${tile(t('analysis.sessionBest'), fmt(top), esc(rname(riders[0])))}${tile(t('analysis.medianBest'), fmt(med(bests)), t('analysis.medianBestSub'))}${bestSpeed ? tile(t('analysis.topSpeed'), num(bestSpeed, 1) + ' km/h', t('analysis.onBestRun')) : tile(t('analysis.spread'), '+' + num((Math.max(...bests) - top) / 1000, 2) + ' s', t('analysis.spreadSub'))}</div>`;

  // 1. Every run on one time axis
  const lo = Math.min(...allT), hi = Math.max(...allT), pad = Math.max(500, (hi - lo) * .06), a0 = lo - pad, a1 = hi + pad, W = 320, LX = 92, RW = W - LX - 8, rowH = 24;
  const X = v => (LX + (v - a0) / (a1 - a0) * RW).toFixed(1), ticks = [0, 1, 2, 3].map(i => a0 + (a1 - a0) * (i + .5) / 4);
  const H = riders.length * rowH + 22;
  h += `<h2>${t('analysis.everyRun')}</h2><div class="note">${t('analysis.everyRunHelp')}</div><div class="plot"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${t('analysis.everyRun')}">
    ${ticks.map(v => `<line x1="${X(v)}" y1="0" x2="${X(v)}" y2="${H - 18}" stroke="var(--line)"/><text x="${X(v)}" y="${H - 5}" text-anchor="middle">${fmt(v, 1)}</text>`).join('')}
    ${riders.map((r, i) => { const y = i * rowH + 12, rs = byRider(r), b = bestOf(r), avg = rs.reduce((a, x) => a + x.end - x.start, 0) / rs.length;
      return `<text x="${LX - 6}" y="${y + 4}" text-anchor="end" class="rl">${esc(rname(r).slice(0, 14))}</text><line x1="${LX}" y1="${y}" x2="${W - 8}" y2="${y}" stroke="var(--line)" stroke-dasharray="2 3"/>
      ${rs.length > 1 ? `<line x1="${X(avg)}" y1="${y - 7}" x2="${X(avg)}" y2="${y + 7}" stroke="var(--muted)" stroke-width="2"><title>${t('results.avg')} ${fmt(avg)}</title></line>` : ''}
      ${rs.map((x, k) => { const v = x.end - x.start, isB = v === b; return `<circle cx="${X(v)}" cy="${y}" r="${isB ? 5 : 4}" fill="${isB ? 'var(--accent)' : 'var(--surface)'}" stroke="var(--accent)" stroke-width="2"><title>${esc(rname(r))} · ${t('analysis.runN', { i: k + 1 })} : ${fmt(v)}</title></circle>`; }).join('')}`; }).join('')}
  </svg></div>`;

  // 2. Gap to the session best
  const gapMax = Math.max(...bests) - top || 1;
  h += `<h2>${t('analysis.gap')}</h2><ul class="bars">${riders.map(r => { const g = bestOf(r) - top, d = C ? runDist(byRider(r).find(x => x.end - x.start === bestOf(r)), C) : null;
    return `<li><span class="bn">${esc(rname(r))}</span><span class="bt"><i style="width:${g ? Math.max(2, g / gapMax * 100).toFixed(1) : 0}%"></i></span><span class="bv">${g ? '+' + num(g / 1000, 2) + ' s' : t('analysis.leader')}${d ? `<small>${num(kmh(d, bestOf(r)), 1)} km/h</small>` : ''}</span></li>`; }).join('')}</ul>`;

  // 3. Progress during the session
  const multi = riders.filter(r => byRider(r).length > 1);
  if (multi.length) h += `<h2>${t('analysis.progress')}</h2><div class="note">${t('analysis.progressHelp')}</div><table class="atable"><thead><tr><th>${t('csv.name')}</th><th>${t('analysis.trend')}</th><th>${t('analysis.firstToLast')}</th><th>${t('analysis.consistency')}</th></tr></thead><tbody>${multi.map(r => {
    const v = byRider(r).map(x => x.end - x.start), d = v[v.length - 1] - v[0], m = v.reduce((a, b) => a + b, 0) / v.length, sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    return `<tr><td>${esc(rname(r))}</td><td>${sparkSvg(v, v.indexOf(Math.min(...v)), 96, 28)}</td><td class="${d < 0 ? 'better' : d > 0 ? 'worse' : ''}">${d < 0 ? '▲ ' : d > 0 ? '▼ ' : ''}${d > 0 ? '+' : d < 0 ? '−' : ''}${num(Math.abs(d) / 1000, 2)} s</td><td>±${num(sd / 1000, 2)} s</td></tr>`; }).join('')}</tbody></table>`;

  // 4. Sectors (when splits were taken)
  const nS = Math.max(0, ...fin.filter(x => !x.laps.length).map(x => x.splits.length));
  if (nS) {
    const keys = [...Array(nS + 1).keys()].map(i => [i ? 'split' + i : 'start', i < nS ? 'split' + (i + 1) : 'finish']);
    const secOf = (x, i) => { const b = i ? x.splits[i - 1] : x.start, e = i < nS ? x.splits[i] : x.end; return b != null && e != null && (i < nS ? x.splits.length > i : x.splits.length === nS) ? e - b : null; };
    const bestSec = r => keys.map((_, i) => { const v = byRider(r).filter(x => !x.laps.length).map(x => secOf(x, i)).filter(v => v != null); return v.length ? Math.min(...v) : null; });
    const table = riders.map(r => ({ r, sec: bestSec(r) })), colBest = keys.map((_, i) => table.map(x => x.sec[i]).filter(v => v != null).sort((a, b) => a - b));
    const shade = (v, i) => { if (v == null) return ''; const rk = colBest[i].indexOf(v); return rk === 0 ? 's1' : rk === 1 ? 's2' : rk === 2 ? 's3' : ''; };
    h += `<h2>${t('analysis.sectors')}</h2><div class="note">${t('analysis.sectorsHelp')}</div><div class="scroll"><table class="atable sec"><thead><tr><th>${t('csv.name')}</th>${keys.map(([a, b]) => `<th>${esc(gateShort(a))}→${esc(gateShort(b))}${C && C.seg[segKey(a, b)] ? `<small>${metres(C.seg[segKey(a, b)])}</small>` : ''}</th>`).join('')}<th>${t('analysis.ideal')}</th><th>${t('analysis.gain')}</th></tr></thead><tbody>${table.map(({ r, sec }) => {
      const ideal = sec.every(v => v != null) ? sec.reduce((a, b) => a + b, 0) : null, gain = ideal != null ? bestOf(r) - ideal : null;
      return `<tr><td>${esc(rname(r))}</td>${sec.map((v, i) => { const dist = C && C.seg[segKey(keys[i][0], keys[i][1])]; return `<td class="${shade(v, i)}">${v != null ? fmt(v) : '–'}${v != null && dist ? `<small>${num(kmh(dist, v), 1)} km/h</small>` : ''}</td>`; }).join('')}<td>${ideal != null ? fmt(ideal) : '–'}</td><td>${gain > 0 ? '−' + num(gain / 1000, 2) + ' s' : gain === 0 ? '0' : '–'}</td></tr>`; }).join('')}</tbody></table></div>`;
  }

  // 5. Laps (circuit)
  const lapRiders = riders.filter(r => byRider(r).some(x => x.laps.length));
  if (lapRiders.length) h += `<h2>${t('analysis.laps')}</h2><table class="atable"><thead><tr><th>${t('csv.name')}</th><th>${t('analysis.lapTimes')}</th><th>${t('analysis.bestLap')}</th><th>${t('results.avg')}</th></tr></thead><tbody>${lapRiders.map(r => {
    const L2 = byRider(r).flatMap(x => [...x.laps, x.end].map((v, j, arr) => v - (j ? arr[j - 1] : x.start))), b = Math.min(...L2), avg = L2.reduce((a, c) => a + c, 0) / L2.length;
    return `<tr><td>${esc(rname(r))}</td><td>${sparkSvg(L2, L2.indexOf(b), 96, 28)}</td><td>${fmt(b)}${C && C.lap ? `<small>${num(kmh(C.lap, b), 1)} km/h</small>` : ''}</td><td>${fmt(avg)}</td></tr>`; }).join('')}</tbody></table>`;

  h += `<div class="note">${t('analysis.basedOn', { runs: nRuns(fin.length) })}${C ? ' ' + t('analysis.speedFrom') : ' ' + t('analysis.speedHint')}</div>`;
  return h;
}

/* ---------- sheets ---------- */
function sheet() {
  if (ui.sheet === 'new') return `<div class="veil"><form class="sheet" data-form="new"><h3>${t('sheet.newTitle')}</h3>
    <div class="field">${t('sheet.name')}<input id="n-name" placeholder="${t('sheet.namePlaceholder')}" autocomplete="off"></div>
    <div class="field">${t('sheet.date')}<input id="n-date" type="date" value="${today()}"></div>
    <button class="primary" type="submit">${t('sheet.createAndPick')}</button><button type="button" class="ghost" data-act="close">${t('common.cancel')}</button></form></div>`;
  if (ui.sheet === 'people') { const s = cur(); if (!s) return ''; return `<div class="veil"><div class="sheet"><h3>${t('chrono.peopleBtn')}</h3>
    <div class="field">${t('sheet.addRider')}<input id="q" placeholder="${t('sheet.typeName')}" autocomplete="off"></div><div class="sugg" id="sugg">${sugg('')}</div>
    <ul class="list">${s.rider_ids.map(r => `<li class="line"><span class="grow">${esc(rname(r))}</span><button data-act="rmrider" data-id="${r}">${t('common.remove')}</button></li>`).join('')}</ul>
    <div class="field">${t('sheet.name')}<input id="e-name" value="${esc(s.name)}" autocomplete="off"></div>
    <div class="field">${t('sheet.date')}<input id="e-date" type="date" value="${esc(s.date)}"></div>
    <button class="primary" data-act="close">${t('common.done')}</button>
    ${isAdmin() ? `<button class="ghost danger" data-act="delsession">${t(ui.confirmDel ? 'sheet.confirmDelete' : 'sheet.deleteSession')}</button>` : ''}</div></div>`; }
  return '';
}
function sugg(q) {
  const s = cur(), n = q.trim().toLowerCase(), pool = db.riders.filter(r => r.active !== false && !s.rider_ids.includes(r.id)), groups = [...new Set(pool.map(r => r.grp).filter(Boolean))].sort();
  const list = pool.filter(r => r.name.toLowerCase().includes(n)).sort((a, b) => a.name.localeCompare(b.name, LOC)).slice(0, n ? 8 : 16);
  let h = list.map(r => `<button class="chip" data-act="addrider" data-id="${r.id}">+ ${esc(r.name)}</button>`).join('');
  if (!n) h = groups.map(g => `<button class="chip add" data-act="addgroup" data-id="${esc(g)}">${t('sheet.addGroup', { group: esc(g) })}</button>`).join('') + h;
  if (n && !db.riders.some(r => r.active !== false && r.name.toLowerCase() === n)) h += `<button class="chip add" data-act="addnew">${t('sheet.createRider', { name: esc(q.trim()) })}</button>`;
  return h || `<span class="note">${t('sheet.allIn')}</span>`;
}

/* ---------- rendering ---------- */
const typing = () => { const a = document.activeElement; return !!a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName); };
function render(bg) {
  if (bg && (holding || typing())) { dirty = true; return; }
  if (!configured || (!sb && !db.me)) { app.innerHTML = V.setup(); return; }
  if (ui.view === 'session' && !cur()) ui.view = 'home';
  if (ui.view !== 'login' && ui.view !== 'newpass' && !db.me) ui.view = 'login';
  if (ui.view === 'admin' && !isAdmin()) ui.view = 'home';
  R = ui.view === 'session' ? runsOf(ui.sid) : [];
  app.innerHTML = V[ui.view]() + sheet();
}
let toastT;
// btn: optional {act, label} shown as a button in the toast
function toast(msg, btn, ms) {
  document.querySelectorAll('.toast').forEach(e => e.remove()); clearTimeout(toastT);
  const d = document.createElement('div'); d.className = 'toast'; d.setAttribute('role', 'status');
  d.innerHTML = '<span>' + esc(msg) + '</span>' + (btn ? `<button data-act="${btn.act}">${esc(btn.label)}</button>` : ''); document.body.appendChild(d);
  if (ms !== 0) toastT = setTimeout(() => d.remove(), ms || (btn ? 7000 : 5000));
}
const undoBtn = () => ({ act: 'undo', label: t('common.undo') });
const tapTs = () => (downTs && now() - downTs < 1500) ? downTs : now();
const setRiders = (s, ids) => { s.rider_ids = ids; save('sessions'); queue({ k: 'upd', t: 'sessions', id: s.id, patch: { rider_ids: ids } }); };
const addRider = (name, grp) => { const r = { id: uuid(), name, grp: grp || '', active: true }; db.riders.push(r); save('riders'); queue({ k: 'ins', t: 'riders', row: r }); return r; };
function download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
let wake = null;
async function keepAwake() { try { if (ui.view === 'session' && 'wakeLock' in navigator && document.visibilityState === 'visible') wake = await navigator.wakeLock.request('screen'); } catch (e) {} }

/* ---------- app updates (see sw.js and version.js) ---------- */
let swReg = null, hadController = false, updateFound = false;
function initUpdates() {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:') return;
  hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then(reg => {
    swReg = reg;
    reg.addEventListener('updatefound', () => { updateFound = true; });
  }).catch(() => {});
  // A new version has taken over: offer to reload. Every tap is already saved, so reloading loses nothing.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) { hadController = true; return; }
    toast(t('update.ready'), { act: 'reload', label: t('update.reload') }, 0);
  });
}

/* ---------- actions ---------- */
const A = {
  home() { ui.view = 'home'; ui.sheet = null; ui.multi = false; ui.sel = []; ui.sid = null; subscribeSession(null); if (wake) { try { wake.release(); } catch (e) {} wake = null; } },
  open(d) { ui.view = 'session'; ui.sid = d.id; ui.tab = 'chrono'; ui.multi = false; ui.sel = []; subscribeSession(d.id); pullEvents(d.id); keepAwake(); },
  admin() { ui.view = 'admin'; pullCoaches().then(() => render(true)); }, atab(d) { ui.adminTab = d.id; },
  lmode(d) { ui.loginMode = d.id; },
  async logout() {
    if (db.outbox.length) { toast(t('toast.waitSync', { n: db.outbox.length })); return; }
    authed = false; db.me = null; save('me'); ui.view = 'login'; render(); if (sb) { try { await sb.auth.signOut(); } catch (e) {} }
  },
  sync() { setNet(navigator.onLine !== false); syncClock(); push().then(pull); toast(navigator.onLine === false ? t('toast.noNetworkKept') : t('toast.syncStarted')); },
  reload() { location.reload(); },
  async checkupdate() {
    if (!swReg) { toast(t('update.unavailable')); return; }
    updateFound = false; toast(t('update.checking'));
    try { await swReg.update(); } catch (e) { toast(t('auth.noNetwork')); return; }
    setTimeout(() => { if (!updateFound) toast(t('update.latest')); }, 2500);
  },
  new() { ui.sheet = 'new'; }, close() { ui.sheet = null; ui.confirmDel = false; }, people() { ui.sheet = 'people'; ui.confirmDel = false; },
  arch() { ui.showArch = !ui.showArch; },
  archive() { const s = cur(); s.archived = !s.archived; save('sessions'); queue({ k: 'upd', t: 'sessions', id: s.id, patch: { archived: s.archived } }); if (s.archived) { A.home(); toast(t('toast.archived')); } else toast(t('toast.unarchived')); },
  delsession() { if (!ui.confirmDel) { ui.confirmDel = true; return; } const id = ui.sid; db.sessions = db.sessions.filter(s => s.id !== id); delete db.events[id]; delete db.gpx[id]; delete db.pend[id]; save('sessions', 'events', 'gpx', 'pend'); queue({ k: 'del', t: 'sessions', id }); A.home(); toast(t('toast.sessionDeleted')); },
  tab(d) { ui.tab = d.id; if ((d.id === 'gpx' || d.id === 'analysis') && !db.gpx[ui.sid]) pullGpx(ui.sid); },
  poste(d) { ui.poste = d.id; L.set('poste', d.id); ui.multi = false; ui.sel = []; },
  multi() { ui.multi = !ui.multi; ui.sel = []; },
  pick(d) { const i = ui.sel.indexOf(d.id); if (i < 0) ui.sel.push(d.id); else ui.sel.splice(i, 1); },
  pickall() { ui.sel = cur().rider_ids.filter(r => !active(r)); },
  start(d) { if (active(d.id)) return; const e = emit('start', d.id, tapTs()); ui.undo = [e]; buzz(); toast(t('toast.started', { name: rname(d.id) }), undoBtn()); },
  startsel() { const ts = tapTs(), ids = ui.sel.filter(r => cur().rider_ids.includes(r) && !active(r)); if (!ids.length) return; ui.undo = ids.map(r => emit('start', r, ts)); ui.sel = []; ui.multi = false; buzz(); toast(t('toast.groupStarted', { riders: nRiders(ids.length) }), undoBtn()); },
  split(d) { const ts = tapTs(), a = active(d.id), e = emit('split', d.id, ts); ui.undo = [e]; buzz(); toast(a ? t('toast.split', { i: a.splits.length + 1, name: rname(d.id), time: fmt(ts - a.start) }) : t('toast.splitEarly', { name: rname(d.id) }), undoBtn()); },
  stop(d) {
    const ts = tapTs(), a = active(d.id); buzz();
    if (a && ui.poste === 'both') { (db.pend[ui.sid] = db.pend[ui.sid] || {})[d.id] = ts; save('pend'); return; }
    const e = emit('finish', d.id, ts); ui.undo = [e];
    toast(a ? t('toast.finished', { name: rname(d.id), time: fmt(ts - a.start) }) : t('toast.finishEarly', { name: rname(d.id) }), undoBtn());
  },
  lap(d) { const p = db.pend[ui.sid] || {}, ts = p[d.id], a = active(d.id); delete p[d.id]; save('pend'); if (ts == null || !a) return; ui.undo = [emit('lap', d.id, ts)]; toast(t('toast.lap', { i: a.laps.length + 1, name: rname(d.id), time: fmt(ts - (a.laps[a.laps.length - 1] ?? a.start)) }), undoBtn()); },
  fin(d) { const p = db.pend[ui.sid] || {}, ts = p[d.id], a = active(d.id); delete p[d.id]; save('pend'); if (ts == null || !a) return; ui.undo = [emit('finish', d.id, ts)]; toast(t('toast.finished', { name: rname(d.id), time: fmt(ts - a.start) }), undoBtn()); },
  nostop(d) { const p = db.pend[ui.sid] || {}; delete p[d.id]; save('pend'); },
  undo() { (ui.undo || []).forEach(e => emit('void', e.rider_id, now(), e.id)); ui.undo = null; document.querySelectorAll('.toast').forEach(e => e.remove()); },
  delrun(d) { const run = R.find(x => x.id === d.id); if (!run) return; const evs = (db.events[ui.sid] || []).filter(e => run.evs.includes(e.id)); evs.forEach(e => emit('void', e.rider_id, now(), e.id)); toast(t('toast.runDeleted')); },
  copy() {
    const s = cur(), ids = s.rider_ids.filter(r => times(r).length).sort((a, b) => best(a) - best(b));
    const txt = [[t('csv.rank'), t('csv.name'), t('csv.runs'), t('results.best'), t('results.avg'), t('results.max')].join(';'), ...ids.map((r, i) => { const ts = times(r); return [i + 1, rname(r), ts.length, fmt(Math.min(...ts)), fmt(ts.reduce((a, b) => a + b, 0) / ts.length), fmt(Math.max(...ts))].join(';'); })].join('\n');
    try { navigator.clipboard.writeText(txt).then(() => toast(t('toast.copied')), () => toast(t('toast.copyRefused'))); } catch (e) { toast(t('toast.copyRefused')); }
  },
  csv() {
    const s = cur(), dec = (1.5).toLocaleString(LOC).charAt(1), sec = v => (v / 1000).toFixed(2).replace('.', dec), count = {};
    const rows = [[t('csv.name'), t('csv.run'), t('csv.startTime'), t('csv.time'), t('csv.seconds'), t('csv.splits'), t('csv.laps')].join(';')];
    R.filter(x => x.end != null).forEach(x => { count[x.riderId] = (count[x.riderId] || 0) + 1;
      rows.push([rname(x.riderId), count[x.riderId], new Date(x.start).toLocaleTimeString(LOC), fmt(x.end - x.start), sec(x.end - x.start), x.splits.map(v => sec(v - x.start)).join(' | '), x.laps.map((v, j) => sec(v - (x.laps[j - 1] ?? x.start))).join(' | ')].join(';')); });
    download('chrono-' + s.date + '-' + s.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 40) + '.csv', rows.join('\r\n'));
  },
  addrider(d) { const s = cur(); if (!s.rider_ids.includes(d.id)) setRiders(s, [...s.rider_ids, d.id]); },
  addgroup(d) { const s = cur(), add = db.riders.filter(r => r.active !== false && r.grp === d.id && !s.rider_ids.includes(r.id)).sort((a, b) => a.name.localeCompare(b.name, LOC)).map(r => r.id); setRiders(s, [...s.rider_ids, ...add]); },
  addnew() { const n = $('q').value.trim(); if (!n) return; const r = addRider(n, ''), s = cur(); setRiders(s, [...s.rider_ids, r.id]); },
  rmrider(d) { const s = cur(); setRiders(s, s.rider_ids.filter(r => r !== d.id)); if (db.pend[s.id]) { delete db.pend[s.id][d.id]; save('pend'); } },
  delyouth(d) { const r = db.riders.find(r => r.id === d.id); if (!r) return; r.active = false; save('riders'); queue({ k: 'upd', t: 'riders', id: r.id, patch: { active: false } }); toast(t('toast.riderRemoved', { name: r.name })); },
  async delcoach(d) { const { error } = await sb.from('allowed_users').delete().eq('email', d.id); if (error) toast(isNetErr(error) ? t('toast.retryLater') : t('toast.refused', { msg: error.message })); await pullCoaches(); render(); },
  trkdel(d) { saveTracks(ui.sid, tracksOf(ui.sid).filter(tk => tk.id !== d.id)); },
  // Add a run found on a GPS track to the results, as if it had been timed by the coaches.
  gpsadd(d) { const x = (ui.det || {})[d.id]; if (!x || !x.rider) return; const r = x.r, ev = [emit('start', x.rider, r.start)]; r.splits.forEach(v => ev.push(emit('split', x.rider, v))); r.laps.forEach(v => ev.push(emit('lap', x.rider, v))); ev.push(emit('finish', x.rider, r.end)); ui.undo = ev; toast(t('toast.gpsAdded', { name: rname(x.rider), time: fmt(r.end - r.start) }), undoBtn()); }
};

/* forms */
const F = {
  async auth() {
    const email = $('l-mail').value.trim().toLowerCase(), pass = $('l-pass') ? $('l-pass').value : '', redirect = location.origin + location.pathname;
    if (!sb) { toast(t('setup.libMissing')); return; }
    L.set('lastmail', email); ui.busy = true; render();
    try {
      if (ui.loginMode === 'in') { const { error } = await sb.auth.signInWithPassword({ email, password: pass }); if (error) toast(authMsg(error) || t('auth.refused', { msg: error.message })); }
      else if (ui.loginMode === 'up') {
        const { data, error } = await sb.auth.signUp({ email, password: pass, options: { emailRedirectTo: redirect } });
        if (error) toast(authMsg(error) || t('auth.notAllowed'));
        else if (!data.session) { ui.loginMode = 'in'; toast(t('auth.checkEmail')); }
      } else { const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect }); toast(error ? (authMsg(error) || t('auth.refused', { msg: error.message })) : t('auth.linkSent')); ui.loginMode = 'in'; }
    } catch (e) { toast(t('auth.noNetwork')); }
    ui.busy = false; if (ui.view === 'login') render();
  },
  async newpass() { const { error } = await sb.auth.updateUser({ password: $('np').value }); if (error) { toast(t('auth.refused', { msg: error.message })); return; } ui.view = db.me ? 'home' : 'login'; render(); toast(t('toast.passwordSaved')); const { data } = await sb.auth.getSession(); if (data && data.session) afterLogin(data.session.user); },
  new() { const s = { id: uuid(), name: $('n-name').value.trim() || t('sheet.untitled'), date: $('n-date').value || today(), archived: false, rider_ids: [] }; db.sessions.push(s); save('sessions'); queue({ k: 'ins', t: 'sessions', row: { ...s, gpx: null } }); A.open({ id: s.id }); ui.sheet = 'people'; render(); },
  youth() { const n = $('new-youth').value.trim(), g = $('new-grp').value.trim(); if (!n) return; if (db.riders.some(r => r.active !== false && r.name.toLowerCase() === n.toLowerCase())) { toast(t('toast.riderExists', { name: n })); return; } addRider(n, g); render(); $('new-youth').focus(); },
  async coach() {
    const row = { name: $('c-name').value.trim(), email: $('c-mail').value.trim().toLowerCase(), role: $('c-role').value }; if (!row.name || !row.email) return;
    const { error } = await sb.from('allowed_users').insert(row);
    if (error) { toast(isNetErr(error) ? t('toast.retryLater') : /duplicate/i.test(error.message) ? t('toast.coachExists') : t('toast.refused', { msg: error.message })); return; }
    await pullCoaches(); render(); toast(t('toast.coachAdded', { name: row.name }));
  }
};

/* ---------- events ---------- */
document.addEventListener('pointerdown', () => { downTs = now(); holding = true; }, true);
const release = () => setTimeout(() => { holding = false; if (dirty && !typing()) { dirty = false; render(); } }, 160);
document.addEventListener('pointerup', release, true); document.addEventListener('pointercancel', release, true);
document.addEventListener('focusout', () => setTimeout(() => { if (dirty && !typing() && !holding) { dirty = false; render(); } }, 120));
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]'); if (!el || el.disabled) return;
  const act = el.dataset.act, r = A[act](el.dataset); dirty = false;
  if (!(r && r.then)) render();
  if (ui.sheet === 'people' && /^add/.test(act)) { const q = $('q'); if (q) q.focus(); }
});
document.addEventListener('submit', e => { const f = e.target.closest('[data-form]'); if (!f) return; e.preventDefault(); F[f.dataset.form](); });
document.addEventListener('input', e => { if (e.target.id === 'q') $('sugg').innerHTML = sugg(e.target.value); });
document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'q') { e.preventDefault(); const b = document.querySelector('#sugg .chip'); if (b) b.click(); } });
function readFile(input, cb) { const f = input.files && input.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => cb(String(r.result), f.name); r.readAsText(f); input.value = ''; }
const csvRows = txt => txt.replace(/^﻿/, '').split(/\r?\n/).map(l => l.split(/[;,\t]/).map(c => c.trim().replace(/^"|"$/g, ''))).filter(r => r[0] && !/^(name|nom|prénom|prenom|vorname)$/i.test(r[0]));
document.addEventListener('change', e => {
  const id = e.target.id, s = cur();
  if (id === 'lang-pick') { L.set('lang', e.target.value); setLang(e.target.value); e.target.blur(); render(); return; }
  if (id === 'e-name' && s) { const v = e.target.value.trim(); if (v) { s.name = v; save('sessions'); queue({ k: 'upd', t: 'sessions', id: s.id, patch: { name: v } }); } }
  if (id === 'e-date' && s && e.target.value) { s.date = e.target.value; save('sessions'); queue({ k: 'upd', t: 'sessions', id: s.id, patch: { date: s.date } }); }
  if (e.target.dataset && e.target.dataset.track) { const tr = tracksOf(ui.sid), tk = tr.find(x => x.id === e.target.dataset.track); if (tk) { tk.riderId = e.target.value || null; saveTracks(ui.sid, tr); } e.target.blur(); render(); return; }
  if (id === 'gpx-file') { const f = e.target.files && e.target.files[0], sid = ui.sid; e.target.value = ''; if (!f) return;
    readTrackFile(f).then(pts => { if (pts.length < 2) throw new Error('empty'); const tr = tracksOf(sid); tr.push({ id: uuid().slice(0, 8), name: f.name, riderId: null, pts }); saveTracks(sid, tr); render(); toast(t('gpx.imported', { n: pts.length })); }).catch(() => toast(t('gpx.unreadable'))); }
  if (id === 'csv-youth') readFile(e.target, txt => { const rows = csvRows(txt), have = new Set(db.riders.filter(r => r.active !== false).map(r => r.name.toLowerCase())); let n = 0; rows.forEach(r => { if (!have.has(r[0].toLowerCase())) { have.add(r[0].toLowerCase()); addRider(r[0], r[1] || ''); n++; } }); render(); toast(t('toast.ridersImported', { n, skipped: rows.length - n })); });
  if (id === 'csv-coach') readFile(e.target, async txt => { const rows = csvRows(txt).filter(r => /@/.test(r[1] || '')).map(r => ({ name: r[0], email: r[1].toLowerCase(), role: /admin/i.test(r[2] || '') ? 'admin' : 'coach' })); if (!rows.length) { toast(t('toast.coachCsvEmpty')); return; } const { error } = await sb.from('allowed_users').upsert(rows, { onConflict: 'email', ignoreDuplicates: true }); await pullCoaches(); render(); toast(error ? (isNetErr(error) ? t('toast.retryLater') : t('toast.refused', { msg: error.message })) : t('toast.coachesImported', { n: rows.length })); });
});
self.addEventListener('online', () => { setNet(true); syncClock(); push().then(pull); });
self.addEventListener('offline', () => setNet(false));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { keepAwake(); if (swReg) swReg.update().catch(() => {}); push().then(() => ui.view === 'session' ? pullEvents(ui.sid) : pull()); } });

/* ---------- start-up: load the language files listed in settings.js, then show the app ---------- */
function loadScript(src) { return new Promise(res => { const s = document.createElement('script'); s.src = src; s.onload = s.onerror = () => res(); document.head.appendChild(s); }); }
function boot() {
  LANGS = self.CHRONO_LANGS || {};
  setLang(pickLang()); applyTheme();
  setInterval(() => { const n = now(); document.querySelectorAll('[data-start]').forEach(el => { el.textContent = fmt(n - el.dataset.start, 1); }); }, 70);
  setInterval(() => { if (document.visibilityState !== 'visible' || !authed) return; push(); if (ui.view === 'session') pullEvents(ui.sid); }, 8000);
  setInterval(() => { if (document.visibilityState === 'visible' && authed) pull(); }, 60000);
  setInterval(syncClock, 600000);
  render(); initAuth(); initUpdates();
}
const missing = SET.languages.filter(c => !(self.CHRONO_LANGS || {})[c]);
if (missing.length) Promise.all(missing.map(c => loadScript('lang/' + encodeURIComponent(c) + '.js'))).then(boot); else boot();
self.__chrono = { db, ui, A, F, runsOf, render, push, pull, t, parseFit, parseGpx, course, detectRuns, tracksOf };   // handy for troubleshooting in the browser console
})();
