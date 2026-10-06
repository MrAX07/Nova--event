'use strict';
/* Nova Events Kontrolpanel – kerne (hjælpere, UI-komponenter, router) */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LV = { MOD: 1, EM: 2, HA: 3, OWNER: 4 };
const S = { me: null, csrf: '', gid: null, meta: null, level: 0, guilds: [] };
const P = {}; // sider registreres i pages.js
const ACT = {}; // klik-handlinger
const F = {}; // filtre pr. side

try { S.gid = localStorage.getItem('nova.guild'); } catch { /* ignorer */ }

/* ---------- ikoner ---------- */
const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M5 12v9h14v-9M7.5 8a2.5 2.5 0 1 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 1 1 0 5"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
  ticket: '<path d="M3 9a2 2 0 0 0 0 6v3h18v-3a2 2 0 0 0 0-6V6H3z"/><path d="M13 6v12" stroke-dasharray="2 2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.5-3.5 3-5.5 6.5-5.5s6 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c2 .6 3.3 2.3 3.5 5.2"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H4v1a4 4 0 0 0 4 4M16 6h4v1a4 4 0 0 1-4 4M12 13v4M8 20h8M10 17h4"/>',
  scroll: '<path d="M6 3h11a2 2 0 0 1 2 2v13a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V4a1 1 0 0 1 1-1zM9 8h6M9 12h6M9 16h4"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  file: '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  buoy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M5.6 5.6l3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M5 19l1.5-1.5M17.5 6.5L19 5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10"/>',
  download: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
  chev: '<path d="M6 9l6 6 6-6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
};
const icon = (n) => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;

/* ---------- formatering ---------- */
const STATUS = { ACTIVE: 'Aktiv', PAUSED: 'Pauset', SCHEDULED: 'Planlagt', ENDED: 'Afsluttet', CANCELLED: 'Annulleret', OPEN: 'Åben', CLOSED: 'Lukket', VALID: 'Gyldig', REJECTED: 'Afvist' };
const badge = (s, test) => `<span class="badge b-${esc(s)}">${esc(STATUS[s] || s)}</span>${test ? ' <span class="badge b-test">Test</span>' : ''}`;
const num = (n) => Number(n || 0).toLocaleString('da-DK');
function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Intl.DateTimeFormat('da-DK', { timeZone: S.meta?.timezone || 'UTC', dateStyle: 'short', timeStyle: 'short' }).format(new Date(d));
  } catch { return new Date(d).toLocaleString('da-DK'); }
}
function ago(d) {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'lige nu';
  if (s < 3600) return `${Math.floor(s / 60)} min. siden`;
  if (s < 86400) return `${Math.floor(s / 3600)} t. siden`;
  return `${Math.floor(s / 86400)} d. siden`;
}
function dur(sec) {
  sec = Math.round(sec || 0);
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return [d && `${d} d`, h && `${h} t`, m && `${m} min`, !d && !h && s && `${s} s`].filter(Boolean).join(' ') || '0 s';
}
const usr = (id, users) => {
  const u = (users || {})[id];
  return `<span class="usr">${u?.avatar ? `<img class="av" src="${esc(u.avatar)}" alt="" loading="lazy">` : '<span class="av"></span>'}<span title="${esc(id)}">${esc(u?.username || id || '—')}</span></span>`;
};
const chan = (id) => { const c = S.meta?.channels.find((x) => x.id === id); return c ? `#${esc(c.name)}` : id ? esc(id) : '—'; };
const roleName = (id) => esc(S.meta?.roles.find((r) => r.id === id)?.name || id);

