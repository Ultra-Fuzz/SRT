// Logic shared by the app (browser) and the alert job (Node): weather digest, operating
// status, conditions score, crowd estimate, leave-by time. No DOM, no storage in here.

import { RESORTS, weatherPoint } from './resorts.js';

export const TZ = 'Europe/Vienna';
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const round1 = (v) => (v == null ? null : Math.round(v * 10) / 10);
export const isoDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
export const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const fmtDate = (iso, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts }).format(new Date(iso + 'T12:00:00Z'));
export const localHour = (d = new Date()) => +new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(d);
export const fmtDrive = (min) => { const m = Math.round(min); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`; };
export const fmtHM = (minutes) => { const m = ((Math.round(minutes) % 1440) + 1440) % 1440; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };

export function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/* ------------------------------------------------------------- preferences */

export const DEFAULT_PREFS = {
  // how much each ingredient matters to you: 0 = ignore, 1 = normal, 2 = double
  weights: { snow: 1, sky: 1, lifts: 1, quiet: 1, drive: 1 },
  maxDrive: 0,            // minutes; 0 = no limit
  firstLift: '08:30',     // when you want to be on the first lift
  buffer: 30,             // minutes for parking, boots, ticket gate
  cardPrice: null,        // what the season card cost, for the cost-per-day figure
  alerts: { morning: true, evening: true, powderCm: 10, minScore: 75, lifts: true },
};

export function mergePrefs(saved) {
  const p = saved || {};
  return {
    ...DEFAULT_PREFS, ...p,
    weights: { ...DEFAULT_PREFS.weights, ...(p.weights || {}) },
    alerts: { ...DEFAULT_PREFS.alerts, ...(p.alerts || {}) },
  };
}

/* ------------------------------------------------------------------ weather */

// q = how good this sky is for skiing, 0..1
export const SKY = {
  sunny:     { icon: '☀️', label: 'Sunny', q: 1 },
  partly:    { icon: '🌤️', label: 'Mostly sunny', q: 0.84 },
  cloudy:    { icon: '⛅', label: 'Partly cloudy', q: 0.6 },
  overcast:  { icon: '☁️', label: 'Overcast', q: 0.4 },
  fog:       { icon: '🌫️', label: 'Fog / low cloud', q: 0.2 },
  snow:      { icon: '🌨️', label: 'Light snowfall', q: 0.48 },
  heavysnow: { icon: '❄️', label: 'Heavy snowfall', q: 0.28 },
  rain:      { icon: '🌧️', label: 'Rain', q: 0.04 },
  storm:     { icon: '⛈️', label: 'Thunderstorm', q: 0 },
};

export function codeInfo(code, isDay = 1) {
  if (code == null) return { icon: '·', label: '' };
  if (code === 0) return { icon: isDay ? '☀️' : '🌙', label: 'Clear' };
  if (code === 1) return { icon: isDay ? '🌤️' : '🌙', label: 'Mostly clear' };
  if (code === 2) return { icon: '⛅', label: 'Partly cloudy' };
  if (code === 3) return { icon: '☁️', label: 'Overcast' };
  if (code === 45 || code === 48) return { icon: '🌫️', label: 'Fog' };
  if (code >= 95) return { icon: '⛈️', label: 'Thunderstorm' };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { icon: '🌨️', label: 'Snow' };
  return { icon: '🌧️', label: code <= 57 ? 'Drizzle' : 'Rain' };
}

function classifySky({ codes, sunFrac, temp, snowSki, rainSki }) {
  const isSnow = (c) => (c >= 71 && c <= 77) || c === 85 || c === 86;
  const isRain = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 82);
  const snowH = codes.filter(isSnow).length, rainH = codes.filter(isRain).length;
  const fogH = codes.filter((c) => c === 45 || c === 48).length;
  if (codes.some((c) => c >= 95)) return 'storm';
  // the model reports rain for its own grid height; at a freezing summit that falls as snow
  const wet = rainH >= 3 && rainSki >= 1;
  if (wet && temp > 0.5) return 'rain';
  if (snowH >= 3 || wet) return snowSki >= 8 ? 'heavysnow' : 'snow';
  // Fog codes describe the model's grid cell, which is often the valley floor. If the sun is
  // forecast to shine at the same time, the fog lies below the pistes (a classic inversion day).
  if (fogH >= 4 && sunFrac < 0.3) return 'fog';
  if (sunFrac >= 0.75) return 'sunny';
  if (sunFrac >= 0.5) return 'partly';
  if (sunFrac >= 0.2) return 'cloudy';
  return 'overcast';
}

function summarise(loc, todayIso) {
  const h = loc.hourly, d = loc.daily;
  const at = new Map(h.time.map((t, i) => [t, i]));
  const vals = (arr, i0, i1) => arr.slice(Math.max(0, i0), i1 + 1).filter((v) => v != null);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const mean = (a) => (a.length ? sum(a) / a.length : null);
  const max = (a) => (a.length ? Math.max(...a) : null);

  const dates = [...new Set(h.time.map((t) => t.slice(0, 10)))].filter((x) => x >= todayIso).slice(0, 6);
  const days = dates.map((date) => {
    const a = at.get(`${date}T08:00`), b = at.get(`${date}T16:00`);   // skiing hours
    if (a == null || b == null) return null;
    const di = d.time.indexOf(date);
    const temp = mean(vals(h.temperature_2m, a, b));
    const cloud = mean(vals(h.cloud_cover, a, b)) ?? 50;
    const snowSki = sum(vals(h.snowfall, a + 1, b));
    const rainSki = sum(vals(h.rain, a + 1, b));
    const depths = vals(h.snow_depth, a - 6, a);
    const frz = mean(vals(h.freezing_level_height, a, b));
    const sunSki = sum(vals(h.sunshine_duration, a + 1, b)) / 3600;      // hours of sun, 08-16 h
    return {
      date,
      temp: round1(temp),
      tMax: round1(d.temperature_2m_max[di]),
      tMin: round1(d.temperature_2m_min[di]),
      cloud: Math.round(cloud),
      gust: Math.round(max(vals(h.wind_gusts_10m, a, b)) ?? 0),
      fresh48: round1(sum(vals(h.snowfall, a - 47, a))),       // 48 h up to 08:00
      snowSki: round1(snowSki),
      snowDay: round1(d.snowfall_sum[di] ?? 0),
      rainSki: round1(rainSki),
      depth: depths.length ? Math.round(depths[depths.length - 1] * 100) : null,
      frz: frz == null ? null : Math.round(frz / 50) * 50,
      sun: round1(Math.max(sunSki, (d.sunshine_duration[di] ?? 0) / 3600)),
      sky: classifySky({ codes: vals(h.weather_code, a, b), sunFrac: sunSki / 8, temp: temp ?? 0, snowSki, rainSki }),
    };
  }).filter(Boolean);

  const c = loc.current || {};
  return {
    elev: Math.round(loc.elevation),
    now: {
      temp: round1(c.temperature_2m), feels: round1(c.apparent_temperature), code: c.weather_code, isDay: c.is_day,
      wind: Math.round(c.wind_speed_10m ?? 0), gust: Math.round(c.wind_gusts_10m ?? 0),
    },
    days,
  };
}

/** One request for the mountain forecast of every resort; returns { resortId: digest }. */
export async function fetchWeather(todayIso) {
  const pts = RESORTS.map(weatherPoint);
  const params = new URLSearchParams({
    latitude: pts.map((p) => p.lat).join(','),
    longitude: pts.map((p) => p.lon).join(','),
    elevation: pts.map((p) => p.elev).join(','),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,wind_gusts_10m',
    hourly: 'temperature_2m,weather_code,cloud_cover,sunshine_duration,wind_gusts_10m,snowfall,rain,snow_depth,freezing_level_height',
    daily: 'temperature_2m_max,temperature_2m_min,sunshine_duration,snowfall_sum',
    past_days: '2', forecast_days: '6', timezone: TZ, wind_speed_unit: 'kmh',
  });
  const res = await fetch('https://api.open-meteo.com/v1/forecast?' + params);
  if (!res.ok) throw new Error('Weather service returned ' + res.status);
  const json = await res.json();
  const list = Array.isArray(json) ? json : [json];
  const byId = {};
  RESORTS.forEach((r, i) => { if (list[i]) byId[r.id] = summarise(list[i], todayIso); });
  return byId;
}

/* ------------------------------------------------------ getting to a resort */

/** Live lift count for the area a valley station belongs to (null if the report has no such area). */
export function sectorOf(access, st) {
  if (!access.sector || !st?.sectors?.length) return null;
  const re = new RegExp(access.sector, 'i');
  const hits = st.sectors.filter((s) => re.test(s.name));
  if (!hits.length) return null;
  return { lifts: hits.reduce((n, s) => n + s.lifts, 0), liftsOpen: hits.reduce((n, s) => n + s.liftsOpen, 0) };
}

/** Valley stations worth driving to: the ones whose lifts run today, where the report says so. */
export function usableAccess(r, st) {
  if (!st?.lifts?.open) return r.access;
  const running = r.access.filter((a) => sectorOf(a, st)?.liftsOpen > 0);
  return running.length ? running : r.access;
}

/** Drive times from one position to every valley station (public OSRM router, one request). */
export async function fetchDriveTable(pos) {
  const all = RESORTS.flatMap((r) => r.access.map((a) => ({ id: r.id, a })));
  // the router caps a request at 100 points: keep the three nearest per resort if the list outgrows it
  const cand = all.length <= 99 ? all : RESORTS.flatMap((r) =>
    [...r.access].sort((x, y) => haversineKm(pos, x) - haversineKm(pos, y)).slice(0, 3).map((a) => ({ id: r.id, a })));
  const coords = [`${pos.lon.toFixed(3)},${pos.lat.toFixed(3)}`, ...cand.map((c) => `${c.a.lon},${c.a.lat}`)].join(';');
  const res = await fetch(`https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration,distance`);
  if (!res.ok) throw new Error('Routing service returned ' + res.status);
  const json = await res.json();
  if (json.code !== 'Ok') throw new Error('Routing failed');
  const byId = {};
  cand.forEach((c, i) => {
    const sec = json.durations[0][i + 1], m = json.distances?.[0]?.[i + 1];
    if (sec == null) return;
    (byId[c.id] ||= {})[c.a.name] = { min: Math.round(sec / 60), km: m == null ? null : Math.round(m / 1000) };
  });
  return byId;
}

/** Routed drive to one valley station (from a drive table), or an estimate from the air distance. */
export function driveTo(r, a, pos, table) {
  const routed = table?.[r.id]?.[a.name];
  if (routed) return { ...routed, name: a.name, lat: a.lat, lon: a.lon, exact: true };
  const road = haversineKm(pos, a) * 1.35;
  return { min: Math.round((road / 65) * 60 + 5), km: Math.round(road), name: a.name, lat: a.lat, lon: a.lon, exact: false };
}

/** Quickest drive to a valley station of this resort that is worth going to. */
export function tripTo(r, st, pos, table) {
  if (!pos) return null;
  return usableAccess(r, st).map((a) => driveTo(r, a, pos, table)).sort((x, y) => x.min - y.min)[0];
}

/* ------------------------------------------------------------------- crowds */

// Rough share of the people on Austrian pistes that each region sends when its schools are off.
const HOLIDAY_WEIGHT = {
  'AT-9': 0.07, 'AT-3': 0.05, 'AT-4': 0.05, 'AT-5': 0.04, 'AT-6': 0.04, 'AT-7': 0.03, 'AT-2': 0.02, 'AT-8': 0.005, 'AT-1': 0.005,
  'DE-BY': 0.10, 'DE-BW': 0.04, 'DE-NW': 0.04, 'DE-HE': 0.02, 'DE-NI': 0.012, 'DE-RP': 0.008, 'DE-SN': 0.008, 'DE-BE': 0.008,
  'DE-HH': 0.006, 'DE-SH': 0.005, 'DE-BB': 0.004, 'DE-TH': 0.004, 'DE-ST': 0.004, 'DE-MV': 0.003, 'DE-HB': 0.002, 'DE-SL': 0.002,
  'NL-N': 0.025, 'NL-M': 0.025, 'NL-S': 0.02,
};
const COUNTRY = { AT: 'Austria', DE: 'Germany', NL: 'the Netherlands' };

/** How busy the slopes will be on a date, 0 (empty) .. 1 (packed), from the calendar alone. */
export function dayCrowd(date, holidays) {
  const dow = new Date(date + 'T12:00:00Z').getUTCDay();   // 0 = Sunday
  const weekend = dow === 0 || dow === 6;
  let level = dow === 6 ? 0.5 : dow === 0 ? 0.45 : dow === 5 ? 0.2 : 0.12;
  const why = [];
  if (weekend) why.push('weekend');

  const off = (holidays?.school || []).filter((h) => h.start <= date && date <= h.end);
  const regions = new Set(off.map((h) => h.region));
  let school = 0;
  for (const code of regions) school += HOLIDAY_WEIGHT[code] ?? 0;
  level += school;
  if (school >= 0.02) {      // a single small region on holiday is not worth mentioning
    const perCountry = {};
    for (const code of regions) { const c = code.slice(0, 2); perCountry[c] = (perCountry[c] || 0) + 1; }
    const all = { AT: 9, DE: 16, NL: 3 };
    why.push('school holidays in ' + Object.entries(perCountry)
      .map(([c, n]) => (n >= all[c] ? `all of ${COUNTRY[c]}` : `${n} ${n === 1 ? 'region' : 'regions'} of ${COUNTRY[c]}`)).join(', '));
  }

  for (const h of (holidays?.public || []).filter((x) => x.date === date)) {
    const nationwide = !h.regions;
    const weight = h.country === 'AT' ? (nationwide ? 0.3 : 0.08) : h.country === 'DE' ? (nationwide || h.regions.includes('DE-BY') ? 0.12 : 0.03) : 0;
    if (!weight) continue;
    level += weekend ? weight / 3 : weight;
    if (h.country === 'AT' || nationwide || h.regions.includes('DE-BY')) why.push(`${h.name} (${h.country})`);
  }
  return { level: clamp(level, 0, 1), why };
}

/** Small resorts stay quieter than the famous big ones on the same day. */
export const resortCrowd = (r, dayLevel) => clamp(dayLevel * (r.km >= 150 ? 1 : r.km >= 60 ? 0.85 : 0.65), 0, 1);
export const crowdLabel = (c) => (c < 0.25 ? 'Quiet' : c < 0.45 ? 'Moderate' : c < 0.7 ? 'Busy' : 'Very busy');

/** When to leave home to be on the first lift; busy days get extra time for roads and car parks. */
export function leaveBy(driveMin, dayLevel, prefs) {
  const [h, m] = String(prefs.firstLift || '08:30').split(':').map(Number);
  const traffic = Math.round((driveMin * 0.25 * dayLevel) / 5) * 5;
  const leave = h * 60 + m - (prefs.buffer ?? 30) - driveMin - traffic;
  return { leave: fmtHM(leave), leaveMin: leave, traffic, firstLift: fmtHM(h * 60 + m) };
}

/* --------------------------------------------------------- status + scoring */

export function opStatus(st, date, todayIso) {
  const isToday = date === todayIso;
  const season = st?.season || null;
  const open = st?.lifts?.open ?? 0, total = st?.lifts?.total ?? 0;
  const before = !!season && date < season.start, after = !!season && date > season.end;
  const opens = season ? `Opens ${fmtDate(season.start, { day: 'numeric', month: 'short' })}` : 'Closed';
  if (!st || !st.lifts) return { open: false, unknown: true, label: 'No data' };
  if (after) return { open: false, label: 'Season over' };
  if (open > 0) return { open: true, share: total ? open / total : null, label: 'Open', planned: !isToday };
  if (isToday) return { open: false, label: season && todayIso < season.start ? opens : 'Closed today' };
  // a later day: nothing runs today, but the season will have started by then
  if (season && !before) return { open: true, share: null, label: 'Opening', planned: true };
  return { open: false, label: opens };
}

/** Lifts turn but the resort lists pistes and reports none of them open. */
export const noPistes = (st) => !!st?.lifts?.open && !!st?.pistes?.total && !st.pistes.open;

// Points each ingredient contributes to the 0-100 score when every preference is "normal".
export const MAX = { lifts: 25, snow: 25, sky: 22, wind: 11, temp: 9, quiet: 8 };

/**
 * Conditions score for one resort on one day.
 * w = weather digest for that day, op = opStatus(), crowd = resortCrowd() 0..1, weights = prefs.weights
 */
export function scoreDay(st, w, op, crowd = 0, weights = DEFAULT_PREFS.weights) {
  if (!w) return null;
  // Snow depth: only the resort's own measurement is trusted. The forecast model's depth is
  // for a 2 km grid cell (valley included) and can be far off, so it is only a last resort.
  const reported = st?.snowDepthCm ?? null;
  const base = reported != null ? Math.min(1, reported / 120) : op.open ? 0.5 : Math.min(1, (w.depth ?? 0) / 120);
  const g = w.gust, t = w.temp ?? -5;
  // every ingredient as a 0..1 quality
  const q = {
    snow: 0.67 * Math.min(1, w.fresh48 / 30) ** 0.7 + 0.33 * base,
    sky: SKY[w.sky].q,
    wind: g <= 30 ? 1 : g <= 60 ? 1 - ((g - 30) / 30) * 0.77 : Math.max(0, 0.23 - ((g - 60) / 20) * 0.23),
    temp: t > -2 ? Math.max(0, 1 - (t + 2) / 7) : t < -12 ? Math.max(0.2, 1 - ((-12 - t) / 13) * 0.8) : 1,
    // season opens by then but nothing runs yet: assume a modest early-season operation
    lifts: (op.open ? (op.share != null ? Math.sqrt(op.share) : 0.4) : 0) * (noPistes(st) ? 0.5 : 1),
    quiet: 1 - crowd,
  };
  const wt = { lifts: weights.lifts, snow: weights.snow, sky: weights.sky, wind: 1, temp: 1, quiet: weights.quiet };
  let got = 0, possible = 0;
  const parts = {};
  for (const k of Object.keys(MAX)) {
    const max = MAX[k] * wt[k];
    parts[k] = { pts: q[k] * max, max };
    got += parts[k].pts; possible += max;
  }
  const total = Math.round(clamp((got / possible) * 100, 0, 100));

  const why = [];
  if (w.fresh48 >= 4) why.push(`${Math.round(w.fresh48)} cm fresh`);
  why.push(SKY[w.sky].label.toLowerCase());
  if (g >= 50) why.push(`gusts ${g} km/h`);
  else if (g <= 25) why.push('calm');
  if (t > 2) why.push('mild, soft snow');
  else if (t < -15) why.push('very cold');
  if (op.open && op.share != null && op.share >= 0.6) why.push('most lifts running');
  else if (op.open && op.share != null && op.share < 0.15) why.push('only a few lifts running');
  if (crowd >= 0.7) why.push('expect crowds');
  return { total, parts, scale: 100 / possible, why };
}

export const grade = (s) => (s >= 75 ? { cls: 'g1', label: 'Excellent' } : s >= 60 ? { cls: 'g2', label: 'Good' } : s >= 45 ? { cls: 'g3', label: 'Fair' } : { cls: 'g4', label: 'Poor' });

/**
 * Everything the app and the alert job need to rank the resorts for one day.
 * ctx = { status, weather, holidays, pos, driveTable, prefs, todayIso }
 */
export function rankDay(date, ctx) {
  const prefs = mergePrefs(ctx.prefs);
  const day = dayCrowd(date, ctx.holidays);
  return RESORTS.map((r) => {
    const st = ctx.status?.resorts?.[r.id] || null;
    const wx = ctx.weather?.[r.id] || null;
    const w = wx?.days?.find((x) => x.date === date) || null;
    const op = opStatus(st, date, ctx.todayIso);
    const crowd = resortCrowd(r, day.level);
    const sc = scoreDay(st, w, op, crowd, prefs.weights);
    const trip = tripTo(r, st, ctx.pos, ctx.driveTable);
    const tooFar = !!trip && prefs.maxDrive > 0 && trip.min > prefs.maxDrive;
    // every 5 minutes of driving costs one point (more or less, as you prefer)
    const combo = sc ? sc.total - (trip ? (trip.min / 5) * prefs.weights.drive : 0) : null;
    const go = trip ? leaveBy(trip.min, day.level, prefs) : null;
    return { r, st, wx, w, op, sc, trip, tooFar, combo, crowd, go };
  });
}

/* ---------------------------------------------------------------- avalanche */

export const DANGER = [
  null,
  { label: 'Low', bg: '#ccff66', fg: '#1b2a00' },
  { label: 'Moderate', bg: '#ffff00', fg: '#2a2a00' },
  { label: 'Considerable', bg: '#ff9900', fg: '#2b1700' },
  { label: 'High', bg: '#ff0000', fg: '#ffffff' },
  { label: 'Very high', bg: '#1a1a1a', fg: '#ff3b30' },
];
export const PROBLEM = {
  new_snow: 'New snow', wind_slab: 'Wind slab', persistent_weak_layers: 'Persistent weak layer', wet_snow: 'Wet snow',
  gliding_snow: 'Gliding snow', cornices: 'Cornices', no_distinct_avalanche_problem: 'No distinct problem', favourable_situation: 'Favourable situation',
};
export const ASPECTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

/** The bulletin that applies to a resort on a date (or the newest one, if it is recent enough). */
export function bulletinFor(av, id, date) {
  const list = av?.resorts?.[id]?.bulletins || [];
  if (!list.length) return null;
  const exact = list.find((b) => b.date === date);
  if (exact) return { ...exact, exact: true };
  const earlier = list.filter((b) => b.date < date).pop();
  return earlier && addDays(earlier.date, 1) >= date ? { ...earlier, exact: false } : null;
}

/**
 * Where the bulletin says the danger is: a test (elevation m, aspect index 0..7) -> boolean.
 * Uses the avalanche problems (aspect + elevation band); falls back to the elevation band of the
 * highest rating when a bulletin lists no problems.
 */
export function dangerZone(b) {
  if (!b) return null;
  const probs = (b.problems || []).filter((p) => p.aspects?.length);
  if (probs.length) {
    const rules = probs.map((p) => ({ mask: p.aspects.reduce((m, a) => m | (1 << ASPECTS.indexOf(a)), 0), above: p.above ?? -1e9, below: p.below ?? 1e9 }));
    return (elev, aspect) => rules.some((x) => (x.mask >> aspect) & 1 && elev >= x.above && elev <= x.below);
  }
  const top = [...(b.ratings || [])].sort((x, y) => y.level - x.level)[0];
  if (!top) return null;
  return (elev) => elev >= (top.above ?? -1e9) && elev <= (top.below ?? 1e9);
}
