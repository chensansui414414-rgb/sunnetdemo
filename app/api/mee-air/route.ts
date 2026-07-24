const CENMC_BASE_URL = "http://air.cenmc.cn:18007";
const CACHE_TTL_MS = 30 * 60 * 1000;

type CacheValue = {
  expiresAt: number;
  payload: ResponsePayload;
};

type ResponsePayload = {
  source: string;
  city: string;
  cityCode: string;
  time: string[];
  aqi?: number;
  pm25?: number;
  pm10?: number;
  o3?: number;
  no2?: number;
  so2?: number;
  co?: number;
  quality?: string;
  aerosol_optical_depth: number[];
  aod_method: "pm_aqi_proxy";
  raw_time?: string;
};

const cache = new Map<string, CacheValue>();

function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && value !== "—" && value !== "-") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeTime(value?: string) {
  if (!value) return new Date().toISOString().slice(0, 16);
  if (value.includes("T")) return value.slice(0, 16);
  return value.replace(" ", "T").slice(0, 16);
}

function aodFromAirQuality(pm25?: number, pm10?: number, aqi?: number) {
  const pmSignal = (pm25 ?? 0) / 500 + (pm10 ?? 0) / 900;
  const aqiSignal = (aqi ?? 0) / 1200;
  return Math.max(0.03, Math.min(0.75, Number((0.04 + pmSignal + aqiSignal).toFixed(3))));
}

function normalizeCenmcPayload(payload: unknown, city: string, cityCode: string): ResponsePayload {
  const record = Array.isArray(payload) ? payload[0] : payload;
  if (!record || typeof record !== "object") {
    throw new Error("CENMC response is empty");
  }
  const data = record as Record<string, unknown>;
  const pm25 = numberFrom(data.PM2_5 ?? data.pm25 ?? data["PM2.5"]);
  const pm10 = numberFrom(data.PM10 ?? data.pm10);
  const aqi = numberFrom(data.AQI ?? data.aqi);
  const timePoint = stringFrom(data.TimePoint ?? data.timePoint ?? data.Time ?? data.time);
  const aodProxy = aodFromAirQuality(pm25, pm10, aqi);

  return {
    source: "生态环境部/中国环境监测总站空气质量网页",
    city: stringFrom(data.Area) ?? city,
    cityCode: String(data.CityCode ?? cityCode),
    time: [normalizeTime(timePoint)],
    aqi,
    pm25,
    pm10,
    o3: numberFrom(data.O3 ?? data.o3),
    no2: numberFrom(data.NO2 ?? data.no2),
    so2: numberFrom(data.SO2 ?? data.so2),
    co: numberFrom(data.CO ?? data.co),
    quality: stringFrom(data.Quality),
    aerosol_optical_depth: [aodProxy],
    aod_method: "pm_aqi_proxy",
    raw_time: timePoint,
  };
}

async function fetchCenmc(city: string, cityCode: string) {
  const url = new URL("/CityData/GetAQIDataPublishLiveInfo", CENMC_BASE_URL);
  url.searchParams.set("cityCode", cityCode);
  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      Referer: `${CENMC_BASE_URL}/`,
      "User-Agent": "Mozilla/5.0 GlowCast/1.0",
      "X-Requested-With": "XMLHttpRequest",
    },
    next: { revalidate: 1800 },
  });
  if (!response.ok) throw new Error(`CENMC request failed: ${response.status}`);
  const payload = (await response.json()) as unknown;
  return normalizeCenmcPayload(payload, city, cityCode);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const city = url.searchParams.get("city") || "南京市";
  const cityCode = url.searchParams.get("cityCode") || "320100";
  const cacheKey = `${cityCode}:${city}`;
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ ...cached.payload, cache: "hit" });
  }

  try {
    const payload = await fetchCenmc(city, cityCode);
    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    });
    return Response.json({ ...payload, cache: "miss" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CENMC error";
    return Response.json(
      {
        error: message,
        source: "生态环境部/中国环境监测总站空气质量网页",
        city,
        cityCode,
      },
      { status: 502 },
    );
  }
}