const ACTION_LABEL = {
  GIVEAWAY_CREATED: 'Giveaway oprettet', GIVEAWAY_SCHEDULED: 'Giveaway planlagt', GIVEAWAY_STARTED: 'Planlagt giveaway startet', GIVEAWAY_EDITED: 'Giveaway redigeret',
  GIVEAWAY_ENDED: 'Giveaway afsluttet', GIVEAWAY_CANCELLED: 'Giveaway annulleret', GIVEAWAY_PAUSED: 'Giveaway pauset', GIVEAWAY_RESUMED: 'Giveaway genoptaget', GIVEAWAY_DELETED: 'Giveaway slettet',
  GIVEAWAY_TEMPLATE_CREATED: 'Skabelon gemt', GIVEAWAY_TEMPLATE_DELETED: 'Skabelon slettet',
  ENTRY_ADDED: 'Entries tilføjet', ENTRY_REMOVED: 'Entries fjernet', ENTRY_SET: 'Entries sat', JOIN_ENTERED: 'Deltog via knap',
  WINNER_SELECTED: 'Vinder valgt', WINNER_REJECTED: 'Vinder afvist', WINNER_REROLLED: 'Vinder rerollet', WINNER_DM_FAILED: 'Vinder-DM fejlede',
  NUMBER_STARTED: 'Talevent startet', NUMBER_WON: 'Talevent vundet', NUMBER_ENDED: 'Talevent afsluttet', NUMBER_STOPPED: 'Talevent stoppet', NUMBER_REROLLED: 'Talevent genåbnet',
  ROLE_GRANTED: 'Vinderrolle givet', ROLE_GRANT_FAILED: 'Vinderrolle fejlede', ROLE_ADDED: 'Rolle tilføjet', ROLE_REMOVED: 'Rolle fjernet',
  BLACKLIST_ADDED: 'Blacklistet', BLACKLIST_REMOVED: 'Fjernet fra blacklist', PERMISSION_CHANGED: 'Rettigheder ændret', SETTINGS_CHANGED: 'Indstillinger ændret', SETTINGS_TESTMODE: 'Testtilstand ændret',
  EXPORT_CREATED: 'Data eksporteret', TICKET_OPENED: 'Ticket oprettet', TICKET_CLAIMED: 'Ticket overtaget', TICKET_CLOSED: 'Ticket lukket', TICKET_USER_ADDED: 'Bruger tilføjet til ticket', TICKET_USER_REMOVED: 'Bruger fjernet fra ticket', TICKET_PANEL: 'Ticket-panel oprettet',
};
const actionLabel = (a) => ACTION_LABEL[a] || a.replace(/_/g, ' ').toLowerCase();
const ACTION_ICON = (c) => ({ GIVEAWAY: 'gift', NUMBER: 'target', ENTRY: 'ticket', JOIN: 'ticket', WINNER: 'trophy', ADMIN: 'shield', SETTINGS: 'sliders', TICKET: 'buoy', ERROR: 'flag' }[c] || 'scroll');

/* ---------- netværk ---------- */
async function api(method, path, body) {
  const opt = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') { opt.headers['x-nova-csrf'] = S.csrf; opt.headers['Content-Type'] = 'application/json'; }
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(path, opt);
  if (r.status === 401) { renderLogin(); throw new Error('Du er ikke logget ind.'); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Der opstod en fejl.');
  return data;
}
const G = (p) => `/api/g/${S.gid}${p}`;
const qs = (o) => '?' + Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

/* ---------- toast & modal ---------- */
function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateX(30px)'; setTimeout(() => t.remove(), 320); }, err ? 6000 : 3500);
}
const fail = (e) => toast(e.message || String(e), true);

function modal({ title, body, actions = [], wide = false, danger = false }) {
  const w = document.createElement('div');
  w.className = 'mw';
  w.innerHTML = `<div class="md${wide ? ' wide' : ''}${danger ? ' danger' : ''}" role="dialog" aria-modal="true"><header><span>${esc(title)}</span><button class="icon-btn" data-x aria-label="Luk">${icon('x')}</button></header><div class="bd">${body}</div>${actions.length ? '<footer></footer>' : ''}</div>`;
  const close = () => { w.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  w.addEventListener('mousedown', (e) => { if (e.target === w) close(); });
  $('[data-x]', w).onclick = close;
  const foot = $('footer', w);
  const ctx = { el: w, close, $: (s) => $(s, w), $$: (s) => $$(s, w) };
  actions.forEach((a) => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.cls || '');
    b.textContent = a.label;
    b.onclick = async () => {
      if (a.close) return close();
      b.disabled = true;
      try { await a.run(ctx); } catch (e) { fail(e); } finally { b.disabled = false; }
    };
    foot.appendChild(b);
  });
  document.body.appendChild(w);
  const first = $('input:not([type=checkbox]),select,textarea', w);
  if (first && window.innerWidth > 760) first.focus();
  return ctx;
}

