// Collects the official avalanche bulletin for every SuperSkiCard region and writes
// app/data/avalanche.json.
//
// 1. Each resort's mountain point is matched to its EAWS avalanche micro-region
//    (polygons from regions.avalanches.org).
// 2. The bulletins of the six warning services concerned (Salzburg, Tirol, Kärnten,
//    Steiermark, Oberösterreich, Bayern) are read from the EAWS bulletin collection
//    (CAAML v6 JSON, English) for today and - once published, around 17:00 - tomorrow.
//
// Run locally:   node scripts/fetch-avalanche.mjs
// Options:       --date YYYY-MM-DD   fetch an archived day instead of today
//                --out <path>        write somewhere else than app/data/avalanche.json
//
// No dependencies - needs Node 18+ (built-in fetch).

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESORTS, weatherPoint } from '../app/resorts.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'SkiResortTracker/1.0 (personal season-ticket companion; low-volume)';
const REGIONS_URL = (area) => `https://regions.avalanches.org/micro-regions/${area}_micro-regions.geojson.json`;
const NAMES_URL = 'https://regions.avalanches.org/micro-regions_names/en.json';
const BULLETIN_URL = (area, date) => `https://static.avalanche.report/eaws_bulletins/${date}/${date}-${area}.json`;
const TREELINE_M = 1900;   // stand-in altitude where a bulletin says "treeline"

// Warning services whose territory holds at least one resort.
const SERVICES = {
  'AT-05': { name: 'Lawinenwarndienst Salzburg', url: 'https://lawine.salzburg.at/en' },
  'AT-07': { name: 'Lawinenwarndienst Tirol', url: 'https://avalanche.report' },
  'AT-02': { name: 'Lawinenwarndienst Kärnten', url: 'https://lawinenwarndienst.ktn.gv.at/?lang=en' },
  'AT-06': { name: 'Lawinenwarndienst Steiermark', url: 'https://www.lawine-steiermark.at' },
  'AT-04': { name: 'Lawinenwarndienst Oberösterreich', url: 'https://oberoesterreich.avalanche-warnings.eu' },
  'DE-BY': { name: 'Lawinenwarndienst Bayern', url: 'https://lawinenwarndienst.bayern.de/' },
};

const LEVELS = { low: 1, moderate: 2, considerable: 3, high: 4, very_high: 5 };
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const PERIODS = { earlier: 'am', later: 'pm' };

/* ------------------------------------------------------------------ options */

function parseArgs(argv) {
  const opts = { date: null, out: resolve(ROOT, 'app/data/avalanche.json') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--date') opts.date = argv[++i];
    else if (argv[i] === '--out') opts.out = resolve(process.cwd(), argv[++i]);
  }
  if (opts.date && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new Error('--date must look like 2026-02-14');
  return opts;
}

const viennaDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna' }).format(d);
const addDays = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (res.status === 404) return null;                 // nothing published (yet)
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ------------------------------------------------------- region of a resort */

function inRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inGeometry(geom, lon, lat) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  // first ring is the outline, any further rings are holes
  return polys.some((rings) => inRing(rings[0], lon, lat) && !rings.slice(1).some((hole) => inRing(hole, lon, lat)));
}

/** Micro-regions are redrawn now and then; keep only the ones in force on `date`. */
const inForce = (props, date) => (!props.start_date || props.start_date <= date) && (!props.end_date || props.end_date > date);

async function loadRegions(date) {
  const features = [];
  const failed = [];
  await Promise.all(Object.keys(SERVICES).map(async (area) => {
    try {
      const geo = await getJson(REGIONS_URL(area));
      for (const f of geo?.features || []) {
        if (f.properties?.id && f.geometry && inForce(f.properties, date)) features.push({ id: f.properties.id, area, geom: f.geometry });
      }
    } catch (err) {
      failed.push(area);
      console.warn(`FAIL regions ${area}: ${err.message}`);
    }
  }));
  return { features, failed };
}

/* ---------------------------------------------------------------- bulletins */

const metres = (bound) => {
  if (bound == null) return null;
  if (bound === 'treeline') return { m: TREELINE_M, treeline: true };
  const m = parseInt(bound, 10);
  return Number.isFinite(m) ? { m } : null;
};

function elevation(e) {
  const lo = metres(e?.lowerBound), hi = metres(e?.upperBound);
  const out = { above: lo ? lo.m : null, below: hi ? hi.m : null };
  if (lo?.treeline || hi?.treeline) out.treeline = true;
  return out;
}

function plainText(html) {
  return String(html ?? '')
    .replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}

function highlightOf(b) {
  let text = plainText(b.avalancheActivity?.highlights);
  if (!text) {
    // no headline: take the opening one or two sentences of the danger description
    const sentences = plainText(b.avalancheActivity?.comment).match(/[^.!?]+[.!?]+/g) || [];
    text = sentences.slice(0, 2).join(' ').replace(/\s+/g, ' ').trim();
  }
  if (!text) return null;
  return text.length > 300 ? text.slice(0, 297).replace(/\s+\S*$/, '') + '…' : text;
}

