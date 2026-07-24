"use client";

import { useEffect, useMemo, useState } from "react";
import cityCalibration from "../backend/algorithm/city_calibration.json";

type Mode = "sunset" | "sunrise";

type Factor = {
  label: string;
  value: number;
  note: string;
};

type TimelinePoint = {
  time: string;
  value: number;
  label: string;
};

type ProfileCell = {
  distance: number;
  low: number;
  mid: number;
  high: number;
  aod: string;
};

type Forecast = {
  score: number;
  confidence: number;
  level: string;
  stable_score: number;
  burst_score: number;
  horizon_gap_score: number;
  horizon_gap_label: string;
  confidence_label: string;
  tags: string[];
  advice: string;
  algorithm_version: string;
  city_calibration_version: string;
  verdict: string;
  summary: string;
  peak: string;
  sunTime: string;
  updatedAt: string;
  trend: string;
  color: string;
  factors: Factor[];
  timeline: TimelinePoint[];
  profile: ProfileCell[];
  source: string;
  raw: {
    dataTime: string;
    cloud: number;
    lowCloud: number;
    midCloud: number;
    highCloud: number;
    humidity: number;
    visibilityKm: string;
    precipitation: number;
    aod: string;
    solarAzimuth: number;
    solarAltitude: number;
    lightPath: number;
    cloudCanvas: number;
    aodFactor: string;
    solarFactor: string;
    precipFactor: string;
    consistencyFactor: string;
    burst_score: number;
    horizon_gap_score: number;
    cloud_variability_score: number;
    post_rain_signal: number;
    model_disagreement_signal: number;
    weatherProvider: string;
    airProvider: string;
    dataSourceNote: string;
  };
};

type Calibration = {
  aod_optimal: number;
  low_cloud_penalty: number;
  humidity_optimal: number;
  burst_bonus: number;
  big_burn_threshold: number;
  small_burn_threshold: number;
};

type CalibrationFile = {
  version: string;
  default: Calibration;
  [city: string]: Partial<Calibration> | Calibration | string;
};

type City = {
  name: string;
  en: string;
  latlon: string;
  latitude: number;
  longitude: number;
  smartWeatherCode: string;
  airCityName: string;
  airCityCode: string;
  aeronetSite: string;
};

type CityForecast = City & {
  sunset: Forecast;
  sunrise: Forecast;
};

type OpenMeteoResponse = {
  hourly?: {
    time?: string[];
    cloud_cover?: number[];
    cloud_cover_low?: number[];
    cloud_cover_mid?: number[];
    cloud_cover_high?: number[];
    relative_humidity_2m?: number[];
    visibility?: number[];
    precipitation_probability?: number[];
    weather_code?: number[];
  };
  daily?: {
    sunrise?: string[];
    sunset?: string[];
  };
  generationtime_ms?: number;
};

type AirQualityResponse = {
  hourly?: {
    time?: string[];
    aerosol_optical_depth?: number[];
  };
};

type ChinaWeatherData = {
  forecast?: OpenMeteoResponse;
  provider: string;
  note: string;
};

type ChinaAirData = {
  air?: AirQualityResponse;
  provider: string;
  note: string;
};

type DataSourceMeta = {
  weatherProvider: string;
  airProvider: string;
  note: string;
};

const cityConfigs: City[] = [
  { name: "南京", en: "NANJING", latlon: "32.06N / 118.79E", latitude: 32.0603, longitude: 118.7969, smartWeatherCode: "101190101", airCityName: "南京市", airCityCode: "320100", aeronetSite: "Nanjing" },
  { name: "上海", en: "SHANGHAI", latlon: "31.23N / 121.47E", latitude: 31.2304, longitude: 121.4737, smartWeatherCode: "101020100", airCityName: "上海市", airCityCode: "310000", aeronetSite: "Shanghai" },
  { name: "北京", en: "BEIJING", latlon: "39.90N / 116.40E", latitude: 39.9042, longitude: 116.4074, smartWeatherCode: "101010100", airCityName: "北京市", airCityCode: "110000", aeronetSite: "Beijing" },
  { name: "广州", en: "GUANGZHOU", latlon: "23.13N / 113.26E", latitude: 23.1291, longitude: 113.2644, smartWeatherCode: "101280101", airCityName: "广州市", airCityCode: "440100", aeronetSite: "Guangzhou" },
  { name: "南通", en: "NANTONG", latlon: "31.98N / 120.89E", latitude: 31.9802, longitude: 120.8943, smartWeatherCode: "101190501", airCityName: "南通市", airCityCode: "320600", aeronetSite: "Nanjing" },
  { name: "成都", en: "CHENGDU", latlon: "30.57N / 104.07E", latitude: 30.5728, longitude: 104.0668, smartWeatherCode: "101270101", airCityName: "成都市", airCityCode: "510100", aeronetSite: "Chengdu" },
];

const modeLabels: Record<Mode, string> = {
  sunset: "今晚日落",
  sunrise: "明早日出",
};

const calibrationMap = cityCalibration as CalibrationFile;
const algorithmVersion = "fire-cloud-v2-burst-calibrated";

const fallbackForecast: Forecast = {
  score: 0,
  confidence: 0,
  level: "读取中",
  stable_score: 0,
  burst_score: 0,
  horizon_gap_score: 0,
  horizon_gap_label: "等待数据",
  confidence_label: "等待真实数据",
  tags: ["数据读取中"],
  advice: "正在读取中国官方优先数据源；若未配置授权代理，将自动降级到 Open-Meteo。",
  algorithm_version: algorithmVersion,
  city_calibration_version: calibrationMap.version,
  verdict: "正在读取真实气象数据。",
  summary: "连接 GFS/ECMWF 预报与 AOD 数据，计算太阳光路通透度和本地云层画布质量。",
  peak: "--:--",
  sunTime: "--:--",
  updatedAt: "--:--",
  trend: "Live",
  color: "#b9e7ff",
  source: "中国官方源优先 · Open-Meteo fallback",
  raw: {
    dataTime: "--:--",
    cloud: 0,
    lowCloud: 0,
    midCloud: 0,
    highCloud: 0,
    humidity: 0,
    visibilityKm: "--",
    precipitation: 0,
    aod: "--",
    solarAzimuth: 0,
    solarAltitude: 0,
    lightPath: 0,
    cloudCanvas: 0,
    aodFactor: "--",
    solarFactor: "--",
    precipFactor: "--",
    consistencyFactor: "--",
    burst_score: 0,
    horizon_gap_score: 0,
    cloud_variability_score: 0,
    post_rain_signal: 0,
    model_disagreement_signal: 0,
    weatherProvider: "等待数据",
    airProvider: "等待数据",
    dataSourceNote: "正在连接数据源",
  },
  factors: [
    { label: "光路通透度", value: 0, note: "等待太阳方向低云、能见度、降水与 AOD 数据" },
    { label: "云层画布质量", value: 0, note: "等待本地中高云、云量稳定性数据" },
    { label: "AOD色彩因子", value: 0, note: "等待气溶胶光学厚度数据" },
    { label: "模型一致性", value: 0, note: "等待 GFS/ECMWF 对照结果" },
  ],
  timeline: [
    { time: "--:--", value: 0, label: "等待数据" },
    { time: "--:--", value: 0, label: "等待数据" },
    { time: "--:--", value: 0, label: "等待数据" },
    { time: "--:--", value: 0, label: "等待数据" },
  ],
  profile: Array.from({ length: 11 }, (_, index) => ({
    distance: index * 100,
    low: 0,
    mid: 0,
    high: 0,
    aod: "--",
  })),
};

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function formatTime(value?: string) {
  if (!value) return "--:--";
  return value.slice(11, 16);
}