function confirmDialog({ title, text, label = 'Bekræft', danger = true }) {
  return new Promise((resolve) => {
    let done = false;
    const m = modal({
      title, danger, body: `<p>${text}</p>`,
      actions: [
        { label: 'Annuller', close: true },
        { label, cls: danger ? 'dng' : 'pri', run: async (c) => { done = true; c.close(); resolve(true); } },
      ],
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

/* ---------- formularer ---------- */
const field = (label, input, hint) => `<div class="f"><label>${esc(label)}</label>${input}${hint ? `<small>${hint}</small>` : ''}</div>`;
const val = (m, id) => { const el = $('#' + id, m.el); return el ? el.value.trim() : ''; };
const chk = (m, id) => !!$('#' + id, m.el)?.checked;
const multi = (m, id) => [...$('#' + id, m.el).selectedOptions].map((o) => o.value);
const roleOpts = (sel = []) => (S.meta?.roles || []).map((r) => `<option value="${esc(r.id)}"${sel.includes(r.id) ? ' selected' : ''}>${esc(r.name)}</option>`).join('');
const chanOpts = (sel, ph = '— vælg kanal —', list = S.meta?.channels) => `<option value="">${esc(ph)}</option>` + (list || []).map((c) => `<option value="${esc(c.id)}"${sel === c.id ? ' selected' : ''}>${list === S.meta?.channels ? '#' : ''}${esc(c.name)}</option>`).join('');
const toggle = (id, label, on) => `<label class="toggle"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span>${label}</span></label>`;
const nz = (v) => (v === '' ? undefined : Number(v));

/* ---------- tabel, pagination, grafer ---------- */
function table(cols, rows, { click } = {}) {
  if (!rows.length) return `<div class="tw"><div class="empty"><b>Ingen resultater</b>Prøv at ændre dine filtre.</div></div>`;
  return `<div class="tw"><table class="tbl"><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((r, i) => `<tr${click ? ` class="click" data-act="${click}" data-arg="${esc(r.__arg ?? i)}"` : ''}>${cols.map((c) => `<td data-label="${esc(c.label)}">${c.render(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function pager(d, act) {
  const pages = Math.max(1, Math.ceil(d.total / d.pageSize));
  return `<div class="pager"><span>${num(d.total)} i alt • side ${d.page} af ${pages}</span><div class="row"><button class="btn sm" data-act="${act}" data-arg="${d.page - 1}"${d.page <= 1 ? ' disabled' : ''}>← Forrige</button><button class="btn sm" data-act="${act}" data-arg="${d.page + 1}"${d.page >= pages ? ' disabled' : ''}>Næste →</button></div></div>`;
}
const searchBox = (id, ph, v) => `<div class="search">${icon('search')}<input class="input" id="${id}" data-search="${id}" placeholder="${esc(ph)}" value="${esc(v || '')}" autocomplete="off"></div>`;

let chartId = 0;
function barChart(data, color) {
  const W = 600, H = 190, pl = 6, pb = 22, max = Math.max(1, ...data.map((d) => d.c));
  const bw = (W - pl * 2) / data.length;
  const bars = data.map((d, i) => {
    const h = Math.max(d.c ? 3 : 0, ((H - pb - 14) * d.c) / max);
    return `<rect class="bar" x="${pl + i * bw + bw * 0.16}" y="${H - pb - h}" width="${bw * 0.68}" height="${h}" rx="3"${color ? ` style="fill:${color}"` : ''}><title>${esc(d.l || d.d)}: ${num(d.c)}</title></rect>`;
  }).join('');
  const step = Math.ceil(data.length / 7);
  const labels = data.map((d, i) => (i % step === 0 ? `<text x="${pl + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${esc((d.l || d.d.slice(5)).slice(0, 10))}</text>` : '')).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"><line class="gl" x1="0" x2="${W}" y1="${H - pb}" y2="${H - pb}"/>${bars}${labels}<text x="${W - 4}" y="12" text-anchor="end">maks ${num(max)}</text></svg>`;
}
function lineChart(data) {
  const id = 'g' + ++chartId, W = 600, H = 190, pb = 22, pt = 14, max = Math.max(1, ...data.map((d) => d.c));
  const x = (i) => 8 + (i * (W - 16)) / Math.max(1, data.length - 1), y = (v) => H - pb - ((H - pb - pt) * v) / max;
  const pts = data.map((d, i) => `${x(i)},${y(d.c)}`).join(' ');
  const step = Math.ceil(data.length / 7);
  const labels = data.map((d, i) => (i % step === 0 ? `<text x="${x(i)}" y="${H - 6}" text-anchor="middle">${esc(d.d.slice(5))}</text>` : '')).join('');
  const dots = data.map((d, i) => `<circle cx="${x(i)}" cy="${y(d.c)}" r="9" fill="transparent"><title>${esc(d.d)}: ${num(d.c)}</title></circle>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff3b47" stop-opacity=".55"/><stop offset="1" stop-color="#ff3b47" stop-opacity="0"/></linearGradient></defs><line class="gl" x1="0" x2="${W}" y1="${H - pb}" y2="${H - pb}"/><polygon fill="url(#${id})" points="8,${H - pb} ${pts} ${W - 8},${H - pb}"/><polyline class="ln" points="${pts}"/>${dots}${labels}<text x="${W - 4}" y="12" text-anchor="end">maks ${num(max)}</text></svg>`;
}

/* ---------- events (klik & søg) ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && ACT[el.dataset.act]) { e.preventDefault(); Promise.resolve(ACT[el.dataset.act](el.dataset.arg, el, e)).catch(fail); }
});
let searchTimer;
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-search]');
  if (!el) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => ACT[`search:${el.dataset.search}`]?.(el.value), 300);
});
ACT.openNav = () => { $('#side')?.classList.add('open'); $('.scrim')?.classList.add('open'); };
ACT.closeNav = () => { $('#side')?.classList.remove('open'); $('.scrim')?.classList.remove('open'); };
ACT.theme = () => {
  const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('nova.theme', t); } catch { /* ignorer */ }
  $$('[data-act=theme]').forEach((b) => (b.innerHTML = icon(t === 'light' ? 'moon' : 'sun')));
};
ACT.logout = async () => { await api('POST', '/auth/logout', {}); location.href = '/'; };
ACT.reveal = (_a, el) => el.classList.toggle('show');

/* ---------- navigation ---------- */
const NAV = [
  ['overview', 'Overblik', 'grid', LV.MOD], ['giveaways', 'Giveaways', 'gift', LV.MOD], ['numberevents', 'Talevents', 'target', LV.MOD],
  ['entries', 'Entries', 'ticket', LV.HA], ['users', 'Brugere', 'users', LV.HA], ['winners', 'Vindere', 'trophy', LV.MOD], ['tickets', 'Tickets', 'buoy', LV.MOD],
  ['logs', 'Logs', 'scroll', LV.HA], ['stats', 'Statistik', 'chart', LV.MOD], ['templates', 'Skabeloner', 'file', LV.EM],
  ['permissions', 'Rettigheder', 'shield', LV.HA], ['settings', 'Indstillinger', 'sliders', LV.HA],
];

function renderLogin(err) {
  const failed = err || new URLSearchParams(location.search).get('fejl');
  $('#app').innerHTML = `<div class="login"><div class="login-card"><img src="/logo.png" alt="Nova Events"><h1>Nova Events</h1><p>Kontrolpanel til giveaways, talevents og tickets.</p>${failed ? '<div class="err">Login mislykkedes. Prøv igen.</div>' : ''}<a class="btn pri" style="width:100%" href="/auth/login">Log ind med Discord</a></div></div>`;
}

function renderShell() {
  const g = S.guilds.find((x) => x.id === S.gid);
  $('#app').innerHTML = `<div class="shell">
    <aside class="side" id="side">
      <div class="brand"><img src="/logo.png" alt=""><div><b>Nova Events</b><span>Kontrolpanel</span></div></div>
      <div class="gsel"><select id="gsel" aria-label="Vælg server">${S.guilds.map((x) => `<option value="${esc(x.id)}"${x.id === S.gid ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>${icon('chev')}</div>
      <nav class="nav" id="nav">${NAV.filter((n) => S.level >= n[3]).map((n) => `<a href="#/${n[0]}" data-page="${n[0]}">${icon(n[2])}<span>${n[1]}</span></a>`).join('')}</nav>
      <div class="user">${S.me.avatar ? `<img src="${esc(S.me.avatar)}" alt="">` : '<span class="av"></span>'}<div><b>${esc(S.me.username)}</b><span>${esc(g?.levelName || '')}</span></div><button class="icon-btn" data-act="logout" title="Log ud" aria-label="Log ud">${icon('logout')}</button></div>
    </aside>
    <div class="scrim" data-act="closeNav"></div>
    <div class="main">
      <header class="topbar"><button class="icon-btn" data-act="openNav" aria-label="Menu">${icon('menu')}</button><div class="top-title" id="ptitle">Nova Events</div><button class="icon-btn" data-act="theme" aria-label="Skift tema">${icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun')}</button></header>
      <main class="view" id="view"></main>
    </div></div>`;
  $('#gsel').onchange = async (e) => { S.gid = e.target.value; try { localStorage.setItem('nova.guild', S.gid); } catch { /* ignorer */ } await loadGuild(); };
}

const skeleton = () => `<div class="grid g4">${'<div class="sk"></div>'.repeat(4)}</div><div class="sk" style="margin-top:16px;height:260px"></div>`;
const header = (title, sub, actions = '') => `<div class="ph"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="row">${actions}<button class="icon-btn" data-act="theme" aria-label="Skift tema" style="display:var(--tdisp,grid)">${icon(document.documentElement.dataset.theme === 'light' ? 'moon' : 'sun')}</button></div></div>`;

let routeToken = 0;
async function route() {
  if (!S.me || !S.gid) return;
  ACT.closeNav();
  const [, page = 'overview', arg] = (location.hash || '#/overview').split('/');
  const key = page === 'event' ? 'event' : P[page] ? page : 'overview';
  const navKey = key === 'event' ? (F.eventBack || 'giveaways') : key;
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.page === navKey));
  const item = NAV.find((n) => n[0] === navKey);
  if (item && S.level < item[3]) { location.hash = '#/overview'; return; }
  $('#ptitle').textContent = item ? item[1] : 'Event';
  const view = $('#view');
  const token = ++routeToken;
  view.innerHTML = skeleton();
  S.after = null;
  try {
    const html = await P[key](decodeURIComponent(arg || ''));
    if (token !== routeToken) return;
    view.innerHTML = html;
    view.style.animation = 'none'; void view.offsetWidth; view.style.animation = '';
    window.scrollTo({ top: 0 });
    if (S.after) { const run = S.after; S.after = null; await run(); }
  } catch (e) {
    if (token === routeToken) view.innerHTML = `<div class="card empty"><b>Noget gik galt</b>${esc(e.message)}<br><br><button class="btn" data-act="reload">Prøv igen</button></div>`;
  }
}
ACT.reload = () => route();
window.addEventListener('hashchange', route);
const refresh = () => route();

async function loadGuild() {
  S.meta = await api('GET', G('/meta'));
  S.level = S.meta.level;
  renderShell();
  await route();
}

async function boot() {
  try {
    const me = await api('GET', '/api/me');
    S.me = me.user; S.csrf = me.csrf; S.guilds = me.guilds;
    if (!S.guilds.length) {
      $('#app').innerHTML = `<div class="login"><div class="login-card"><img src="/logo.png" alt=""><h1>Ingen adgang</h1><p>Du er logget ind som <b>${esc(me.user.username)}</b>, men du har ikke en rolle med adgang på nogen server hvor botten er installeret.<br><br>Bed en ejer eller højadmin om at give dig en rolle under <code>/config role</code>.</p><button class="btn" data-act="logout">Log ud</button></div></div>`;
      return;
    }
    if (!S.guilds.some((g) => g.id === S.gid)) S.gid = S.guilds[0].id;
    await loadGuild();
  } catch (e) {
    if (!S.me) renderLogin();
    else fail(e);
  }
}
document.addEventListener('DOMContentLoaded', () => { /* pages.js indlæses før boot */ });
window.addEventListener('load', boot);
