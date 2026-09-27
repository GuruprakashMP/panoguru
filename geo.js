// Pure geography helpers: distance, scoring, random sampling inside country polygons.

const EARTH_RADIUS_KM = 6371.0088;

export function toRad(deg) { return (deg * Math.PI) / 180; }

/** Great-circle distance in km between {lat,lng} points (haversine). */
export function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** GeoGuessr-style score: max * exp(-d / scale); within 25 m counts as perfect. */
export function scoreForDistance(km, { maxScorePerRound = 5000, scoreScaleKm = 1492.7 } = {}) {
  if (!Number.isFinite(km) || km < 0) return 0;
  if (km <= 0.025) return maxScorePerRound;
  return Math.max(0, Math.round(maxScorePerRound * Math.exp(-km / scoreScaleKm)));
}

export function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("en-US")} km`;
}

export function formatPoints(n) { return Math.round(n).toLocaleString("en-US"); }

/** Weighted random choice; items must have a numeric weight under `key`. */
export function weightedPick(items, key, rng = Math.random) {
  let total = 0;
  for (const it of items) total += it[key] > 0 ? it[key] : 0;
  let r = rng() * total;
  for (const it of items) {
    const w = it[key] > 0 ? it[key] : 0;
    if (r < w) return it;
    r -= w;
  }
  return items[items.length - 1];
}

/** Ray-casting point-in-ring test. ring = [[lng,lat],...] */
export function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Point inside a polygon part (outer ring + holes). */
export function pointInPart(lng, lat, part) {
  const [outer, ...holes] = part.r;
  if (!pointInRing(lng, lat, outer)) return false;
  for (const h of holes) if (pointInRing(lng, lat, h)) return false;
  return true;
}

/** Find the country (from the dataset) containing a point, or null. */
export function countryAt(countries, lat, lng) {
  for (const c of countries) {
    for (const p of c.p) {
      const [minx, miny, maxx, maxy] = p.b;
      if (lng < minx || lng > maxx || lat < miny || lat > maxy) continue;
      if (pointInPart(lng, lat, p)) return c;
    }
  }
  return null;
}

/**
 * Uniform-ish random point inside a country: choose a polygon part weighted by
 * area, then rejection-sample inside its bounding box. Latitude is sampled so
 * that density is (roughly) uniform on the sphere.
 */
export function randomPointInCountry(country, rng = Math.random, maxTries = 400) {
  const part = weightedPick(country.p, "a", rng);
  const [minx, miny, maxx, maxy] = part.b;
  const s1 = Math.sin(toRad(miny)), s2 = Math.sin(toRad(maxy));
  for (let i = 0; i < maxTries; i++) {
    const lng = minx + rng() * (maxx - minx);
    const lat = (Math.asin(s1 + rng() * (s2 - s1)) * 180) / Math.PI;
    if (pointInPart(lng, lat, part)) return { lat, lng };
  }
  // Degenerate part (e.g. extremely thin): fall back to the bbox centre.
  return { lat: (miny + maxy) / 2, lng: (minx + maxx) / 2 };
}

/** Deterministic PRNG (mulberry32) for seeded games. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bearing (deg) from a to b, used to face the camera somewhere sensible. */
export function bearing(a, b) {
  const la1 = toRad(a.lat), la2 = toRad(b.lat), dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
