'use strict';
/* Nova Events Kontrolpanel – sider (del 1) */

const canEM = () => S.level >= LV.EM;
const canHA = () => S.level >= LV.HA;
const exportLink = (kind, label, extra = '') => `<a class="btn sm" href="${G('/export/' + kind)}${extra}" download>${icon('download')} ${esc(label)}</a>`;
const setAfter = (fn) => { S.after = fn; };
const fill = (id, html) => { const el = $('#' + id); if (el) el.innerHTML = html; };

/* ================= OVERBLIK ================= */
P.overview = async () => {
  const d = await api('GET', G('/overview'));
  const t = d.totals;
  const cards = [
    ['Aktive giveaways', t.activeGiveaways, 'gift'], ['Aktive talevents', t.activeNumberEvents, 'target'], ['Unikke brugere', t.uniqueParticipants, 'users'],
    ['Entries i alt', t.totalEntries, 'ticket'], ['Giveaways i alt', t.totalGiveaways, 'gift'], ['Vindere i alt', t.totalWinners, 'trophy'], ['Talevents i alt', t.totalNumberEvents, 'target'],
  ];
  return header(`Hej, ${S.me.username}`, `Overblik for <b>${esc(S.meta.guild.name)}</b>`) +
    `<div class="grid g4">${cards.map((c) => `<div class="card stat"><div class="ic">${icon(c[2])}</div><div><b>${num(c[1])}</b><span>${c[0]}</span></div></div>`).join('')}</div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><h3>Events pr. dag <small style="color:var(--muted);font-weight:600">14 dage</small></h3>${barChart(d.eventsPerDay)}</div>
      <div class="card"><h3>Entries via knap pr. dag <small style="color:var(--muted);font-weight:600">14 dage</small></h3>${lineChart(d.entriesPerDay)}</div>
    </div>
    <div class="card" style="margin-top:16px"><h3>Seneste aktivitet</h3><div class="list">${d.recent.length ? d.recent.map((r) => `<div class="it"><div class="dot">${icon(ACTION_ICON(r.category))}</div><div style="flex:1;min-width:0"><b>${esc(actionLabel(r.action))}</b>${r.eventCode ? ` <a class="code" href="#/event/${esc(r.eventCode)}">${esc(r.eventCode)}</a>` : ''}<small>${r.actorId ? 'af ' + esc(d.users[r.actorId]?.username || r.actorId) : 'automatisk'}</small></div><small>${ago(r.createdAt)}</small></div>`).join('') : '<div class="empty"><b>Ingen aktivitet endnu</b>Start dit første giveaway med /giveaway start eller knappen under Giveaways.</div>'}</div></div>`;
};

