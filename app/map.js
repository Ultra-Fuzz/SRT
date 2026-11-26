// Terrain map: topographic base map, resort pins, and a slope-angle layer that is calculated
// on the phone from open elevation data (so it works for every resort, not just one region).
//
// Slope classes follow the usual avalanche-terrain colours: 30-35° yellow, 35-40° orange,
// 40-45° red, steeper than 45° purple. In "danger zones" mode the slopes that match today's
// bulletin (aspect + elevation band of the avalanche problems) stay vivid, the rest fade.

import { ASPECTS } from './core.js';

const LEAFLET = {
  js: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  jsHash: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=',
  css: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  cssHash: 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=',
};
// Mapzen "terrarium" elevation tiles hosted as AWS open data (Austria: 10 m survey data)
const DEM_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium';
const DEM_MIN_ZOOM = 12, DEM_MAX_ZOOM = 14;

export const SLOPE_CLASSES = [
  { min: 30, label: '30–35°', rgb: [255, 222, 0] },
  { min: 35, label: '35–40°', rgb: [255, 138, 0] },
  { min: 40, label: '40–45°', rgb: [224, 32, 32] },
  { min: 45, label: 'over 45°', rgb: [140, 40, 175] },
];

let leafletReady;
function loadLeaflet() {
  leafletReady ||= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = LEAFLET.css; css.integrity = LEAFLET.cssHash; css.crossOrigin = '';
    document.head.append(css);
    const js = document.createElement('script');
    js.src = LEAFLET.js; js.integrity = LEAFLET.jsHash; js.crossOrigin = '';
    js.onload = () => resolve(window.L);
    js.onerror = () => { leafletReady = null; reject(new Error('Map library could not be loaded')); };
    document.head.append(js);
  });
  return leafletReady;
}

/* ---------------------------------------------------------------- elevation */

const demCache = new Map();   // "z/x/y" -> Promise<Float32Array(256 * 256) | null>

function loadDem(z, x, y) {
  const n = 2 ** z;
  if (y < 0 || y >= n) return Promise.resolve(null);
  const key = `${z}/${((x % n) + n) % n}/${y}`;
  if (!demCache.has(key)) {
    if (demCache.size > 220) demCache.delete(demCache.keys().next().value);
    demCache.set(key, decodeDem(key).catch(() => { demCache.delete(key); return null; }));
  }
  return demCache.get(key);
}

async function decodeDem(key) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  // wait for onload rather than img.decode(): decode() never settles while the page is in
  // the background, which would leave the slope layer blank after switching back to the app
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error('elevation tile unavailable'));
    img.src = `${DEM_URL}/${key}.png`;
  });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const px = ctx.getImageData(0, 0, 256, 256).data;
  const out = new Float32Array(65536);
  for (let i = 0; i < 65536; i++) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  return out;
}

/** Elevations of one tile plus a one-pixel rim from its neighbours (258 x 258), for seamless slopes. */
async function paddedDem(z, x, y) {
  const [c, n, s, w, e] = await Promise.all([loadDem(z, x, y), loadDem(z, x, y - 1), loadDem(z, x, y + 1), loadDem(z, x - 1, y), loadDem(z, x + 1, y)]);
  if (!c) return null;
  const P = 258, out = new Float32Array(P * P);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) out[(j + 1) * P + i + 1] = c[j * 256 + i];
  for (let i = 0; i < 256; i++) {
    out[i + 1] = n ? n[255 * 256 + i] : c[i];
    out[257 * P + i + 1] = s ? s[i] : c[255 * 256 + i];
    out[(i + 1) * P] = w ? w[i * 256 + 255] : c[i * 256];
    out[(i + 1) * P + 257] = e ? e[i * 256] : c[i * 256 + 255];
  }
  out[0] = out[1]; out[257] = out[256]; out[257 * P] = out[257 * P + 1]; out[257 * P + 257] = out[257 * P + 256];
  return out;
}

/** Metres per pixel of a tile row at zoom z. */
function cellSize(z, y) {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z;
  const lat = Math.atan(Math.sinh(n));
  return (40075016.686 * Math.cos(lat)) / (256 * 2 ** z);
}

/** Slope (degrees), aspect (0..7, direction the slope faces) and elevation at pixel i, j of a padded tile. */
function terrainAt(pad, i, j, cell) {
  const P = 258, o = (j + 1) * P + i + 1;
  const a = pad[o - P - 1], b = pad[o - P], c = pad[o - P + 1];
  const d = pad[o - 1], f = pad[o + 1];
  const g = pad[o + P - 1], h = pad[o + P], k = pad[o + P + 1];
  const dzdx = (c + 2 * f + k - (a + 2 * d + g)) / (8 * cell);   // towards east
  const dzdy = (g + 2 * h + k - (a + 2 * b + c)) / (8 * cell);   // towards south
  const slope = Math.atan(Math.hypot(dzdx, dzdy)) * 57.29578;
  const bearing = (Math.atan2(-dzdx, dzdy) * 57.29578 + 360) % 360;   // downhill direction
  return { slope, aspect: Math.round(bearing / 45) % 8, elev: pad[o] };
}