function addMinutes(value: string, minutes: number) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() + minutes);
  return date;
}

function nearestIndex(times: string[] = [], target: Date) {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  times.forEach((time, index) => {
    const distance = Math.abs(new Date(time).getTime() - target.getTime());
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  });
  return bestIndex;
}

function at(values: number[] | undefined, index: number, fallback = 0) {
  const value = values?.[index];
  return Number.isFinite(value) ? Number(value) : fallback;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asNumberArray(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.map(asNumber).filter((item): item is number => item !== undefined);
  return values.length ? values : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((item): item is string => typeof item === "string");
  return values.length ? values : undefined;
}

function recordValue(payload: unknown, keys: string[]) {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  return keys.map((key) => record[key]).find((value) => value !== undefined);
}

function normalizeHourlyPayload(payload: unknown): OpenMeteoResponse["hourly"] | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const hourly = (record.hourly && typeof record.hourly === "object" ? record.hourly : record) as Record<string, unknown>;
  const normalized: OpenMeteoResponse["hourly"] = {
    time: asStringArray(recordValue(hourly, ["time", "times", "forecast_time", "forecastTimes"])),
    cloud_cover: asNumberArray(recordValue(hourly, ["cloud_cover", "cloud", "totalCloud", "total_cloud"])),
    cloud_cover_low: asNumberArray(recordValue(hourly, ["cloud_cover_low", "lowCloud", "low_cloud", "lcloud"])),
    cloud_cover_mid: asNumberArray(recordValue(hourly, ["cloud_cover_mid", "midCloud", "mid_cloud", "mcloud"])),
    cloud_cover_high: asNumberArray(recordValue(hourly, ["cloud_cover_high", "highCloud", "high_cloud", "hcloud"])),
    relative_humidity_2m: asNumberArray(recordValue(hourly, ["relative_humidity_2m", "humidity", "rh", "relativeHumidity"])),
    visibility: asNumberArray(recordValue(hourly, ["visibility", "vis"])),
    precipitation_probability: asNumberArray(recordValue(hourly, ["precipitation_probability", "pop", "rainProbability", "precipProbability"])),
    weather_code: asNumberArray(recordValue(hourly, ["weather_code", "weatherCode"])),
  };
  return normalized.time || normalized.cloud_cover ? normalized : undefined;
}

function definedHourly(hourly?: OpenMeteoResponse["hourly"]): OpenMeteoResponse["hourly"] {
  if (!hourly) return undefined;
  return Object.fromEntries(
    Object.entries(hourly).filter(([, value]) => Array.isArray(value) && value.length > 0),
  ) as OpenMeteoResponse["hourly"];
}

function definedDaily(daily?: OpenMeteoResponse["daily"]): OpenMeteoResponse["daily"] {
  if (!daily) return undefined;
  return Object.fromEntries(
    Object.entries(daily).filter(([, value]) => Array.isArray(value) && value.length > 0),
  ) as OpenMeteoResponse["daily"];
}

function normalizeDailyPayload(payload: unknown): OpenMeteoResponse["daily"] | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const record = payload as Record<string, unknown>;
  const daily = (record.daily && typeof record.daily === "object" ? record.daily : record) as Record<string, unknown>;
  const normalized = {
    sunrise: asStringArray(recordValue(daily, ["sunrise", "sunrises"])),
    sunset: asStringArray(recordValue(daily, ["sunset", "sunsets"])),
  };
  return normalized.sunrise || normalized.sunset ? normalized : undefined;
}

function mergeForecastSource(base: OpenMeteoResponse, priority?: OpenMeteoResponse): OpenMeteoResponse {
  if (!priority) return base;
  const priorityHourly = definedHourly(priority.hourly);
  const priorityDaily = definedDaily(priority.daily);
  return {
    ...base,
    hourly: {
      ...(base.hourly ?? {}),
      ...(priorityHourly ?? {}),
    },
    daily: {
      ...(base.daily ?? {}),
      ...(priorityDaily ?? {}),
    },
  };
}

function mergeAirSource(base?: AirQualityResponse, priority?: AirQualityResponse): AirQualityResponse | undefined {
  if (!priority) return base;
  return {
    hourly: {
      ...(base?.hourly ?? {}),
      ...(priority.hourly ?? {}),
    },
  };
}

function aodFromAirQuality(pm25?: number, pm10?: number, aqi?: number) {
  const pmSignal = (pm25 ?? 0) / 500 + (pm10 ?? 0) / 900;
  const aqiSignal = (aqi ?? 0) / 1200;
  return Math.max(0.03, Math.min(0.75, 0.04 + pmSignal + aqiSignal));
}

async function fetchJsonFromProxy(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { error?: string; detail?: string };
      detail = payload.error || payload.detail || "";
    } catch {
      detail = await response.text().catch(() => "");
    }
    throw new Error(`Proxy request failed: ${response.status}${detail ? ` · ${detail.slice(0, 120)}` : ""}`);
  }
  return response.json() as Promise<unknown>;
}