/* ================= EVENT-LISTER ================= */
function eventsPage(type) {
  const k = type === 'GIVEAWAY' ? 'gw' : 'ne';
  F[k] = F[k] || { q: '', status: '', page: 1 };
  F.eventBack = type === 'GIVEAWAY' ? 'giveaways' : 'numberevents';
  const f = F[k];
  setAfter(() => loadEvents(type));
  const create = canEM() ? `<button class="btn pri" data-act="${type === 'GIVEAWAY' ? 'newGiveaway' : 'newNumber'}">${icon('plus')} ${type === 'GIVEAWAY' ? 'Nyt giveaway' : 'Nyt talevent'}</button>` : '';
  const exp = canHA() ? exportLink('events', 'Eksportér') : '';
  return header(type === 'GIVEAWAY' ? 'Giveaways' : 'Talevents', type === 'GIVEAWAY' ? 'Opret, styr og find giveaways' : 'Skjulte tal – den første med det rigtige tal vinder', exp + create) +
    `<div class="toolbar">${searchBox('evq', 'Søg på ID, præmie eller vært-ID…', f.q)}<select class="select" id="evs"><option value="">Alle statusser</option>${['ACTIVE', 'PAUSED', 'SCHEDULED', 'ENDED', 'CANCELLED'].map((s) => `<option value="${s}"${f.status === s ? ' selected' : ''}>${STATUS[s]}</option>`).join('')}</select></div><div id="L"></div>`;
}
async function loadEvents(type) {
  const f = F[type === 'GIVEAWAY' ? 'gw' : 'ne'];
  const sel = $('#evs'); if (sel) sel.onchange = () => { f.status = sel.value; f.page = 1; loadEvents(type); };
  const d = await api('GET', G('/events' + qs({ type, q: f.q, status: f.status, page: f.page })));
  const cols = [
    { label: 'ID', render: (r) => `<span class="code">${esc(r.code)}</span>` },
    { label: 'Præmie', render: (r) => `<div class="ell" title="${esc(r.prize)}"><b>${esc(r.prize)}</b></div>` },
    { label: 'Vindere', render: (r) => (type === 'NUMBER' ? `${r.winnersFound}/${r.winnerCount}` : r.winnerCount) },
    ...(type === 'GIVEAWAY' ? [{ label: 'Deltagere', render: (r) => num(r.participants) }, { label: 'Entries', render: (r) => num(r.entries) }] : []),
    { label: 'Vært', render: (r) => usr(r.hostId, d.users) },
    { label: 'Start', render: (r) => fmtDate(r.startsAt) },
    { label: 'Slut', render: (r) => fmtDate(r.endedAt || r.endsAt) },
    { label: 'Status', render: (r) => badge(r.status, r.isTest) },
  ];
  fill('L', table(cols, d.items.map((r) => ({ ...r, __arg: r.code })), { click: 'openEvent' }) + pager(d, type === 'GIVEAWAY' ? 'gwPage' : 'nePage'));
}
ACT['search:evq'] = (v) => { const t = location.hash.includes('numberevents') ? 'NUMBER' : 'GIVEAWAY'; const f = F[t === 'GIVEAWAY' ? 'gw' : 'ne']; f.q = v; f.page = 1; loadEvents(t); };
ACT.gwPage = (p) => { F.gw.page = Number(p); loadEvents('GIVEAWAY'); };
ACT.nePage = (p) => { F.ne.page = Number(p); loadEvents('NUMBER'); };
ACT.openEvent = (code) => { location.hash = '#/event/' + encodeURIComponent(code); };
P.giveaways = async () => eventsPage('GIVEAWAY');
P.numberevents = async () => eventsPage('NUMBER');

