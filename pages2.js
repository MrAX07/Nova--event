'use strict';
/* Nova Events Kontrolpanel – sider (del 2) */

/* ================= BRUGERE ================= */
P.users = async () => {
  F.u = F.u || { q: '', page: 1 };
  setAfter(loadUsers);
  return header('Brugere', 'Søg på brugernavn eller Discord-ID', `<button class="btn" data-act="blacklistList">Blacklist</button><button class="btn pri" data-act="entryModal">${icon('plus')} Ret entries</button>`) +
    `<div class="toolbar">${searchBox('uq', 'Søg på brugernavn eller ID…', F.u.q)}</div><div id="L"></div>`;
};
async function loadUsers() {
  const d = await api('GET', G('/users' + qs({ q: F.u.q, page: F.u.page })));
  fill('L', table([
    { label: 'Bruger', render: (r) => usr(r.userId, d.users) }, { label: 'Discord-ID', render: (r) => `<span class="code">${esc(r.userId)}</span>` },
    { label: 'Giveaways', render: (r) => num(r.giveaways) }, { label: 'Entries', render: (r) => num(r.entries) }, { label: 'Sejre', render: (r) => num(r.wins) },
    { label: 'Talevent-sejre', render: (r) => num(r.numberWins) }, { label: 'Status', render: (r) => (r.blacklisted ? '<span class="badge b-REJECTED">Blacklistet</span>' : '') },
  ], d.items.map((r) => ({ ...r, __arg: r.userId })), { click: 'openUser' }) + (F.u.q ? '' : pager(d, 'uPage')));
}
ACT['search:uq'] = (v) => { F.u.q = v; F.u.page = 1; loadUsers(); };
ACT.uPage = (p) => { F.u.page = Number(p); loadUsers(); };
ACT.openUser = async (id) => {
  const d = await api('GET', G('/users/' + id));
  const s = d.stats, bl = d.blacklist, global = bl.some((b) => !b.eventCode);
  const m = modal({
    title: d.user.username, wide: true,
    body: `<div class="row" style="margin-bottom:16px">${d.user.avatar ? `<img class="av" style="width:56px;height:56px" src="${esc(d.user.avatar)}" alt="">` : ''}<div><b>${esc(d.user.username)}</b><br><span class="code">${esc(d.user.id)}</span> ${d.inGuild ? '' : '<span class="badge b-REJECTED">Ikke på serveren</span>'}</div></div>
    <div class="kv" style="margin-bottom:16px">
      <div><span>Konto oprettet</span><b>${fmtDate(d.createdAt)}</b></div><div><span>Kom til serveren</span><b>${fmtDate(d.joinedAt)}</b></div>
      <div><span>Giveaways deltaget i</span><b>${num(s.giveawaysEntered)}</b></div><div><span>Entries i alt</span><b>${num(s.totalEntries)}</b></div>
      <div><span>Aktive entries</span><b>${num(s.activeEntries)}</b></div><div><span>Giveaway-sejre</span><b>${num(s.giveawayWins)}</b></div>
      <div><span>Talevent-sejre</span><b>${num(s.numberWins)}</b></div><div><span>Win rate</span><b>${s.winRate.toFixed(1)}%</b></div></div>
    <div style="margin-bottom:16px"><span style="color:var(--muted);font-size:12px;font-weight:600">Roller</span><div>${d.roles.length ? d.roles.map((r) => `<span class="pill" style="border-left:3px solid ${esc(r.color)}">${esc(r.name)}</span>`).join('') : '—'}</div></div>
    ${bl.length ? `<div class="card" style="margin-bottom:16px;border-color:var(--red)"><b>🚫 Blacklist</b>${bl.map((b) => `<div style="margin-top:6px">${b.eventCode ? esc(b.eventCode) : 'Alle giveaways'} — ${esc(b.reason || 'ingen årsag')} <small style="color:var(--muted)">(${fmtDate(b.createdAt)})</small></div>`).join('')}</div>` : ''}
    <h3 style="margin-bottom:10px">Seneste entry-ændringer</h3>${d.transactions.length ? table([
      { label: 'Tid', render: (r) => fmtDate(r.createdAt) }, { label: 'Event', render: (r) => `<span class="code">${esc(r.eventCode || '—')}</span>` }, { label: 'Type', render: (r) => esc({ JOIN: 'Deltog', ADD: 'Tilføjet', REMOVE: 'Fjernet', SET: 'Sat' }[r.type]) },
      { label: 'Ændring', render: (r) => `${r.delta >= 0 ? '+' : ''}${r.delta} (${r.before} → ${r.after})` }, { label: 'Af', render: (r) => (r.actorId ? usr(r.actorId, d.admins) : 'brugeren selv') }, { label: 'Årsag', render: (r) => esc(r.reason || '') },
    ], d.transactions) : '<div class="empty">Ingen ændringer endnu.</div>'}`,
    actions: [
      { label: 'Luk', close: true },
      { label: global ? 'Fjern fra global blacklist' : 'Blacklist (alle giveaways)', cls: 'dng', run: async (c) => {
        if (global) {
          if (!(await confirmDialog({ title: 'Fjern fra blacklist', text: 'Brugeren kan igen deltage i giveaways.', label: 'Fjern', danger: false }))) return;
          await api('POST', G('/blacklist/remove'), { userId: id, confirm: true });
        } else {
          const reason = prompt('Årsag til blacklist (valgfri):') ?? null;
          if (reason === null) return;
          if (!(await confirmDialog({ title: 'Blacklist bruger', text: `<b>${esc(d.user.username)}</b> kan ikke deltage i nogen giveaways.`, label: 'Blacklist' }))) return;
          await api('POST', G('/blacklist'), { userId: id, reason, confirm: true });
        }
        c.close(); toast('Blacklist opdateret'); ACT.openUser(id); if (location.hash.startsWith('#/users')) loadUsers();
      } },
      { label: 'Ret entries', cls: 'pri', run: async (c) => { c.close(); await entryForm({ userId: id }); } },
    ],
  });
  void m;
};
ACT.blacklistList = async () => {
  const d = await api('GET', G('/blacklist?pageSize=100'));
  modal({ title: 'Blacklist', wide: true, body: d.items.length ? table([
    { label: 'Bruger', render: (r) => usr(r.userId, d.users) }, { label: 'Omfang', render: (r) => (r.eventCode ? `<span class="code">${esc(r.eventCode)}</span>` : 'Alle giveaways') },
    { label: 'Årsag', render: (r) => esc(r.reason || '—') }, { label: 'Tilføjet af', render: (r) => usr(r.addedBy, d.users) }, { label: 'Dato', render: (r) => fmtDate(r.createdAt) },
  ], d.items) : '<div class="empty"><b>Blacklisten er tom</b></div>', actions: [{ label: 'Luk', close: true }] });
};

