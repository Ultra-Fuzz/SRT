// The 30 ski regions covered by the SuperSkiCard (season 2026/27).
//
// slug     -> page on superskicard.com the live data is read from
// km       -> total piste kilometres (from superskicard.com)
// base/top -> lowest / highest lift-served elevation in metres
// access   -> valley stations / villages you can drive to (used for distance + navigation).
//             `sector` is a pattern matching the area name used in the live lift report, so the
//             app can send you to a valley station whose lifts are actually running.
// wx       -> optional point on the mountain for the weather forecast when the ski
//             area lies far above/away from the valley station (glaciers)

export const RESORTS = [
  { id: 'skicircus', slug: 'skicircus-saalbach-hinterglemm-leogang', name: 'Skicircus Saalbach Hinterglemm Leogang Fieberbrunn', short: 'Skicircus Saalbach', state: 'Salzburg / Tirol', km: 270, base: 830, top: 2096,
    access: [
      { name: 'Saalbach', lat: 47.3906, lon: 12.6367, sector: 'Saalbach' },
      { name: 'Hinterglemm', lat: 47.3764, lon: 12.5964, sector: 'Saalbach' },
      { name: 'Leogang', lat: 47.4390, lon: 12.7200, sector: 'Saalbach' },
      { name: 'Fieberbrunn', lat: 47.4640, lon: 12.5560, sector: 'Fieberbrunn' },
      { name: 'Viehhofen', lat: 47.3660, lon: 12.7300, sector: 'Saalbach' },
    ] },
  { id: 'skiwelt', slug: 'skiwelt-wilder-kaiser-brixental', name: 'SkiWelt Wilder Kaiser – Brixental', short: 'SkiWelt Wilder Kaiser', state: 'Tirol', km: 275, base: 620, top: 1957,
    access: [
      { name: 'Söll', lat: 47.5040, lon: 12.1920, sector: 'Söll' },
      { name: 'Scheffau', lat: 47.5207, lon: 12.2399, sector: 'Scheffau' },
      { name: 'Ellmau', lat: 47.5140, lon: 12.3020, sector: 'Ellmau' },
      { name: 'Going', lat: 47.5130, lon: 12.3300, sector: 'Going' },
      { name: 'Brixen im Thale', lat: 47.4500, lon: 12.2530, sector: 'Brixen' },
      { name: 'Westendorf', lat: 47.4320, lon: 12.2140, sector: 'Westendorf' },
      { name: 'Hopfgarten', lat: 47.4490, lon: 12.1570, sector: 'Hopfgarten' },
      { name: 'Itter', lat: 47.4700, lon: 12.1420, sector: 'Itter' },
    ] },
  { id: 'snow-space', slug: 'snow-space-salzburg-zauchensee-shuttleberg', name: 'Snow Space Salzburg, Zauchensee & Shuttleberg', short: 'Snow Space Salzburg', state: 'Salzburg', km: 250, base: 800, top: 2188,
    access: [
      { name: 'Flachau', lat: 47.3447, lon: 13.3917, sector: '^Flachau$' },
      { name: 'Wagrain', lat: 47.3350, lon: 13.2990, sector: 'Wagrain' },
      { name: 'St. Johann-Alpendorf', lat: 47.3300, lon: 13.1830, sector: 'St\\. Johann' },
      { name: 'Zauchensee', lat: 47.2933, lon: 13.4569, sector: 'Zauchensee' },
      { name: 'Flachauwinkl', lat: 47.2943, lon: 13.3987, sector: 'Flachauwinkl' },
      { name: 'Kleinarl', lat: 47.2760, lon: 13.3200, sector: 'Kleinarl' },
      { name: 'Altenmarkt', lat: 47.3790, lon: 13.4230, sector: 'Altenmarkt' },
      { name: 'Radstadt', lat: 47.3833, lon: 13.4614, sector: 'Radstadt' },
      { name: 'Filzmoos', lat: 47.4340, lon: 13.5220, sector: 'Filzmoos' },
    ] },
  { id: 'schladming-dachstein', slug: 'schladming-dachstein', name: 'Region Schladming-Dachstein', short: 'Schladming-Dachstein', state: 'Steiermark', km: 222, base: 745, top: 2700,
    access: [
      { name: 'Schladming (Planai)', lat: 47.3925, lon: 13.6883, sector: 'Planai' },
      { name: 'Rohrmoos (Hochwurzen)', lat: 47.3780, lon: 13.6590, sector: 'Hochwurzen' },
      { name: 'Pichl (Reiteralm)', lat: 47.3960, lon: 13.5950, sector: 'Reiteralm' },
      { name: 'Haus (Hauser Kaibling)', lat: 47.4100, lon: 13.7667, sector: 'Hauser Kaibling' },
      { name: 'Pruggern (Galsterberg)', lat: 47.4220, lon: 13.8770, sector: 'Galsterberg' },
      { name: 'Ramsau am Dachstein', lat: 47.4220, lon: 13.6560, sector: 'Rittisberg|Dachstein' },
      { name: 'Forstau (Fageralm)', lat: 47.3780, lon: 13.5560, sector: 'Fageralm' },
    ] },
  { id: 'kitzski', slug: 'kitzski', name: 'KitzSki Kitzbühel / Kirchberg', short: 'KitzSki', state: 'Tirol / Salzburg', km: 196, base: 800, top: 2000,
    access: [
      { name: 'Kitzbühel (Hahnenkamm)', lat: 47.4460, lon: 12.3850 },
      { name: 'Kirchberg', lat: 47.4450, lon: 12.3160 },
      { name: 'Jochberg', lat: 47.3780, lon: 12.4190 },
      { name: 'Pass Thurn', lat: 47.3090, lon: 12.4080 },
      { name: 'Hollersbach', lat: 47.2780, lon: 12.4200 },
    ] },
  { id: 'gastein', slug: 'skigebiet-gastein', name: 'Gastein', short: 'Gastein', state: 'Salzburg', km: 180, base: 840, top: 2686,
    access: [
      { name: 'Bad Hofgastein (Schlossalm)', lat: 47.1722, lon: 13.1028, sector: 'Ski Gastein' },
      { name: 'Bad Gastein (Stubnerkogel)', lat: 47.1128, lon: 13.1325, sector: 'Ski Gastein' },
      { name: 'Sportgastein', lat: 47.0622, lon: 13.0587, sector: 'Ski Gastein' },
      { name: 'Dorfgastein', lat: 47.2414, lon: 13.1058, sector: 'Dorfgastein' },
    ] },
  { id: 'zillertal-arena', slug: 'zillertal-arena', name: 'Zillertal Arena', short: 'Zillertal Arena', state: 'Tirol / Salzburg', km: 150, base: 580, top: 2500,
    access: [
      { name: 'Zell am Ziller', lat: 47.2333, lon: 11.8833 },
      { name: 'Gerlos', lat: 47.2256, lon: 12.0325 },
      { name: 'Königsleiten', lat: 47.2493, lon: 12.1205 },
      { name: 'Hochkrimml', lat: 47.2400, lon: 12.1500 },
    ] },
  { id: 'lungau', slug: 'lungau', name: 'Lungau', short: 'Lungau', state: 'Salzburg', km: 150, base: 1075, top: 2411,
    access: [
      { name: 'Katschberg', lat: 47.0586, lon: 13.6156, sector: 'Katschberg' },
      { name: 'Mauterndorf (Grosseck)', lat: 47.1344, lon: 13.6792, sector: 'Speiereck' },
      { name: 'St. Michael (Speiereck)', lat: 47.0975, lon: 13.6386, sector: 'Speiereck' },
      { name: 'Fanningberg', lat: 47.1694, lon: 13.6936, sector: 'Fanningberg' },
      { name: 'St. Margarethen (Aineck)', lat: 47.0792, lon: 13.6936, sector: 'Katschberg' },
    ] },
  { id: '3-laender', slug: '3-laender-freizeit-arena', name: '3 Länder Freizeit-Arena', short: '3 Länder Freizeit-Arena', state: 'Salzburg / Tirol / Bayern', km: 152, base: 640, top: 1870,
    access: [
      { name: 'Lofer (Almenwelt)', lat: 47.5850, lon: 12.6930, sector: 'Lofer' },
      { name: 'Waidring (Steinplatte)', lat: 47.5874, lon: 12.5650, sector: 'Steinplatte' },
      { name: 'Reit im Winkl (Winklmoosalm)', lat: 47.6579, lon: 12.5389, sector: 'Winklmoos' },
      { name: 'St. Johann in Tirol', lat: 47.5236, lon: 12.4264, sector: 'St\\. Johann' },
      { name: 'Kirchdorf in Tirol', lat: 47.5550, lon: 12.4450, sector: 'Kirchdorf' },
    ] },
  { id: 'schneebaeren', slug: 'skigebiete-schneebaeren', name: 'Schneebären', short: 'Schneebären', state: 'Steiermark', km: 128, base: 900, top: 2000,
    access: [
      { name: 'Tauplitz', lat: 47.5600, lon: 14.0130, sector: 'Tauplitz' },
      { name: 'Donnersbachwald (Riesneralm)', lat: 47.3800, lon: 14.1200, sector: 'Riesneralm' },
      { name: 'Planneralm', lat: 47.4020, lon: 14.2000, sector: 'Planneralm' },
      { name: 'Altaussee (Loser)', lat: 47.6400, lon: 13.7650, sector: 'Loser' },
      { name: 'Admont (Kaiserau)', lat: 47.5275, lon: 14.4824, sector: 'Kaiserau' },
    ] },
  { id: 'hochkoenig', slug: 'region-hochkoenig', name: 'Region Hochkönig', short: 'Hochkönig', state: 'Salzburg', km: 120, base: 800, top: 1900,
    access: [
      { name: 'Maria Alm', lat: 47.4050, lon: 12.9000, sector: 'Maria Alm' },
      { name: 'Dienten', lat: 47.3820, lon: 13.0030, sector: 'Dienten' },
      { name: 'Mühlbach', lat: 47.3780, lon: 13.1280, sector: 'Mühlbach' },
    ] },
  { id: 'ski-juwel', slug: 'ski-juwel-alpbachtal-wildschoenau', name: 'Ski Juwel Alpbachtal Wildschönau', short: 'Ski Juwel Alpbachtal', state: 'Tirol', km: 114, base: 830, top: 2025,
    access: [
      { name: 'Alpbach', lat: 47.3990, lon: 11.9440, sector: 'Alpbachtal' },
      { name: 'Reith im Alpbachtal', lat: 47.4172, lon: 11.8783, sector: 'Alpbachtal' },
      { name: 'Niederau', lat: 47.4497, lon: 12.0893, sector: 'Wildschönau' },
      { name: 'Auffach', lat: 47.4050, lon: 12.0420, sector: 'Wildschönau' },
    ] },
  { id: 'obertauern', slug: 'bergbahn-obertauern', name: 'Obertauern', short: 'Obertauern', state: 'Salzburg', km: 100, base: 1630, top: 2313,
    access: [{ name: 'Obertauern', lat: 47.2497, lon: 13.5597 }] },
  { id: 'zell-am-see', slug: 'zell-am-see-schmittenhoehe', name: 'Zell am See – Schmittenhöhe', short: 'Schmittenhöhe', state: 'Salzburg', km: 77, base: 760, top: 2000,
    access: [
      { name: 'Zell am See', lat: 47.3236, lon: 12.7950 },
      { name: 'Schüttdorf (areitXpress)', lat: 47.3000, lon: 12.7900 },
      { name: 'Viehhofen (zellamseeXpress)', lat: 47.3660, lon: 12.7300 },
    ] },
  { id: 'dachstein-salzkammergut', slug: 'skigebiet-dachstein-west', name: 'Bergbahnen Dachstein Salzkammergut', short: 'Dachstein Salzkammergut', state: 'Oberösterreich / Salzburg', km: 75, base: 500, top: 2100,
    access: [
      { name: 'Gosau (Dachstein West)', lat: 47.5846, lon: 13.5346, sector: 'Dachstein West' },
      { name: 'Russbach (Dachstein West)', lat: 47.5897, lon: 13.4610, sector: 'Dachstein West' },
      { name: 'Annaberg (Dachstein West)', lat: 47.5206, lon: 13.4336, sector: 'Dachstein West' },
      { name: 'Ebensee (Feuerkogel)', lat: 47.8072, lon: 13.7730, sector: 'Feuerkogel' },
      { name: 'Grünau (Kasberg)', lat: 47.8540, lon: 13.9550, sector: 'Kasberg' },
      { name: 'Obertraun (Krippenstein)', lat: 47.5560, lon: 13.6830, sector: 'Krippenstein' },
    ] },
  { id: 'wildkogel', slug: 'wildkogel-arena', name: 'Wildkogel-Arena', short: 'Wildkogel-Arena', state: 'Salzburg', km: 75, base: 820, top: 2150,
    access: [
      { name: 'Neukirchen', lat: 47.2517, lon: 12.2775 },
      { name: 'Bramberg', lat: 47.2706, lon: 12.3414 },
    ] },
  { id: 'grossarltal', slug: 'grossarltal', name: 'Großarltal', short: 'Großarltal', state: 'Salzburg', km: 70, base: 920, top: 2033,
    access: [{ name: 'Großarl', lat: 47.2376, lon: 13.2010 }] },
  { id: 'kitzsteinhorn', slug: 'kaprun-kitzsteinhorn-maiskogel', name: 'Kitzsteinhorn & Maiskogel – Kaprun', short: 'Kitzsteinhorn Kaprun', state: 'Salzburg', km: 63, base: 768, top: 3029, glacier: true,
    access: [
      { name: 'Kaprun (Maiskogel)', lat: 47.2730, lon: 12.7590 },
      { name: 'Kitzsteinhorn valley station', lat: 47.2290, lon: 12.7260 },
    ],
    wx: { lat: 47.1950, lon: 12.6870, elev: 2500 } },
  { id: 'hinterstoder', slug: 'hinterstoder-wurzeralm', name: 'Hinterstoder / Wurzeralm', short: 'Hinterstoder / Wurzeralm', state: 'Oberösterreich', km: 62, base: 600, top: 2000,
    access: [
      { name: 'Hinterstoder (Höss)', lat: 47.6960, lon: 14.1500, sector: 'Hinterstoder' },
      { name: 'Spital am Pyhrn (Wurzeralm)', lat: 47.6274, lon: 14.3152, sector: 'Wurzeralm' },
    ] },
  { id: 'moelltaler', slug: 'moelltaler-gletscherbahnen', name: 'Mölltaler Gletscher', short: 'Mölltaler Gletscher', state: 'Kärnten', km: 36, base: 2200, top: 3122, glacier: true,
    access: [{ name: 'Flattach (Gletscher Express)', lat: 46.9618, lon: 13.0572 }],
    wx: { lat: 47.0350, lon: 13.0100, elev: 2700 } },
  { id: 'rauris', slug: 'rauris', name: 'Rauris – Hochalmbahnen', short: 'Rauris', state: 'Salzburg', km: 33, base: 950, top: 2175,
    access: [{ name: 'Rauris', lat: 47.2240, lon: 12.9950 }] },
  { id: 'werfenweng', slug: 'skigebiet-werfenweng', name: 'Werfenweng', short: 'Werfenweng', state: 'Salzburg', km: 29, base: 1000, top: 1836,
    access: [{ name: 'Werfenweng', lat: 47.4619, lon: 13.2575 }] },
  { id: 'hochficht', slug: 'hochficht', name: 'Hochficht', short: 'Hochficht', state: 'Oberösterreich', km: 28, base: 930, top: 1338,
    access: [{ name: 'Hochficht valley station', lat: 48.7372, lon: 13.8989 }] },
  { id: 'weisssee', slug: 'weisssee-gletscherwelt-uttendorf', name: 'Weißsee Gletscherwelt', short: 'Weißsee Gletscherwelt', state: 'Salzburg', km: 23, base: 1480, top: 2600, glacier: true,
    access: [{ name: 'Uttendorf (Enzingerboden)', lat: 47.1705, lon: 12.6273 }],
    wx: { lat: 47.1340, lon: 12.6260, elev: 2300 } },
  { id: 'ankogel', slug: 'bergbahnen-ankogel-mallnitz', name: 'Ankogel – Mallnitz', short: 'Ankogel Mallnitz', state: 'Kärnten', km: 13, base: 1287, top: 2636,
    access: [{ name: 'Mallnitz (Ankogelbahn)', lat: 47.0146, lon: 13.1864 }] },
  { id: 'postalm', slug: 'postalm-winterpark', name: 'Postalm Winterpark', short: 'Postalm', state: 'Salzburg', km: 12, base: 1200, top: 1500,
    access: [{ name: 'Postalm', lat: 47.6470, lon: 13.4270 }] },
  { id: 'abtenau', slug: 'skigebiet-abtenau', name: 'Abtenau – Karkogel', short: 'Abtenau', state: 'Salzburg', km: 9, base: 712, top: 1260,
    access: [{ name: 'Abtenau', lat: 47.5636, lon: 13.3456 }] },
  { id: 'zinken', slug: 'zinkenlifte-hallein', name: 'Zinkenlifte Hallein – Bad Dürrnberg', short: 'Zinken Bad Dürrnberg', state: 'Salzburg', km: 8, base: 800, top: 1336,
    access: [{ name: 'Bad Dürrnberg', lat: 47.6640, lon: 13.0880 }] },
  { id: 'untersberg', slug: 'untersbergbahn', name: 'Untersbergbahn', short: 'Untersberg', state: 'Salzburg', km: 7, base: 456, top: 1776,
    access: [{ name: 'Grödig – St. Leonhard', lat: 47.7270, lon: 13.0420 }] },
  { id: 'naglkoepfl', slug: 'naglkoepfl-piesendorf', name: 'Naglköpfl – Piesendorf', short: 'Naglköpfl', state: 'Salzburg', km: 3, base: 780, top: 1010,
    access: [{ name: 'Piesendorf', lat: 47.2906, lon: 12.7181 }] },
];

/** Point + elevation the mountain weather forecast is requested for. */
export function weatherPoint(r) {
  if (r.wx) return r.wx;
  const a = r.access[0];
  return { lat: a.lat, lon: a.lon, elev: Math.round(r.base + (r.top - r.base) * 0.6) };
}