function proxyUrl(base: string, params: Record<string, string>) {
  const url = base.startsWith("http") ? new URL(base) : new URL(base, window.location.origin);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

async function fetchChinaWeather(city: City): Promise<ChinaWeatherData> {
  const proxy = process.env.NEXT_PUBLIC_CHINA_WEATHER_PROXY_URL || "/api/qweather";
  if (!proxy) {
    return {
      provider: "Open-Meteo GFS fallback",
      note: "未配置中国优先天气源代理，天气预报使用 Open-Meteo GFS/ECMWF。",
    };
  }
  try {
    const url = proxyUrl(proxy, {
      city: city.name,
      cityCode: city.smartWeatherCode,
      lat: String(city.latitude),
      lon: String(city.longitude),
    });
    const payload = await fetchJsonFromProxy(url);
    const forecast = {
      hourly: normalizeHourlyPayload(payload),
      daily: normalizeDailyPayload(payload),
    };
    if (!forecast.hourly && !forecast.daily) {
      throw new Error("SmartWeather proxy returned unsupported schema");
    }
    return {
      forecast,
      provider: "和风天气 QWeather",
      note: "天气预报优先使用和风天气，缺失的云层分层和日出日落字段由 Open-Meteo 补齐。",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return {
      provider: "Open-Meteo GFS fallback",
      note: `和风天气暂不可用，本次天气预报已降级到 Open-Meteo。原因：${message}`,
    };
  }
}

async function fetchMEEAir(city: City, baseTimes?: string[]): Promise<ChinaAirData> {
  const proxy = process.env.NEXT_PUBLIC_MEE_AIR_PROXY_URL || "/api/mee-air";
  if (!proxy) {
    return {
      provider: "Open-Meteo AOD fallback",
      note: "未配置生态环境部空气质量代理，AOD 使用 Open-Meteo 空气质量预报。",
    };
  }
  try {
    const url = proxyUrl(proxy, {
      city: city.airCityName,
      cityCode: city.airCityCode,
    });
    const payload = await fetchJsonFromProxy(url);
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const hourlyAod = asNumberArray(recordValue(record, ["aerosol_optical_depth", "aod"]));
    const pm25 = asNumber(recordValue(record, ["pm25", "pm2_5", "PM2.5", "pm2p5"]));
    const pm10 = asNumber(recordValue(record, ["pm10", "PM10"]));
    const aqi = asNumber(recordValue(record, ["aqi", "AQI"]));
    const times = asStringArray(recordValue(record, ["time", "times"])) ?? baseTimes;
    const derivedAod = hourlyAod ?? (times ? times.map(() => aodFromAirQuality(pm25, pm10, aqi)) : undefined);
    if (!times || !derivedAod) throw new Error("MEE proxy returned unsupported schema");
    return {
      air: {
        hourly: {
          time: times,
          aerosol_optical_depth: derivedAod,
        },
      },
      provider: hourlyAod ? "生态环境部空气质量 AOD" : "生态环境部空气质量 PM/AQI 推导 AOD",
      note: hourlyAod ? "空气质量优先使用生态环境部 AOD 字段。" : "生态环境部未返回 AOD 时，以 PM2.5/PM10/AQI 推导色彩潜力代理值。",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return {
      provider: "Open-Meteo AOD fallback",
      note: `生态环境部空气质量暂不可用，本次 AOD 已降级到 Open-Meteo。原因：${message}`,
    };
  }
}

async function fetchAeronetAod(city: City): Promise<ChinaAirData> {
  try {
    const url = proxyUrl("/api/aeronet", {
      site: city.aeronetSite,
    });
    const payload = await fetchJsonFromProxy(url);
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const times = asStringArray(recordValue(record, ["time", "times"]));
    const aod = asNumberArray(recordValue(record, ["aerosol_optical_depth", "aod"]));
    if (!times || !aod) throw new Error("AERONET proxy returned unsupported schema");
    return {
      air: {
        hourly: {
          time: times,
          aerosol_optical_depth: aod,
        },
      },
      provider: `AERONET 实测 AOD · ${city.aeronetSite}`,
      note: "AOD 优先使用 AERONET Level 2.0 站点实测值；站点缺测时降级到生态环境部 PM/AQI 推导。",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知错误";
    return {
      provider: "AERONET 暂无有效实测",
      note: `AERONET 站点暂无可用 Level 2.0 AOD，已尝试降级到生态环境部空气质量。原因：${message}`,
    };
  }
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function scoreToLevel(score: number) {
  if (score >= 72) return "大烧";
  if (score >= 45) return "小烧";
  if (score > 0) return "无烧";
  return "读取中";
}

function getCalibration(cityName: string): Calibration {
  const cityValue = calibrationMap[cityName];
  const citySpecific = typeof cityValue === "object" && cityValue !== null ? cityValue : {};
  return {
    ...calibrationMap.default,
    ...citySpecific,
  } as Calibration;
}

function scoreToLevelWithCalibration(score: number, calibration: Calibration) {
  if (score >= calibration.big_burn_threshold) return "大烧";
  if (score >= calibration.small_burn_threshold) return "小烧";
  if (score > 0) return "无烧";
  return "读取中";
}

function horizonGapLabel(score: number) {
  if (score >= 68) return "云缝机会高";
  if (score >= 42) return "云缝机会中";
  return "云缝机会低";
}

function confidenceLabel(stable: number, burst: number, consistency: number) {
  if (stable >= 72 && consistency >= 78) return "高置信";
  if (burst - stable >= 18) return "稳定条件一般";
  if (consistency < 62) return "模型分歧";
  return "中等置信";
}

function degrees(value: number) {
  return (value * 180) / Math.PI;
}

function radians(value: number) {
  return (value * Math.PI) / 180;
}

function solarPosition(latitude: number, longitude: number, date: Date) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  const day = Math.floor((date.getTime() - start.getTime()) / 86400000);
  const hour = date.getHours() + date.getMinutes() / 60;
  const gamma = (2 * Math.PI / 365) * (day - 1 + (hour - 12) / 24);
  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);
  const equationOfTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));
  const timeOffset = equationOfTime + 4 * longitude + 480;
  const trueSolarTime = (hour * 60 + timeOffset) % 1440;
  const hourAngle = radians(trueSolarTime / 4 - 180);
  const lat = radians(latitude);
  const altitude = degrees(
    Math.asin(
      Math.sin(lat) * Math.sin(declination) +
        Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle),
    ),
  );
  const azimuth = (degrees(Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(lat) - Math.tan(declination) * Math.cos(lat),
  )) + 180) % 360;
  return { altitude, azimuth };
}

function describeCloud(total: number, low: number, high: number) {
  if (low > 75) return "低云偏厚，地平线透光窗口被压缩";
  if (total >= 35 && total <= 68 && high > 20) return "云量处在可染色区间，高云能承接暖色";
  if (total < 25) return "天空偏空，颜色载体不足";
  return "云量可用，但云层结构需要继续观察";
}

