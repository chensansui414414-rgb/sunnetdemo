const CACHE_TTL_MS = 10 * 60 * 1000;
const CMA_API_URL = "http://api.data.cma.cn:8090/api";
const DATA_CODE = "RADA_L3_MST_V3_CREF_PNG";
const INTERFACE_ID = "getRadaFileByTimeRange";
const ELEMENTS = "Station_Id_C,DATETIME,FORMAT,FILE_NAME";

type CacheValue = {
  expiresAt: number;
  payload: CmaRadarProxyPayload;
};

type CmaRow = Record<string, unknown>;

type CmaPayload = {
  returnCode?: string;
  returnMessage?: string;
  rowCount?: string | number;
  DS?: CmaRow[];
  data?: CmaRow[];
};

type CmaRadarFile = {
  stationId?: string;
  datetime?: string;
  format?: string;
  fileName?: string;
  fileUrl?: string;
};

type CmaRadarProxyPayload = {
  source: string;
  city?: string;
  stationId: string;
  latest?: CmaRadarFile;
  files: CmaRadarFile[];
  analysis: {
    status: "metadata_only" | "no_file";
    method: string;
    rainWallScore?: number;
    clearingScore?: number;
    note: string;
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

function normalizeFile(row: CmaRow): CmaRadarFile {
  return {
    stationId: stringFrom(row.Station_Id_C),
    datetime: stringFrom(row.DATETIME),
    format: stringFrom(row.FORMAT),
    fileName: stringFrom(row.FILE_NAME),
    fileUrl: stringFrom(row.FILE_URL),
  };
}

function publicPayload(payload: CmaRadarProxyPayload) {
  const stripSignedUrl = (file: CmaRadarFile) => ({
    stationId: file.stationId,
    datetime: file.datetime,
    format: file.format,
    fileName: file.fileName,
  });
  return {
    ...payload,
    latest: payload.latest ? stripSignedUrl(payload.latest) : undefined,
    files: payload.files.map(stripSignedUrl),
    imageAvailable: Boolean(payload.latest?.fileUrl),
  };
}

async function proxyRadarImage(file: CmaRadarFile) {
  if (!file.fileUrl) throw new Error("CMA radar metadata has no FILE_URL");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(file.fileUrl, {
      headers: {
        Accept: "image/png,image/*;q=0.8,*/*;q=0.1",
        "User-Agent": "GlowCast/1.0",
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CMA radar PNG download failed: ${response.status}`);
    const upstreamContentType = response.headers.get("content-type");
    const contentType =
      file.format?.toLowerCase() === "png" || file.fileName?.toLowerCase().endsWith(".png")
        ? "image/png"
        : upstreamContentType || "application/octet-stream";
    const image = await response.arrayBuffer();
    if (!image.byteLength) throw new Error("CMA radar PNG is empty");

    return new Response(image, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(image.byteLength),
        "Cache-Control": "public, max-age=300, s-maxage=300",
        "X-Radar-Data-Time": file.datetime || "",
        "X-Radar-File-Name": file.fileName || "",
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCmaRadar(city: string | undefined, stationId: string) {
  const userId = process.env.CMA_RADAR_USER_ID;
  const password = process.env.CMA_RADAR_PASSWORD;
  if (!userId || !password) throw new Error("CMA_RADAR_USER_ID or CMA_RADAR_PASSWORD is not configured");

  const now = new Date();
  const start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const url = new URL(CMA_API_URL);
  url.searchParams.set("userId", userId);
  url.searchParams.set("pwd", password);
  url.searchParams.set("dataFormat", "json");
  url.searchParams.set("interfaceId", INTERFACE_ID);
  url.searchParams.set("dataCode", DATA_CODE);
  url.searchParams.set("timeRange", `[${cmaTime(start)},${cmaTime(now)}]`);
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
      next: { revalidate: 600 },
    });
    if (!response.ok) throw new Error(`CMA radar request failed: ${response.status}`);
    const payload = (await response.json()) as CmaPayload;
    const files = rowsFrom(payload)
      .map(normalizeFile)
      .filter((item) => item.fileName || item.datetime)
      .sort((a, b) => (b.datetime ?? "").localeCompare(a.datetime ?? ""));
    if (!files.length) {
      throw new Error(payload.returnMessage ? `CMA radar returned no files: ${payload.returnMessage}` : "CMA radar returned no files");
    }
    return {
      source: "中国气象数据网 CMA 天气雷达组网组合反射率图像产品",
      city,
      stationId,
      latest: files[0],
      files,
      analysis: {
        status: files[0]?.fileName ? "metadata_only" : "no_file",
        method: "该产品是全国雷达组网组合反射率图；JSON 模式只返回安全元数据，PNG 由同源后端代理下载。",
        note: files[0]?.fileUrl
          ? "已取得 CMA 临时 PNG 地址，可通过 format=image 同源代理读取；尚未进行像素反射率解析。"
          : "未拿到可解析雷达文件。",
      },
      cma_raw: {
        returnCode: payload.returnCode,
        returnMessage: payload.returnMessage,
        rowCount: payload.rowCount,
      },
    } satisfies CmaRadarProxyPayload;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const city = url.searchParams.get("city") || undefined;
  const stationId = url.searchParams.get("stationId");
  const format = url.searchParams.get("format") || "json";

  if (!stationId) {
    return Response.json(
      {
        error: "stationId is required. CMA radar products use radar station IDs, not surface weather station IDs.",
        source: "中国气象数据网 CMA 天气雷达组网组合反射率图像产品",
        city,
      },
      { status: 400 },
    );
  }

  const cacheKey = stationId;
  const cached = cache.get(cacheKey);
  const validCached = cached && cached.expiresAt > Date.now() ? cached : undefined;

  try {
    const payload = validCached?.payload ?? await fetchCmaRadar(city, stationId);
    if (format === "image") {
      return await proxyRadarImage(payload.latest ?? {});
    }
    cache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    });
    return Response.json({ ...publicPayload(payload), cache: validCached ? "hit" : "miss" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown CMA radar error";
    return Response.json(
      {
        error: message,
        source: "中国气象数据网 CMA 天气雷达组网组合反射率图像产品",
        city,
        stationId,
      },
      { status: 502 },
    );
  }
}