/* ================= GIVEAWAY-FORMULAR ================= */
function advancedForm(c = {}, full = false) {
  const e = c.embed || {};
  const bonus = (c.bonusRoles || []).map(bonusRow).join('');
  return `<details class="adv"><summary>Krav og bonus-entries ${icon('chev')}</summary>
    <div class="fg">
      ${field('Påkrævede roller', `<select class="select" id="g_req" multiple>${roleOpts(c.requiredRoles || [])}</select>`, 'Medlemmet skal have mindst én af dem. Hold Ctrl/⌘ nede for flere.')}
      ${field('Blokerede roller', `<select class="select" id="g_blk" multiple>${roleOpts(c.blacklistedRoles || [])}</select>`)}
    </div>
    <div class="fg">
      ${field('Min. alder på Discord-konto (dage)', `<input class="input" id="g_acc" type="number" min="0" value="${c.minAccountAgeDays ?? ''}">`)}
      ${field('Min. tid på serveren (dage)', `<input class="input" id="g_srv" type="number" min="0" value="${c.minServerDays ?? ''}">`)}
      ${field('Min. antal beskeder', `<input class="input" id="g_msg" type="number" min="0" value="${c.minMessages ?? ''}">`)}
      ${field('Maks. entries pr. bruger (0 = ingen)', `<input class="input" id="g_max" type="number" min="0" value="${c.maxEntries ?? ''}">`)}
      ${field('Entries pr. klik', `<input class="input" id="g_per" type="number" min="1" value="${c.entriesPerClick ?? ''}">`)}
      ${field('Bonus-tilstand', `<select class="select" id="g_mode"><option value="">Standard</option><option value="highest"${c.bonusMode === 'highest' ? ' selected' : ''}>Højeste tæller</option><option value="stack"${c.bonusMode === 'stack' ? ' selected' : ''}>Læg sammen</option></select>`)}
    </div>
    ${toggle('g_voice', 'Kræv at deltageren sidder i en stemmekanal', c.voiceRequired)}
    <div class="f" style="margin-top:12px"><label>Bonus-entries for roller</label><div id="bonusRows">${bonus}</div><button type="button" class="btn sm" data-act="addBonus" style="align-self:flex-start">${icon('plus')} Tilføj bonus-rolle</button></div>
  </details>
  <details class="adv"><summary>Udseende (embed, knap, vinderbesked) ${icon('chev')}</summary>
    <div class="fg">
      ${field('Titel', `<input class="input" id="e_title" maxlength="200" value="${esc(e.title || '')}" placeholder="Standard: 🎉 præmien">`)}
      ${field('Footer', `<input class="input" id="e_footer" maxlength="100" value="${esc(e.footer || '')}">`)}
      ${field('Thumbnail-link', `<input class="input" id="e_thumb" maxlength="500" value="${esc(e.thumbnail || '')}" placeholder="https://…">`)}
      ${field('Billede-link', `<input class="input" id="e_img" maxlength="500" value="${esc(e.image || '')}" placeholder="https://…">`)}
      ${field('Farve (hex)', `<input class="input" id="e_color" maxlength="7" value="${esc(e.color || '')}" placeholder="#e11d2e">`)}
      ${field('Knaptekst', `<input class="input" id="e_btn" maxlength="80" value="${esc(e.buttonLabel || '')}" placeholder="DELTAG I GIVEAWAY">`)}
      ${field('Knap-emoji', `<input class="input" id="e_emoji" maxlength="60" value="${esc(e.buttonEmoji || '')}" placeholder="🎉">`)}
    </div>
    ${field('Beskrivelse', `<textarea class="textarea" id="e_desc" maxlength="1500">${esc(e.description || '')}</textarea>`, 'Du kan bruge {prize}, {winners}, {host}, {id}.')}
    ${field('Egen vinderbesked', `<textarea class="textarea" id="e_win" maxlength="1000" placeholder="🏆 Tillykke {winners}! I vandt {prize}!">${esc(c.winnerMessage || '')}</textarea>`)}
  </details>`;
}
const bonusRow = (b = {}) => `<div class="row bonus" style="margin-bottom:8px"><select class="select b-role" style="flex:2;min-width:150px"><option value="">— rolle —</option>${(S.meta.roles || []).map((r) => `<option value="${esc(r.id)}"${b.roleId === r.id ? ' selected' : ''}>${esc(r.name)}</option>`).join('')}</select><input class="input b-n" type="number" min="1" max="1000" value="${b.entries ?? 2}" style="flex:1;min-width:80px"><button type="button" class="icon-btn" data-act="rmRow" aria-label="Fjern">${icon('x')}</button></div>`;
ACT.addBonus = (_a, el) => { const box = $('#bonusRows', el.closest('.md')); box.insertAdjacentHTML('beforeend', bonusRow()); };
ACT.rmRow = (_a, el) => el.closest('.bonus').remove();

function collectAdvanced(m, full) {
  const cfg = { embed: {} };
  const put = (obj, key, v, numeric) => { if (v === '' || v === undefined) { if (full) obj[key] = numeric ? 0 : null; return; } obj[key] = numeric ? Number(v) : v; };
  const req = multi(m, 'g_req'), blk = multi(m, 'g_blk');
  if (full || req.length) cfg.requiredRoles = req;
  if (full || blk.length) cfg.blacklistedRoles = blk;
  put(cfg, 'minAccountAgeDays', val(m, 'g_acc'), true);
  put(cfg, 'minServerDays', val(m, 'g_srv'), true);
  put(cfg, 'minMessages', val(m, 'g_msg'), true);
  if (val(m, 'g_max') !== '') cfg.maxEntries = Number(val(m, 'g_max'));
  if (val(m, 'g_per') !== '') cfg.entriesPerClick = Number(val(m, 'g_per'));
  if (val(m, 'g_mode')) cfg.bonusMode = val(m, 'g_mode');
  if (full || chk(m, 'g_voice')) cfg.voiceRequired = chk(m, 'g_voice');
  const bonus = $$('.bonus', m.el).map((r) => ({ roleId: $('.b-role', r).value, entries: Number($('.b-n', r).value) || 1 })).filter((b) => b.roleId);
  if (full || bonus.length) cfg.bonusRoles = bonus;
  const em = cfg.embed;
  [['title', 'e_title'], ['footer', 'e_footer'], ['thumbnail', 'e_thumb'], ['image', 'e_img'], ['color', 'e_color'], ['buttonLabel', 'e_btn'], ['buttonEmoji', 'e_emoji'], ['description', 'e_desc']].forEach(([k, id]) => put(em, k, val(m, id)));
  put(cfg, 'winnerMessage', val(m, 'e_win'));
  return cfg;
}