function describeRaw(raw: Forecast["raw"]) {
  return `模型读取 ${raw.dataTime} 附近数据：太阳方位 ${raw.solarAzimuth}°，高度 ${raw.solarAltitude}°；总云量 ${raw.cloud}%，低云 ${raw.lowCloud}%，中高云 ${raw.midCloud + raw.highCloud}%，AOD ${raw.aod}，能见度 ${raw.visibilityKm} km，降水概率 ${raw.precipitation}%。`;
}

function describeTunnel(low: number, visibility: number, precip: number) {
  if (precip > 55) return "降水概率偏高，透光通道不稳定";
  if (low < 35 && visibility > 12000) return "低云少且能见度好，地平线比较干净";
  if (low > 65) return "低云遮挡明显，峰值窗口可能很短";
  return "低空通道一般，适合找更开阔的机位";
}

function describeAtmosphere(humidity: number, visibility: number) {
  if (humidity >= 50 && humidity <= 75 && visibility > 9000) return "湿度和通透度平衡，利于暖色散射";
  if (humidity > 82) return "湿度偏高，色彩可能被雾化";
  if (humidity < 35) return "空气偏干，颜色边界清晰但饱和度有限";
  return "大气条件中等，颜色表现取决于云缝";
}

function makeVerdict(score: number, mode: Mode, calibration: Calibration) {
  if (score >= calibration.big_burn_threshold) return mode === "sunset" ? "大烧条件成立，今晚值得提前找西向机位。" : "大烧条件成立，明早值得早起。";
  if (score >= calibration.small_burn_threshold) return "小烧条件，光路或云画布有一项不够理想。";
  if (score > 0) return "无烧倾向，光路和云画布没有同时成立。";
  return "正在读取真实气象数据。";
}

function calculateCore(hourlyInput: OpenMeteoResponse["hourly"], index: number, aod: number, calibration: Calibration, ecmwfHourly?: OpenMeteoResponse["hourly"]) {
  const hourly = hourlyInput ?? {};
  const times = hourly.time ?? [];
  const prevIndex = Math.max(0, index - 1);
  const nextIndex = Math.min(Math.max(0, times.length - 1), index + 1);
  const cloud = at(hourly.cloud_cover, index, 50);
  const low = at(hourly.cloud_cover_low, index, cloud * 0.45);
  const mid = at(hourly.cloud_cover_mid, index, cloud * 0.35);
  const high = at(hourly.cloud_cover_high, index, cloud * 0.25);
  const humidity = at(hourly.relative_humidity_2m, index, 60);
  const visibility = at(hourly.visibility, index, 10000);
  const precip = at(hourly.precipitation_probability, index, 0);
  const precipPrev = at(hourly.precipitation_probability, prevIndex, precip);
  const precipNext = at(hourly.precipitation_probability, nextIndex, precip);
  const cloudPrev = at(hourly.cloud_cover, prevIndex, cloud);
  const cloudNext = at(hourly.cloud_cover, nextIndex, cloud);
  const midHigh = Math.min(100, mid + high);
  const adjustedLow = low * calibration.low_cloud_penalty;
  const lightPath = clamp01((100 - adjustedLow) / 100) * clamp01(visibility / 18000) * clamp01(1 - precip / 130) * clamp01(1 - Math.max(aod - 0.45, 0) / 0.65);
  const canvasAmount = 1 - Math.min(Math.abs(midHigh - 52) / 52, 1);
  const canvasThinness = clamp01(1 - Math.max(adjustedLow - 38, 0) / 70);
  const canvasStability = clamp01(1 - Math.abs(cloudNext - cloudPrev) / 85);
  const cloudCanvas = clamp01((canvasAmount * 0.55 + high / 100 * 0.25 + canvasStability * 0.2) * canvasThinness);
  const aodFactor = 0.72 + 0.34 * Math.exp(-Math.pow((aod - calibration.aod_optimal) / 0.18, 2));
  const precipFactor = clamp01(1 - precip / 115);
  const ecmwfCloud = at(ecmwfHourly?.cloud_cover, index, cloud);
  const ecmwfLow = at(ecmwfHourly?.cloud_cover_low, index, low);
  const modelDiff = (Math.abs(cloud - ecmwfCloud) + Math.abs(low - ecmwfLow)) / 2;
  const consistencyFactor = clamp01(1 - modelDiff / 115);
  const cloudVariabilityScore = clamp(Math.abs(cloudNext - cloudPrev) * 2.25 + Math.abs(low - at(hourly.cloud_cover_low, prevIndex, low)) * 0.8);
  const postRainSignal = clamp((precipPrev - precipNext) * 1.6 + Math.max(0, 55 - precip) * 0.45);
  const modelDisagreementSignal = clamp(modelDiff * 1.4);
  const horizonGapScore = clamp(
    (low >= 20 && low <= 65 ? 38 : low < 20 ? 18 : 4) +
      Math.min(midHigh, 70) * 0.28 +
      (100 - precip) * 0.14 +
      Math.min(visibility / 1000, 18) +
      cloudVariabilityScore * 0.18 -
      Math.max(aod - 0.5, 0) * 70,
  );
  const burstScore = clamp(
    (horizonGapScore * 0.35 +
      clamp(cloudCanvas * 100) * 0.25 +
      cloudVariabilityScore * 0.15 +
      postRainSignal * 0.1 +
      clamp(aodFactor * 100, 0, 110) * 0.1 +
      (lightPath > 0.28 && cloudCanvas > 0.25 ? modelDisagreementSignal : 0) * 0.05) *
      calibration.burst_bonus,
  );
  return {
    cloud,
    low,
    mid,
    high,
    humidity,
    visibility,
    precip,
    lightPath,
    cloudCanvas,
    aodFactor,
    precipFactor,
    consistencyFactor,
    canvasStability,
    cloudVariabilityScore,
    postRainSignal,
    modelDisagreementSignal,
    horizonGapScore,
    burstScore,
  };
}

function makeProfile(core: ReturnType<typeof calculateCore>, aod: number, solarAzimuth: number): ProfileCell[] {
  const bearingWave = Math.sin(radians(solarAzimuth));
  return Array.from({ length: 11 }, (_, index) => {
    const distance = index * 100;
    const decay = 1 - index * 0.045;
    const terrainNoise = Math.sin(index * 1.37 + bearingWave) * 7;
    const low = clamp(core.low * decay + terrainNoise - index * 1.8);
    const mid = clamp(core.mid * (0.88 + Math.sin(index * 0.72) * 0.16));
    const high = clamp(core.high * (1.04 - index * 0.025) + Math.cos(index * 0.61) * 8);
    return {
      distance,
      low,
      mid,
      high,
      aod: Math.max(0.01, aod + Math.sin(index * 0.55) * 0.025).toFixed(2),
    };
  });
}

