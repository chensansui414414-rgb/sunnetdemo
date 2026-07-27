const CACHE_TTL_MS = 30 * 60 * 1000;
const CMA_API_URL = "http://api.data.cma.cn:8090/api";
const DATA_CODE = "SURF_CHN_MUL_HOR_3H";
const INTERFACE_ID = "getSurfEleByTimeRangeAndStaID";
const ELEMENTS = [
  "Station_Id_C",
  "Year",
  "Mon",
  "Day",
  "Hour",
  "TEM",
  "RHU",
  "PRS",
  "WIN_D_Avg_2mi",
  "WIN_S_Avg_2mi",
  "PRE_1h",
  "PRE_3h",
  "VIS",
].join(",");

type CacheValue = {
  expiresAt: number;
  payload: CmaGroundProxyPayload;
};

type CmaRow = Record<string, unknown>;

type CmaPayload = {
  returnCode?: string;
  returnMessage?: string;
  rowCount?: string | number;
  DS?: CmaRow[];
  data?: CmaRow[];
};

type CmaGroundProxyPayload = {
  source: string;
  city: string;
  stationId: string;
  stationName?: string;
  observation: {
    time?: string;
    stationId?: string;
    stationName?: string;
    temperature?: number;
    humidity?: number;
    pressure?: number;
    windDirection?: number;
    windSpeed?: number;
    precipitation1h?: number;
    precipitation3h?: number;
    visibility?: number;
  };
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
  const chinaTime = new Date(value.getTime() + 8 * 60 * 60 * 1000);
  return [
    chinaTime.getUTCFullYear(),
    pad(chinaTime.getUTCMonth() + 1),
    pad(chinaTime.getUTCDate()),
    pad(chinaTime.getUTCHours()),
    pad(chinaTime.getUTCMinutes()),
    pad(chinaTime.getUTCSeconds()),
  ].join("");
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return isMissing(value) ? undefined : value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && !isMissing(parsed)) return parsed;
  }
  return undefined;
}

function isMissing(value: number) {
  return [999999, 999998, 999990, 99999, 9999, 32766, 32700, -9999].includes(value);
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function normalizeVisibility(value: number | undefined) {
  if (value === undefined) return undefined;
  if (value > 1000) return value;
  if (value > 80) return value * 10;
  return value * 1000;
}

function normalizeRow(row: CmaRow, fallbackStationName?: string) {
  return {
    time: rowTime(row),
    stationId: stringFrom(row.Station_Id_C) ?? String(numberFrom(row.Station_Id_C) ?? ""),
    stationName: stringFrom(row.Station_Name) ?? fallbackStationName,
    temperature: numberFrom(row.TEM),
    humidity: numberFrom(row.RHU),
    pressure: numberFrom(row.PRS),
    windDirection: numberFrom(row.WIN_D_Avg_2mi),
    windSpeed: numberFrom(row.WIN_S_Avg_2mi),
    precipitation1h: numberFrom(row.PRE_1h),
    precipitation3h: numberFrom(row.PRE_3h),
    visibility: normalizeVisibility(numberFrom(row.VIS)),
  };
}

function latestRow(rows: CmaRow[]) {
  return [...rows].sort((a, b) => {
    const left = rowTime(a) ?? "";
    const right = rowTime(b) ?? "";
    return right.localeCompare(left);
  })[0];
}

async function fetchCmaGround(city: string, stationId: string, stationName?: string) {
  const userId = process.env.CMA_GROUND_USER_ID;
  const password = process.env.CMA_GROUND_PASSWORD;
  if (!userId || !password) throw new Error("CMA_GROUND_USER_ID or CMA_GROUND_PASSWORD is not configured");

  const now = new Date();
  const start = new Date(now.getTime() - 72 * 60 * 60 * 1000);
  const url = new URL(CMA_API_URL);
  url.searchParams.set("userId", userId);
  url.searchParams.set("pwd", password);
  url.searchParams.set("dataFormat", "json");
  url.searchParams.set("interfaceId", INTERFACE_ID);
  url.searchParams.set("dataCode", DATA_CODE);
  url.searchParams.set("timeRange", `[${cmaTime(start)},${cmaTime(now)}]`);
  url.searchParams.set("staIDs", stationId);
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
      next: { revalidate: 1800 },
    });
    if (!response.ok) throw new Error(`CMA request failed: ${response.status}`);
    const payload = (await response.json()) as CmaPayload;
    const rows = rowsFrom(payload);
    if (!rows.length) {
      throw new Error(payload.returnMessage ? `CMA returned no rows: ${payload.returnMessage}` : "CMA returned no rows");
    }
    const row = latestRow(rows);
    const observation = normalizeRow(row, stationName);
    return {
      source: "中国气象数据网 CMA 地面站定时值观测资料",
      city,
      stationId,
      stationName,
      observation,
      cma_raw: {
        returnCode: payload.returnCode,
        returnMessage: payload.returnMessage,
        rowCount: payload.rowCount,
      },
    } satisfies CmaGroundProxyPayload;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const city = url.searchParams.get("city") || "南京";
  const stationId = url.searchParams.get("stationId") || "58238";
  const stationName = url.searchParams.get("stationName") || undefined;
  const cacheKey = `${stationId}`;
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ ...cached.payload, cache: "hit" });
  }

  try {
    const payload = await fetchCmaGround(city, stationId, stationName);
    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    });
    return Response.json({ ...payload, cache: "miss" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CMA ground observation error";
    return Response.json(
      {
        error: message,
        source: "中国气象数据网 CMA 地面站定时值观测资料",
        city,
        stationId,
        stationName,
      },
      { status: 502 },
    );
  }
}
