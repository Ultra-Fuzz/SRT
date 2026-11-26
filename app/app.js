import { RESORTS, weatherPoint } from './resorts.js';
import {
  TZ, isoDate, addDays, fmtDate, fmtDrive, localHour, haversineKm, mergePrefs, DEFAULT_PREFS,
  SKY, codeInfo, fetchWeather, fetchDriveTable, driveTo, sectorOf, noPistes,
  dayCrowd, crowdLabel, MAX, grade, rankDay, DANGER, PROBLEM, ASPECTS, bulletinFor, dangerZone,
} from './core.js';
import { VAPID_PUBLIC_KEY } from './push-config.js';

/* ------------------------------------------------------------------ helpers */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem('sst.' + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('sst.' + key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  },
};

const fmtClock = (ts) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(ts));
const fmtTemp = (t) => { if (t == null) return '–'; const r = Math.round(t); return (r < 0 ? '−' : '') + Math.abs(r) + '°'; };
const fmtCm = (v) => (v == null ? '–' : `${Math.round(v)} cm`);
const fmtM = (v) => `${Math.round(v).toLocaleString('en')} m`;
const fmtAgo = (ts) => {
  const min = Math.round((Date.now() - new Date(ts).getTime()) / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} days ago`;
};

/* -------------------------------------------------------------------- state */

const state = {
  status: store.get('status', null),     // data/status.json
  wx: store.get('wx', null),             // { fetchedAt, day, byId }
  av: store.get('av', null),             // data/avalanche.json
  holidays: store.get('holidays', null), // holidays.json
  pos: store.get('pos', null),           // { lat, lon, label, gps }
  drive: store.get('drive', null),       // { key, byId }
  prefs: mergePrefs(store.get('prefs', null)),
  favs: new Set(store.get('favs', [])),
  log: store.get('log', []),             // ski days: [{ date, id }]
  watch: store.get('watch', {}),         // watched lifts: { resortId: [lift names] }
  seen: store.get('seen', {}),           // last known state of watched lifts
  changes: store.get('changes', []),     // [{ id, name, s, at }]
  day: localHour() >= 16 ? 1 : 0,        // once the lifts have stopped, tomorrow is the day to look at
  sort: store.get('sort', 'score'),
  openOnly: store.get('openOnly', false),
  favOnly: false,
  view: 'resorts',
  detail: null,
  busy: false,
  errors: {},
  map: { slope: store.get('mapSlope', 'angle'), pistes: store.get('mapPistes', false), sat: false, focus: null },
};

const today = () => isoDate(new Date());
const dayDates = () => Array.from({ length: 6 }, (_, i) => addDays(today(), i));
const selectedDate = () => dayDates()[state.day];
const dayWord = (i = state.day) => (i === 0 ? 'today' : i === 1 ? 'tomorrow' : fmtDate(dayDates()[i], { weekday: 'long' }));
// identifies a set of cached drive times: where from, and to how many valley stations
const ACCESS_COUNT = RESORTS.reduce((n, r) => n + r.access.length, 0);
const posKey = (p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}|${ACCESS_COUNT}`;
const driveTable = () => (state.pos && state.drive?.key === posKey(state.pos) ? state.drive.byId : null);
const savePrefs = () => { store.set('prefs', state.prefs); };

function compute() {
  return rankDay(selectedDate(), {
    status: state.status, weather: state.wx?.byId, holidays: state.holidays,
    pos: state.pos, driveTable: driveTable(), prefs: state.prefs, todayIso: today(),
  });
}

/* ------------------------------------------------------------------ loading */

async function loadWeather(force = false) {
  const fresh = state.wx && Date.now() - state.wx.fetchedAt < 20 * 60000 && state.wx.day === today();
  if (fresh && !force) return;
  const day = today();
  state.wx = { fetchedAt: Date.now(), day, byId: await fetchWeather(day) };
  store.set('wx', state.wx);
}

async function loadStatus() {
  const res = await fetch('data/status.json', { cache: 'no-store' });
  if (!res.ok) throw new Error('Lift data returned ' + res.status);
  state.status = await res.json();
  store.set('status', state.status);
  checkWatched();
}

async function loadAvalanche() {
  const res = await fetch('data/avalanche.json', { cache: 'no-store' });
  if (!res.ok) return;
  state.av = await res.json();
  store.set('av', state.av);
}

async function loadHolidays() {
  if (state.holidays?.to >= today() && state.holidays.loadedOn === today()) return;
  const res = await fetch('holidays.json');
  if (!res.ok) return;
  state.holidays = { ...(await res.json()), loadedOn: today() };
  store.set('holidays', state.holidays);
}

async function loadDrive() {
  const pos = state.pos;
  if (!pos) return;
  const key = posKey(pos);
  if (state.drive?.key === key) return;
  const byId = await fetchDriveTable(pos);
  if (state.pos && posKey(state.pos) === key) {
    state.drive = { key, byId };
    store.set('drive', state.drive);
  }
}

/* -------------------------------------------------------------- lift watching */

const watchKey = (id, name) => `${id}|${name}`;
const isWatched = (id, name) => (state.watch[id] || []).includes(name);

function toggleWatch(id, name) {
  const list = new Set(state.watch[id] || []);
  if (list.has(name)) list.delete(name); else list.add(name);
  if (list.size) state.watch[id] = [...list]; else delete state.watch[id];
  store.set('watch', state.watch);
  const lift = state.status?.resorts?.[id]?.liftList?.find((l) => l.n === name);
  if (lift) { state.seen[watchKey(id, name)] = lift.s; store.set('seen', state.seen); }
}

/** After every lift report: did one of the watched lifts open or close since we last looked? */
function checkWatched() {
  const seen = {};
  for (const [id, names] of Object.entries(state.watch)) {
    const lifts = state.status?.resorts?.[id]?.liftList || [];
    for (const name of names) {
      const lift = lifts.find((l) => l.n === name);
      if (!lift) continue;
      const key = watchKey(id, name), before = state.seen[key];
      seen[key] = lift.s;
      if (before != null && before !== lift.s) {
        state.changes = [{ id, name, s: lift.s, at: Date.now() }, ...state.changes.filter((c) => !(c.id === id && c.name === name))].slice(0, 8);
      }
    }
  }
  state.seen = seen;
  store.set('seen', seen);
  store.set('changes', state.changes);
}

/* ---------------------------------------------------------------- rendering */

const crowdCls = (c) => (c < 0.25 ? 'c1' : c < 0.45 ? 'c2' : c < 0.7 ? 'c3' : 'c4');

function renderDays() {
  $('#days').innerHTML = dayDates().map((d, i) => {
    const crowd = dayCrowd(d, state.holidays).level;
    return `<button class="day${i === state.day ? ' on' : ''}" data-day="${i}" aria-pressed="${i === state.day}">
      <b>${i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDate(d, { weekday: 'short' })}</b>
      <span><i class="dot ${crowdCls(crowd)}" title="${crowdLabel(crowd)}"></i>${fmtDate(d, { day: 'numeric', month: 'short' })}</span></button>`;
  }).join('');
}

function renderUpdated() {
  const bits = [];
  if (state.status?.generatedAt) bits.push(`Lifts ${fmtAgo(state.status.generatedAt)}`);
  if (state.wx?.fetchedAt) bits.push(`Weather ${fmtClock(state.wx.fetchedAt)}`);
  $('#updated').textContent = state.busy ? 'Updating…' : bits.join(' · ') || 'No data yet';

  const notes = [];
  if (!navigator.onLine) notes.push('You are offline – showing the last saved data.');
  else {
    if (state.errors.status) notes.push(state.status ? 'Could not refresh lift data – showing the last saved report.' : 'Live lift data is not available right now.');
    if (state.errors.wx) notes.push(state.wx ? 'Could not refresh the weather – showing the last saved forecast.' : 'The weather forecast is not available right now.');
  }
  if (state.status?.generatedAt && Date.now() - new Date(state.status.generatedAt).getTime() > 3 * 3600000) {
    notes.push(`The lift report is ${fmtAgo(state.status.generatedAt).replace(' ago', '')} old.`);
  }
  const el = $('#notice');
  el.hidden = !notes.length;
  el.textContent = notes.join(' ');
}

function renderChanges() {
  const el = $('#changes');
  el.hidden = !state.changes.length;
  if (!state.changes.length) return;
  el.innerHTML = `<div class="changes-head"><b>Watched lifts</b><button id="changes-clear">Dismiss</button></div>` +
    state.changes.map((c) => {
      const r = RESORTS.find((x) => x.id === c.id);
      return `<button class="change ${c.s ? 'on' : 'off'}" data-id="${c.id}"><i></i><span><b>${esc(c.name)}</b> ${c.s ? 'opened' : 'closed'}</span><small>${esc(r?.short || '')} · ${fmtClock(c.at)}</small></button>`;
    }).join('');
}

const approx = (trip) => (trip.exact ? '' : '≈ ');
const tripHtml = (trip) => (trip ? `<span class="trip"><b>${approx(trip)}${fmtDrive(trip.min)}</b><small>${trip.km != null ? trip.km + ' km' : ''}</small></span>` : '');
const badgeCls = (op) => (op.open ? (op.planned && op.share == null ? 'soon' : 'open') : 'shut');

function liftsText(st, op) {
  if (!st?.lifts) return 'No lift data';
  if (op?.open && op.share == null) return 'season opens, lifts not confirmed';
  return `${st.lifts.open}/${st.lifts.total} lifts`;
}

function avBadge(b, small = false) {
  if (!b) return '';
  const d = DANGER[b.max];
  return `<span class="av${small ? ' small' : ''}" style="background:${d.bg};color:${d.fg}" title="Avalanche danger: ${d.label}">${small ? '▲ ' : ''}${b.max}</span>`;
}

function renderDayline() {
  const date = selectedDate();
  const crowd = dayCrowd(date, state.holidays);
  $('#dayline').innerHTML = `<b>${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</b>
    <span class="crowd ${crowdCls(crowd.level)}">${crowdLabel(crowd.level)} slopes expected</span>${crowd.why.length ? `<small>${esc(crowd.why.join(' · '))}</small>` : ''}`;
}

function renderPicks(rows) {
  const usable = rows.filter((x) => x.op.open && x.sc && !x.tooFar);
  const cards = [];
  const add = (tag, row, line) => {
    const hit = cards.find((c) => c.row === row);
    if (hit) hit.tags.push(tag); else cards.push({ tags: [tag], row, line });
  };
  if (!state.wx && !state.status) { $('#picks').innerHTML = ''; return; }
  if (!usable.length) {
    const limit = state.prefs.maxDrive ? ` within ${fmtDrive(state.prefs.maxDrive)}` : '';
    $('#picks').innerHTML = `<div class="pick empty"><b>No resort${limit} reports open lifts ${dayWord()}.</b><span>Pick another day above to see what is planned.</span></div>`;
    return;
  }
  const best = [...usable].sort((a, b) => b.sc.total - a.sc.total)[0];
  add('Best conditions', best, best.sc.why.slice(0, 3).join(' · '));
  if (state.pos) {
    const near = [...usable].sort((a, b) => a.trip.min - b.trip.min)[0];
    add('Closest open', near, `${approx(near.trip)}${fmtDrive(near.trip.min)} to ${near.trip.name}`);
    const combo = [...usable].sort((a, b) => b.combo - a.combo)[0];
    add('Best nearby', combo, `${grade(combo.sc.total).label} conditions, ${approx(combo.trip)}${fmtDrive(combo.trip.min)} away`);
  }
  // on a busy day, point out the best of the smaller resorts
  const busy = dayCrowd(selectedDate(), state.holidays).level >= 0.45;
  const quiet = busy ? [...usable].filter((x) => x.r.km < 60 && x.sc.total >= 45).sort((a, b) => b.sc.total - a.sc.total)[0] : null;
  if (quiet) add('Quieter choice', quiet, `small resort, ${crowdLabel(quiet.crowd).toLowerCase()} even on a busy day`);

  let html = cards.map(({ tags, row, line }) => {
    const g = grade(row.sc.total);
    const facts = [`${row.w ? SKY[row.w.sky].icon : ''} ${fmtTemp(row.w?.temp)}`, liftsText(row.st, row.op)];
    if (row.trip) facts.push(`${approx(row.trip)}${fmtDrive(row.trip.min)}`);
    return `<button class="pick" data-id="${row.r.id}">
      <span class="pick-tags">${tags.map((t) => `<em>${t}</em>`).join('')}<i>${dayWord()}</i></span>
      <span class="pick-main">
        <span class="score ${g.cls}">${row.sc.total}</span>
        <span class="pick-text"><b>${esc(row.r.short)}</b><span>${esc(line)}</span>
          <span class="pick-facts">${facts.join(' · ')}</span>
          ${row.go ? `<span class="pick-go">Leave by <b>${row.go.leave}</b> for the ${row.go.firstLift} lift</span>` : ''}
        </span>
      </span>
    </button>`;
  }).join('');
  if (!state.pos) {
    html += `<button class="pick hint" data-action="location"><b>Where are you?</b><span>Set your location to see the closest resort, drive times, when to leave and the best option nearby.</span></button>`;
  }
  $('#picks').innerHTML = html;
}

function sortRows(rows) {
  const by = {
    score: (a, b) => (b.op.open - a.op.open) || ((b.sc?.total ?? -1) - (a.sc?.total ?? -1)),
    near: (a, b) => ((a.trip?.min ?? 1e9) - (b.trip?.min ?? 1e9)) || a.r.short.localeCompare(b.r.short),
    combo: (a, b) => (b.op.open - a.op.open) || ((b.combo ?? -999) - (a.combo ?? -999)),
  }[state.sort];
  return [...rows].sort(by);
}

function renderList(rows) {
  let shown = sortRows(rows);
  if (state.openOnly) shown = shown.filter((x) => x.op.open);
  if (state.favOnly) shown = shown.filter((x) => state.favs.has(x.r.id));
  if (state.prefs.maxDrive && state.pos) shown = shown.filter((x) => !x.tooFar);
  const limit = state.prefs.maxDrive && state.pos ? ` · within ${fmtDrive(state.prefs.maxDrive)}` : '';
  $('#count').textContent = `${shown.length} of ${rows.length}${limit}`;

  if (!shown.length) {
    $('#list').innerHTML = `<p class="empty-list">${state.favOnly && !state.favs.size ? 'No favourites yet – open a resort and tap the star.' : 'No resorts match these filters.'}</p>`;
    return;
  }
  const date = selectedDate();
  $('#list').innerHTML = shown.map(({ r, st, w, op, sc, trip }) => {
    const g = sc ? grade(sc.total) : null;
    const share = st?.lifts?.total ? st.lifts.open / st.lifts.total : 0;
    const facts = [];
    if (w) facts.push(`${SKY[w.sky].icon} ${fmtTemp(w.temp)}`);
    if (st?.snowDepthCm != null) facts.push(`${Math.round(st.snowDepthCm)} cm base`);
    if (w && w.fresh48 >= 1) facts.push(`+${Math.round(w.fresh48)} cm new`);
    if (w && w.gust >= 40) facts.push(`💨 ${w.gust} km/h`);
    if (noPistes(st)) facts.push('no pistes reported open');
    const b = bulletinFor(state.av, r.id, date);
    if (b && b.max >= 3) facts.push(avBadge(b, true));
    const skied = state.log.some((d) => d.id === r.id);
    return `<button class="card${op.open ? '' : ' closed'}" data-id="${r.id}">
      <span class="score ${g ? g.cls : 'g0'}">${sc ? sc.total : '–'}</span>
      <span class="card-main">
        <span class="card-title">${state.favs.has(r.id) ? '<i class="star">★</i> ' : ''}${esc(r.short)}${skied ? ' <i class="tick" title="Skied this season">✓</i>' : ''}</span>
        <span class="card-status"><span class="badge ${badgeCls(op)}">${esc(op.label)}</span>${liftsText(st, op)}${st?.pistes?.total && !(op.open && op.share == null) ? ` · ${st.pistes.open}/${st.pistes.total} pistes` : ''}</span>
        <span class="bar"><span style="width:${Math.round(share * 100)}%"></span></span>
        <span class="card-facts">${facts.join(' · ')}</span>
      </span>
      ${tripHtml(trip)}
    </button>`;
  }).join('');
}

/* ------------------------------------------------------------------- detail */

function liftType(t) {
  const chair = t.match(/^chairlift(\d)/);
  if (chair) return `${chair[1]}-seat chairlift`;
  if (t === '3s-gondola') return '3S gondola';
  if (/ropeway|gondola/.test(t)) return 'Gondola';
  if (t === 'cablecar') return 'Cable car';
  if (t === 'funicular') return 'Funicular';
  if (/combi|kombi/.test(t)) return 'Chair/gondola combi';
  if (t === 'draglift') return 'Drag lift';
  if (/conveyor/.test(t)) return 'Magic carpet';
  if (/babylift/.test(t)) return 'Beginner lift';
  return 'Lift';
}
const pisteColour = (t) => (/difficult/.test(t) ? 'black' : /medium/.test(t) ? 'red' : /easy/.test(t) ? 'blue' : /skiroute/.test(t) ? 'route' : 'plain');
const pisteLabel = { black: 'Black', red: 'Red', blue: 'Blue', route: 'Ski route', plain: 'Piste' };

function facilityList(items, kind, id) {
  const sectors = [...new Set(items.map((x) => x.r))];
  const row = (x) => {
    const dot = kind === 'piste' ? `<i class="pdot ${pisteColour(x.t)}"></i>` : '';
    const type = kind === 'piste' ? pisteLabel[pisteColour(x.t)] : kind === 'lift' ? liftType(x.t) : '';
    const watch = kind === 'lift'
      ? `<button class="watch" data-watch="${esc(x.n)}" aria-pressed="${isWatched(id, x.n)}" aria-label="Watch ${esc(x.n)}"><svg viewBox="0 0 24 24"><path d="M6 9a6 6 0 1 1 12 0c0 6 2.500 7 2.500 7h-17S6 15 6 9zM10 19.500a2.200 2.200 0 0 0 4 0"/></svg></button>` : '';
    return `<li class="${x.s ? 'on' : 'off'}">${dot}<span class="f-name">${esc(x.n)}</span><span class="f-type">${type}</span><span class="f-state">${x.s ? 'Open' : 'Closed'}</span>${watch}</li>`;
  };
  return sectors.map((sec) => {
    const part = items.filter((x) => x.r === sec).sort((a, b) => b.s - a.s);
    const head = sectors.length > 1 ? `<li class="f-sector">${esc(sec || 'Other')} <span>${part.filter((x) => x.s).length}/${part.length}</span></li>` : '';
    return head + part.map(row).join('');
  }).join('');
}

/** Small compass rose with the dangerous aspects filled in. */
function aspectRose(aspects, color) {
  const on = new Set(aspects);
  const wedges = ASPECTS.map((a, i) => {
    const a0 = ((i * 45 - 22.5 - 90) * Math.PI) / 180, a1 = ((i * 45 + 22.5 - 90) * Math.PI) / 180;
    const p = (ang) => `${(20 + 17 * Math.cos(ang)).toFixed(1)},${(20 + 17 * Math.sin(ang)).toFixed(1)}`;
    return `<path d="M20,20 L${p(a0)} A17,17 0 0 1 ${p(a1)} Z" fill="${on.has(a) ? color : 'none'}" stroke="currentColor" stroke-opacity=".35" stroke-width=".8"/>`;
  }).join('');
  return `<svg class="rose" viewBox="0 0 40 40" role="img" aria-label="Aspects: ${aspects.join(', ')}">${wedges}<text x="20" y="6.500" text-anchor="middle">N</text></svg>`;
}

const band = (x) => {
  const tl = x.treeline ? ' (treeline)' : '';
  if (x.above != null && x.below != null) return `${fmtM(x.above)} – ${fmtM(x.below)}`;
  if (x.above != null) return `above ${fmtM(x.above)}${tl}`;
  if (x.below != null) return `below ${fmtM(x.below)}${tl}`;
  return 'all elevations';
};

function avalancheHtml(r, date) {
  const info = state.av?.resorts?.[r.id];
  const b = bulletinFor(state.av, r.id, date);
  if (!b) {
    const why = info === null ? 'This area is not covered by an avalanche warning service.'
      : 'No bulletin has been published for this area yet – most services start their daily reports in December.';
    return `<h3>Avalanche danger</h3><div class="panel"><p class="muted">${why}</p>
      <button class="secondary" data-action="map">Show slope angles on the map</button></div>`;
  }
  const d = DANGER[b.max];
  const ratings = [...(b.ratings || [])].sort((x, y) => (y.above ?? -1) - (x.above ?? -1));
  return `<h3>Avalanche danger <small>${b.exact ? '' : 'latest bulletin, '}${fmtDate(b.date, { weekday: 'short', day: 'numeric', month: 'short' })}</small></h3>
    <div class="panel avpanel">
      <div class="av-head">
        <span class="av big" style="background:${d.bg};color:${d.fg}">${b.max}</span>
        <div><b>${d.label}</b><span class="muted">${esc(info?.regionName || '')}</span></div>
      </div>
      ${ratings.length > 1 || ratings[0]?.above != null || ratings[0]?.below != null ? `<ul class="av-bands">${ratings.map((x) =>
        `<li><span class="av" style="background:${DANGER[x.level].bg};color:${DANGER[x.level].fg}">${x.level}</span>${band(x)}${x.period ? ` · ${x.period === 'am' ? 'morning' : 'afternoon'}` : ''}</li>`).join('')}</ul>` : ''}
      ${(b.problems || []).map((p) => `<div class="av-problem">${p.aspects?.length ? aspectRose(p.aspects, d.bg) : ''}
        <div><b>${esc(PROBLEM[p.type] || p.type.replace(/_/g, ' '))}</b><span>${p.aspects?.length === 8 ? 'all aspects' : p.aspects?.length ? 'facing ' + p.aspects.join(', ') : ''}${p.aspects?.length ? ' · ' : ''}${band(p)}</span></div></div>`).join('')}
      ${b.highlight ? `<p class="av-text">${esc(b.highlight)}</p>` : ''}
      <button class="primary" data-action="map">Show the affected slopes on the map</button>
      <a class="secondary" href="${esc(b.url)}" target="_blank" rel="noopener">Read the official bulletin</a>
      <p class="muted small">The danger level applies off-piste. Open, marked pistes are secured by the resort.</p>
    </div>`;
}

function renderDetail(row) {
  if (!row) return;
  const { r, st, wx, w, op, sc, trip, crowd, go } = row;
  const date = selectedDate();
  $('#detail-title').textContent = r.short;
  $('#detail-fav').setAttribute('aria-pressed', String(state.favs.has(r.id)));

  const g = sc ? grade(sc.total) : null;
  const labels = { lifts: 'Lifts running', snow: 'Snow', sky: 'Sky & visibility', wind: 'Wind', temp: 'Temperature', quiet: 'Quiet slopes' };
  const parts = sc ? Object.keys(MAX).filter((k) => sc.parts[k].max > 0).map((k) => [labels[k], sc.parts[k].pts * sc.scale, sc.parts[k].max * sc.scale]) : [];
  const stat = (label, value, sub = '') => `<div class="stat"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
  const now = wx?.now;
  const nowInfo = now ? codeInfo(now.code, now.isDay) : null;
  const depth = st?.snowDepthCm ?? null;
  const day = dayCrowd(date, state.holidays);

  const forecast = (wx?.days || []).map((d, i) => `
    <button class="fc${d.date === date ? ' on' : ''}" data-day="${i}">
      <b>${i === 0 ? 'Today' : fmtDate(d.date, { weekday: 'short' })}</b>
      <span class="fc-icon">${SKY[d.sky].icon}</span>
      <span>${fmtTemp(d.tMax)} <small>${fmtTemp(d.tMin)}</small></span>
      <span class="fc-snow">${d.snowDay >= 0.5 ? '❄ ' + Math.round(d.snowDay) + ' cm' : '&nbsp;'}</span>
      <small>💨 ${d.gust}</small>
      <small>☀ ${Math.round(d.sun)} h</small>
    </button>`).join('');

  const table = driveTable();
  const access = r.access
    .map((a) => ({ a, drive: state.pos ? driveTo(r, a, state.pos, table) : null, sec: sectorOf(a, st) }))
    .sort((x, y) => (x.drive?.min ?? 0) - (y.drive?.min ?? 0));
  const accessHtml = access.map(({ a, drive, sec }) => {
    const running = sec ? `<small class="${sec.liftsOpen ? 'run' : ''}">${sec.liftsOpen}/${sec.lifts} lifts here</small>` : '';
    const dist = drive ? `${approx(drive)}${fmtDrive(drive.min)}${drive.km != null ? ` · ${drive.km} km` : ''}` : '';
    return `<li class="${trip && trip.name === a.name ? 'pick-row' : ''}"><span class="f-name">${esc(a.name)}${running}</span><span class="f-type">${dist}</span>
      <a class="nav" href="https://maps.apple.com/?daddr=${a.lat},${a.lon}&dirflg=d" target="_blank" rel="noopener">Navigate</a></li>`;
  }).join('');

  const lifts = st?.liftList || [], pistes = st?.pisteList || [], other = st?.otherList || [];
  const cams = st?.webcams || [];
  const season = st?.season;
  const loggedToday = state.log.some((d) => d.id === r.id && d.date === today());
  const daysHere = state.log.filter((d) => d.id === r.id).length;
  const watched = state.watch[r.id] || [];

  $('#detail-body').innerHTML = `
    <div class="hero">
      <div class="hero-top">
        <span class="score big ${g ? g.cls : 'g0'}">${sc ? sc.total : '–'}</span>
        <div>
          <h2>${esc(r.name)}</h2>
          <p class="muted">${esc(r.state)} · ${r.base.toLocaleString('en')}–${r.top.toLocaleString('en')} m · ${r.km} km of pistes${r.glacier ? ' · glacier' : ''}</p>
          <p><span class="badge ${badgeCls(op)}">${esc(op.label)}</span> ${g ? `<b>${g.label}</b> ${dayWord()}` : ''}</p>
        </div>
      </div>
      ${sc ? `<p class="why">${esc(sc.why.join(' · '))}</p>` : ''}
      ${go ? `<p class="go">🚗 Leave by <b>${go.leave}</b> to be on the ${go.firstLift} lift <small>${approx(trip)}${fmtDrive(trip.min)} drive to ${esc(trip.name)}${go.traffic ? ` + ${go.traffic} min busy-day margin` : ''} + ${state.prefs.buffer} min to park and get ready</small></p>` : ''}
      ${st?.lifts?.conflict ? '<p class="warn">The resort’s feed is contradicting itself right now – double-check on its own site.</p>' : ''}
      ${noPistes(st) ? '<p class="warn">Lifts are running but no piste is reported open – this may be sightseeing or training operation only.</p>' : ''}
      ${st && st.ok === false ? '<p class="warn">This resort could not be refreshed – showing the last known report.</p>' : ''}
      <div class="hero-actions">
        <button class="secondary" data-action="map">Terrain map</button>
        <button class="secondary${loggedToday ? ' done' : ''}" data-action="log">${loggedToday ? '✓ Skied today' : 'I skied here today'}</button>
      </div>
      ${daysHere ? `<p class="muted small">${daysHere} ski ${daysHere === 1 ? 'day' : 'days'} here this season.</p>` : ''}
    </div>

    <div class="stats">
      ${stat('Lifts open', st?.lifts ? `${st.lifts.open}<i>/${st.lifts.total}</i>` : '–', state.day ? 'as of today' : '')}
      ${stat('Pistes open', st?.pistes?.total ? `${st.pistes.open}<i>/${st.pistes.total}</i>` : '–', state.day ? 'as of today' : '')}
      ${stat('Snow depth', fmtCm(depth), depth == null ? 'not reported' : 'on the mountain')}
      ${stat('New snow', w ? fmtCm(w.fresh48) : '–', 'last 48 h')}
      ${stat('Right now', now ? `${nowInfo.icon} ${fmtTemp(now.temp)}` : '–', now ? `feels ${fmtTemp(now.feels)} · ${wx.elev.toLocaleString('en')} m` : '')}
      ${stat('Crowds', `<span class="crowd ${crowdCls(crowd)}">${crowdLabel(crowd)}</span>`, day.why[0] ? esc(day.why[0]) : 'ordinary weekday')}
    </div>

    ${w ? `<h3>Skiing hours ${dayWord()} <small>08–16 h at ${wx.elev.toLocaleString('en')} m</small></h3>
    <div class="stats">
      ${stat('Weather', `${SKY[w.sky].icon}`, SKY[w.sky].label)}
      ${stat('Temperature', fmtTemp(w.temp), `${fmtTemp(w.tMin)} to ${fmtTemp(w.tMax)} all day`)}
      ${stat('Max gusts', `${w.gust}<i> km/h</i>`, w.gust >= 60 ? 'lift closures likely' : w.gust >= 40 ? 'breezy up top' : 'calm')}
      ${stat('Snowfall', fmtCm(w.snowSki), 'while skiing')}
      ${stat('Sunshine', `${Math.round(w.sun)}<i> h</i>`, `${w.cloud}% cloud`)}
      ${stat('Freezing level', w.frz != null ? `${w.frz.toLocaleString('en')}<i> m</i>` : '–', w.frz != null && w.frz > r.base ? 'above the valley' : 'below the valley')}
    </div>` : '<p class="muted">No forecast available.</p>'}

    ${sc ? `<h3>Why ${sc.total}/100?</h3><div class="parts">${parts.map(([label, v, max]) =>
      `<div class="part"><span>${label}</span><span class="part-bar"><span style="width:${Math.round((v / max) * 100)}%"></span></span><b>${Math.round(v)}<i>/${Math.round(max)}</i></b></div>`).join('')}</div>` : ''}

    ${forecast ? `<h3>6-day outlook</h3><div class="forecast">${forecast}</div>` : ''}

    ${avalancheHtml(r, date)}

    <h3>Getting there</h3>
    <ul class="flist access">${accessHtml}</ul>

    ${(st?.sectors || []).length > 1 ? `<h3>Areas</h3><ul class="flist">${st.sectors.map((s) =>
      `<li class="${s.liftsOpen ? 'on' : 'off'}"><span class="f-name">${esc(s.name)}</span><span class="f-type">${s.pistes ? `${s.pistesOpen}/${s.pistes} pistes` : ''}</span><span class="f-state">${s.liftsOpen}/${s.lifts} lifts</span></li>`).join('')}</ul>` : ''}

    ${lifts.length ? `<details${watched.length ? ' open' : ''}><summary>Lifts <span>${lifts.filter((x) => x.s).length} of ${lifts.length} open${watched.length ? ` · ${watched.length} watched` : ''}</span></summary>
      <p class="hint-row">Tap the bell on a lift you depend on – the app tells you when it opens or closes.</p>
      <ul class="flist">${facilityList(lifts, 'lift', r.id)}</ul></details>` : ''}
    ${pistes.length ? `<details><summary>Pistes <span>${pistes.filter((x) => x.s).length} of ${pistes.length} open</span></summary><ul class="flist">${facilityList(pistes, 'piste', r.id)}</ul></details>` : ''}
    ${other.length ? `<details><summary>Touring, toboggan &amp; parks <span>${other.filter((x) => x.s).length} of ${other.length} open</span></summary><ul class="flist">${facilityList(other, 'other', r.id)}</ul></details>` : ''}
    ${cams.length ? `<details class="cams"><summary>Webcams <span>${cams.length}</span></summary><div class="cam-grid">${cams.map((c) =>
      `<a href="${esc(c.link || c.image)}" target="_blank" rel="noopener noreferrer"><img loading="lazy" referrerpolicy="no-referrer" src="${esc(c.image)}" alt=""><span>${esc(c.title || c.location)}</span></a>`).join('')}</div></details>` : ''}

    <div class="foot">
      ${season ? `<p>Season ${fmtDate(season.start, { day: 'numeric', month: 'short', year: 'numeric' })} – ${fmtDate(season.end, { day: 'numeric', month: 'short', year: 'numeric' })}${season.note ? `<br><span class="muted">${esc(season.note)}</span>` : ''}</p>` : ''}
      <a class="secondary" href="${esc(st?.source || 'https://www.superskicard.com/de/' + r.slug + '.html')}" target="_blank" rel="noopener">Open on superskicard.com</a>
    </div>`;
}

/* ---------------------------------------------------------------------- map */

let mapApi = null, mapLoading = null, zoneKey = '', zoneFn = null;
const mapPoint = (r) => r.wx || r.access[0];

function terrainInfo(t) {
  const steep = t.slope >= 30;
  const zone = t.inZone == null ? '' : t.inZone && steep
    ? '<span class="tz in">Matches the bulletin’s danger zone</span>'
    : steep ? '<span class="tz">Steep, but outside the bulletin’s main aspects/elevations</span>' : '';
  return `<div class="terrain"><b>${Math.round(t.slope)}°</b> slope · faces ${t.aspectName} · ${fmtM(t.elev)}${zone}
    ${steep ? '' : '<span class="tz">Under 30° – can still be reached by slides from steeper ground above</span>'}</div>`;
}

async function ensureMap() {
  if (mapApi) return mapApi;
  mapLoading ||= (async () => {
    const { createMap } = await import('./map.js');
    const api = await createMap($('#map'), { onPick: showDetail, onInfo: terrainInfo });
    api.map.on('moveend', renderMapOverlay);
    mapApi = api;
    return api;
  })().catch((err) => { mapLoading = null; throw err; });
  return mapLoading;
}

/** Bulletin of the resort the map is looking at -> which slopes to highlight, plus the legend. */
function renderMapOverlay() {
  if (!mapApi) return;
  const c = mapApi.map.getCenter(), here = { lat: c.lat, lon: c.lng };
  const near = [...RESORTS].sort((a, b) => haversineKm(here, mapPoint(a)) - haversineKm(here, mapPoint(b)))[0];
  const b = bulletinFor(state.av, near.id, selectedDate());
  const key = `${near.id}|${b?.date}|${b?.max}`;
  if (key !== zoneKey) { zoneKey = key; zoneFn = dangerZone(b); }
  const mode = state.map.slope;
  mapApi.setSlope(mode, zoneFn);

  $$('#map-slope button').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.slope === mode)));
  $('#map-pistes').setAttribute('aria-pressed', String(state.map.pistes));
  $('#map-sat').setAttribute('aria-pressed', String(state.map.sat));

  const swatches = '<span class="sw" style="background:#ffde00"></span>30–35°<span class="sw" style="background:#ff8a00"></span>35–40°<span class="sw" style="background:#e02020"></span>40–45°<span class="sw" style="background:#8c28af"></span>45°+';
  let head, body;
  if (mode === 'off') { head = 'Slope shading is off'; body = 'Switch on “Slope angle” to see how steep the terrain is.'; }
  else if (mapApi.map.getZoom() < 12) { head = '<b>Zoom in</b> on a mountain to see its slope angles'; body = 'Slope shading appears from about village level.'; }
  else if (mode === 'zones' && b && zoneFn) {
    const d = DANGER[b.max];
    head = `<span class="av" style="background:${d.bg};color:${d.fg}">${b.max}</span> <b>${d.label}</b> · ${esc(near.short)} ${b.exact ? dayWord() : fmtDate(b.date, { day: 'numeric', month: 'short' })}`;
    body = 'Vivid colours: steep slopes at the aspects and elevations the bulletin warns about. Faded: other steep slopes.';
  } else if (mode === 'zones') { head = `No bulletin for ${esc(near.short)} yet`; body = 'Showing every steep slope instead. Most services start their daily bulletins in December.'; }
  else { head = '<b>Slope angle</b>'; body = 'Most skier-triggered avalanches start on slopes of 30° or more.'; }
  const old = $('#map-legend details');
  const open = old ? old.open : !store.get('legendSeen', false);
  $('#map-legend').innerHTML = `<details${open ? ' open' : ''}><summary><span>${head}</span>${mode !== 'off' ? `<span class="sws">${swatches}</span>` : ''}</summary>
    <div>${body}<small>Tap the map for the angle, aspect and height of a spot. An aid for planning – not a replacement for the official bulletin, training and your own judgement.</small></div></details>`;
  $('#map-legend details').addEventListener('toggle', () => store.set('legendSeen', true));
}

function renderMap(rows) {
  if (!mapApi) return;
  mapApi.setPins(rows.map(({ r, sc, op }) => ({
    id: r.id, name: r.short, lat: mapPoint(r).lat, lon: mapPoint(r).lon,
    cls: sc && op.open ? grade(sc.total).cls : 'g0', text: sc ? sc.total : '–',
  })));
  mapApi.setUser(state.pos);
  mapApi.setPistes(state.map.pistes);
  mapApi.setBase(state.map.sat ? 'sat' : 'topo');
  renderMapOverlay();
}

async function showMap(focusId) {
  switchView('map');
  try {
    const api = await ensureMap();
    api.resize();
    if (focusId) {
      const p = mapPoint(RESORTS.find((r) => r.id === focusId));
      api.focus(p.lat, p.lon, 13);
      if (state.map.slope === 'off') state.map.slope = 'angle';
    }
    render();
  } catch {
    $('#map-legend').innerHTML = '<div>The map could not be loaded – it needs an internet connection.</div>';
  }
}

/* ------------------------------------------------------------------- season */

function renderSeason() {
  const el = $('#view-season');
  const days = [...state.log].sort((a, b) => b.date.localeCompare(a.date));
  const dates = new Set(days.map((d) => d.date));
  const visited = new Set(days.map((d) => d.id));
  const price = state.prefs.cardPrice;
  const perDay = price && dates.size ? price / dates.size : null;
  const todo = RESORTS.filter((r) => !visited.has(r.id));
  const name = (id) => RESORTS.find((r) => r.id === id)?.short || id;
  const euro = (v) => '€' + (v >= 100 ? Math.round(v).toLocaleString('en') : v.toFixed(2));
  const counts = [...visited].map((id) => ({ id, n: days.filter((d) => d.id === id).length })).sort((a, b) => b.n - a.n);
  const focused = document.activeElement?.id;

  el.innerHTML = `
    <div class="stats three">
      <div class="stat"><span>Ski days</span><b>${dates.size}</b><small>this season</small></div>
      <div class="stat"><span>Resorts</span><b>${visited.size}<i>/${RESORTS.length}</i></b><small>skied so far</small></div>
      <div class="stat"><span>Cost per day</span><b>${perDay ? euro(perDay) : '–'}</b><small>${price ? `card: ${euro(price)}` : 'enter card price'}</small></div>
    </div>

    <h3>Your season card</h3>
    <div class="panel form">
      <label>What you paid for the card (€) <input id="card-price" type="number" inputmode="decimal" min="0" step="1" value="${price ?? ''}" placeholder="e.g. 999"></label>
      ${perDay ? `<p class="muted small">Every further ski day lowers this: ${euro(price / (dates.size + 1))} after your next day, ${euro(price / (dates.size + 5))} after five more.</p>` : ''}
    </div>

    <h3>Add a ski day</h3>
    <form class="panel form" id="log-form">
      <label>Date <input id="log-date" type="date" value="${today()}" max="${today()}"></label>
      <label>Resort <select id="log-resort">${[...RESORTS].sort((a, b) => a.short.localeCompare(b.short)).map((r) => `<option value="${r.id}">${esc(r.short)}</option>`).join('')}</select></label>
      <button class="primary" type="submit">Add ski day</button>
    </form>

    ${days.length ? `<h3>Ski days <small>${days.length}</small></h3>
      <ul class="flist">${days.map((d) => `<li><span class="f-name">${esc(name(d.id))}</span><span class="f-type">${fmtDate(d.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
        <button class="del" data-del="${d.date}|${d.id}" aria-label="Remove">✕</button></li>`).join('')}</ul>` : ''}

    ${counts.length > 1 ? `<h3>Most skied</h3><ul class="flist">${counts.slice(0, 5).map((c) => `<li><span class="f-name">${esc(name(c.id))}</span><span class="f-state">${c.n} ${c.n === 1 ? 'day' : 'days'}</span></li>`).join('')}</ul>` : ''}

    <h3>Not skied yet <small>${todo.length}</small></h3>
    ${todo.length ? `<div class="todo">${todo.map((r) => `<button class="chip" data-id="${r.id}">${esc(r.short)}</button>`).join('')}</div>` : '<p class="muted">You have skied every resort on the card. 🎉</p>'}`;
  if (focused === 'card-price') { const i = $('#card-price'); i.focus(); i.setSelectionRange?.(i.value.length, i.value.length); }
}

function logDay(date, id) {
  if (!date || !id || state.log.some((d) => d.date === date && d.id === id)) return;
  state.log.push({ date, id });
  store.set('log', state.log);
}
function unlogDay(date, id) {
  state.log = state.log.filter((d) => !(d.date === date && d.id === id));
  store.set('log', state.log);
}

/* ----------------------------------------------------------------- settings */

const WEIGHTS = [
  ['snow', 'Fresh snow & depth'], ['sky', 'Sunshine'], ['lifts', 'Lots of lifts open'], ['quiet', 'Quiet slopes'], ['drive', 'Short drive'],
];
const weightWord = (v) => (v === 0 ? 'Ignore' : v < 1 ? 'Less' : v === 1 ? 'Normal' : v < 2 ? 'More' : 'Most');

function renderSettings() {
  const p = state.prefs;
  if (!$('#weights').childElementCount) {
    $('#weights').innerHTML = WEIGHTS.map(([key, label]) =>
      `<label class="slider"><span>${label}<b id="w-${key}-out"></b></span><input type="range" min="0" max="2" step="0.5" data-weight="${key}"></label>`).join('');
  }
  for (const [key] of WEIGHTS) {
    $(`[data-weight="${key}"]`).value = p.weights[key];
    $(`#w-${key}-out`).textContent = weightWord(p.weights[key]);
  }
  $('#set-maxdrive').value = String(p.maxDrive);
  $('#set-firstlift').value = p.firstLift;
  $('#set-buffer').value = String(p.buffer);
  $('#al-evening').checked = p.alerts.evening;
  $('#al-morning').checked = p.alerts.morning;
  $('#al-lifts').checked = p.alerts.lifts;
  $('#al-powder').value = String(p.alerts.powderCm);
  $('#al-score').value = String(p.alerts.minScore);
  renderPush();
}

/* ------------------------------------------------------------ notifications */

const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
let pushSub = null;

/** Everything the scheduled job needs to send this phone its alerts (saved as a GitHub secret). */
function alertCode(sub) {
  const p = state.prefs;
  const cfg = {
    v: 1,
    sub,
    home: state.pos ? { lat: +state.pos.lat.toFixed(2), lon: +state.pos.lon.toFixed(2) } : null,
    prefs: { weights: p.weights, maxDrive: p.maxDrive, firstLift: p.firstLift, buffer: p.buffer, alerts: p.alerts },
    watch: state.watch,
  };
  return btoa(unescape(encodeURIComponent(JSON.stringify(cfg))));
}

async function renderPush() {
  const status = $('#push-status'), btn = $('#btn-push'), box = $('#push-code');
  if (!VAPID_PUBLIC_KEY) {
    status.textContent = 'Notifications are switched on when the app is published (a key pair is created in that step).';
    btn.hidden = true; box.hidden = true; return;
  }
  if (!pushSupported()) {
    status.textContent = 'To get notifications on an iPhone, add this app to your Home Screen (Share → Add to Home Screen) and open it from there.';
    btn.hidden = true; box.hidden = true; return;
  }
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    pushSub = (await reg?.pushManager.getSubscription()) || null;
  } catch { pushSub = null; }
  if (!pushSub) {
    status.textContent = Notification.permission === 'denied'
      ? 'Notifications are blocked for this app. Allow them in the iPhone Settings → Notifications → Ski Tracker.'
      : 'Get a tip when the snow is good, and a heads-up when a lift you watch opens or closes.';
    btn.hidden = Notification.permission === 'denied'; box.hidden = true; return;
  }
  const code = alertCode(pushSub.toJSON());
  status.textContent = 'Notifications are on for this phone.';
  btn.hidden = true; box.hidden = false;
  $('#push-code-text').value = code;
  const copied = store.get('alertCode', null);
  $('#push-code-stale').hidden = !copied || copied === code;
}

async function enablePush() {
  const status = $('#push-status');
  try {
    if ((await Notification.requestPermission()) !== 'granted') { renderPush(); return; }
    const reg = await navigator.serviceWorker.ready;
    const key = Uint8Array.from(atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    pushSub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  } catch {
    status.textContent = 'Could not switch notifications on. Open the app from the Home Screen icon and try again.';
    return;
  }
  renderPush();
}

/* -------------------------------------------------------------------- views */

const TITLES = { resorts: 'Ski Tracker', map: 'Terrain map', season: 'My season', settings: 'Settings' };

function switchView(view) {
  state.view = view;
  document.body.dataset.view = view;
  for (const v of Object.keys(TITLES)) $('#view-' + v).hidden = v !== view;
  $$('#tabbar button').forEach((b) => { if (b.dataset.view === view) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  $('#view-title').textContent = TITLES[view];
  window.scrollTo(0, 0);
}

function render() {
  renderDays();
  renderUpdated();
  const rows = compute();
  if (state.view === 'resorts') {
    renderChanges();
    renderDayline();
    renderPicks(rows);
    renderList(rows);
    $$('#sort button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sort === state.sort)));
    $('#chip-open').setAttribute('aria-pressed', String(state.openOnly));
    $('#chip-fav').setAttribute('aria-pressed', String(state.favOnly));
  }
  if (state.view === 'map') renderMap(rows);
  if (state.view === 'season') renderSeason();
  if (state.view === 'settings') renderSettings();
  $('#btn-location').classList.toggle('active', !!state.pos);
  $('#btn-refresh').classList.toggle('spin', state.busy);
  if (state.detail) renderDetail(rows.find((x) => x.r.id === state.detail));
  const src = state.av?.sources;
  if (src?.length) $('#av-sources').innerHTML = src.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a>`).join(', ');
}

/* -------------------------------------------------------------------- sheets */

function openSheet(id) {
  const el = $('#' + id);
  if (!el.hidden) return;
  el.hidden = false;
  $('.sheet-body', el).scrollTop = 0;
  document.body.classList.add('sheet-open');
  history.pushState({ sheet: id }, '');
}
function closeSheets() {
  $$('.sheet').forEach((s) => { s.hidden = true; });
  document.body.classList.remove('sheet-open');
  state.detail = null;
}
const back = () => (history.state?.sheet ? history.back() : closeSheets());
window.addEventListener('popstate', closeSheets);

function showDetail(id) {
  state.detail = id;
  render();
  openSheet('detail');
}

function showLocation() {
  const p = state.pos;
  $('#location-current').textContent = p ? `Currently using: ${p.label}` : 'No location set yet.';
  $('#gps-msg').textContent = '';
  $('#place-results').innerHTML = '';
  openSheet('location');
}

/* ------------------------------------------------------------------ location */

function setPos(pos) {
  state.pos = pos;
  store.set('pos', pos);
  render();
  loadDrive().then(render).catch(() => { /* estimated drive times stay in place */ });
}

function locate(silent = false) {
  const msg = (t) => { if (!silent) $('#gps-msg').textContent = t; };
  if (!navigator.geolocation) { msg('Location is not available in this browser.'); return; }
  msg('Finding you…');
  navigator.geolocation.getCurrentPosition(
    (p) => {
      setPos({ lat: p.coords.latitude, lon: p.coords.longitude, label: 'Current location', gps: true });
      if (!silent) back();
    },
    (err) => msg(err.code === 1
      ? 'Location access was declined. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using.'
      : 'Could not determine your location. Try again outdoors or search for a place below.'),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 5 * 60000 },
  );
}

async function searchPlace(query) {
  const box = $('#place-results');
  box.innerHTML = '<p class="muted small">Searching…</p>';
  try {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=${encodeURIComponent(query)}`);
    const hits = (await res.json()).results || [];
    if (!hits.length) { box.innerHTML = '<p class="muted small">Nothing found – try a nearby town.</p>'; return; }
    box.innerHTML = hits.map((h, i) =>
      `<button class="place" data-i="${i}"><b>${esc(h.name)}</b><span>${esc([h.admin1, h.country].filter(Boolean).join(', '))}</span></button>`).join('');
    box.onclick = (e) => {
      const b = e.target.closest('.place');
      if (!b) return;
      const h = hits[+b.dataset.i];
      setPos({ lat: h.latitude, lon: h.longitude, label: h.name, gps: false });
      back();
    };
  } catch {
    box.innerHTML = '<p class="muted small">Search is not available right now.</p>';
  }
}

/* ------------------------------------------------------------------- refresh */

async function refresh(force = false) {
  if (state.busy) return;
  state.busy = true;
  render();
  const run = (name, job) => job.then(() => { delete state.errors[name]; }, (e) => { state.errors[name] = e.message || 'failed'; }).then(render);
  await Promise.all([
    run('status', loadStatus()),
    run('wx', loadWeather(force)),
    run('drive', loadDrive()),
    run('av', loadAvalanche()),
    run('holidays', loadHolidays()),
  ]);
  state.busy = false;
  render();
}

/* -------------------------------------------------------------------- events */

$('#days').addEventListener('click', (e) => {
  const b = e.target.closest('[data-day]');
  if (b) { state.day = +b.dataset.day; render(); }
});
$('#tabbar').addEventListener('click', (e) => {
  const b = e.target.closest('[data-view]');
  if (!b) return;
  if (b.dataset.view === 'map') showMap(); else { switchView(b.dataset.view); render(); }
});
$('#sort').addEventListener('click', (e) => {
  const b = e.target.closest('[data-sort]');
  if (!b) return;
  state.sort = b.dataset.sort;
  store.set('sort', state.sort);
  render();
  if (state.sort !== 'score' && !state.pos) showLocation();
});
$('#chip-open').addEventListener('click', () => { state.openOnly = !state.openOnly; store.set('openOnly', state.openOnly); render(); });
$('#chip-fav').addEventListener('click', () => { state.favOnly = !state.favOnly; render(); });
for (const id of ['picks', 'list', 'changes']) {
  $('#' + id).addEventListener('click', (e) => {
    if (e.target.closest('#changes-clear')) { state.changes = []; store.set('changes', []); render(); return; }
    const b = e.target.closest('[data-id], [data-action]');
    if (!b) return;
    if (b.dataset.action === 'location') showLocation(); else showDetail(b.dataset.id);
  });
}

$('#detail-body').addEventListener('click', (e) => {
  const id = state.detail;
  const day = e.target.closest('[data-day]');
  if (day) { state.day = +day.dataset.day; render(); return; }
  const watch = e.target.closest('[data-watch]');
  if (watch) { e.preventDefault(); toggleWatch(id, watch.dataset.watch); watch.setAttribute('aria-pressed', String(isWatched(id, watch.dataset.watch))); return; }
  const act = e.target.closest('[data-action]');
  if (!act) return;
  if (act.dataset.action === 'map') {
    if (bulletinFor(state.av, id, selectedDate())) state.map.slope = 'zones';
    closeSheets();
    if (history.state?.sheet) history.replaceState(null, '');
    showMap(id);
  } else if (act.dataset.action === 'log') {
    if (state.log.some((d) => d.id === id && d.date === today())) unlogDay(today(), id); else logDay(today(), id);
    render();
  }
});
$('#detail-close').addEventListener('click', back);
$('#location-close').addEventListener('click', back);
$('#detail-fav').addEventListener('click', () => {
  const id = state.detail;
  if (!id) return;
  if (state.favs.has(id)) state.favs.delete(id); else state.favs.add(id);
  store.set('favs', [...state.favs]);
  render();
});

$('#map-chips').addEventListener('click', (e) => {
  const s = e.target.closest('[data-slope]');
  if (s) { state.map.slope = s.dataset.slope; store.set('mapSlope', state.map.slope); }
  if (e.target.closest('#map-pistes')) { state.map.pistes = !state.map.pistes; store.set('mapPistes', state.map.pistes); }
  if (e.target.closest('#map-sat')) state.map.sat = !state.map.sat;
  render();
});

$('#view-season').addEventListener('submit', (e) => {
  e.preventDefault();
  logDay($('#log-date').value, $('#log-resort').value);
  render();
});
$('#view-season').addEventListener('click', (e) => {
  const del = e.target.closest('[data-del]');
  if (del) { const [date, id] = del.dataset.del.split('|'); unlogDay(date, id); render(); return; }
  const chip = e.target.closest('[data-id]');
  if (chip) showDetail(chip.dataset.id);
});
$('#view-season').addEventListener('change', (e) => {
  if (e.target.id !== 'card-price') return;
  const v = parseFloat(e.target.value);
  state.prefs.cardPrice = Number.isFinite(v) && v > 0 ? v : null;
  savePrefs();
  render();
});

$('#view-settings').addEventListener('input', (e) => {
  const w = e.target.dataset?.weight;
  if (!w) return;
  state.prefs.weights[w] = +e.target.value;
  $(`#w-${w}-out`).textContent = weightWord(+e.target.value);
  savePrefs();
});
$('#view-settings').addEventListener('change', (e) => {
  const p = state.prefs, t = e.target;
  if (t.id === 'set-maxdrive') p.maxDrive = +t.value;
  else if (t.id === 'set-firstlift') p.firstLift = t.value || DEFAULT_PREFS.firstLift;
  else if (t.id === 'set-buffer') p.buffer = +t.value;
  else if (t.id === 'al-evening') p.alerts.evening = t.checked;
  else if (t.id === 'al-morning') p.alerts.morning = t.checked;
  else if (t.id === 'al-lifts') p.alerts.lifts = t.checked;
  else if (t.id === 'al-powder') p.alerts.powderCm = +t.value;
  else if (t.id === 'al-score') p.alerts.minScore = +t.value;
  else if (!t.dataset?.weight) return;
  savePrefs();
  renderPush();
});
$('#btn-push').addEventListener('click', enablePush);

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
$('#btn-copy-code').addEventListener('click', async () => {
  const code = $('#push-code-text').value;
  const ok = await copyText(code);
  if (!ok) { $('#push-code-text').select(); }
  store.set('alertCode', code);
  $('#btn-copy-code').textContent = ok ? 'Copied ✓' : 'Select all and copy';
  $('#push-code-stale').hidden = true;
});
$('#btn-export').addEventListener('click', async () => {
  const data = JSON.stringify({ app: 'ski-tracker', v: 1, prefs: state.prefs, favs: [...state.favs], log: state.log, watch: state.watch });
  const ok = await copyText(data);
  if (!ok) $('#import-text').value = data;
  $('#backup-msg').textContent = ok ? 'Backup copied – paste it into a note or an e-mail to yourself.' : 'Copy the text in the box above and keep it somewhere safe.';
});
$('#btn-import').addEventListener('click', () => {
  try {
    const d = JSON.parse($('#import-text').value);
    if (d.app !== 'ski-tracker') throw new Error('not a backup');
    state.prefs = mergePrefs(d.prefs); savePrefs();
    state.favs = new Set(d.favs || []); store.set('favs', [...state.favs]);
    state.log = (d.log || []).filter((x) => x.date && RESORTS.some((r) => r.id === x.id)); store.set('log', state.log);
    state.watch = d.watch || {}; store.set('watch', state.watch);
    $('#import-text').value = '';
    $('#backup-msg').textContent = 'Backup restored.';
    render();
  } catch {
    $('#backup-msg').textContent = 'That does not look like a Ski Tracker backup.';
  }
});

$('#btn-location').addEventListener('click', showLocation);
$('#btn-refresh').addEventListener('click', () => refresh(true));
$('#btn-gps').addEventListener('click', () => locate(false));
$('#place-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#place-input').value.trim();
  if (q.length >= 2) searchPlace(q);
});
window.addEventListener('online', () => refresh());
window.addEventListener('offline', render);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const age = state.status?.generatedAt ? Date.now() - new Date(state.status.generatedAt).getTime() : Infinity;
  if (age > 10 * 60000) refresh();
});

// keep the map's height in step with the header (day strip) and tab bar
const fitMap = () => {
  document.documentElement.style.setProperty('--top-h', $('#top').offsetHeight + 'px');
  mapApi?.resize();
};
new ResizeObserver(fitMap).observe($('#top'));
window.addEventListener('resize', fitMap);

/* --------------------------------------------------------------------- start */

if (history.state?.sheet) history.replaceState(null, '');
switchView('resorts');
render();
refresh();
if (state.pos?.gps) locate(true);   // follow the phone as it moves

const local = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator && (!local || new URLSearchParams(location.search).has('sw'))) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* app still works without offline support */ });
}
