const QWEATHER_DEFAULT_HOST = "https://devapi.qweather.com";
const CACHE_TTL_MS = 20 * 60 * 1000;

type CacheValue = {
  expiresAt: number;
  payload: QWeatherProxyPayload;
};

type QWeatherHourlyItem = {
  fxTime?: string;
  temp?: string;
  icon?: string;
  text?: string;
  wind360?: string;
  windDir?: string;
  windScale?: string;
  windSpeed?: string;
  humidity?: string;
  pop?: string;
  precip?: string;
  pressure?: string;
  cloud?: string;
  dew?: string;
};

type QWeatherHourlyResponse = {
  code?: string;
  updateTime?: string;
  hourly?: QWeatherHourlyItem[];
  refer?: {
    sources?: string[];
    license?: string[];
  };
};

type QWeatherProxyPayload = {
  source: string;
  provider_update_time?: string;
  hourly: {
    time: string[];
    cloud_cover?: number[];
    relative_humidity_2m?: number[];
    precipitation_probability?: number[];
  };
  daily: Record<string, never>;
  qweather_raw?: {
    text?: string[];
    pop?: number[];
    cloud?: number[];
  };
};

const cache = new Map<string, CacheValue>();

function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeFxTime(value?: string) {
  if (!value) return new Date().toISOString().slice(0, 16);
  return value.slice(0, 16);
}

function normalizeQWeather(payload: QWeatherHourlyResponse): QWeatherProxyPayload {
  if (payload.code !== "200" || !Array.isArray(payload.hourly) || payload.hourly.length === 0) {
    throw new Error(`QWeather response invalid: ${payload.code ?? "empty"}`);
  }
  const rows = payload.hourly;
  const cloud = rows.map((item) => numberFrom(item.cloud)).filter((item): item is number => item !== undefined);
  const humidity = rows.map((item) => numberFrom(item.humidity)).filter((item): item is number => item !== undefined);
  const pop = rows.map((item) => numberFrom(item.pop)).filter((item): item is number => item !== undefined);

  return {
    source: "和风天气 QWeather",
    provider_update_time: payload.updateTime,
    hourly: {
      time: rows.map((item) => normalizeFxTime(item.fxTime)),
      cloud_cover: cloud.length === rows.length ? cloud : undefined,
      relative_humidity_2m: humidity.length === rows.length ? humidity : undefined,
      precipitation_probability: pop.length === rows.length ? pop : undefined,
    },
    daily: {},
    qweather_raw: {
      text: rows.map((item) => item.text ?? ""),
      pop,
      cloud,
    },
  };
}

async function fetchQWeather(cityCode: string, lat?: string | null, lon?: string | null) {
  const key = process.env.QWEATHER_API_KEY;
  if (!key) throw new Error("QWEATHER_API_KEY is not configured");
  const host = process.env.QWEATHER_API_HOST || QWEATHER_DEFAULT_HOST;
  const url = new URL("/v7/weather/24h", host);
  url.searchParams.set("location", lon && lat ? `${lon},${lat}` : cityCode);
  url.searchParams.set("key", key);

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "GlowCast/1.0",
    },
    next: { revalidate: 1200 },
  });
  if (!response.ok) throw new Error(`QWeather request failed: ${response.status}`);
  const payload = (await response.json()) as QWeatherHourlyResponse;
  if (payload.code && payload.code !== "200") {
    throw new Error(`QWeather response code: ${payload.code}`);
  }
  return normalizeQWeather(payload);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const city = url.searchParams.get("city") || "南京";
  const cityCode = url.searchParams.get("cityCode") || "101190101";
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  const cacheKey = `${cityCode}:${lat ?? ""}:${lon ?? ""}`;
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ ...cached.payload, city, cityCode, cache: "hit" });
  }

  try {
    const payload = await fetchQWeather(cityCode, lat, lon);
    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    });
    return Response.json({ ...payload, city, cityCode, cache: "miss" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown QWeather error";
    return Response.json(
      {
        error: message,
        source: "和风天气 QWeather",
        city,
        cityCode,
      },
      { status: 502 },
    );
  }
}