async function paintTile(canvas, z, x, y, mode, zone) {
  const pad = await paddedDem(z, x, y);
  if (!pad) return;
  const cell = cellSize(z, y);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(256, 256);
  const out = image.data;
  for (let j = 0; j < 256; j++) {
    for (let i = 0; i < 256; i++) {
      const t = terrainAt(pad, i, j, cell);
      if (t.slope < 30) continue;
      const cls = t.slope >= 45 ? SLOPE_CLASSES[3] : t.slope >= 40 ? SLOPE_CLASSES[2] : t.slope >= 35 ? SLOPE_CLASSES[1] : SLOPE_CLASSES[0];
      const p = (j * 256 + i) * 4;
      out[p] = cls.rgb[0]; out[p + 1] = cls.rgb[1]; out[p + 2] = cls.rgb[2];
      out[p + 3] = mode === 'zones' && zone ? (zone(t.elev, t.aspect) ? 225 : 45) : 150;
    }
  }
  ctx.putImageData(image, 0, 0);
}

/* ---------------------------------------------------------------------- map */

export async function createMap(el, { onPick, onInfo } = {}) {
  const L = await loadLeaflet();
  const map = L.map(el, { zoomControl: false, attributionControl: true, minZoom: 7, maxZoom: 17, maxBounds: [[45.5, 9], [49.6, 17.5]], maxBoundsViscosity: 0.8 })
    .setView([47.35, 13.1], 9);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  map.attributionControl.setPrefix(false);

  const bases = {
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, subdomains: 'abc',
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM · <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)' }),
    sat: L.tileLayer('https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg', { maxZoom: 17,
      attribution: 'Aerial: <a href="https://basemap.at">basemap.at</a>' }),
  };
  let base = bases.topo.addTo(map);
  const pistes = L.tileLayer('https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png', { maxZoom: 17, opacity: 0.9,
    attribution: 'Pistes © <a href="https://www.opensnowmap.org">OpenSnowMap</a>' });

  let mode = 'angle', zone = null;
  const Slope = L.GridLayer.extend({
    createTile(coords, done) {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      paintTile(canvas, coords.z, coords.x, coords.y, mode, zone).then(() => done(null, canvas), (err) => done(err, canvas));
      return canvas;
    },
  });
  const slope = new Slope({ minZoom: DEM_MIN_ZOOM, minNativeZoom: DEM_MIN_ZOOM, maxNativeZoom: DEM_MAX_ZOOM, maxZoom: 17, opacity: 0.85, updateWhenIdle: true,
    attribution: 'Elevation: <a href="https://registry.opendata.aws/terrain-tiles/">Terrain Tiles</a>' }).addTo(map);

  const pins = L.layerGroup().addTo(map);
  const me = L.layerGroup().addTo(map);
  const popup = L.popup({ maxWidth: 230 });

  // tap anywhere: what is the terrain like right here?
  map.on('click', async (ev) => {
    const z = Math.max(DEM_MIN_ZOOM, Math.min(DEM_MAX_ZOOM, Math.round(map.getZoom())));
    const p = map.project(ev.latlng, z);
    const tx = Math.floor(p.x / 256), ty = Math.floor(p.y / 256);
    const pad = await paddedDem(z, tx, ty);
    if (!pad) return;
    const t = terrainAt(pad, Math.floor(p.x - tx * 256), Math.floor(p.y - ty * 256), cellSize(z, ty));
    const inZone = zone ? zone(t.elev, t.aspect) : null;
    const html = onInfo ? onInfo({ ...t, aspectName: ASPECTS[t.aspect], inZone }) : `${Math.round(t.elev)} m · ${Math.round(t.slope)}°`;
    popup.setLatLng(ev.latlng).setContent(html).openOn(map);
  });

  const api = {
    map,
    /** rows: [{ id, name, lat, lon, cls, text }] */
    setPins(rows) {
      pins.clearLayers();
      for (const r of rows) {
        const icon = L.divIcon({ className: '', html: `<span class="pin ${r.cls}">${r.text}</span>`, iconSize: [34, 34], iconAnchor: [17, 17] });
        L.marker([r.lat, r.lon], { icon, title: r.name, keyboard: false }).on('click', (ev) => { L.DomEvent.stopPropagation(ev); onPick?.(r.id); }).addTo(pins);
      }
    },
    setUser(pos) {
      me.clearLayers();
      if (pos) L.circleMarker([pos.lat, pos.lon], { radius: 7, color: '#fff', weight: 2.5, fillColor: '#1a73e8', fillOpacity: 1, interactive: false }).addTo(me);
    },
    focus(lat, lon, zoom = 13) { map.setView([lat, lon], zoom, { animate: false }); },
    /** 'angle' = every steep slope, 'zones' = highlight the slopes the bulletin warns about, 'off' */
    setSlope(nextMode, nextZone) {
      const changed = nextMode !== mode || nextZone !== zone;
      mode = nextMode; zone = nextZone || null;
      if (mode === 'off') { map.removeLayer(slope); return; }
      if (!map.hasLayer(slope)) slope.addTo(map);
      else if (changed) slope.redraw();
    },
    setBase(name) {
      if (bases[name] === base) return;
      map.removeLayer(base);
      base = bases[name].addTo(map);
      base.bringToBack();
    },
    setPistes(on) { if (on) pistes.addTo(map); else map.removeLayer(pistes); },
    slopeVisible: () => mode !== 'off' && map.getZoom() >= DEM_MIN_ZOOM,
    resize() { map.invalidateSize(); },
  };
  return api;
}
