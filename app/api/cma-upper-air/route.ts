const CACHE_TTL_MS = 60 * 60 * 1000;
const CMA_API_URL = "http://api.data.cma.cn:8090/api";
const DATA_CODE = "UPAR_GLB_MUL_FTM_7DAY";
const INTERFACE_ID = "getUparEleByTimeAndStaIDAndPress";
const DEFAULT_LAYERS = "1000,925,850,700,500,300,200";
const ELEMENTS = [
  "Station_Id_C",
  "Year",
  "Mon",
  "Day",
  "Hour",
  "GPH",
  "TEM",
  "DPT",
  "WIN_D",
  "WIN_S",
].join(",");

type CacheValue = {
  expiresAt: number;
  payload: CmaUpperAirProxyPayload;
};

type CmaRow = Record<string, unknown>;

type CmaPayload = {
  returnCode?: string;
  returnMessage?: string;
  rowCount?: string | number;
  DS?: CmaRow[];
  data?: CmaRow[];
};

type UpperAirLayer = {
  pressure?: number;
  height?: number;
  temperature?: number;
  dewpoint?: number;
  humidity?: number;
  windDirection?: number;
  windSpeed?: number;
};

type UpperAirProfile = {
  time?: string;
  stationId?: string;
  stationName?: string;
  layers: UpperAirLayer[];
  lowLayerHumidity?: number;
  midLayerHumidity?: number;
  highLayerHumidity?: number;
  lowCloudSupport?: number;
  midCloudSupport?: number;
  highCloudSupport?: number;
  profileSupport?: number;
};

type CmaUpperAirProxyPayload = {
  source: string;
  city: string;
  stationId: string;
  stationName?: string;
  profile: UpperAirProfile;
  cma_raw?: {
    returnCode?: string;
    returnMessage?: string;
    rowCount?: string | number;
  };
};

const cache = new Map<string, CacheValue>();

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function cmaTime(value: Date) {
  return [
    value.getUTCFullYear(),
    pad(value.getUTCMonth() + 1),
    pad(value.getUTCDate()),
    pad(value.getUTCHours()),
    pad(value.getUTCMinutes()),
    pad(value.getUTCSeconds()),
  ].join("");
}

function latestSynopticTime(now = new Date()) {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  const h = now.getUTCHours();
  if (h >= 15) return new Date(Date.UTC(y, m, d, 12, 0, 0));
  if (h >= 3) return new Date(Date.UTC(y, m, d, 0, 0, 0));
  return new Date(Date.UTC(y, m, d - 1, 12, 0, 0));
}

function isMissing(value: number) {
  return [999999, 999998, 999990, 99999, 9999, 32766, 32700, -9999].includes(value);
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return isMissing(value) ? undefined : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && !isMissing(parsed)) return parsed;
  }
  return undefined;
}

