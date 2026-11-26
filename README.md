# Ski Tracker – SuperSkiCard companion

A personal iPhone app (installable web app) for the 30 ski regions on the
[SuperSkiCard](https://www.superskicard.com/).

## What it does

- **Live status** – open/closed, lifts and pistes running, per-area and per-lift lists, snow depth, webcams, season dates
- **Mountain weather** – now, skiing hours (08–16 h) and a 6-day outlook at piste elevation
- **Where to go** – a 0–100 conditions score per resort and day, the closest open resort, and "best nearby" (conditions weighed against the drive)
- **Leave-by time** – when to set off to be on the first lift, with extra margin on busy days
- **Crowd forecast** – quiet / moderate / busy / very busy per day from weekends, public holidays and the school holidays of Austria, Germany and the Netherlands; a "quieter choice" on busy days
- **Avalanche danger** – the official bulletin for each resort's region: level, elevation bands, avalanche problems with their aspects
- **Terrain map** – topographic map with slope-angle shading (30–35°, 35–40°, 40–45°, 45°+) calculated from 10 m elevation data. "Danger zones" keeps the slopes vivid that match the bulletin's aspects and elevations and fades the rest. Tap anywhere for angle, aspect and height. Optional piste overlay and aerial imagery.
- **Your preferences** – how much powder, sun, open lifts, quiet slopes and a short drive matter to you; longest drive
- **Season log** – tick off ski days: cost per day of the card, resorts not skied yet
- **Lift watching** – tap the bell on a lift you depend on; the app (and a notification) tells you when it opens or closes
- **Notifications** – evening tip for tomorrow, morning tip for today, powder alerts

## How it works

| Part | What it does |
| --- | --- |
| `app/` | The app: plain HTML/CSS/JavaScript, no build step. Works offline with the last saved data. |
| `app/core.js` | Scoring, crowd estimate, leave-by time – shared by the app and the alert job. |
| `app/map.js` | Terrain map; slope angles are computed on the phone from open elevation tiles. |
| `scripts/fetch-status.mjs` | Reads the public region pages on superskicard.com → `app/data/status.json`. |
| `scripts/fetch-avalanche.mjs` | Reads the official bulletins (EAWS feed) → `app/data/avalanche.json`. |
| `scripts/alerts.mjs` | Sends the notifications (Web Push, no third-party service). |
| `scripts/fetch-holidays.mjs` | Rebuilds `app/holidays.json` (run once per season). |
| `.github/workflows/deploy.yml` | Runs all of this every 20 minutes during the ski day and publishes `app/` to GitHub Pages. |

Data sources: superskicard.com (lifts, pistes, webcams), [Open-Meteo](https://open-meteo.com/) (weather),
[OSRM](https://project-osrm.org/) (drive times), the avalanche warning services of Salzburg, Tirol, Kärnten,
Steiermark, Oberösterreich and Bayern via [EAWS](https://www.avalanches.org/), [OpenHolidays](https://www.openholidaysapi.org/),
[OpenTopoMap](https://opentopomap.org/), [basemap.at](https://basemap.at/), [OpenSnowMap](https://www.opensnowmap.org/)
and AWS Terrain Tiles (elevation).

### The score

| Ingredient | Points | Based on |
| --- | --- | --- |
| Lifts running | 25 | share of lifts open today (halved if no piste is reported open) |
| Snow | 25 | new snow in the last 48 h, resort-reported snow depth |
| Sky & visibility | 22 | forecast sunshine, snowfall, fog, rain during skiing hours |
| Wind | 11 | strongest gusts during skiing hours |
| Temperature | 9 | best between −12 °C and −2 °C on the mountain |
| Quiet slopes | 8 | calendar-based crowd estimate |

The sliders under Settings scale these. "Best nearby" subtracts one point for every 5 minutes of driving.

## Put it on your iPhone

1. Create a free account on [github.com](https://github.com/) and a new **public** repository (this one is `Ultra-Fuzz/SRT`).
2. Push this folder to it.
3. In the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Open the **Actions** tab and wait for "Update data and publish" to finish (about a minute).
5. On the iPhone open <https://ultra-fuzz.github.io/SRT/> in **Safari**, tap **Share → Add to Home Screen**, and open the app from the new icon.

### Switch on notifications (optional)

1. In the repository: **Settings → Secrets and variables → Actions → New repository secret**.
   Name `VAPID_PRIVATE_KEY`, value = the contents of `.vapid-private-key.txt` in this folder.
2. On the phone (app opened from the Home Screen): **Settings → Turn on notifications**, allow them, then **Copy code**.
3. Add a second secret named `ALERT_CONFIG` and paste the code.

Copy the code again (and update the secret) when you change the alert settings, your home location or
your watched lifts. The code holds the phone's push address and a position rounded to about 1 km; as a
secret it is not visible to anyone, including in a public repository.

> GitHub pauses scheduled runs in repositories without any activity for 60 days. If the data
> stops updating, open the **Actions** tab and press "Enable workflow".

## Try it on this computer

```
node scripts/fetch-status.mjs
node scripts/fetch-avalanche.mjs
node scripts/serve.mjs
```

Then open http://localhost:5173.

## Good to know

- Unofficial personal tool. The lift report is only as good as what each resort publishes; check the
  resort's own report before a long drive.
- **Avalanche terrain:** the slope map is a planning aid. It is computed from a 10 m elevation model, so
  small steep features can be missed, and it knows nothing about the snowpack. It does not replace the
  official bulletin, training, or judgement on the mountain. Danger levels apply off-piste.
- Leave-by times use free-flow drive times plus a busy-day margin, not live traffic. The Navigate button
  opens Apple Maps, which does have live traffic.
- The crowd forecast is a calendar-based estimate, not a measurement.
- If superskicard.com changes its page layout, `scripts/fetch-status.mjs` may need adjusting.