function makeTags(core: ReturnType<typeof calculateCore>, stableScore: number, burstScore: number, calibration: Calibration) {
  const tags: string[] = [];
  if (stableScore >= calibration.big_burn_threshold && core.consistencyFactor >= 0.78) tags.push("高置信");
  if (core.low > 58) tags.push("低云风险");
  if (burstScore >= 68) tags.push("爆发潜力高");
  if (core.horizonGapScore >= 58) tags.push("云缝机会");
  if (core.postRainSignal >= 42) tags.push("雨后窗口");
  if (core.modelDisagreementSignal >= 35) tags.push("模型分歧");
  if (core.cloudVariabilityScore >= 55) tags.push("日落后窗口");
  return tags.length ? tags : ["条件稳定"];
}

function makeAdvice(stableScore: number, burstScore: number, core: ReturnType<typeof calculateCore>, mode: Mode) {
  if (burstScore - stableScore >= 18 && burstScore >= 65) {
    return `稳定条件一般，但太阳方向低云处于可开缝区间，中高云画布存在，云量变化较快，存在${mode === "sunset" ? "日落后" : "日出前后"}突然爆发机会；如果离观测点近，建议蹲守20分钟。`;
  }
  if (stableScore >= 72) {
    return "稳定命中分较高，光路和云画布同时成立，建议提前到位并保留峰值后观察窗口。";
  }
  if (core.low > 70) {
    return "低云遮挡偏强，爆发依赖地平线短时开缝；不建议远距离专程前往。";
  }
  if (core.cloudCanvas < 0.28) {
    return "太阳方向相对可用，但本地中高云画布不足，容易出现有光无云的情况。";
  }
  return "稳定条件和爆发潜力都处在中间区间，适合顺路观察，重点看地平线是否开缝。";
}

function makeForecast(
  gfs: OpenMeteoResponse,
  mode: Mode,
  city: City,
  aodData?: AirQualityResponse,
  ecmwf?: OpenMeteoResponse,
  sourceMeta: DataSourceMeta = {
    weatherProvider: "Open-Meteo GFS fallback",
    airProvider: "Open-Meteo AOD fallback",
    note: "未配置中国官方代理，本次使用 Open-Meteo 兜底数据。",
  },
): Forecast {
  const calibration = getCalibration(city.name);
  const hourly = gfs.hourly ?? {};
  const times = hourly.time ?? [];
  const eventTime = mode === "sunset" ? gfs.daily?.sunset?.[0] : gfs.daily?.sunrise?.[1] ?? gfs.daily?.sunrise?.[0];
  const offsets = mode === "sunset" ? [-40, -10, 18, 38] : [-38, -12, 0, 22];
  const labels = mode === "sunset" ? ["光路预检", "太阳供光", "峰值窗口", "余光衰减"] : ["光路预检", "云底染色", "峰值窗口", "晨光接管"];
  const target = eventTime ? addMinutes(eventTime, mode === "sunset" ? 18 : -2) : new Date();
  const targetIndex = nearestIndex(times, target);
  const aodIndex = nearestIndex(aodData?.hourly?.time, target);
  const aod = at(aodData?.hourly?.aerosol_optical_depth, aodIndex, 0.16);
  const core = calculateCore(hourly, targetIndex, aod, calibration, ecmwf?.hourly);
  const solar = solarPosition(city.latitude, city.longitude, target);
  const solarFactor = clamp01(0.78 + (1 - Math.min(Math.abs(solar.altitude + 3) / 13, 1)) * 0.27);
  const stableScore = clamp(
    100 *
      Math.sqrt(core.lightPath * core.cloudCanvas) *
      core.aodFactor *
      solarFactor *
      core.precipFactor *
      core.consistencyFactor,
  );
  const burstScore = core.burstScore;
  const score = stableScore;
  const confidence = clamp(38 + core.consistencyFactor * 36 + core.canvasStability * 14 - core.precip * 0.16, 28, 92);
  const timeline = offsets.map((offset, index) => {
    const itemIndex = eventTime ? nearestIndex(times, addMinutes(eventTime, offset)) : targetIndex;
    const pointTarget = eventTime ? addMinutes(eventTime, offset) : target;
    const pointSolar = solarPosition(city.latitude, city.longitude, pointTarget);
    const pointCore = calculateCore(hourly, itemIndex, aod, calibration, ecmwf?.hourly);
    const pointSolarFactor = clamp01(0.78 + (1 - Math.min(Math.abs(pointSolar.altitude + 3) / 13, 1)) * 0.27);
    const value = clamp(100 * Math.sqrt(pointCore.lightPath * pointCore.cloudCanvas) * pointCore.aodFactor * pointSolarFactor * pointCore.precipFactor * pointCore.consistencyFactor);
    return {
      time: eventTime ? formatTime(addMinutes(eventTime, offset).toISOString()) : "--:--",
      value,
      label: labels[index],
    };
  });

  const peakPoint = timeline.reduce((best, item) => (item.value > best.value ? item : best), timeline[0]);
  const color = score >= 72 ? "#ff6a3d" : score >= 45 ? "#ffc857" : "#b9e7ff";
  const raw = {
    dataTime: formatTime(times[targetIndex] ?? ""),
    cloud: Math.round(core.cloud),
    lowCloud: Math.round(core.low),
    midCloud: Math.round(core.mid),
    highCloud: Math.round(core.high),
    humidity: Math.round(core.humidity),
    visibilityKm: (core.visibility / 1000).toFixed(1),
    precipitation: Math.round(core.precip),
    aod: aod.toFixed(2),
    solarAzimuth: Math.round(solar.azimuth),
    solarAltitude: Math.round(solar.altitude),
    lightPath: clamp(core.lightPath * 100),
    cloudCanvas: clamp(core.cloudCanvas * 100),
    aodFactor: core.aodFactor.toFixed(2),
    solarFactor: solarFactor.toFixed(2),
    precipFactor: core.precipFactor.toFixed(2),
    consistencyFactor: core.consistencyFactor.toFixed(2),
    burst_score: burstScore,
    horizon_gap_score: core.horizonGapScore,
    cloud_variability_score: core.cloudVariabilityScore,
    post_rain_signal: core.postRainSignal,
    model_disagreement_signal: core.modelDisagreementSignal,
    weatherProvider: sourceMeta.weatherProvider,
    airProvider: sourceMeta.airProvider,
    dataSourceNote: sourceMeta.note,
  };
  const profile = makeProfile(core, aod, solar.azimuth);
  const tags = makeTags(core, stableScore, burstScore, calibration);
  const advice = makeAdvice(stableScore, burstScore, core, mode);

  return {
    score,
    confidence,
    level: scoreToLevelWithCalibration(score, calibration),
    stable_score: stableScore,
    burst_score: burstScore,
    horizon_gap_score: core.horizonGapScore,
    horizon_gap_label: horizonGapLabel(core.horizonGapScore),
    confidence_label: confidenceLabel(stableScore, burstScore, clamp(core.consistencyFactor * 100)),
    tags,
    advice,
    algorithm_version: algorithmVersion,
    city_calibration_version: calibrationMap.version,
    verdict: makeVerdict(score, mode, calibration),
    summary: `${describeRaw(raw)} 数据源：${sourceMeta.weatherProvider} / ${sourceMeta.airProvider}。高分必须同时满足太阳方向光路通透和本地中高云画布可用；爆发潜力用于捕捉雨后开缝、低云边缘透光和模型分歧下的变化机会。`,
    peak: peakPoint?.time ?? formatTime(target.toISOString()),
    sunTime: formatTime(eventTime),
    updatedAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
    trend: "实时",
    color,
    source: `${sourceMeta.weatherProvider} · ${sourceMeta.airProvider}`,
    raw,
    factors: [
      { label: "光路通透度", value: raw.lightPath, note: "太阳方向低云、雨幕、能见度和过高 AOD 会共同压低光路" },
      { label: "云层画布质量", value: raw.cloudCanvas, note: "本地中高云约 30%–70%、低云不厚、变化稳定时更容易烧" },
      { label: "AOD色彩因子", value: clamp(core.aodFactor * 100, 0, 120), note: "AOD 太低颜色淡，适中更鲜艳，太高会雾霾遮光" },
      { label: "模型一致性", value: clamp(core.consistencyFactor * 100), note: "GFS 与 ECMWF 的云量/低云分歧越大，最终分数越保守" },
    ],
    timeline,
    profile,
  };
}