/* ================= VINDERE ================= */
P.winners = async () => {
  F.w = F.w || { q: '', type: '', status: '', page: 1 };
  setAfter(loadWinners);
  return header('Vindere', 'Alle vindere og afviste vindere', canHA() ? exportLink('winners', 'Eksportér') : '') +
    `<div class="toolbar">${searchBox('wq', 'Søg på bruger, event eller præmie…', F.w.q)}<select class="select" id="wt"><option value="">Alle typer</option><option value="GIVEAWAY"${F.w.type === 'GIVEAWAY' ? ' selected' : ''}>Giveaways</option><option value="NUMBER"${F.w.type === 'NUMBER' ? ' selected' : ''}>Talevents</option></select><select class="select" id="ws"><option value="">Alle statusser</option><option value="VALID"${F.w.status === 'VALID' ? ' selected' : ''}>Gyldige</option><option value="REJECTED"${F.w.status === 'REJECTED' ? ' selected' : ''}>Afviste</option></select></div><div id="L"></div>`;
};
async function loadWinners() {
  $('#wt').onchange = (e) => { F.w.type = e.target.value; F.w.page = 1; loadWinners(); };
  $('#ws').onchange = (e) => { F.w.status = e.target.value; F.w.page = 1; loadWinners(); };
  const d = await api('GET', G('/winners' + qs(F.w)));
  fill('L', table([
    { label: 'Tid', render: (r) => fmtDate(r.createdAt) }, { label: 'Bruger', render: (r) => usr(r.userId, d.users) }, { label: 'Event', render: (r) => `<a class="code" href="#/event/${esc(r.eventCode)}">${esc(r.eventCode)}</a>` },
    { label: 'Type', render: (r) => (r.eventType === 'NUMBER' ? '🎯 Talevent' : '🎁 Giveaway') }, { label: 'Plads', render: (r) => (r.place ? '#' + r.place : '—') },
    { label: 'Præmie', render: (r) => `<div class="ell">${esc(r.prize)}</div>` }, { label: 'Status', render: (r) => badge(r.status, r.isTest) }, { label: 'Bemærkning', render: (r) => esc(r.rejectReason || '') },
  ], d.items) + pager(d, 'wPage'));
}
ACT['search:wq'] = (v) => { F.w.q = v; F.w.page = 1; loadWinners(); };
ACT.wPage = (p) => { F.w.page = Number(p); loadWinners(); };

