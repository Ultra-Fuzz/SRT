// Sends this phone its notifications. Runs after fetch-status.mjs in the scheduled workflow.
//
//   - watched lifts: a push when one of them opens or closes between two lift reports
//   - evening tip (for tomorrow) and morning tip (for today): where the snow and weather are
//     best, how long the drive is and when to leave - sent when the powder / score threshold
//     you chose in the app is met
//
// Configuration comes from two repository secrets:
//   ALERT_CONFIG       the code the app shows under Settings -> Notifications
//   VAPID_PRIVATE_KEY  the private half of the key made by scripts/make-vapid.mjs
// Without them the script does nothing. It never prints the configuration or message text,
// because workflow logs of a public repository are public.
//
//   node scripts/alerts.mjs            normal run
//   node scripts/alerts.mjs --dry      show what would be sent (local testing), send nothing
//   node scripts/alerts.mjs --dry --force=evening|morning     ignore the time of day

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESORTS } from '../app/resorts.js';
import { isoDate, addDays, localHour, fetchWeather, fetchDriveTable, rankDay, mergePrefs, grade, fmtDrive } from '../app/core.js';
import { VAPID_PUBLIC_KEY } from '../app/push-config.js';
import { sendPush } from './push.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STATUS = resolve(ROOT, 'app/data/status.json');
const PREVIOUS = resolve(ROOT, process.env.PREV_STATUS || '.cache/prev-status.json');
const STATE = resolve(ROOT, 'app/data/alert-state.json');
const HOLIDAYS = resolve(ROOT, 'app/holidays.json');

const DRY = process.argv.includes('--dry');
const FORCE = process.argv.find((a) => a.startsWith('--force='))?.split('=')[1];
const readJson = async (file) => { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return null; } };
const shortName = (id) => RESORTS.find((r) => r.id === id)?.short || id;

function readConfig() {
  const raw = process.env.ALERT_CONFIG;
  if (!raw) return null;
  try {
    const cfg = JSON.parse(Buffer.from(raw.trim(), 'base64').toString('utf8'));
    return cfg?.sub?.endpoint ? cfg : null;
  } catch { return null; }
}

/** Watched lifts whose state differs between the previous and the new lift report. */
function liftChanges(cfg, before, now) {
  const out = [];
  for (const [id, names] of Object.entries(cfg.watch || {})) {
    const was = before?.resorts?.[id]?.liftList, is = now?.resorts?.[id]?.liftList;
    if (!was || !is) continue;
    for (const name of names) {
      const a = was.find((l) => l.n === name), b = is.find((l) => l.n === name);
      if (a && b && a.s !== b.s) out.push(`${name} (${shortName(id)}) ${b.s ? 'opened' : 'closed'}`);
    }
  }
  return out;
}

/** The evening / morning tip, or null when nothing clears the thresholds set in the app. */
function briefing(kind, date, rows, prefs, hasHome) {
  // only resorts whose lifts are confirmed running - a planned opening is not worth a notification
  const usable = rows.filter((x) => x.op.open && x.op.share != null && x.sc && !x.tooFar);
  if (!usable.length) return null;
  const rank = (a, b) => (hasHome ? b.combo - a.combo : b.sc.total - a.sc.total);
  const powder = [...usable].filter((x) => x.w.fresh48 >= prefs.alerts.powderCm).sort(rank)[0];
  const pick = [...usable].sort(rank)[0];
  if (!powder && prefs.alerts.minScore > 0 && pick.sc.total < prefs.alerts.minScore) return null;

  const when = kind === 'evening' ? 'Tomorrow' : 'Today';
  const facts = (x) => {
    const bits = [x.sc.why.slice(0, 3).join(', ')];
    if (x.trip) bits.push(`${x.trip.exact ? '' : '~'}${fmtDrive(x.trip.min)} drive`);
    if (x.go) bits.push(`leave by ${x.go.leave}`);
    return bits.join(' · ');
  };
  if (powder) {
    const other = pick !== powder ? `\nBest overall: ${pick.r.short} (${pick.sc.total})` : '';
    return { title: `❄ ${Math.round(powder.w.fresh48)} cm fresh at ${powder.r.short}`, body: `${when}: ${facts(powder)}${other}`, tag: kind, url: './' };
  }
  return { title: `${when}: ${pick.r.short} looks ${grade(pick.sc.total).label.toLowerCase()} (${pick.sc.total})`, body: facts(pick), tag: kind, url: './' };
}

async function main() {
  const cfg = readConfig();
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!cfg || ((!privateKey || !VAPID_PUBLIC_KEY) && !DRY)) {
    console.log('Alerts are not set up (missing ALERT_CONFIG / VAPID key) - nothing to do.');
    return;
  }
  const prefs = mergePrefs(cfg.prefs);
  const status = await readJson(STATUS);
  const state = (await readJson(STATE)) || {};
  const today = isoDate(new Date()), hour = localHour();
  const send = async (message, urgency = 'normal') => {
    if (DRY) { console.log('[dry run]', JSON.stringify(message, null, 1)); return true; }
    const res = await sendPush(cfg.sub, message, {
      publicKey: VAPID_PUBLIC_KEY, privateKey: privateKey.trim(), urgency,
      subject: process.env.VAPID_SUBJECT || 'https://github.com',
    });
    console.log(`push "${message.tag}": ${res.ok ? 'sent' : 'failed'} (status ${res.status})`);
    if (res.gone) console.warn('The phone\'s push subscription has expired - open the app, copy a new code and update the ALERT_CONFIG secret.');
    return res.ok;
  };

  // 1. watched lifts (daytime only: overnight resets are noise)
  if (prefs.alerts.lifts && status && ((hour >= 6 && hour < 20) || (DRY && FORCE))) {
    const changes = liftChanges(cfg, await readJson(PREVIOUS), status);
    if (changes.length) await send({ title: changes.length === 1 ? 'Lift update' : `${changes.length} lift updates`, body: changes.slice(0, 6).join('\n'), tag: 'lifts', url: './' }, 'high');
  }

  // 2. evening tip for tomorrow / morning tip for today, once each per day
  const kinds = [];
  if (FORCE) kinds.push(FORCE);
  else {
    if (prefs.alerts.morning && hour >= 5 && hour < 9 && state.morning !== today) kinds.push('morning');
    if (prefs.alerts.evening && hour >= 17 && hour < 22 && state.evening !== today) kinds.push('evening');
  }
  if (kinds.length && status) {
    const weather = await fetchWeather(today);
    const driveTable = cfg.home ? await fetchDriveTable(cfg.home).catch(() => null) : null;
    const ctx = { status, weather, holidays: await readJson(HOLIDAYS), pos: cfg.home, driveTable, prefs, todayIso: today };
    for (const kind of kinds) {
      const date = kind === 'evening' ? addDays(today, 1) : today;
      const message = briefing(kind, date, rankDay(date, ctx), prefs, !!cfg.home);
      if (message) await send(message);
      else console.log(`${kind} tip: nothing clears the thresholds today.`);
      state[kind] = today;
    }
  }

  if (!DRY) {
    await mkdir(dirname(STATE), { recursive: true });
    await writeFile(STATE, JSON.stringify({ morning: state.morning || null, evening: state.evening || null, updatedAt: new Date().toISOString() }));
  }
}

// never fail the deployment because a notification could not be sent
main().catch(() => { console.error('alerts: could not complete this run (details withheld from the public log)'); });
