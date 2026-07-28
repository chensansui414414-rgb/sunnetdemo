import {
  analyzeRadarImage,
  decodeRadarPng,
  radarCityCalibrations,
  type RadarImageMetrics,
} from "./radar-image";

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
  regionCode?: string;
};

type CmaRadarProxyPayload = {
  source: string;
  city?: string;
  stationId: string;
  latest?: CmaRadarFile;
  files: CmaRadarFile[];
  analysis: {
    status: "parsed" | "metadata_only" | "no_file";
    method: string;
    rainWallScore?: number;
    clearingScore?: number;
    echoTrend?: "increasing" | "stable" | "decreasing";
    cityMetrics?: RadarImageMetrics["city"];
    sunrisePathMetrics?: RadarImageMetrics["sunrisePath"];
    sunsetPathMetrics?: RadarImageMetrics["sunsetPath"];
    previousCityMetrics?: RadarImageMetrics["city"];
    dataAgeMinutes?: number;
    regionCode?: string;
    imageSize?: { width: number; height: number };
    geolocationQuality?: "city_control_point_approximation";
    reflectivityScale?: "5-70 dBZ, 5 dBZ intervals";
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
  const fileName = stringFrom(row.FILE_NAME);
  return {
    stationId: stringFrom(row.Station_Id_C),
    datetime: stringFrom(row.DATETIME),
    format: stringFrom(row.FORMAT),
    fileName,
    fileUrl: stringFrom(row.FILE_URL),
    regionCode: fileName?.match(/_DOR_([A-Z0-9]+)_CREF_/)?.[1],
  };
}

const radarRegionByCity: Record<string, string> = {
  北京: "ANCN",
  上海: "AECN",
  南京: "AECN",
  南通: "AECN",
  广州: "ASCN",
  成都: "ASWC",
};

function publicPayload(payload: CmaRadarProxyPayload) {
  const stripSignedUrl = (file: CmaRadarFile) => ({
    stationId: file.stationId,
    datetime: file.datetime,
    format: file.format,
    fileName: file.fileName,
    regionCode: file.regionCode,
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

async function downloadRadarImage(file: CmaRadarFile) {
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
    const image = await response.arrayBuffer();
    if (!image.byteLength) throw new Error("CMA radar PNG is empty");
    return image;
  } finally {
    clearTimeout(timer);
  }
}

function parseCmaUtc(value?: string) {
  if (!value || !/^\d{14}$/.test(value)) return undefined;
  return Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(4, 6)) - 1,
    Number(value.slice(6, 8)),
    Number(value.slice(8, 10)),
    Number(value.slice(10, 12)),
    Number(value.slice(12, 14)),
  );
}

async function parseRadarAnalysis(
  city: string | undefined,
  files: CmaRadarFile[],
  fallback: CmaRadarProxyPayload["analysis"],
): Promise<CmaRadarProxyPayload["analysis"]> {
  if (!city) return fallback;
  const calibration = radarCityCalibrations[city];
  const latest = files[0];
  if (!calibration || !latest?.fileUrl || latest.regionCode !== calibration.regionCode) return fallback;

  try {
    const previous = files.find((file) => {
      const latestTime = parseCmaUtc(latest.datetime);
      const fileTime = parseCmaUtc(file.datetime);
      return latestTime !== undefined && fileTime !== undefined && latestTime - fileTime >= 10 * 60 * 1000;
    });
    const [latestBuffer, previousBuffer] = await Promise.all([
      downloadRadarImage(latest),
      previous?.fileUrl ? downloadRadarImage(previous) : Promise.resolve(undefined),
    ]);
    const latestImage = await decodeRadarPng(latestBuffer);
    const latestMetrics = analyzeRadarImage(latestImage, calibration);
    let previousMetrics: RadarImageMetrics | undefined;
    if (previousBuffer) {
      previousMetrics = analyzeRadarImage(await decodeRadarPng(previousBuffer), calibration);
    }

    const coverageDelta = previousMetrics
      ? latestMetrics.city.echoCoverage - previousMetrics.city.echoCoverage
      : 0;
    const echoTrend = coverageDelta >= 4 ? "increasing" : coverageDelta <= -4 ? "decreasing" : "stable";
    const sunsetRisk =
      latestMetrics.sunsetPath.echoCoverage * 1.7 +
      latestMetrics.sunsetPath.strongEchoCoverage * 2.2 +
      Math.max(0, latestMetrics.sunsetPath.maxDbz - 25) * 0.7;
    const cityRisk =
      latestMetrics.city.echoCoverage * 1.35 +
      latestMetrics.city.strongEchoCoverage * 1.8 +
      Math.max(0, latestMetrics.city.maxDbz - 25) * 0.55;
    const rainWallScore = Math.round(Math.min(100, Math.max(sunsetRisk, cityRisk)));
    const clearingScore = Math.round(Math.min(100, Math.max(0, 45 - coverageDelta * 4 - rainWallScore * 0.2)));
    const dataTime = parseCmaUtc(latest.datetime);

    return {
      status: "parsed",
      method: `按城市选择 ${calibration.regionCode} 区域组合反射率图，使用 PNG 固定色标将像素转换为 5–70 dBZ，并统计城市周边、东向日出光路和西向日落光路。`,
      rainWallScore,
      clearingScore,
      echoTrend,
      cityMetrics: latestMetrics.city,
      sunrisePathMetrics: latestMetrics.sunrisePath,
      sunsetPathMetrics: latestMetrics.sunsetPath,
      previousCityMetrics: previousMetrics?.city,
      dataAgeMinutes: dataTime === undefined ? undefined : Math.max(0, Math.round((Date.now() - dataTime) / 60000)),
      regionCode: calibration.regionCode,
      imageSize: { width: latestImage.width, height: latestImage.height },
      geolocationQuality: "city_control_point_approximation",
      reflectivityScale: "5-70 dBZ, 5 dBZ intervals",
      note: "雷达反射率和趋势来自真实 CMA PNG；城市位置采用图上城市控制点拟合，适用于区域风险统计，不等同于官方雷达格点。",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知解析错误";
    return {
      ...fallback,
      note: `${fallback.note} PNG 像素解析降级：${message}`,
    };
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
    const allFiles = rowsFrom(payload)
      .map(normalizeFile)
      .filter((item) => item.fileName || item.datetime)
      .sort((a, b) => (b.datetime ?? "").localeCompare(a.datetime ?? ""));
    if (!allFiles.length) {
      throw new Error(payload.returnMessage ? `CMA radar returned no files: ${payload.returnMessage}` : "CMA radar returned no files");
    }
    const regionCode = city ? radarRegionByCity[city] : undefined;
    const regionalFiles = regionCode ? allFiles.filter((file) => file.regionCode === regionCode) : allFiles;
    const files = (regionalFiles.length ? regionalFiles : allFiles).slice(0, 24);
    const fallbackAnalysis: CmaRadarProxyPayload["analysis"] = {
      status: files[0]?.fileName ? "metadata_only" : "no_file",
      method: `按城市选择 ${files[0]?.regionCode ?? "未知"} 区域雷达组网组合反射率图；JSON 模式只返回安全元数据，PNG 由同源后端代理下载。`,
      note: files[0]?.fileUrl
        ? "已取得 CMA 临时 PNG 地址；像素解析暂时不可用。"
        : "未拿到可解析雷达文件。",
    };
    const analysis = await parseRadarAnalysis(city, files, fallbackAnalysis);
    return {
      source: "中国气象数据网 CMA 天气雷达组网组合反射率图像产品",
      city,
      stationId,
      latest: files[0],
      files,
      analysis,
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