function stringFrom(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function rowsFrom(payload: unknown): CmaRow[] {
  if (Array.isArray(payload)) return payload as CmaRow[];
  if (!payload || typeof payload !== "object") return [];
  const record = payload as CmaPayload;
  if (Array.isArray(record.DS)) return record.DS;
  if (Array.isArray(record.data)) return record.data;
  return [];
}

function rowTime(row: CmaRow) {
  const year = numberFrom(row.Year);
  const month = numberFrom(row.Mon);
  const day = numberFrom(row.Day);
  const hour = numberFrom(row.Hour);
  if (!year || !month || !day || hour === undefined) return undefined;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:00`;
}

function layerPressure(row: CmaRow) {
  return numberFrom(row.PRS) ??
    numberFrom(row.PRE) ??
    numberFrom(row.Press) ??
    numberFrom(row.pLayer) ??
    pressureFromHeight(layerHeight(row));
}

function layerHeight(row: CmaRow) {
  return numberFrom(row.GPH) ?? numberFrom(row.HGT) ?? numberFrom(row.Height);
}

function pressureFromHeight(height?: number) {
  if (height === undefined) return undefined;
  const standardLevels = [
    { pressure: 1000, height: 110 },
    { pressure: 925, height: 760 },
    { pressure: 850, height: 1460 },
    { pressure: 700, height: 3010 },
    { pressure: 500, height: 5570 },
    { pressure: 300, height: 9160 },
    { pressure: 200, height: 11780 },
  ];
  return standardLevels.reduce((best, level) =>
    Math.abs(level.height - height) < Math.abs(best.height - height) ? level : best,
  ).pressure;
}

function layerFrom(row: CmaRow): UpperAirLayer {
  const temperature = numberFrom(row.TEM);
  const dewpoint = numberFrom(row.DPT);
  return {
    pressure: layerPressure(row),
    height: layerHeight(row),
    temperature,
    dewpoint,
    humidity: numberFrom(row.RHU) ?? numberFrom(row.RH) ?? relativeHumidityFromDewpoint(temperature, dewpoint),
    windDirection: numberFrom(row.WIN_D),
    windSpeed: numberFrom(row.WIN_S),
  };
}

function relativeHumidityFromDewpoint(temperature?: number, dewpoint?: number) {
  if (temperature === undefined || dewpoint === undefined) return undefined;
  const saturationAtDewpoint = Math.exp((17.625 * dewpoint) / (243.04 + dewpoint));
  const saturationAtTemperature = Math.exp((17.625 * temperature) / (243.04 + temperature));
  return Math.max(0, Math.min(100, (saturationAtDewpoint / saturationAtTemperature) * 100));
}

function average(values: Array<number | undefined>) {
  const valid = values.filter((value): value is number => value !== undefined && Number.isFinite(value));
  if (!valid.length) return undefined;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function supportFromHumidity(value: number | undefined, threshold = 72) {
  if (value === undefined) return undefined;
  return Math.max(0, Math.min(100, Math.round((value - threshold) * 3.2 + 35)));
}

function normalizeRows(rows: CmaRow[], fallbackStationName?: string): UpperAirProfile {
  const uniqueByPressure = new Map<number, CmaRow>();
  rows.forEach((row) => {
    const pressure = layerPressure(row);
    if (pressure !== undefined && !uniqueByPressure.has(pressure)) uniqueByPressure.set(pressure, row);
  });
  const sortedRows = [...uniqueByPressure.values()].sort((a, b) => (layerPressure(b) ?? 0) - (layerPressure(a) ?? 0));
  const layers = sortedRows.map(layerFrom);
  const lowLayerHumidity = average(layers.filter((layer) => [1000, 925, 850].includes(Math.round(layer.pressure ?? 0))).map((layer) => layer.humidity));
  const midLayerHumidity = average(layers.filter((layer) => [700, 500].includes(Math.round(layer.pressure ?? 0))).map((layer) => layer.humidity));
  const highLayerHumidity = average(layers.filter((layer) => [300, 200].includes(Math.round(layer.pressure ?? 0))).map((layer) => layer.humidity));
  const lowCloudSupport = supportFromHumidity(lowLayerHumidity, 78);
  const midCloudSupport = supportFromHumidity(midLayerHumidity, 68);
  const highCloudSupport = supportFromHumidity(highLayerHumidity, 58);
  const profileSupport = average([lowCloudSupport, midCloudSupport, highCloudSupport]);

  return {
    time: rowTime(sortedRows[0] ?? {}),
    stationId: stringFrom(sortedRows[0]?.Station_Id_C),
    stationName: stringFrom(sortedRows[0]?.Station_Name) ?? fallbackStationName,
    layers,
    lowLayerHumidity,
    midLayerHumidity,
    highLayerHumidity,
    lowCloudSupport,
    midCloudSupport,
    highCloudSupport,
    profileSupport,
  };
}

async function fetchCmaUpperAir(city: string, stationId: string, stationName?: string, time?: string, pLayers = DEFAULT_LAYERS) {
  const userId = process.env.CMA_UPPER_AIR_USER_ID;
  const password = process.env.CMA_UPPER_AIR_PASSWORD;
  if (!userId || !password) throw new Error("CMA_UPPER_AIR_USER_ID or CMA_UPPER_AIR_PASSWORD is not configured");

  const queryTime = time || cmaTime(latestSynopticTime());
  const url = new URL(CMA_API_URL);
  url.searchParams.set("userId", userId);
  url.searchParams.set("pwd", password);
  url.searchParams.set("dataFormat", "json");
  url.searchParams.set("interfaceId", INTERFACE_ID);
  url.searchParams.set("dataCode", DATA_CODE);
  url.searchParams.set("times", queryTime);
  url.searchParams.set("staIDs", stationId);
  url.searchParams.set("pLayers", pLayers);
  url.searchParams.set("elements", ELEMENTS);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "User-Agent": "GlowCast/1.0",
      },
      signal: controller.signal,
      next: { revalidate: 3600 },
    });
    if (!response.ok) throw new Error(`CMA upper air request failed: ${response.status}`);
    const payload = (await response.json()) as CmaPayload;
    const rows = rowsFrom(payload);
    if (!rows.length) {
      throw new Error(payload.returnMessage ? `CMA upper air returned no rows: ${payload.returnMessage}` : "CMA upper air returned no rows");
    }
    return {
      source: "中国气象数据网 CMA 全球高空基本气象观测数据",
      city,
      stationId,
      stationName,
      profile: normalizeRows(rows, stationName),
      cma_raw: {
        returnCode: payload.returnCode,
        returnMessage: payload.returnMessage,
        rowCount: payload.rowCount,
      },
    } satisfies CmaUpperAirProxyPayload;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const city = url.searchParams.get("city") || "南京";
  const stationId = url.searchParams.get("stationId") || "58238";
  const stationName = url.searchParams.get("stationName") || undefined;
  const time = url.searchParams.get("time") || undefined;
  const pLayers = url.searchParams.get("pLayers") || DEFAULT_LAYERS;
  const cacheKey = `${stationId}:${time || "latest"}:${pLayers}`;
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ ...cached.payload, cache: "hit" });
  }

  try {
    const payload = await fetchCmaUpperAir(city, stationId, stationName, time, pLayers);
    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    });
    return Response.json({ ...payload, cache: "miss" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CMA upper air error";
    return Response.json(
      {
        error: message,
        source: "中国气象数据网 CMA 全球高空基本气象观测数据",
        city,
        stationId,
        stationName,
      },
      { status: 502 },
    );
  }
}