ACT.newGiveaway = async () => {
  const [tpl] = await Promise.all([api('GET', G('/templates')).catch(() => ({ items: [] }))]);
  const d = S.meta.defaults;
  const m = modal({
    title: 'Nyt giveaway', wide: true,
    body: `${tpl.items.length ? field('Skabelon (valgfri)', `<select class="select" id="g_tpl"><option value="">Ingen</option>${tpl.items.map((t) => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')}</select>`, 'Felter du udfylder herunder overstyrer skabelonen.') : ''}
    <div class="fg">${field('Præmie', '<input class="input" id="g_prize" maxlength="250" placeholder="Fx $10.000.000">')}
    ${field('Varighed', `<input class="input" id="g_dur" placeholder="Fx 30m, 2t, 1d" value="${esc(dur(d.durationSec).replace(/ /g, '').replace('t', 't').replace('d', 'd').replace('min', 'm'))}">`)}
    ${field('Antal vindere', `<input class="input" id="g_win" type="number" min="1" max="50" value="${d.winnerCount}">`)}
    ${field('Kanal', `<select class="select" id="g_ch">${chanOpts(S.meta.settings?.giveawayChannelId, '— standard-kanal —')}</select>`)}
    ${field('Planlæg start (valgfri)', '<input class="input" id="g_start" type="datetime-local">', `Serverens tidszone: ${esc(S.meta.timezone)}`)}</div>
    ${toggle('g_test', '🧪 Testtilstand (tæller ikke i statistik, ingen roller/DM)', false)}<div style="height:14px"></div>
    ${advancedForm({}, false)}`,
    actions: [{ label: 'Annuller', close: true }, {
      label: 'Opret giveaway', cls: 'pri', run: async (c) => {
        const body = { template: val(c, 'g_tpl') || undefined, prize: val(c, 'g_prize') || undefined, duration: val(c, 'g_dur') || undefined, winnerCount: nz(val(c, 'g_win')), channelId: val(c, 'g_ch') || undefined, startsAtLocal: val(c, 'g_start') || undefined, test: chk(c, 'g_test'), config: collectAdvanced(c, false) };
        const r = await api('POST', G('/giveaways'), body);
        c.close(); toast(`Giveaway ${r.event.code} er oprettet 🎉`);
        location.hash = '#/event/' + r.event.code; refresh();
      },
    }],
  });
  void m;
};

ACT.newNumber = () => {
  const m = modal({
    title: 'Nyt talevent', wide: true,
    body: `<div class="fg">${field('Præmie', '<input class="input" id="n_prize" maxlength="250" placeholder="Fx $10.000.000">')}
    ${field('Kanal', `<select class="select" id="n_ch">${chanOpts(S.meta.settings?.numberChannelId, '— standard-kanal —')}</select>`)}
    ${field('Mindste tal', '<input class="input" id="n_min" type="number" value="1">')}
    ${field('Største tal', '<input class="input" id="n_max" type="number" value="10000">')}
    ${field('Hemmeligt tal (valgfrit)', '<input class="input" id="n_num" type="number" placeholder="Tomt = tilfældigt">', 'Kun du kan se det. Det vises aldrig i loggen.')}
    ${field('Varighed', '<input class="input" id="n_dur" value="10m" placeholder="10m">')}
    ${field('Antal vindere (1-10)', '<input class="input" id="n_win" type="number" min="1" max="10" value="1">')}</div>
    ${field('Præmie pr. plads (valgfrit)', '<input class="input" id="n_prizes" placeholder="$10M | $5M | $2M">', 'Adskil med | – 1. plads, 2. plads, 3. plads …')}
    <details class="adv"><summary>Hints og højere/lavere ${icon('chev')}</summary><div class="fg">
      ${field('Antal hints (0-10)', '<input class="input" id="n_hints" type="number" min="0" max="10" value="0">')}
      ${field('Tid mellem hints', '<input class="input" id="n_hint_i" placeholder="Fx 2m">')}
      ${field('Første hint-interval (størrelse)', '<input class="input" id="n_hint_r" type="number" min="2" placeholder="Fx 3000">', 'Halveres for hvert hint.')}
    </div>${toggle('n_hl', 'Svar ⬆️ HØJERE / ⬇️ LAVERE på forkerte gæt', false)}<div style="height:10px"></div>${toggle('n_range', 'Vis min/max-intervallet i beskeden', true)}</details>
    ${toggle('n_test', '🧪 Testtilstand', false)}`,
    actions: [{ label: 'Annuller', close: true }, {
      label: 'Start talevent', cls: 'pri', run: async (c) => {
        const r = await api('POST', G('/numberevents'), { prize: val(c, 'n_prize'), channelId: val(c, 'n_ch') || undefined, min: nz(val(c, 'n_min')), max: nz(val(c, 'n_max')), number: val(c, 'n_num') === '' ? undefined : Number(val(c, 'n_num')), duration: val(c, 'n_dur'), winnerCount: nz(val(c, 'n_win')), prizes: val(c, 'n_prizes') || undefined, hintCount: nz(val(c, 'n_hints')), hintInterval: val(c, 'n_hint_i') || undefined, hintRange: nz(val(c, 'n_hint_r')), higherLower: chk(c, 'n_hl'), showRange: chk(c, 'n_range'), test: chk(c, 'n_test') });
        c.close(); toast(`Talevent ${r.event.code} er startet 🎯`); location.hash = '#/event/' + r.event.code; refresh();
      },
    }],
  });
  void m;
};

/* ================= EVENT-DETALJER ================= */
P.event = async (code) => {
  const d = await api('GET', G('/events/' + encodeURIComponent(code)));
  const ev = d.event, gw = ev.type === 'GIVEAWAY';
  S.cur = d;
  F.eventBack = gw ? 'giveaways' : 'numberevents';
  F.pq = { q: '', page: 1 };
  const st = ev.status, em = canEM(), ha = canHA();
  const btn = (act, label, ic, cls = '') => `<button class="btn sm ${cls}" data-act="${act}">${icon(ic)} ${label}</button>`;
  const acts = [];
  if (gw) {
    if (em && st === 'ACTIVE') acts.push(btn('evPause', 'Pause', 'pause'));
    if (em && st === 'PAUSED') acts.push(btn('evResume', 'Genoptag', 'play'));
    if (em && (st === 'ACTIVE' || st === 'PAUSED')) acts.push(btn('evEnd', 'Afslut nu', 'flag', 'pri'));
    if (em && ['ACTIVE', 'PAUSED', 'SCHEDULED'].includes(st)) acts.push(btn('evCancel', 'Annullér', 'x', 'dng'));
    if (ha && !['ENDED', 'CANCELLED'].includes(st)) acts.push(btn('evEdit', 'Rediger', 'edit'));
    if (ha && ['ACTIVE', 'PAUSED', 'SCHEDULED'].includes(st)) acts.push(btn('evAddEntries', 'Ret entries', 'ticket'));
    if (ha && st === 'ENDED') acts.push(btn('evReroll', 'Reroll', 'refresh'));
  } else {
    if (em && st === 'ACTIVE') acts.push(btn('evStop', 'Stop eventet', 'x', 'dng'));
    if (ha && st === 'ENDED' && ev.winnersFound > 0) acts.push(btn('evNReroll', 'Reroll vinder', 'refresh'));
  }
  if (ha && !['ACTIVE', 'PAUSED'].includes(st)) acts.push(btn('evDelete', 'Slet', 'trash', 'dng'));
  if (ha && gw) acts.push(exportLink('participants', 'Deltagere (CSV)', `?code=${ev.code}`));
  const cfg = ev.config || {};
  const req = gw ? [
    cfg.requiredRoles?.length && `Roller: ${cfg.requiredRoles.map(roleName).join(', ')}`, cfg.blacklistedRoles?.length && `Blokeret: ${cfg.blacklistedRoles.map(roleName).join(', ')}`,
    cfg.minAccountAgeDays && `Konto ≥ ${cfg.minAccountAgeDays} dage`, cfg.minServerDays && `Server ≥ ${cfg.minServerDays} dage`, cfg.minMessages && `≥ ${cfg.minMessages} beskeder`,
    cfg.voiceRequired && 'Stemmekanal', cfg.maxEntries && `Maks. ${cfg.maxEntries} entries`,
    ...(cfg.bonusRoles || []).map((b) => `${roleName(b.roleId)} = ${b.entries} entries`),
  ].filter(Boolean) : [];
  setAfter(() => { if (gw) loadParticipants(); });
  const winners = d.winners;
  return `<div class="row" style="margin-bottom:10px"><a class="btn sm" href="#/${F.eventBack}">${icon('back')} Tilbage</a></div>` +
    header(ev.prize, `<span class="code">${esc(ev.code)}</span> ${badge(st, ev.isTest)} ${gw ? '🎁 Giveaway' : '🎯 Talevent'}`) +
    (acts.length ? `<div class="row" style="margin-bottom:18px">${acts.join('')}</div>` : '') +
    `<div class="card"><div class="kv">
      <div><span>Vindere</span><b>${gw ? ev.winnerCount : `${ev.winnersFound}/${ev.winnerCount}`}</b></div>
      ${gw ? `<div><span>Deltagere</span><b>${num(ev.participants)}</b></div><div><span>Entries</span><b>${num(ev.entries)}</b></div>` : `<div><span>Interval</span><b>${num(cfg.min)} – ${num(cfg.max)}</b></div>${ev.secretNumber != null ? `<div><span>Hemmeligt tal ${ev.status === 'ACTIVE' ? '(klik for at vise)' : ''}</span><b class="secret${ev.status !== 'ACTIVE' ? ' show' : ''}" data-act="reveal">${esc(ev.secretNumber)}</b></div>` : ''}`}
      <div><span>Vært</span><b>${usr(ev.hostId, d.users)}</b></div><div><span>Kanal</span><b>${chan(ev.channelId)}</b></div>
      <div><span>Start</span><b>${fmtDate(ev.startsAt)}</b></div><div><span>Slut</span><b>${fmtDate(ev.endedAt || ev.endsAt)}</b></div>
      <div><span>Varighed</span><b>${dur(ev.durationSec)}</b></div>${st === 'PAUSED' ? `<div><span>Tid tilbage</span><b>${dur(ev.remainingSec)}</b></div>` : ''}
    </div>${req.length ? `<div style="margin-top:16px"><span style="color:var(--muted);font-size:12px;font-weight:600">Krav & bonus</span><div>${req.map((r) => `<span class="pill">${r}</span>`).join('')}</div></div>` : ''}</div>
    <div class="card" style="margin-top:16px"><h3>Vindere</h3>${winners.length ? table([
      { label: 'Plads', render: (r) => (r.place ? `#${r.place}` : '—') }, { label: 'Bruger', render: (r) => usr(r.userId, d.users) },
      { label: 'Præmie', render: (r) => esc(r.prize || ev.prize) }, { label: 'Status', render: (r) => badge(r.status) + (r.rerolled ? ' <span class="pill">reroll</span>' : '') },
      { label: 'Bemærkning', render: (r) => esc(r.rejectReason || '') },
    ], winners) : '<div class="empty">Ingen vindere endnu.</div>'}</div>` +
    (gw ? `<div class="card" style="margin-top:16px"><h3>Deltagere</h3><div class="toolbar">${searchBox('pq', 'Søg på brugernavn eller ID…', '')}</div><div id="P"></div></div>` : '');
};
async function loadParticipants() {
  const code = S.cur.event.code;
  const d = await api('GET', G(`/events/${encodeURIComponent(code)}/entries` + qs({ q: F.pq.q, page: F.pq.page })));
  fill('P', table([{ label: 'Bruger', render: (r) => usr(r.userId, d.users) }, { label: 'Bruger-ID', render: (r) => `<span class="code">${esc(r.userId)}</span>` }, { label: 'Entries', render: (r) => `<b>${num(r.amount)}</b>` }, { label: 'Tilmeldt', render: (r) => fmtDate(r.createdAt) }], d.items) + pager(d, 'pPage'));
}
ACT['search:pq'] = (v) => { F.pq.q = v; F.pq.page = 1; loadParticipants(); };
ACT.pPage = (p) => { F.pq.page = Number(p); loadParticipants(); };

const evPath = (a) => G(`/giveaways/${encodeURIComponent(S.cur.event.code)}/${a}`);
ACT.evPause = async () => { await api('POST', evPath('pause'), {}); toast('Giveawayet er sat på pause'); refresh(); };
ACT.evResume = async () => { await api('POST', evPath('resume'), {}); toast('Giveawayet er genoptaget'); refresh(); };
ACT.evEnd = async () => { if (await confirmDialog({ title: 'Afslut giveaway', text: 'Vinderne trækkes med det samme. Det kan ikke fortrydes (men du kan reroll\'e bagefter).', label: 'Afslut nu' })) { const r = await api('POST', evPath('end'), { confirm: true }); toast(r.winners.length ? `Vindere: ${r.winners.length}` : 'Afsluttet – ingen gyldig vinder'); refresh(); } };
ACT.evCancel = async () => { if (await confirmDialog({ title: 'Annullér giveaway', text: 'Der trækkes ingen vindere.', label: 'Annullér' })) { await api('POST', evPath('cancel'), { confirm: true }); toast('Giveawayet er annulleret'); refresh(); } };
ACT.evStop = async () => { if (await confirmDialog({ title: 'Stop talevent', text: 'Tallet afsløres i kanalen og eventet lukkes.', label: 'Stop' })) { await api('POST', G(`/numberevents/${encodeURIComponent(S.cur.event.code)}/stop`), { confirm: true }); toast('Eventet er stoppet'); refresh(); } };
ACT.evDelete = async () => { if (await confirmDialog({ title: 'Slet event', text: `<b>${esc(S.cur.event.code)}</b> og alle tilhørende entries og vindere slettes permanent. Handlingen logges.`, label: 'Slet permanent' })) { await api('DELETE', G(`/events/${encodeURIComponent(S.cur.event.code)}`), { confirm: true }); toast('Eventet er slettet'); location.hash = '#/' + F.eventBack; } };

ACT.evEdit = () => {
  const ev = S.cur.event, cfg = ev.config || {};
  modal({
    title: `Rediger ${ev.code}`, wide: true,
    body: `<div class="fg">${field('Præmie', `<input class="input" id="x_prize" maxlength="250" value="${esc(ev.prize)}">`)}${field('Antal vindere', `<input class="input" id="x_win" type="number" min="1" max="50" value="${ev.winnerCount}">`)}${field('Ny tid til slut (fra nu)', '<input class="input" id="x_ends" placeholder="Fx 2t – tomt = uændret">', ev.status === 'PAUSED' ? 'Det er den resterende tid.' : '')}</div>${advancedForm(cfg, true)}`,
    actions: [{ label: 'Annuller', close: true }, { label: 'Gem ændringer', cls: 'pri', run: async (c) => {
      await api('PATCH', G(`/giveaways/${encodeURIComponent(ev.code)}`), { prize: val(c, 'x_prize'), winnerCount: nz(val(c, 'x_win')), endsIn: val(c, 'x_ends') || undefined, config: collectAdvanced(c, true) });
      c.close(); toast('Ændringerne er gemt'); refresh();
    } }],
  });
};

ACT.evReroll = () => {
  const ev = S.cur.event, valid = S.cur.winners.filter((w) => w.status === 'VALID');
  modal({
    title: `Reroll ${ev.code}`,
    body: `${field('Antal nye vindere', '<input class="input" id="r_n" type="number" min="1" max="50" value="1">')}${field('Erstat en bestemt vinder (valgfrit)', `<select class="select" id="r_rep"><option value="">Ingen – træk ekstra vindere</option>${valid.map((w) => `<option value="${esc(w.userId)}">${esc(S.cur.users[w.userId]?.username || w.userId)} (#${w.place})</option>`).join('')}</select>`)}${toggle('r_rej', 'Tillad tidligere afviste brugere', false)}`,
    actions: [{ label: 'Annuller', close: true }, { label: 'Reroll', cls: 'pri', run: async (c) => {
      if (!(await confirmDialog({ title: 'Reroll vindere', text: 'Der trækkes nye vindere, og de bliver annonceret i kanalen.', label: 'Ja, reroll', danger: false }))) return;
      const r = await api('POST', evPath('reroll'), { confirm: true, count: nz(val(c, 'r_n')), replaceUserId: val(c, 'r_rep') || undefined, allowRejected: chk(c, 'r_rej') });
      c.close(); toast(`Nye vindere: ${r.winners.length}`); refresh();
    } }],
  });
};
ACT.evNReroll = () => {
  const ev = S.cur.event, valid = S.cur.winners.filter((w) => w.status === 'VALID');
  modal({
    title: `Reroll ${ev.code}`,
    body: `<p style="margin-bottom:14px;color:var(--muted)">Vinderen diskvalificeres og eventet genåbnes, så den næste der skriver det rigtige tal vinder pladsen.</p>${field('Hvilken vinder?', `<select class="select" id="rn_u">${valid.map((w) => `<option value="${esc(w.userId)}">#${w.place} ${esc(S.cur.users[w.userId]?.username || w.userId)}</option>`).join('')}</select>`)}${field('Genåbnes i', '<input class="input" id="rn_d" value="5m">')}${field('Årsag', '<input class="input" id="rn_r" maxlength="300" placeholder="Fx snyd / forlod serveren">')}`,
    actions: [{ label: 'Annuller', close: true }, { label: 'Genåbn event', cls: 'pri', run: async (c) => {
      if (!(await confirmDialog({ title: 'Genåbn talevent', text: 'Vinderen diskvalificeres.', label: 'Genåbn' }))) return;
      await api('POST', G(`/numberevents/${encodeURIComponent(ev.code)}/reroll`), { confirm: true, userId: val(c, 'rn_u'), duration: val(c, 'rn_d'), reason: val(c, 'rn_r') });
      c.close(); toast('Eventet er genåbnet'); refresh();
    } }],
  });
};

/* ================= ENTRIES (manuel) ================= */
async function entryForm(pre = {}) {
  const list = await api('GET', G('/events' + qs({ type: 'GIVEAWAY', pageSize: 100 })));
  const open = list.items.filter((e) => ['ACTIVE', 'PAUSED', 'SCHEDULED'].includes(e.status));
  return modal({
    title: 'Ret entries manuelt',
    body: `<p style="color:var(--muted);margin-bottom:14px">Alle ændringer logges med admin, før/efter, årsag og tidspunkt.</p>
    ${field('Giveaway', `<select class="select" id="m_code">${open.map((e) => `<option value="${esc(e.code)}"${pre.code === e.code ? ' selected' : ''}>${esc(e.code)} — ${esc(e.prize)}</option>`).join('') || '<option value="">Ingen aktive giveaways</option>'}</select>`)}
    ${field('Bruger-ID', `<input class="input" id="m_user" inputmode="numeric" placeholder="Fx 123456789012345678" value="${esc(pre.userId || '')}">`, 'Højreklik på brugeren i Discord → Kopiér bruger-ID.')}
    <div class="fg">${field('Handling', '<select class="select" id="m_mode"><option value="add">Tilføj</option><option value="remove">Fjern</option><option value="set">Sæt til</option></select>')}${field('Antal', '<input class="input" id="m_amt" type="number" min="0" value="1">')}</div>
    ${field('Årsag', '<input class="input" id="m_reason" maxlength="300" placeholder="Fx manuel belønning">')}`,
    actions: [{ label: 'Annuller', close: true }, { label: 'Gem ændring', cls: 'pri', run: async (c) => {
      const mode = val(c, 'm_mode'), body = { code: val(c, 'm_code'), userId: val(c, 'm_user'), mode, amount: Number(val(c, 'm_amt')), reason: val(c, 'm_reason') };
      if (mode !== 'add') { if (!(await confirmDialog({ title: mode === 'remove' ? 'Fjern entries' : 'Sæt entries', text: `${mode === 'remove' ? 'Fjern' : 'Sæt til'} <b>${body.amount}</b> entries for bruger <b>${esc(body.userId)}</b> i <b>${esc(body.code)}</b>?`, label: 'Bekræft' }))) return; body.confirm = true; }
      const r = await api('POST', G('/entries'), body);
      c.close(); toast(`Entries opdateret: ${r.before} → ${r.after}`); if (location.hash.startsWith('#/entries') || location.hash.startsWith('#/users') || location.hash.startsWith('#/event')) refresh();
    } }],
  });
}
ACT.entryModal = () => entryForm();
P.entries = async () => {
  setAfter(loadEntryLog);
  F.el = F.el || { page: 1 };
  return header('Entries', 'Manuelle ændringer – kun højadmins og ejere', `${exportLink('entries', 'Eksportér')}<button class="btn pri" data-act="entryModal">${icon('plus')} Ret entries</button>`) +
    `<div class="card" style="margin-bottom:16px"><b>Sådan fungerer det</b><p style="color:var(--muted);margin-top:4px">Brugere optjener kun entries ved at deltage i giveaways, eller når en højadmin/ejer ændrer dem manuelt. Der findes <b>ingen køb</b> af entries. Hver ændring står i loggen herunder og i din log-kanal.</p></div><div id="L"></div>`;
};
async function loadEntryLog() {
  const d = await api('GET', G('/logs' + qs({ category: 'ENTRY', page: F.el.page })));
  fill('L', logTable(d) + pager(d, 'elPage'));
}
ACT.elPage = (p) => { F.el.page = Number(p); loadEntryLog(); };
