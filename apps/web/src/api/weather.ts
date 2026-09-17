/** Event-time weather via Open-Meteo (free, no API key, CORS-open).
 *
 * Docs: https://open-meteo.com/en/docs — forecast endpoint takes WGS84
 * coords and returns WMO weather codes; geocoding endpoint resolves place
 * names. All network access is fail-silent by design: a weather chip must
 * never break an agenda row or the kiosk. Results are cached (geocodes
 * persistently, forecasts per day) to stay kind to the free tier.
 */

export interface GeoHit {
  latitude: number;
  longitude: number;
  label: string;
}

export interface DayWeather {
  /** WMO weather code (0, 1, 2, 3, 45, 48, 51, …, 99). */
  code: number;
  tempMax: number | null;
  tempMin: number | null;
  /** Max precipitation probability 0–100, or null when unavailable. */
  precipProb: number | null;
}

/** WMO interpretation codes → short labels (see Open-Meteo docs table). */
export function wmoLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1) return "Mostly clear";
  if (code === 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code === 51 || code === 53 || code === 55) return "Drizzle";
  if (code === 56 || code === 57) return "Freezing drizzle";
  if (code === 61 || code === 63 || code === 65) return "Rain";
  if (code === 66 || code === 67) return "Freezing rain";
  if (code === 71 || code === 73 || code === 75) return "Snow";
  if (code === 77) return "Snow grains";
  if (code === 80 || code === 81 || code === 82) return "Showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code === 95) return "Thunderstorm";
  if (code === 96 || code === 99) return "Storm with hail";
  return "—";
}

/** Compact glyph for chips and the kiosk header. */
export function wmoGlyph(code: number): string {
  if (code === 0 || code === 1) return "☀";
  if (code === 2) return "⛅";
  if (code === 3) return "☁";
  if (code === 45 || code === 48) return "🌫";
  if ((code >= 51 && code <= 57) || (code >= 80 && code <= 82)) return "🌧";
  if ((code >= 61 && code <= 67)) return "🌧";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "❄";
  if (code === 95 || code === 96 || code === 99) return "⛈";
  return "•";
}

/** "☀ 21°/14°" plus rain odds when worth mentioning (>=30%). */
export function formatDayWeather(w: DayWeather): string {
  const hi = w.tempMax === null ? "–" : `${Math.round(w.tempMax)}°`;
  const lo = w.tempMin === null ? "–" : `${Math.round(w.tempMin)}°`;
  const rain = w.precipProb !== null && w.precipProb >= 30 ? ` · ${Math.round(w.precipProb)}% rain` : "";
  return `${wmoGlyph(w.code)} ${hi}/${lo}${rain}`;
}

export function geoCacheKey(name: string): string {
  return `weather:geo:${name.trim().toLowerCase()}`;
}

export function dayCacheKey(lat: number, lon: number, dateISO: string): string {
  return `weather:day:${lat.toFixed(3)},${lon.toFixed(3)},${dateISO}`;
}

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { value: T; expires: number };
    if (parsed.expires < Date.now()) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed.value;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T, ttlMs: number): void {
  try {
    localStorage.setItem(key, JSON.stringify({ value, expires: Date.now() + ttlMs }));
  } catch {
    // Storage full/blocked — weather just refetches next time.
  }
}

// In-flight request dedup: several agenda rows (or an agenda row plus a
// kiosk header) can resolve the same location/day at the same moment,
// before either has had a chance to write the localStorage cache —
// without this, each one fires its own network request.
const geoInFlight = new Map<string, Promise<GeoHit | null>>();
const dayInFlight = new Map<string, Promise<DayWeather | null>>();

/** Resolve "Edmonton" / "Hall B" → coords. Returns null when unresolvable
 * (vague room names simply get no chip — never an error). */
export async function geocodeLocation(name: string): Promise<GeoHit | null> {
  const query = (name || "").trim();
  if (query.length < 2) return null;
  const key = geoCacheKey(query);
  const cached = readCache<GeoHit>(key);
  if (cached) return cached;
  const pending = geoInFlight.get(key);
  if (pending) return pending;
  const promise = _geocodeLocation(query, key).finally(() => geoInFlight.delete(key));
  geoInFlight.set(key, promise);
  return promise;
}

async function _geocodeLocation(query: string, key: string): Promise<GeoHit | null> {
  try {
    const res = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      results?: { latitude: number; longitude: number; name: string; country?: string }[];
    };
    const hit = data.results?.[0];
    if (!hit) return null;
    const geo: GeoHit = {
      latitude: hit.latitude,
      longitude: hit.longitude,
      label: hit.country ? `${hit.name}, ${hit.country}` : hit.name,
    };
    // Place names don't move: cache for 30 days.
    writeCache(key, geo, 30 * 24 * 3600 * 1000);
    return geo;
  } catch {
    return null;
  }
}

/** Day forecast for a date (YYYY-MM-DD). Null on any failure. */
export async function getDayWeather(lat: number, lon: number, dateISO: string): Promise<DayWeather | null> {
  const key = dayCacheKey(lat, lon, dateISO);
  const cached = readCache<DayWeather>(key);
  if (cached) return cached;
  const pending = dayInFlight.get(key);
  if (pending) return pending;
  const promise = _getDayWeather(lat, lon, dateISO, key).finally(() => dayInFlight.delete(key));
  dayInFlight.set(key, promise);
  return promise;
}

async function _getDayWeather(lat: number, lon: number, dateISO: string, key: string): Promise<DayWeather | null> {
  try {
    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      timezone: "auto",
      forecast_days: "16",
      start_date: dateISO,
      end_date: dateISO,
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      daily?: {
        weather_code?: number[];
        temperature_2m_max?: (number | null)[];
        temperature_2m_min?: (number | null)[];
        precipitation_probability_max?: (number | null)[];
      };
    };
    const daily = data.daily;
    if (!daily || !daily.weather_code?.length) return null;
    const out: DayWeather = {
      code: daily.weather_code[0],
      tempMax: daily.temperature_2m_max?.[0] ?? null,
      tempMin: daily.temperature_2m_min?.[0] ?? null,
      precipProb: daily.precipitation_probability_max?.[0] ?? null,
    };
    // Forecasts go stale fast: 3-hour cache.
    writeCache(key, out, 3 * 3600 * 1000);
    return out;
  } catch {
    return null;
  }
}

/** One-shot helper for agenda rows: location string + event date →
 * display chip text, or null when weather can't be resolved. */
export async function weatherForEvent(location: string | null, startISO: string): Promise<string | null> {
  if (!location) return null;
  const geo = await geocodeLocation(location);
  if (!geo) return null;
  const dateISO = new Date(startISO).toISOString().slice(0, 10);
  const day = await getDayWeather(geo.latitude, geo.longitude, dateISO);
  if (!day) return null;
  return formatDayWeather(day);
}
