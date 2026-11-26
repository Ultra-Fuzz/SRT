// Builds app/holidays.json: school holidays and public holidays for the countries most skiers on
// these pistes come from (Austria, Germany, the Netherlands). The app uses it for its crowd forecast.
//
// Run once per season (the file is committed):   node scripts/fetch-holidays.mjs
// Source: OpenHolidays API (https://www.openholidaysapi.org, open data). No dependencies.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'app/holidays.json');
const API = 'https://openholidaysapi.org';
const FROM = '2026-10-01', TO = '2027-05-31';
const UA = 'SkiResortTracker/1.0 (personal season-ticket companion; low-volume)';

// Regions are written as ISO 3166-2 codes (AT-5 = Salzburg, DE-BY = Bavaria ...). The Netherlands
// staggers its holidays over three zones that are not ISO subdivisions: NL-N, NL-M, NL-S.
const COUNTRIES = {
  AT: {},
  DE: {},
  NL: { groups: { 'NL-NO': 'NL-N', 'NL-MI': 'NL-M', 'NL-ZU': 'NL-S' } },
};
// Where one state publishes separate calendars per school type, keep general-education schools.
const SKIP_GROUPS = new Set(['DE-MV-BBS']); // vocational schools, Mecklenburg-Vorpommern

const english = (names) => (names?.find((n) => n.language === 'EN') || names?.[0])?.text?.trim() || '';
const dayCount = (start, end) => Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1;

async function get(path, params) {
  const url = `${API}/${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} ${params.countryIsoCode}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Between October and May no school holiday lasts a month. A longer entry is a typo in the
 * source's end date (seen: 21 March instead of 21 February) - pull the end back to the same day
 * number in an earlier month if that gives a believable holiday, and say so.
 */
function repairRange(row, label) {
  if (dayCount(row.start, row.end) <= 23) return row;
  const day = row.end.slice(8);
  for (let back = 1; back <= 2; back++) {
    const d = new Date(`${row.end.slice(0, 7)}-01T12:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - back);
    const end = `${d.toISOString().slice(0, 7)}-${day}`;
    const len = Number.isNaN(Date.parse(end)) ? 0 : dayCount(row.start, end);
    if (len >= 2 && len <= 17) {
      console.warn(`fixed ${label}: ${row.start} - ${row.end} is ${dayCount(row.start, row.end)} days, using end ${end}`);
      return { ...row, end };
    }
  }
  console.warn(`CHECK ${label}: ${row.start} - ${row.end} is unusually long (${dayCount(row.start, row.end)} days)`);
  return row;
}

async function fetchCountry(country, cfg) {
  const range = { countryIsoCode: country, languageIsoCode: 'EN', validFrom: FROM, validTo: TO };
  const [subdivisions, schoolRaw, publicRaw] = await Promise.all([
    get('Subdivisions', { countryIsoCode: country, languageIsoCode: 'EN' }),
    get('SchoolHolidays', range),
    get('PublicHolidays', range),
  ]);

  // the API's own codes (AT-SB) -> ISO 3166-2 (AT-5); only top-level states/provinces count
  const iso = new Map(subdivisions.map((s) => [s.code, s.isoCode || s.code]));
  const allRegions = cfg.groups ? Object.values(cfg.groups) : [...iso.values()];
  const dayOff = (h) => h.temporalScope === 'FullDay';

  const school = [];
  for (const h of schoolRaw) {
    if (h.type !== 'School' || !dayOff(h)) continue;
    if ((h.tags || []).includes('Exception')) continue;            // applies to a few places only (e.g. North Sea islands)
    const groups = (h.groups || []).map((g) => g.code);
    if (groups.length && groups.every((g) => SKIP_GROUPS.has(g))) continue;
    let regions;
    if (h.nationwide) regions = allRegions;
    else if (cfg.groups) regions = groups.map((g) => cfg.groups[g]).filter(Boolean);
    else regions = (h.subdivisions || []).map((s) => iso.get(s.code)).filter(Boolean);
    for (const region of new Set(regions)) {
      school.push(repairRange({ country, region, name: english(h.name), start: h.startDate, end: h.endDate }, `${region} ${english(h.name)}`));
    }
  }

  const publicDays = [];
  for (const h of publicRaw) {
    if (h.type !== 'Public' || !dayOff(h)) continue;
    const regions = h.nationwide ? null : [...new Set((h.subdivisions || []).map((s) => iso.get(s.code)).filter(Boolean))].sort();
    if (regions && !regions.length) continue;
    for (let d = h.startDate; d <= h.endDate; d = new Date(Date.parse(d) + 86400000).toISOString().slice(0, 10)) {
      publicDays.push({ country, date: d, name: english(h.name), regions });
    }
  }
  return { school, publicDays, regions: allRegions };
}

async function main() {
  const school = [], publicDays = [];
  for (const [country, cfg] of Object.entries(COUNTRIES)) {
    const got = await fetchCountry(country, cfg);
    const covered = new Set(got.school.map((r) => r.region));
    const missing = got.regions.filter((r) => !covered.has(r));
    if (!got.school.length || !got.publicDays.length) throw new Error(`${country}: the source returned no holidays - keeping the existing file`);
    if (missing.length) console.warn(`CHECK ${country}: no school holidays for ${missing.join(', ')}`);
    console.log(`ok   ${country}  ${got.school.length} school-holiday rows in ${covered.size} regions, ${got.publicDays.length} public holidays`);
    school.push(...got.school);
    publicDays.push(...got.publicDays);
  }

  const unique = (rows, key) => [...new Map(rows.map((r) => [key(r), r])).values()];
  const out = {
    generatedAt: new Date().toISOString(),
    from: FROM,
    to: TO,
    school: unique(school, (r) => `${r.region}|${r.start}|${r.end}|${r.name}`)
      .sort((a, b) => a.start.localeCompare(b.start) || a.region.localeCompare(b.region)),
    public: unique(publicDays, (r) => `${r.country}|${r.date}|${r.name}`)
      .sort((a, b) => a.date.localeCompare(b.date) || a.country.localeCompare(b.country)),
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(out));
  console.log(`\nWrote ${OUT} (${out.school.length} school rows, ${out.public.length} public holidays)`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