/* ================= TICKETS ================= */
P.tickets = async () => {
  F.t = F.t || { q: '', type: '', status: 'OPEN', page: 1 };
  setAfter(loadTickets);
  return header('Tickets', 'Support og præmie-tickets. Send panelet med /ticket panel i Discord.') +
    `<div class="toolbar">${searchBox('tq', 'Søg på emne, bruger, nummer eller event…', F.t.q)}<select class="select" id="tt"><option value="">Alle typer</option><option value="SUPPORT"${F.t.type === 'SUPPORT' ? ' selected' : ''}>🛠️ Support</option><option value="PRIZE"${F.t.type === 'PRIZE' ? ' selected' : ''}>🏆 Præmie</option></select><select class="select" id="ts"><option value="">Alle</option><option value="OPEN"${F.t.status === 'OPEN' ? ' selected' : ''}>Åbne</option><option value="CLOSED"${F.t.status === 'CLOSED' ? ' selected' : ''}>Lukkede</option></select></div><div id="L"></div>`;
};
async function loadTickets() {
  $('#tt').onchange = (e) => { F.t.type = e.target.value; F.t.page = 1; loadTickets(); };
  $('#ts').onchange = (e) => { F.t.status = e.target.value; F.t.page = 1; loadTickets(); };
  const d = await api('GET', G('/tickets' + qs(F.t)));
  fill('L', table([
    { label: '#', render: (r) => `<b>#${r.number}</b>` }, { label: 'Type', render: (r) => (r.type === 'PRIZE' ? '🏆 Præmie' : '🛠️ Support') }, { label: 'Emne', render: (r) => `<div class="ell">${esc(r.subject)}</div>` },
    { label: 'Bruger', render: (r) => usr(r.userId, d.users) }, { label: 'Event', render: (r) => (r.eventCode ? `<span class="code">${esc(r.eventCode)}</span>${r.verified ? ' ✅' : ' ⚠️'}` : '—') },
    { label: 'Præmie', render: (r) => esc(r.prize || '—') }, { label: 'Overtaget af', render: (r) => (r.claimedBy ? usr(r.claimedBy, d.users) : '—') },
    { label: 'Oprettet', render: (r) => fmtDate(r.createdAt) }, { label: 'Status', render: (r) => badge(r.status) },
  ], d.items.map((r) => ({ ...r, __arg: r.id })), { click: 'openTicket' }) + pager(d, 'tPage'));
}
ACT['search:tq'] = (v) => { F.t.q = v; F.t.page = 1; loadTickets(); };
ACT.tPage = (p) => { F.t.page = Number(p); loadTickets(); };
ACT.openTicket = async (id) => {
  const d = await api('GET', G('/tickets/' + id)), t = d.ticket;
  modal({
    title: `Ticket #${t.number} — ${t.type === 'PRIZE' ? 'Præmie' : 'Support'}`, wide: true,
    body: `<div class="kv" style="margin-bottom:16px"><div><span>Status</span><b>${badge(t.status)}</b></div><div><span>Oprettet af</span><b>${usr(t.userId, d.users)}</b></div><div><span>Oprettet</span><b>${fmtDate(t.createdAt)}</b></div>
    ${t.claimedBy ? `<div><span>Overtaget af</span><b>${usr(t.claimedBy, d.users)}</b></div>` : ''}${t.eventCode ? `<div><span>Event</span><b><a class="code" href="#/event/${esc(t.eventCode)}">${esc(t.eventCode)}</a> ${t.verified ? '✅ verificeret vinder' : '⚠️ ikke registreret vinder'}</b></div>` : ''}${t.prize ? `<div><span>Præmie</span><b>${esc(t.prize)}</b></div>` : ''}
    ${t.closedBy ? `<div><span>Lukket af</span><b>${usr(t.closedBy, d.users)}</b></div><div><span>Lukket</span><b>${fmtDate(t.closedAt)}</b></div><div><span>Årsag</span><b>${esc(t.closeReason || '—')}</b></div>` : ''}</div>
    <h3 style="margin-bottom:8px">${esc(t.subject)}</h3><p style="white-space:pre-wrap;color:var(--muted);margin-bottom:16px">${esc(t.details || '')}</p>
    ${t.transcript ? `<h3 style="margin-bottom:8px">Samtale</h3><pre class="tx">${esc(t.transcript)}</pre>` : t.status === 'OPEN' ? '<div class="empty">Samtalen gemmes når ticketten lukkes.</div>' : ''}`,
    actions: [{ label: 'Luk', close: true }, ...(t.status === 'OPEN' && (t.type === 'SUPPORT' || canEM()) ? [{ label: 'Luk ticket', cls: 'dng', run: async (c) => {
      if (!(await confirmDialog({ title: 'Luk ticket', text: 'Kanalen i Discord slettes og samtalen gemmes.', label: 'Luk ticket' }))) return;
      await api('POST', G(`/tickets/${id}/close`), { confirm: true, reason: 'Lukket via kontrolpanel' });
      c.close(); toast('Ticketten lukkes'); loadTickets();
    } }] : [])],
  });
};