/** One CAAML bulletin -> the compact per-day record the app reads (null if it carries no rating). */
function toEntry(b, area) {
  const ratings = [];
  for (const r of b.dangerRatings || []) {
    const level = LEVELS[r.mainValue];
    if (!level) continue;                               // "no_rating" / "no_snow"
    ratings.push({ level, ...elevation(r.elevation), period: PERIODS[r.validTimePeriod] || null });
  }
  if (!ratings.length || !b.validTime?.endTime) return null;

  const byType = new Map();
  for (const p of b.avalancheProblems || []) {
    if (!p.problemType || p.problemType === 'no_distinct_avalanche_problem') continue;
    const { above, below, treeline } = elevation(p.elevation);
    const known = byType.get(p.problemType);
    if (known) {                                        // same problem listed for morning and afternoon
      for (const a of p.aspects || []) known.aspects.add(a);
    } else {
      const entry = { type: p.problemType, aspects: new Set(p.aspects || []), above, below };
      if (treeline) entry.treeline = true;
      byType.set(p.problemType, entry);
    }
  }
  const problems = [...byType.values()].map((p) => ({ ...p, aspects: COMPASS.filter((a) => p.aspects.has(a)) }));

  const end = new Date(b.validTime.endTime);
  const date = viennaDate(new Date(end.getTime() - 1000));   // a bulletin running "until 17:00" or "until midnight" belongs to that day
  const site = b.source?.provider?.website || SERVICES[area].url;
  return {
    date,
    validFrom: new Date(b.validTime.startTime).toISOString(),
    validTo: end.toISOString(),
    max: Math.max(...ratings.map((r) => r.level)),
    ratings,
    problems,
    highlight: highlightOf(b),
    url: area === 'AT-07' ? `https://avalanche.report/bulletin/${date}` : site,
    published: b.publicationTime || null,               // only used to pick the newest edition; removed before writing
    regionIds: (b.regions || []).map((r) => r.regionID),
    regionNames: Object.fromEntries((b.regions || []).map((r) => [r.regionID, r.name])),
  };
}

/** All bulletins of one warning service for the given days. Throws only on a real failure. */
async function loadService(area, dates) {
  const entries = [];
  let published = 0;
  for (const date of dates) {
    const json = await getJson(BULLETIN_URL(area, date));
    if (!json) continue;
    published++;
    for (const b of json.bulletins || []) {
      const entry = toEntry(b, area);
      if (entry) entries.push(entry);
    }
  }
  return { entries, published };
}

/** Bulletins covering a micro-region: exact id first, otherwise a parent / child region. */
function bulletinsFor(regionId, entries) {
  const exact = entries.filter((e) => e.regionIds.includes(regionId));
  const pool = exact.length ? exact : entries.filter((e) => e.regionIds.some((id) => regionId.startsWith(id + '-') || id.startsWith(regionId + '-')));
  const byDate = new Map();
  for (const e of pool) {
    const known = byDate.get(e.date);
    if (!known || (e.published || '') > (known.published || '')) byDate.set(e.date, e);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/* --------------------------------------------------------------------- main */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const day = opts.date || viennaDate(new Date());
  const dates = [day, addDays(day, 1)];

  let previous = null;
  try { previous = JSON.parse(await readFile(opts.out, 'utf8')); } catch { /* first run */ }

  const [{ features, failed: regionsFailed }, names] = await Promise.all([
    loadRegions(day),
    getJson(NAMES_URL).catch((err) => { console.warn(`FAIL region names: ${err.message}`); return null; }),
  ]);

  const services = {};
  await Promise.all(Object.keys(SERVICES).map(async (area) => {
    try {
      services[area] = await loadService(area, dates);
      console.log(`ok   ${area}  ${services[area].published ? `${services[area].entries.length} bulletin(s)` : 'nothing published'}`);
    } catch (err) {
      services[area] = null;
      console.warn(`FAIL ${area}: ${err.message}`);
    }
  }));

  const nothingWorked = !features.length || Object.values(services).every((s) => s === null);
  if (nothingWorked) {
    console.error('Could not reach the avalanche services - keeping the previous avalanche.json untouched.');
    return;
  }

  const resorts = {};
  for (const r of RESORTS) {
    const p = weatherPoint(r);
    const region = features.find((f) => inGeometry(f.geom, p.lon, p.lat));
    const old = previous?.resorts?.[r.id] || null;

    if (!region) {
      // outside every forecast region - unless its region file simply failed to load this time
      resorts[r.id] = old && regionsFailed.includes(old.regionId.split('-').slice(0, 2).join('-')) ? old : null;
      console.log(`     ${r.id.padEnd(24)} ${resorts[r.id] ? resorts[r.id].regionId + ' (kept)' : 'no avalanche region'}`);
      continue;
    }

    const service = services[region.area];
    let bulletins;
    if (service) {
      bulletins = bulletinsFor(region.id, service.entries);
    } else {
      // this service could not be reached: keep what we knew, minus days that are over
      bulletins = old?.regionId === region.id ? (old.bulletins || []).filter((b) => b.date >= day) : [];
    }
    const regionName = names?.[region.id] || bulletins.find((b) => b.regionNames?.[region.id])?.regionNames[region.id] || old?.regionName || region.id;
    resorts[r.id] = {
      regionId: region.id,
      regionName,
      bulletins: bulletins.map(({ published, regionIds, regionNames, ...b }) => b),
    };
    console.log(`     ${r.id.padEnd(24)} ${region.id.padEnd(15)} ${bulletins.map((b) => `${b.date}: ${b.max}`).join(', ') || 'no bulletin'}`);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    resorts,
    sources: [
      ...Object.values(SERVICES).map(({ name, url }) => ({ name, url })),
      { name: 'EAWS – European Avalanche Warning Services (regions & bulletin collection)', url: 'https://www.avalanches.org/' },
    ],
  };
  await mkdir(dirname(opts.out), { recursive: true });
  await writeFile(opts.out, JSON.stringify(out));
  console.log(`\nWrote ${opts.out}`);
}

main().catch((err) => {
  // the avalanche report is an extra: never let it stop the rest of the update
  console.error(`Avalanche update failed: ${err.message}`);
});