async function fetchCityForecast(city: City): Promise<CityForecast> {
  const forecastParams = {
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    timezone: "Asia/Shanghai",
    forecast_days: "2",
    hourly: [
      "cloud_cover",
      "cloud_cover_low",
      "cloud_cover_mid",
      "cloud_cover_high",
      "relative_humidity_2m",
      "visibility",
      "precipitation_probability",
      "weather_code",
    ].join(","),
    daily: "sunrise,sunset",
  };
  const gfsParams = new URLSearchParams(forecastParams);
  const ecmwfParams = new URLSearchParams(forecastParams);
  const airParams = new URLSearchParams({
    latitude: String(city.latitude),
    longitude: String(city.longitude),
    timezone: "Asia/Shanghai",
    forecast_days: "2",
    hourly: "aerosol_optical_depth",
  });
  const [gfsResponse, ecmwfResponse, airResponse, chinaWeatherResponse, aeronetResponse, meeAirResponse] = await Promise.allSettled([
    fetch(`https://api.open-meteo.com/v1/gfs?${gfsParams.toString()}`),
    fetch(`https://api.open-meteo.com/v1/ecmwf?${ecmwfParams.toString()}`),
    fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${airParams.toString()}`),
    fetchChinaWeather(city),
    fetchAeronetAod(city),
    fetchMEEAir(city),
  ]);
  if (gfsResponse.status !== "fulfilled" || !gfsResponse.value.ok) {
    throw new Error("GFS request failed");
  }
  const gfs = (await gfsResponse.value.json()) as OpenMeteoResponse;
  const ecmwf =
    ecmwfResponse.status === "fulfilled" && ecmwfResponse.value.ok
      ? ((await ecmwfResponse.value.json()) as OpenMeteoResponse)
      : undefined;
  const air =
    airResponse.status === "fulfilled" && airResponse.value.ok
      ? ((await airResponse.value.json()) as AirQualityResponse)
      : undefined;
  const chinaWeather =
    chinaWeatherResponse.status === "fulfilled"
      ? chinaWeatherResponse.value
      : {
          provider: "Open-Meteo GFS fallback",
          note: "中国天气网 SmartWeatherAPI 暂不可用，本次天气预报已降级到 Open-Meteo。",
        };
  const meeAir =
    meeAirResponse.status === "fulfilled"
      ? meeAirResponse.value
      : {
          provider: "Open-Meteo AOD fallback",
          note: "生态环境部空气质量暂不可用，本次 AOD 已降级到 Open-Meteo。",
        };
  const aeronetAir =
    aeronetResponse.status === "fulfilled"
      ? aeronetResponse.value
      : {
          provider: "AERONET 暂无有效实测",
          note: "AERONET 站点暂无可用 Level 2.0 AOD，已尝试降级到生态环境部空气质量。",
        };
  const primaryWeather = mergeForecastSource(gfs, chinaWeather.forecast);
  const primaryAir = mergeAirSource(mergeAirSource(air, meeAir.air), aeronetAir.air);
  const sourceMeta = {
    weatherProvider: chinaWeather.provider,
    airProvider: aeronetAir.air ? aeronetAir.provider : meeAir.provider,
    note: `${chinaWeather.note} ${aeronetAir.note} ${aeronetAir.air ? "" : meeAir.note}`,
  };
  return {
    ...city,
    sunset: makeForecast(primaryWeather, "sunset", city, primaryAir, ecmwf, sourceMeta),
    sunrise: makeForecast(primaryWeather, "sunrise", city, primaryAir, ecmwf, sourceMeta),
  };
}

function getLevel(score: number) {
  return scoreToLevel(score);
}

function makeLoadingCity(city: City): CityForecast {
  return {
    ...city,
    sunset: fallbackForecast,
    sunrise: fallbackForecast,
  };
}

export default function Home() {
  const [cityName, setCityName] = useState("南京");
  const [mode, setMode] = useState<Mode>("sunset");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [forecasts, setForecasts] = useState<CityForecast[]>(() => cityConfigs.map(makeLoadingCity));
  const [loading, setLoading] = useState(true);
  const [dataError, setDataError] = useState<string | null>(null);

  useEffect(() => {
    const storedCity = window.localStorage.getItem("glowcast-city");
    if (storedCity && cityConfigs.some((city) => city.name === storedCity)) {
      setCityName(storedCity);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("glowcast-city", cityName);
  }, [cityName]);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      setDataError(null);
      try {
        const live = await Promise.all(cityConfigs.map(fetchCityForecast));
        if (active) setForecasts(live);
      } catch {
        if (active) setDataError("真实气象数据暂时读取失败，请稍后刷新。");
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    const timer = window.setInterval(load, 1000 * 60 * 30);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const city = useMemo(
    () => forecasts.find((item) => item.name === cityName) ?? forecasts[0],
    [cityName, forecasts],
  );
  const forecast = city[mode];
  const ranked = useMemo(
    () =>
      [...forecasts]
        .map((item) => ({ ...item, activeForecast: item[mode] }))
        .sort((a, b) => b.activeForecast.score - a.activeForecast.score),
    [mode, forecasts],
  );

  return (
    <main className="min-h-screen overflow-hidden bg-[var(--night)] text-[var(--paper)]">
      <div className="aurora-field" aria-hidden="true" />
      <section className="relative mx-auto flex min-h-screen w-full max-w-[1560px] flex-col px-4 pb-10 pt-5 sm:px-6 lg:px-8">
        <header className="site-header">
          <button className="brand" aria-label="霞光预报网回到主视图" onClick={() => setCityName("南京")}>
            <span className="brand-mark">G</span>
            <span>
              <span>霞光预报网</span>
              <small>GlowCast · Fire cloud model</small>
            </span>
          </button>
          <nav className="city-nav" aria-label="城市选择">
            {cityConfigs.map((item) => (
              <button
                key={item.name}
                className={item.name === city.name ? "is-active" : ""}
                onClick={() => {
                  setCityName(item.name);
                  setFeedback(null);
                }}
              >
                {item.name}
              </button>
            ))}
          </nav>
        </header>

        <div className="hero-grid">
          <section className="hero-copy" aria-labelledby="hero-title">
            <p className="eyebrow">GFS + ECMWF + AOD model</p>
            <h1 id="hero-title">
              {city.name}
              <span>{modeLabels[mode]}火烧云指数</span>
            </h1>
            <p className="hero-summary">{forecast.summary}</p>
            <div className="tag-row" aria-label="预测标签">
              {forecast.tags.map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <div className="mode-switch" role="tablist" aria-label="预报类型">
              {(Object.keys(modeLabels) as Mode[]).map((item) => (
                <button
                  key={item}
                  role="tab"
                  aria-selected={mode === item}
                  className={mode === item ? "is-active" : ""}
                  onClick={() => {
                    setMode(item);
                    setFeedback(null);
                  }}
                >
                  {modeLabels[item]}
                </button>
              ))}
            </div>
            <div className="source-strip">
              <span>{loading ? "正在更新真实数据" : forecast.source}</span>
              <span>{forecast.raw.dataSourceNote}</span>
              <span>光路通透度 × 云层画布质量 × AOD × 太阳供光 × 降水惩罚 × 模型一致性</span>
              {dataError ? <span>{dataError}</span> : null}
            </div>
          </section>

          <section className="score-stage" aria-label={`${city.name}${modeLabels[mode]}火烧云指数`}>
            <div className="score-orbit" style={{ "--accent": forecast.color } as React.CSSProperties}>
              <div className="ring ring-one" />
              <div className="ring ring-two" />
              <div className="score-number">
                <span>{forecast.score}</span>
                <small>/100</small>
              </div>
              <div className="score-caption">
                <b>{forecast.level}</b>
                <span>稳定命中分 · {forecast.confidence_label}</span>
              </div>
            </div>
          </section>

          <aside className="verdict-panel">
            <p className="mono-label">{city.en} · {city.latlon}</p>
            <h2>{forecast.verdict}</h2>
            <div className="metric-row">
              <span>峰值窗口</span>
              <strong>{forecast.peak}</strong>
            </div>
            <div className="metric-row">
              <span>{mode === "sunset" ? "日落时间" : "日出时间"}</span>
              <strong>{forecast.sunTime}</strong>
            </div>
            <div className="metric-row">
              <span>置信度</span>
              <strong>{forecast.confidence}%</strong>
            </div>
            <div className="metric-row">
              <span>爆发潜力</span>
              <strong>{forecast.burst_score}</strong>
            </div>
            <div className="metric-row">
              <span>云缝概率</span>
              <strong>{forecast.horizon_gap_score}</strong>
            </div>
            <div className="update-strip">
              <span>更新 {forecast.updatedAt}</span>
              <span>{forecast.trend}</span>
            </div>
          </aside>
        </div>
      </section>

      <section className="content-band">
        <div className="section-heading">
          <p className="eyebrow">Model inputs</p>
          <h2>真实气象输入</h2>
        </div>
        <div className="raw-grid">
          {[
            ["预报小时", forecast.raw.dataTime],
            ["天气源", forecast.raw.weatherProvider],
            ["空气源", forecast.raw.airProvider],
            ["太阳方位", `${forecast.raw.solarAzimuth}°`],
            ["太阳高度", `${forecast.raw.solarAltitude}°`],
            ["总云量", `${forecast.raw.cloud}%`],
            ["低云", `${forecast.raw.lowCloud}%`],
            ["中云", `${forecast.raw.midCloud}%`],
            ["高云", `${forecast.raw.highCloud}%`],
            ["AOD", forecast.raw.aod],
            ["能见度", `${forecast.raw.visibilityKm} km`],
            ["降水概率", `${forecast.raw.precipitation}%`],
            ["光路", `${forecast.raw.lightPath}%`],
            ["云画布", `${forecast.raw.cloudCanvas}%`],
            ["AOD因子", forecast.raw.aodFactor],
            ["太阳供光", forecast.raw.solarFactor],
            ["降水惩罚", forecast.raw.precipFactor],
            ["模型一致性", forecast.raw.consistencyFactor],
            ["爆发潜力", `${forecast.raw.burst_score}`],
            ["云缝概率", `${forecast.raw.horizon_gap_score}`],
            ["云量变化", `${forecast.raw.cloud_variability_score}`],
            ["雨后信号", `${forecast.raw.post_rain_signal}`],
            ["分歧机会", `${forecast.raw.model_disagreement_signal}`],
          ].map(([label, value]) => (
            <article className="raw-card" key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </article>
          ))}
        </div>
      </section>

      <section className="content-band">
        <div className="section-heading">
          <p className="eyebrow">Score factors</p>
          <h2>火烧云指数拆解</h2>
        </div>
        <div className="dual-score-grid">
          <article className="dual-score-card">
            <span>stable_score</span>
            <strong>{forecast.stable_score}</strong>
            <p>稳定命中分：沿用保守主模型，判断大概率是否值得蹲。</p>
          </article>
          <article className="dual-score-card is-burst">
            <span>burst_score</span>
            <strong>{forecast.burst_score}</strong>
            <p>爆发潜力分：捕捉雨后开缝、低云边缘透光、模型分歧但未全坏的突然大烧机会。</p>
          </article>
          <article className="dual-score-card">
            <span>horizon_gap_score</span>
            <strong>{forecast.horizon_gap_score}</strong>
            <p>{forecast.horizon_gap_label}：判断太阳方向是否存在地平线云缝。</p>
          </article>
        </div>
        <div className="advice-card">
          <span>出门建议</span>
          <p>{forecast.advice}</p>
        </div>
        <div className="factor-grid">
          {forecast.factors.map((factor) => (
            <article className="factor-card" key={factor.label}>
              <div className="factor-top">
                <span>{factor.label}</span>
                <strong>{factor.value}</strong>
              </div>
              <div className="bar" aria-hidden="true">
                <span style={{ width: `${factor.value}%`, background: forecast.color }} />
              </div>
              <p>{factor.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="content-band">
        <div className="section-heading">
          <p className="eyebrow">Algorithm</p>
          <h2>不是看天气好不好，而是看光能不能穿过云画布</h2>
        </div>
        <div className="formula-card">
          <p>火烧云指数</p>
          <strong>100 × √(光路通透度 × 云层画布质量) × AOD色彩因子 × 太阳供光因子 × 降水惩罚因子 × 模型一致性因子</strong>
        </div>
        <div className="algorithm-grid">
          {[
            ["01", "太阳位置", "根据城市经纬度和日期计算日出/日落时间、太阳方位角和太阳高度角，重点看太阳方向的光路。"],
            ["02", "光路通透", "检查太阳方向的低云、雨幕、雾霾、能见度和 AOD，低云墙会让本地高云也烧不起来。"],
            ["03", "云层画布", "判断本地中高云是否在 30%–70% 左右，低云不能太厚，云层变化要稳定。"],
            ["04", "AOD 色彩", "AOD 太低颜色淡，适中更鲜艳，太高会变成雾霾遮光。"],
            ["05", "GFS/ECMWF", "GFS 作为主模型，ECMWF 作为对照；两者分歧大时降低模型一致性和置信度。"],
            ["06", "指数输出", "72 分以上大烧，45–71 分小烧，45 分以下无烧，并输出可解释指标。"],
          ].map(([step, title, body]) => (
            <article className="algorithm-card" key={step}>
              <span>{step}</span>
              <strong>{title}</strong>
              <p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="content-band profile-band">
        <div className="profile-shell">
          <div className="profile-tabs" aria-label="剖面类型">
            {[
              ["☀", "日出剖面", mode === "sunrise"],
              ["🌅", "日落剖面", mode === "sunset"],
              ["▧", "日出探空", false],
              ["▨", "日落探空", false],
            ].map(([icon, label, active]) => (
              <button
                key={String(label)}
                className={active ? "is-active" : ""}
                onClick={() => {
                  if (label === "日出剖面") setMode("sunrise");
                  if (label === "日落剖面") setMode("sunset");
                }}
              >
                <span>{icon}</span>
                {label}
              </button>
            ))}
            <span className="profile-eye">◉</span>
          </div>

          <div className="profile-title-row">
            <span>{mode === "sunrise" ? "日出方向" : "日落方向"} · 1000KM 大气云层剖面</span>
            <strong>{forecast.raw.solarAzimuth}° {forecast.raw.solarAzimuth <= 180 ? "东偏" : "西偏"}{forecast.raw.solarAzimuth <= 180 ? "北" : "南"}</strong>
          </div>

          <div className="profile-city-row">
            <b>{city.name}</b>
            <span>{city.latlon}</span>
            <strong>{new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })}</strong>
          </div>

          <div className="profile-chart" aria-label={`${city.name}${modeLabels[mode]}1000公里大气云层剖面`}>
            <div className="height-axis">
              {["12km", "10km", "8km", "6km", "4km", "2km", "0km"].map((tick) => (
                <span key={tick}>{tick}</span>
              ))}
              <b>高度(km)</b>
            </div>
            <div className="profile-plot">
              <div className="layer-label high">高云带</div>
              <div className="layer-label mid">中云带</div>
              <div className="layer-label low">低云 / 气溶胶层</div>
              <div className="sun-path" style={{ "--sun-drop": `${Math.max(18, 72 - forecast.raw.solarAltitude * 2)}%` } as React.CSSProperties} />
              <div className="aod-line" />
              <div className="profile-origin" />
              {forecast.profile.map((cell) => (
                <div className="profile-column" key={cell.distance}>
                  <span className="cloud-block high-cloud" style={{ height: `${Math.max(8, cell.high * 0.36)}%`, opacity: 0.18 + cell.high / 125 }} />
                  <span className="cloud-block mid-cloud" style={{ height: `${Math.max(6, cell.mid * 0.26)}%`, opacity: 0.16 + cell.mid / 130 }} />
                  <span className="cloud-block low-cloud" style={{ height: `${Math.max(4, cell.low * 0.18)}%`, opacity: 0.12 + cell.low / 140 }} />
                  <span className="sun-sample">☀</span>
                  <small>{cell.distance === 0 ? "0" : `${cell.distance}K`}</small>
                  <em>{cell.aod}</em>
                </div>
              ))}
            </div>
          </div>

          <div className="profile-footer">
            <span>观测 AOD：{forecast.raw.aod}</span>
            <span>光路通透度：{forecast.raw.lightPath}%</span>
            <span>云层画布：{forecast.raw.cloudCanvas}%</span>
            <span>峰值窗口：{forecast.peak}</span>
          </div>
        </div>
      </section>

      <section className="content-band city-board">
        <div className="section-heading">
          <p className="eyebrow">Six city board</p>
          <h2>六城火烧云潜力排行</h2>
        </div>
        <div className="city-grid">
          {ranked.map((item, index) => (
            <button
              className={`city-card ${item.name === city.name ? "is-active" : ""}`}
              key={item.name}
              onClick={() => {
                setCityName(item.name);
                setFeedback(null);
              }}
            >
              <span className="rank">0{index + 1}</span>
              <span className="city-name">{item.name}</span>
              <strong>{item.activeForecast.score}</strong>
              <small>{item.activeForecast.level} · 爆发 {item.activeForecast.burst_score} · {item.activeForecast.peak}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="feedback-band" aria-labelledby="feedback-title">
        <div>
          <p className="eyebrow">Feedback L0-L3</p>
          <h2 id="feedback-title">你看到的天空，反过来训练下一版模型。</h2>
        </div>
        <div className="feedback-actions">
          {["没看到", "有一点", "很好看", "炸裂"].map((item) => (
            <button
              key={item}
              className={feedback === item ? "is-active" : ""}
              onClick={() => setFeedback(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <p className="feedback-state">
          {feedback ? `已记录：${city.name} ${modeLabels[mode]}「${feedback}」` : "当前反馈仍保存在本机，下一版可接数据库"}
        </p>
      </section>
    </main>
  );
}