/* ================= LOGS ================= */
const plain = (v) => String(typeof v === 'object' && v !== null ? JSON.stringify(v) : v ?? '—')
  .replace(/<@&(\d+)>/g, (_m, id) => '@' + (S.meta.roles.find((r) => r.id === id)?.name || id)).replace(/<#(\d+)>/g, (_m, id) => '#' + (S.meta.channels.find((c) => c.id === id)?.name || id)).replace(/<@(\d+)>/g, '@$1');
function detailText(r) {
  const b = r.before, a = r.after;
  if (r.category === 'ENTRY' || r.category === 'JOIN') return `${b?.entries ?? 0} → ${a?.entries ?? 0}`;
  const keys = [...new Set([...Object.keys(b || {}), ...Object.keys(a || {})])];
  return keys.map((k) => (b?.[k] !== undefined && a?.[k] !== undefined ? `${k}: ${plain(b[k])} → ${plain(a[k])}` : a?.[k] !== undefined ? `${k}: ${plain(a[k])}` : `${k}: ${plain(b[k])} (før)`)).join(' • ');
}
function logTable(d) {
  return table([
    { label: 'Tid', render: (r) => `<span style="white-space:nowrap">${fmtDate(r.createdAt)}</span>` },
    { label: 'Handling', render: (r) => `<b>${esc(actionLabel(r.action))}</b>` },
    { label: 'Hvem', render: (r) => (r.actorId ? usr(r.actorId, d.users) : '<span style="color:var(--muted)">system</span>') },
    { label: 'Mål', render: (r) => (r.targetType === 'USER' && r.targetId ? usr(r.targetId, d.users) : r.targetId ? `<span class="code">${esc(plain(r.targetId).slice(0, 24))}</span>` : '—') },
    { label: 'Event', render: (r) => (r.eventCode ? `<a class="code" href="#/event/${esc(r.eventCode)}">${esc(r.eventCode)}</a>` : '—') },
    { label: 'Detaljer', render: (r) => `<div class="ell" style="max-width:340px" title="${esc(detailText(r))}">${esc(detailText(r))}</div>` },
    { label: 'Årsag', render: (r) => `<div class="ell" title="${esc(r.reason || '')}">${esc(r.reason || '—')}</div>` },
  ], d.items);
}
P.logs = async () => {
  F.l = F.l || { q: '', category: '', from: '', to: '', page: 1 };
  setAfter(loadLogs);
  const cats = Object.entries(S.meta.logCategories).filter(([k]) => k !== 'JOIN' || true);
  return header('Logs', 'Komplet auditlog – hvem gjorde hvad, hvornår, før og efter', exportLink('audit', 'Eksportér CSV')) +
    `<div class="tabs" id="ltabs"><button data-act="logCat" data-arg="" class="${F.l.category === '' ? 'on' : ''}">Alle</button>${cats.map(([k, v]) => `<button data-act="logCat" data-arg="${k}" class="${F.l.category === k ? 'on' : ''}">${esc(v.replace(/ \(.*\)/, ''))}${k === 'JOIN' ? ' (knap)' : ''}</button>`).join('')}</div>
    <div class="toolbar">${searchBox('lq', 'Søg på bruger-ID/navn, event-ID, handling eller årsag…', F.l.q)}<input class="input" type="date" id="lf" value="${esc(F.l.from)}" style="width:auto" aria-label="Fra dato"><input class="input" type="date" id="lt" value="${esc(F.l.to)}" style="width:auto" aria-label="Til dato"></div><div id="L"></div>`;
};
async function loadLogs() {
  $('#lf').onchange = (e) => { F.l.from = e.target.value; F.l.page = 1; loadLogs(); };
  $('#lt').onchange = (e) => { F.l.to = e.target.value; F.l.page = 1; loadLogs(); };
  if (F.l.category === 'ERROR') {
    const d = await api('GET', G('/errors' + qs({ page: F.l.page })));
    fill('L', table([{ label: 'Tid', render: (r) => fmtDate(r.createdAt) }, { label: 'Hvor', render: (r) => `<span class="code">${esc(r.scope)}</span>` }, { label: 'Fejl', render: (r) => esc(r.message) }, { label: 'Ref.', render: (r) => `<span class="code">${esc(r.id.slice(-8))}</span>` }], d.items) + pager(d, 'lPage'));
    return;
  }
  const d = await api('GET', G('/logs' + qs(F.l)));
  fill('L', logTable(d) + pager(d, 'lPage'));
}
ACT.logCat = (c) => { F.l.category = c; F.l.page = 1; $$('#ltabs button').forEach((b) => b.classList.toggle('on', (b.dataset.arg || '') === c)); loadLogs(); };
ACT['search:lq'] = (v) => { F.l.q = v; F.l.page = 1; loadLogs(); };
ACT.lPage = (p) => { F.l.page = Number(p); loadLogs(); };

/* ================= STATISTIK ================= */
P.stats = async () => {
  const d = await api('GET', G('/stats')), s = d.stats;
  const list = (rows, unit) => (rows.length ? rows.map((r, i) => `<div class="it"><div class="dot">${i + 1}</div><div style="flex:1;min-width:0">${usr(r.userId, d.users)}</div><b>${num(r.value)} ${unit}</b></div>`).join('') : '<div class="empty">Ingen data endnu.</div>');
  const cards = [['Giveaways', s.totalGiveaways, 'gift'], ['Talevents', s.totalNumberEvents, 'target'], ['Unikke deltagere', s.uniqueParticipants, 'users'], ['Entries', s.totalEntries, 'ticket'], ['Vindere', s.totalWinners, 'trophy'], ['Gns. deltagere', s.averageParticipants.toFixed(1), 'chart']];
  return header('Statistik', 'Testevents er ikke med i tallene') +
    `<div class="grid g4">${cards.map((c) => `<div class="card stat"><div class="ic">${icon(c[2])}</div><div><b>${typeof c[1] === 'number' ? num(c[1]) : c[1]}</b><span>${c[0]}</span></div></div>`).join('')}</div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h3>Events pr. dag <small style="color:var(--muted)">30 dage</small></h3>${barChart(d.eventsPerDay)}</div><div class="card"><h3>Entries pr. dag <small style="color:var(--muted)">30 dage</small></h3>${lineChart(d.entriesPerDay)}</div>
    <div class="card"><h3>Vindere pr. dag <small style="color:var(--muted)">30 dage</small></h3>${barChart(d.winnersPerDay, '#ffc857')}</div><div class="card"><h3>Deltagere pr. giveaway <small style="color:var(--muted)">seneste 10</small></h3>${barChart(d.participantsPerGiveaway.map((p) => ({ d: p.code, l: p.code.replace('EVENT-', '#'), c: p.participants })))}</div></div>
    <div class="grid g2" style="margin-top:16px"><div class="card"><h3>🔥 Mest populære giveaway</h3>${s.mostPopular ? `<a href="#/event/${esc(s.mostPopular.code)}"><b>${esc(s.mostPopular.prize)}</b></a><br><span class="code">${esc(s.mostPopular.code)}</span> — ${num(s.mostPopular.participants)} deltagere` : '<div class="empty">Ingen data endnu.</div>'}</div><div class="card"><h3>📊 Gennemsnit (afsluttede)</h3><b style="font-size:26px">${s.averageEndedParticipants.toFixed(1)}</b> deltagere pr. giveaway</div>
    <div class="card"><h3>⚡ Mest aktive</h3><div class="list">${list(s.mostActive, 'entries')}</div></div><div class="card"><h3>🥇 Flest sejre</h3><div class="list">${list(s.mostWins, 'sejre')}</div></div></div>`;
};

/* ================= SKABELONER ================= */
P.templates = async () => {
  const d = await api('GET', G('/templates'));
  return header('Skabeloner', 'Gem faste opsætninger og brug dem med /giveaway start skabelon:Navn', canHA() ? `<button class="btn pri" data-act="newTemplate">${icon('plus')} Ny skabelon</button>` : '') +
    (d.items.length ? `<div class="grid g4">${d.items.map((t) => `<div class="card"><h3>${esc(t.name)}${canHA() ? `<button class="icon-btn" data-act="delTemplate" data-arg="${esc(t.name)}" aria-label="Slet">${icon('trash')}</button>` : ''}</h3><div class="kv" style="grid-template-columns:1fr 1fr"><div><span>Præmie</span><b>${esc(t.data.prize || '—')}</b></div><div><span>Varighed</span><b>${t.data.durationSec ? dur(t.data.durationSec) : '—'}</b></div><div><span>Vindere</span><b>${t.data.winnerCount || '—'}</b></div><div><span>Krav</span><b>${(t.data.config?.requiredRoles || []).length || 0} roller</b></div></div></div>`).join('')}</div>` : '<div class="card empty"><b>Ingen skabeloner endnu</b>Opret en skabelon, fx "VIP", og genbrug den hver gang.</div>');
};
ACT.newTemplate = () => modal({
  title: 'Ny skabelon', wide: true,
  body: `${field('Navn', '<input class="input" id="t_name" maxlength="32" placeholder="Fx VIP">')}<div class="fg">${field('Præmie (valgfri)', '<input class="input" id="t_prize" maxlength="250">')}${field('Varighed (valgfri)', '<input class="input" id="t_dur" placeholder="Fx 2t">')}${field('Antal vindere (valgfri)', '<input class="input" id="t_win" type="number" min="1" max="50">')}</div>${advancedForm({}, false)}`,
  actions: [{ label: 'Annuller', close: true }, { label: 'Gem skabelon', cls: 'pri', run: async (c) => { await api('POST', G('/templates'), { name: val(c, 't_name'), prize: val(c, 't_prize') || undefined, duration: val(c, 't_dur') || undefined, winnerCount: nz(val(c, 't_win')), config: collectAdvanced(c, false) }); c.close(); toast('Skabelonen er gemt'); refresh(); } }],
});
ACT.delTemplate = async (name) => { if (await confirmDialog({ title: 'Slet skabelon', text: `Skabelonen <b>${esc(name)}</b> slettes.`, label: 'Slet' })) { await api('DELETE', G('/templates/' + encodeURIComponent(name)), { confirm: true }); toast('Skabelonen er slettet'); refresh(); } };

/* ================= RETTIGHEDER ================= */
P.permissions = async () => {
  const s = S.meta.settings, owner = S.level >= LV.OWNER;
  const lv = [
    ['ownerRoleIds', '👑 Ejer', 'Kan alt, inklusive at ændre rettigheder. Serverens ejer er altid Ejer.'],
    ['highAdminRoleIds', '🛡️ Højadmin', 'Entries (tilføj/fjern/sæt), redigere/afslutte/reroll giveaways, talevents, brugere, indstillinger, logs og eksport.'],
    ['eventManagerRoleIds', '🎪 Eventansvarlig', 'Oprette giveaways, pause/genoptage/afslutte, starte og stoppe talevents, håndtere præmie-tickets. Kan IKKE ændre entries.'],
    ['moderatorRoleIds', '🔍 Moderator', 'Se events, deltagere, vindere, tickets og grundlæggende statistik.'],
  ];
  return header('Rettigheder', owner ? 'Vælg hvilke Discord-roller der har hvilket niveau' : 'Kun Ejere kan ændre rettigheder') +
    `<div class="grid g2">${lv.map(([k, t, desc]) => `<div class="card"><h3>${t}</h3><p style="color:var(--muted);margin-bottom:12px">${desc}</p><select class="select" id="p_${k}" multiple${owner ? '' : ' disabled'}>${roleOpts(s[k])}</select></div>`).join('')}</div>
    <div class="card" style="margin-top:16px"><b>Bemærk</b><p style="color:var(--muted);margin-top:4px">Almindelige brugere kan deltage i giveaways, se egen statistik og deltage i talevents. Rettighederne tjekkes altid på serveren – aldrig kun i dette panel.</p></div>
    ${owner ? `<div class="row" style="margin-top:16px"><button class="btn pri" data-act="savePerms">Gem rettigheder</button></div>` : ''}`;
};
ACT.savePerms = async () => {
  if (!(await confirmDialog({ title: 'Ændr rettigheder', text: 'Du ændrer hvem der har adgang til botten og kontrolpanelet. Ændringen logges.', label: 'Gem' }))) return;
  const body = { confirm: true };
  ['ownerRoleIds', 'highAdminRoleIds', 'eventManagerRoleIds', 'moderatorRoleIds'].forEach((k) => { body[k] = [...$('#p_' + k).selectedOptions].map((o) => o.value); });
  await api('PUT', G('/permissions'), body);
  S.meta = await api('GET', G('/meta')); toast('Rettighederne er gemt');
};

/* ================= INDSTILLINGER ================= */
P.settings = async () => {
  const s = S.meta.settings, d = S.meta.defaults, cats = S.meta.logCategories, per = s.logChannels || {};
  const msgs = Object.entries(S.meta.messageDefaults).map(([k, def]) => {
    const cur = s.messages?.[k] || {};
    return `<div class="card" style="margin-bottom:12px;padding:16px"><div class="row" style="justify-content:space-between;margin-bottom:8px"><b>${esc(def.label)}</b>${toggle('m_on_' + k, 'Slået til', cur.enabled !== false && def.enabled)}</div><textarea class="textarea" id="m_tx_${k}" maxlength="1500">${esc(cur.text || def.text)}</textarea><small style="color:var(--muted)">Variabler: ${esc(def.vars)}</small></div>`;
  }).join('');
  return header('Indstillinger', 'Kanaler, logs, annonceringer og standarder', `<button class="btn pri" data-act="saveSettings">Gem indstillinger</button>`) +
    `<div class="card" style="margin-bottom:16px"><h3>Kanaler</h3><div class="fg">${field('Giveaway-kanal', `<select class="select" id="s_gc">${chanOpts(s.giveawayChannelId, '— ikke sat —')}</select>`)}${field('Talevent-kanal', `<select class="select" id="s_nc">${chanOpts(s.numberChannelId, '— ikke sat —')}</select>`)}${field('Log-kanal (standard for alle logs)', `<select class="select" id="s_lc">${chanOpts(s.logChannelId, '— ikke sat —')}</select>`)}</div></div>
    <div class="card" style="margin-bottom:16px"><h3>Logs pr. kategori</h3><p style="color:var(--muted);margin-bottom:14px">Giv hver type log sin egen kanal, eller lad feltet stå tomt for at bruge standard-log-kanalen. Slå kategorier fra du ikke vil have.</p>
    ${Object.entries(cats).map(([k, label]) => `<div class="row" style="margin-bottom:10px;gap:14px"><div style="flex:1;min-width:220px">${toggle('lg_on_' + k, esc(label), !s.disabledLogCategories.includes(k))}</div><select class="select" id="lg_ch_${k}" style="flex:1;min-width:200px">${chanOpts(per[k], '— standard-log-kanal —')}</select></div>`).join('')}
    <div style="margin-top:14px">${toggle('s_rolelog', 'Log når medlemmer får/mister vigtige roller (rettigheds-, vinder-, krav- og bonusroller)', s.logRoleChanges)}</div></div>
    <div class="card" style="margin-bottom:16px"><h3>Vinderrolle, tidszone og test</h3><div class="fg">${field('Vinderrolle (valgfri)', `<select class="select" id="s_wr"><option value="">— ingen —</option>${(S.meta.roles || []).map((r) => `<option value="${esc(r.id)}"${s.winnerRoleId === r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select>`, 'Botten skal have en rolle OVER denne i rollelisten.')}${field('Tidszone', `<select class="select" id="s_tz">${[...new Set([s.timezone, ...S.meta.timezones])].map((z) => `<option${z === s.timezone ? ' selected' : ''}>${esc(z)}</option>`).join('')}</select>`)}</div>
    ${toggle('s_test', '🧪 Testtilstand for nye events (tæller ikke i statistik, ingen roller/DM)', s.testMode)}<div style="height:10px"></div>${toggle('s_dash', 'Kontrolpanel aktivt for denne server', s.dashboardEnabled)}</div>
    <div class="card" style="margin-bottom:16px"><h3>Standard for giveaways</h3><div class="fg">${field('Varighed', `<input class="input" id="d_dur" value="${esc(durInput(d.durationSec))}">`)}${field('Antal vindere', `<input class="input" id="d_win" type="number" min="1" max="50" value="${d.winnerCount}">`)}${field('Entries pr. klik', `<input class="input" id="d_per" type="number" min="1" value="${d.entriesPerClick}">`)}${field('Maks. entries (0 = ingen)', `<input class="input" id="d_max" type="number" min="0" value="${d.maxEntries}">`)}${field('Bonus-roller', `<select class="select" id="d_mode"><option value="highest"${d.bonusMode === 'highest' ? ' selected' : ''}>Højeste tæller</option><option value="stack"${d.bonusMode === 'stack' ? ' selected' : ''}>Læg sammen</option></select>`)}${field('Slutter-snart beskeder', `<input class="input" id="s_es" value="${esc(s.endingSoonSeconds.map(durInput).join(', '))}" placeholder="5m, 1m, 30s">`, 'Tomt = slået fra')}</div></div>
    <div class="card" style="margin-bottom:16px"><h3>Tickets</h3><div class="fg">${field('Kategori til ticket-kanaler', `<select class="select" id="s_tk">${chanOpts(s.ticketCategoryId, '— ingen kategori —', S.meta.categories)}</select>`)}${field('Ekstra support-roller', `<select class="select" id="s_ts" multiple>${roleOpts(s.ticketSupportRoleIds)}</select>`)}${field('Roller for præmie-/event-tickets', `<select class="select" id="s_tp" multiple>${roleOpts(s.ticketPrizeRoleIds)}</select>`, 'Eventansvarlige og højere har altid adgang.')}</div></div>
    <h3 style="margin:22px 0 12px">Annonceringer og beskeder</h3>${msgs}
    <div class="row" style="margin-top:8px"><button class="btn pri" data-act="saveSettings">Gem indstillinger</button></div>`;
};
const durInput = (s) => { const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return `${d ? d + 'd' : ''}${h ? h + 't' : ''}${m ? m + 'm' : ''}${x ? x + 's' : ''}` || '1t'; };
const parseDurClient = (t) => { const s = t.trim().toLowerCase().replace(/\s+/g, ''); if (!s) return 0; const re = /(\d+)(w|d|h|t|m|s)/g; let tot = 0, used = 0, m; const mult = { w: 604800, d: 86400, h: 3600, t: 3600, m: 60, s: 1 }; while ((m = re.exec(s))) { tot += Number(m[1]) * mult[m[2]]; used += m[0].length; } return used === s.length ? tot : NaN; };
ACT.saveSettings = async () => {
  const v = (id) => $('#' + id).value, c = (id) => $('#' + id).checked, ms = (id) => [...$('#' + id).selectedOptions].map((o) => o.value);
  const durSec = parseDurClient(v('d_dur')); if (!(durSec >= 10)) throw new Error('Ugyldig standard-varighed. Brug fx 1t, 30m eller 1d.');
  const es = v('s_es').split(/[,;]+/).map((x) => x.trim()).filter(Boolean).map(parseDurClient); if (es.some((n) => !(n >= 5))) throw new Error('Ugyldige slutter-snart tider. Brug fx 5m, 1m, 30s.');
  const logChannels = {}, disabled = [];
  Object.keys(S.meta.logCategories).forEach((k) => { if (v('lg_ch_' + k)) logChannels[k] = v('lg_ch_' + k); if (!c('lg_on_' + k)) disabled.push(k); });
  const messages = {};
  Object.keys(S.meta.messageDefaults).forEach((k) => { messages[k] = { enabled: c('m_on_' + k), text: v('m_tx_' + k) }; });
  await api('PUT', G('/settings'), {
    giveawayChannelId: v('s_gc') || null, numberChannelId: v('s_nc') || null, logChannelId: v('s_lc') || null, logChannels, disabledLogCategories: disabled, logRoleChanges: c('s_rolelog'),
    winnerRoleId: v('s_wr') || null, timezone: v('s_tz'), testMode: c('s_test'), dashboardEnabled: c('s_dash'),
    defaults: { durationSec: durSec, winnerCount: Number(v('d_win')), entriesPerClick: Number(v('d_per')), maxEntries: Number(v('d_max')), bonusMode: v('d_mode') },
    endingSoonSeconds: es, messages, ticketCategoryId: v('s_tk') || null, ticketSupportRoleIds: ms('s_ts'), ticketPrizeRoleIds: ms('s_tp'),
  });
  S.meta = await api('GET', G('/meta')); toast('Indstillingerne er gemt ✅');
};
