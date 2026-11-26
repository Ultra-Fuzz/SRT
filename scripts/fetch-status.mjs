// Collects live lift / piste / webcam data for every SuperSkiCard region from the
// public region pages on superskicard.com and writes app/data/status.json.
//
// Run locally:   node scripts/fetch-status.mjs
// In production: run on a schedule by .github/workflows/deploy.yml
//
// No dependencies - needs Node 18+ (built-in fetch).

import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESORTS } from '../app/resorts.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'app/data/status.json');
const BASE = 'https://www.superskicard.com/de/';
const CONCURRENCY = 4;
const UA = 'SkiResortTracker/1.0 (personal season-ticket companion; low-volume)';

/** Next.js streams page data as string chunks; join them back into one text. */
function decodePayload(html) {
  const re = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let out = '';
  for (const m of html.matchAll(re)) {
    try { out += JSON.parse(m[1]); } catch { /* skip malformed chunk */ }
  }
  return out;
}

/** Reads the JSON array/object that starts at `start` (bracket matching, string aware). */
function readJsonAt(text, start) {
  const open = text[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0, inStr = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}

function allJsonAfter(text, key) {
  const found = [];
  let i = -1;
  while ((i = text.indexOf(key, i + 1)) >= 0) {
    const v = readJsonAt(text, i + key.length);
    if (v) found.push(v);
  }
  return found;
}

const isPiste = (f) => /piste|skiroute/i.test(f.type || '');
// ski-touring tracks, toboggan runs, fun parks ... listed on the site but neither lift nor piste
const isOther = (f) => /skitour|touren|rodel|toboggan|funpark|speedtrack|children/i.test(f.type || '');

function parseFacilities(payload) {
  const seen = new Set();
  const lifts = [], pistes = [], other = [];
  for (const arr of allJsonAfter(payload, '"allFacilities":')) {
    if (!Array.isArray(arr)) continue;
    for (const f of arr) {
      if (!f || typeof f !== 'object' || !f.title) continue;
      const key = `${f.type}|${f.id}|${f.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const item = {
        n: String(f.title).trim(),
        t: f.type || '',
        s: f.status === 1 ? 1 : 0,          // 1 = open, everything else = closed
        r: (f.region || '').trim(),
      };
      if (f.disableAggregation) item.x = 1;  // the site leaves these out of its headline totals
      (isPiste(f) ? pistes : isOther(f) ? other : lifts).push(item);
    }
  }
  return { lifts, pistes, other };
}

function parseKeyfacts(payload) {
  // value node, label node, sub-label node - class names carry a build hash, so match on suffix only
  const re = /"className":"[^"]*_value"(?:,"duration":[\d.]+,"value":(-?[\d.]+)|,"dangerouslySetInnerHTML":\{"__html":"([^"]*)"\})\}\],\["\$","p",null,\{"className":"[^"]*_label","dangerouslySetInnerHTML":\{"__html":"([^"]+)"\}\}\],\["\$","p",null,\{"className":"[^"]*_subLabel","dangerouslySetInnerHTML":\{"__html":"([^"]*)"\}/g;
  const facts = {};
  for (const m of payload.matchAll(re)) {
    const label = m[3];
    if (label in facts) continue;
    const raw = m[1] ?? m[2];
    const num = parseFloat(String(raw).replace(',', '.'));
    facts[label] = { value: Number.isFinite(num) ? num : null, sub: m[4] };
  }
  return facts;
}

function parseWebcams(payload) {
  const cams = [];
  const seen = new Set();
  const re = /\{"image":"(https?:[^"]+)","link":"(https?:[^"]*)","live":(?:true|false),"location":"([^"]*)"[^{}]*?"title":"([^"]*)"\}/g;
  for (const m of payload.matchAll(re)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    cams.push({ image: m[1], link: m[2], location: m[3], title: m[4] });
    if (cams.length >= 8) break;
  }
  return cams;
}

function parseSeason(html) {
  const main = html.slice(html.indexOf('<main'));
  const m = main.match(/(\d{2})\.(\d{2})\.(\d{4})\s*[-–]\s*(\d{2})\.(\d{2})\.(\d{4})/);
  if (!m) return null;
  const season = { start: `${m[3]}-${m[2]}-${m[1]}`, end: `${m[6]}-${m[5]}-${m[4]}` };
  // some pages still show last winter's dates - those say nothing about this season
  if (season.end < new Date().toISOString().slice(0, 10)) return null;
  const after = main.slice(m.index + m[0].length, m.index + m[0].length + 600);
  const note = after.match(/<p[^>]*>([^<]{4,240})<\/p>/);
  if (note) season.note = note[1].replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
  return season;
}

function sectorSummary(lifts, pistes) {
  const map = new Map();
  const get = (name) => {
    if (!map.has(name)) map.set(name, { name, liftsOpen: 0, lifts: 0, pistesOpen: 0, pistes: 0 });
    return map.get(name);
  };
  for (const l of lifts) { const s = get(l.r || ''); s.lifts++; s.liftsOpen += l.s; }
  for (const p of pistes) { const s = get(p.r || ''); s.pistes++; s.pistesOpen += p.s; }
  return [...map.values()].filter((s) => s.name);
}

async function fetchResort(resort) {
  const url = BASE + resort.slug + '.html';
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'de' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const payload = decodePayload(html);
  const { lifts, pistes, other } = parseFacilities(payload);
  const facts = parseKeyfacts(payload);

  const season = parseSeason(html);
  const today = new Date().toISOString().slice(0, 10);
  const outOfSeason = !!season && (today < season.start || today > season.end);

  // Headline numbers as shown on the site ("Lifte 26 / 16 geöffnet"); if the page layout
  // ever changes and they can't be read, count the per-lift list instead.
  const count = (fact, list) => {
    const counted = list.filter((f) => !f.x);
    const listOpen = counted.filter((f) => f.s).length;
    const headOpen = parseInt(fact?.sub, 10);
    if (!(fact && fact.value > 0 && Number.isFinite(headOpen))) return { open: listOpen, total: counted.length };
    const total = Math.max(fact.value, headOpen);
    if (!counted.length || (headOpen > 0) === (listOpen > 0)) return { open: headOpen, total };
    // Headline and per-lift list disagree on whether anything runs at all (stale feed).
    // Outside the announced season, believe "closed"; inside it, believe "open".
    return { open: outOfSeason ? 0 : Math.max(headOpen, listOpen), total, conflict: true };
  };
  const snow = facts['Schneehöhe Berg']?.value;

  return {
    ok: true,
    lifts: count(facts['Lifte'], lifts),
    pistes: count(facts['Pisten'], pistes),
    snowDepthCm: snow && snow > 0 ? snow : null,
    sectors: sectorSummary(lifts, pistes),
    liftList: lifts,
    pisteList: pistes,
    otherList: other,
    webcams: parseWebcams(payload),
    season,
    source: url,
  };
}

async function main() {
  let previous = {};
  try { previous = JSON.parse(await readFile(OUT, 'utf8')).resorts || {}; } catch { /* first run */ }

  const queue = [...RESORTS];
  const resorts = {};
  let failed = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let r; (r = queue.shift());) {
      try {
        resorts[r.id] = await fetchResort(r);
        const d = resorts[r.id];
        console.log(`ok   ${r.id.padEnd(22)} lifts ${d.lifts.open}/${d.lifts.total}  pistes ${d.pistes.open}/${d.pistes.total}  cams ${d.webcams.length}`);
      } catch (err) {
        failed++;
        console.warn(`FAIL ${r.id}: ${err.message}`);
        // keep the last known data, flagged as stale, rather than dropping the resort
        resorts[r.id] = previous[r.id] ? { ...previous[r.id], ok: false } : { ok: false };
      }
    }
  }));

  if (failed === RESORTS.length) {
    console.error('Every resort failed - keeping the previous status.json untouched.');
    process.exit(1);
  }

  const ordered = Object.fromEntries(RESORTS.map((r) => [r.id, resorts[r.id]]));
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), resorts: ordered }));
  console.log(`\nWrote ${OUT} (${failed} failed)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
