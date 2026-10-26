// Shared MapLibre map for the fruit, festival and plan pages: the site's paper base map
// (same OpenFreeMap style as BASE_STYLE in public/app.js), soft relief shading, optional 3D terrain.
import * as maplibregl from 'maplibre-gl';

export { maplibregl };

const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const EN_NAME = ['coalesce', ['get', 'name:en'], ['get', 'name_en']];
export const JAPAN_BOUNDS = [[128.6, 30.6], [146.2, 45.6]];
export const REGION_BOUNDS = {
  japan: JAPAN_BOUNDS,
  hokkaido: [[139.6, 41.3], [145.8, 45.5]],
  tohoku: [[139.3, 37.0], [142.1, 41.6]],
  kanto: [[138.4, 34.8], [141.0, 37.2]],
  chubu: [[135.9, 34.5], [139.9, 38.6]],
  kansai: [[134.2, 33.4], [136.9, 35.8]],
  chugoku: [[130.8, 33.7], [134.5, 35.6]],
  shikoku: [[132.0, 32.7], [134.8, 34.5]],
  kyushu: [[128.6, 30.9], [132.1, 34.0]],
};

export const hasWebGL = (() => {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
})();

function baseStyle() {
  const dem = { type: 'raster-dem', tiles: [TERRAIN_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 12 };
  return {
    version: 8,
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      omt: {
        type: 'vector', url: 'https://tiles.openfreemap.org/planet',
        attribution: '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> · &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      },
      'dem-shade': dem,
      'dem-terrain': { ...dem },
    },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': '#f3ede2' } },
      { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': '#e7e6d2', 'fill-opacity': 0.7 } },
      { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: ['in', ['get', 'class'], ['literal', ['wood', 'grass']]], paint: { 'fill-color': '#e9e6d3', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.35, 10, 0.6] } },
      { id: 'urban', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood', 'commercial', 'retail']]], minzoom: 8, paint: { 'fill-color': '#ece4d6', 'fill-opacity': 0.8 } },
      {
        id: 'hillshade', type: 'hillshade', source: 'dem-shade',
        paint: { 'hillshade-exaggeration': 0.3, 'hillshade-shadow-color': '#6b5a45', 'hillshade-highlight-color': '#fffaf0', 'hillshade-accent-color': '#7a6a55', 'hillshade-illumination-direction': 315 },
      },
      { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': '#cbd8d8' } },
      { id: 'river', type: 'line', source: 'omt', 'source-layer': 'waterway', minzoom: 8, paint: { 'line-color': '#c3d3d3', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 14, 2.5] } },
      { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12, filter: ['in', ['get', 'class'], ['literal', ['minor', 'service', 'tertiary']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#fffcf7', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 16, 4] } },
      { id: 'road-major', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 7, filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary']]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'class'], ['motorway', 'trunk'], '#e8d3b4', '#fffcf7'], 'line-width': ['interpolate', ['linear'], ['zoom'], 7, 0.5, 12, 1.8, 16, 7] } },
      { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 10, filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': '#cbbfae', 'line-width': 0.8, 'line-dasharray': [3, 2] } },
      { id: 'pref-border', type: 'line', source: 'omt', 'source-layer': 'boundary', minzoom: 5, filter: ['all', ['==', ['get', 'admin_level'], 4], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': '#c4b8a3', 'line-width': 0.7, 'line-dasharray': [3, 2] } },
      { id: 'country-border', type: 'line', source: 'omt', 'source-layer': 'boundary', filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]], paint: { 'line-color': '#b3a690', 'line-width': 1 } },
      { id: 'place-small', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 9, filter: ['all', ['in', ['get', 'class'], ['literal', ['town', 'village']]], ['any', ['has', 'name:en'], ['has', 'name_en']]], layout: { 'text-field': EN_NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 11.5 }, paint: { 'text-color': '#5a534b', 'text-halo-color': '#f6f1e8', 'text-halo-width': 1.4 } },
      { id: 'place-city', type: 'symbol', source: 'omt', 'source-layer': 'place', minzoom: 5.5, filter: ['all', ['==', ['get', 'class'], 'city'], ['any', ['has', 'name:en'], ['has', 'name_en']]], layout: { 'text-field': EN_NAME, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 12, 14] }, paint: { 'text-color': '#4c453c', 'text-halo-color': '#f6f1e8', 'text-halo-width': 1.5 } },
    ],
  };
}

export function createMap(container, { attribution = '', bounds = JAPAN_BOUNDS } = {}) {
  const map = new maplibregl.Map({
    container,
    style: baseStyle(),
    bounds,
    fitBoundsOptions: { padding: 24 },
    minZoom: 3.6,
    maxZoom: 15,
    maxPitch: 70,
    maxBounds: [[110, 18], [165, 54]],
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    attributionControl: { compact: true, customAttribution: `${attribution}${attribution ? ' · ' : ''}Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen / AWS</a>` },
    dragRotate: false,
    pitchWithRotate: false,
    fadeDuration: 0,
  });
  map.touchZoomRotate.disableRotation();
  // Start the attribution collapsed on small screens so it never covers the legend.
  if (matchMedia('(max-width: 960px)').matches) {
    map.once('load', () => map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
  }
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  return map;
}

// 3D only where relief explains something, such as orchards on a basin floor.
export function setTerrain(map, on, { reducedMotion = false } = {}) {
  if (on) {
    map.setTerrain({ source: 'dem-terrain', exaggeration: 1.6 });
    map.dragRotate.enable();
    map.easeTo({ pitch: 58, duration: reducedMotion ? 0 : 900 });
  } else {
    map.setTerrain(null);
    map.dragRotate.disable();
    map.easeTo({ pitch: 0, bearing: 0, duration: reducedMotion ? 0 : 600 });
  }
}

export function fitRegion(map, id, { reducedMotion = false, padding = 30 } = {}) {
  map.fitBounds(REGION_BOUNDS[id] ?? JAPAN_BOUNDS, { padding, duration: reducedMotion ? 0 : 800 });
}
