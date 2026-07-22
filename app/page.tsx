"use client";

import { useEffect, useMemo, useState } from "react";

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

type Forecast = {
  score: number;
  confidence: number;
  verdict: string;
  summary: string;
  peak: string;
  sunTime: string;
  updatedAt: string;
  trend: string;
  color: string;
  factors: Factor[];
  timeline: TimelinePoint[];
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
  };
};

type City = {
  name: string;
  en: string;
  latlon: string;
  latitude: number;
  longitude: number;
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

const cityConfigs: City[] = [
  { name: "南京", en: "NANJING", latlon: "32.06N / 118.79E", latitude: 32.0603, longitude: 118.7969 },
  { name: "上海", en: "SHANGHAI", latlon: "31.23N / 121.47E", latitude: 31.2304, longitude: 121.4737 },
  { name: "北京", en: "BEIJING", latlon: "39.90N / 116.40E", latitude: 39.9042, longitude: 116.4074 },
  { name: "广州", en: "GUANGZHOU", latlon: "23.13N / 113.26E", latitude: 23.1291, longitude: 113.2644 },
  { name: "南通", en: "NANTONG", latlon: "31.98N / 120.89E", latitude: 31.9802, longitude: 120.8943 },
  { name: "成都", en: "CHENGDU", latlon: "30.57N / 104.07E", latitude: 30.5728, longitude: 104.0668 },
];

const modeLabels: Record<Mode, string> = {
  sunset: "今晚日落",
  sunrise: "明早日出",
};

const fallbackForecast: Forecast = {
  score: 0,
  confidence: 0,
  verdict: "正在读取真实气象数据。",
  summary: "连接 Open-Meteo 逐小时预报，读取云量、湿度、能见度、降水概率和日出日落时间。",
  peak: "--:--",
  sunTime: "--:--",
  updatedAt: "--:--",
  trend: "Live",
  color: "#b9e7ff",
  source: "Open-Meteo 实时预报",
  raw: {
    dataTime: "--:--",
    cloud: 0,
    lowCloud: 0,
    midCloud: 0,
    highCloud: 0,
    humidity: 0,
    visibilityKm: "--",
    precipitation: 0,
  },
  factors: [
    { label: "云幕画布", value: 0, note: "等待云量数据" },
    { label: "地平线通道", value: 0, note: "等待低云与能见度数据" },
    { label: "大气通透", value: 0, note: "等待湿度数据" },
    { label: "变化稳定", value: 0, note: "等待逐小时变化数据" },
  ],
  timeline: [
    { time: "--:--", value: 0, label: "等待数据" },
    { time: "--:--", value: 0, label: "等待数据" },
    { time: "--:--", value: 0, label: "等待数据" },
    { time: "--:--", value: 0, label: "等待数据" },
  ],
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

function describeCloud(total: number, low: number, high: number) {
  if (low > 75) return "低云偏厚，地平线透光窗口被压缩";
  if (total >= 35 && total <= 68 && high > 20) return "云量处在可染色区间，高云能承接暖色";
  if (total < 25) return "天空偏空，颜色载体不足";
  return "云量可用，但云层结构需要继续观察";
}

function describeRaw(raw: Forecast["raw"]) {
  return `模型读取 ${raw.dataTime} 附近的逐小时预报：总云量 ${raw.cloud}%，低云 ${raw.lowCloud}%，高云 ${raw.highCloud}%，湿度 ${raw.humidity}%，能见度 ${raw.visibilityKm} km，降水概率 ${raw.precipitation}%。`;
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

function makeVerdict(score: number, mode: Mode) {
  if (score >= 82) return mode === "sunset" ? "今晚，值得等一场霞光。" : "明早值得早起，窗口很像样。";
  if (score >= 72) return mode === "sunset" ? "今晚值得出门，颜色有机会展开。" : "明早有戏，建议提前到位。";
  if (score >= 60) return "可以蹲守，但别把期待拉满。";
  if (score >= 45) return "有短暂窗口，适合顺路观察。";
  return "条件偏弱，今天更适合云上观测。";
}

function makeForecast(data: OpenMeteoResponse, mode: Mode): Forecast {
  const hourly = data.hourly ?? {};
  const times = hourly.time ?? [];
  const eventTime = mode === "sunset" ? data.daily?.sunset?.[0] : data.daily?.sunrise?.[1] ?? data.daily?.sunrise?.[0];
  const offsets = mode === "sunset" ? [-40, -10, 18, 38] : [-38, -12, 0, 22];
  const labels = mode === "sunset" ? ["暖色预热", "日落贴线", "峰值窗口", "余晖回落"] : ["天光抬升", "云底染色", "峰值窗口", "晨光铺开"];
  const target = eventTime ? addMinutes(eventTime, mode === "sunset" ? 18 : -2) : new Date();
  const targetIndex = nearestIndex(times, target);
  const prevIndex = Math.max(0, targetIndex - 1);
  const nextIndex = Math.min(Math.max(0, times.length - 1), targetIndex + 1);

  const cloud = at(hourly.cloud_cover, targetIndex, 50);
  const low = at(hourly.cloud_cover_low, targetIndex, cloud * 0.55);
  const mid = at(hourly.cloud_cover_mid, targetIndex, cloud * 0.35);
  const high = at(hourly.cloud_cover_high, targetIndex, cloud * 0.25);
  const humidity = at(hourly.relative_humidity_2m, targetIndex, 60);
  const visibility = at(hourly.visibility, targetIndex, 10000);
  const precip = at(hourly.precipitation_probability, targetIndex, 0);
  const cloudPrev = at(hourly.cloud_cover, prevIndex, cloud);
  const cloudNext = at(hourly.cloud_cover, nextIndex, cloud);
  const dataTime = times[targetIndex] ?? "";

  const canvas = clamp(92 - Math.abs(cloud - 58) * 1.05 + high * 0.24 + mid * 0.12 - Math.max(low - 42, 0) * 0.48);
  const tunnel = clamp(92 - low * 0.62 - precip * 0.62 + Math.min(visibility / 1000, 16));
  const atmosphere = clamp(90 - Math.abs(humidity - 64) * 0.72 + Math.min(visibility / 1500, 10) - precip * 0.35);
  const evolution = clamp(86 - Math.abs(cloudNext - cloudPrev) * 1.05 - precip * 0.22 + Math.min(high, 55) * 0.16);
  const score = clamp(canvas * 0.34 + tunnel * 0.3 + atmosphere * 0.2 + evolution * 0.16);
  const confidence = clamp(82 - precip * 0.22 - Math.abs(cloudNext - cloudPrev) * 0.35 + (data.generationtime_ms ? 5 : 0), 38, 92);
  const timeline = offsets.map((offset, index) => {
    const itemIndex = eventTime ? nearestIndex(times, addMinutes(eventTime, offset)) : targetIndex;
    const pointCloud = at(hourly.cloud_cover, itemIndex, cloud);
    const pointLow = at(hourly.cloud_cover_low, itemIndex, low);
    const pointHigh = at(hourly.cloud_cover_high, itemIndex, high);
    const pointHumidity = at(hourly.relative_humidity_2m, itemIndex, humidity);
    const pointPrecip = at(hourly.precipitation_probability, itemIndex, precip);
    const value = clamp(
      90 - Math.abs(pointCloud - 52) * 1.1 - pointLow * 0.42 + pointHigh * 0.18 - Math.abs(pointHumidity - 62) * 0.42 - pointPrecip * 0.4,
    );
    return {
      time: eventTime ? formatTime(addMinutes(eventTime, offset).toISOString()) : "--:--",
      value,
      label: labels[index],
    };
  });

  const peakPoint = timeline.reduce((best, item) => (item.value > best.value ? item : best), timeline[0]);
  const color = score >= 75 ? "#ff6a3d" : score >= 62 ? "#ffc857" : score >= 48 ? "#b9e7ff" : "#b5a6ff";

  return {
    score,
    confidence,
    verdict: makeVerdict(score, mode),
    summary: `${describeCloud(cloud, low, high)}；${describeTunnel(low, visibility, precip)}。${describeRaw({
      dataTime: formatTime(dataTime),
      cloud: Math.round(cloud),
      lowCloud: Math.round(low),
      midCloud: Math.round(mid),
      highCloud: Math.round(high),
      humidity: Math.round(humidity),
      visibilityKm: (visibility / 1000).toFixed(1),
      precipitation: Math.round(precip),
    })}`,
    peak: peakPoint?.time ?? formatTime(target.toISOString()),
    sunTime: formatTime(eventTime),
    updatedAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }),
    trend: "实时",
    color,
    source: "Open-Meteo 实时预报",
    raw: {
      dataTime: formatTime(dataTime),
      cloud: Math.round(cloud),
      lowCloud: Math.round(low),
      midCloud: Math.round(mid),
      highCloud: Math.round(high),
      humidity: Math.round(humidity),
      visibilityKm: (visibility / 1000).toFixed(1),
      precipitation: Math.round(precip),
    },
    factors: [
      { label: "云幕画布", value: canvas, note: "总云量不能太空也不能太厚，高云和中云越能承接霞光越好" },
      { label: "地平线通道", value: tunnel, note: "低云、降水和能见度决定太阳低角度光线能不能穿进来" },
      { label: "大气通透", value: atmosphere, note: describeAtmosphere(humidity, visibility) },
      { label: "变化稳定", value: evolution, note: "基于峰值前后逐小时云量变化估算窗口稳定性" },
    ],
    timeline,
  };
}

async function fetchCityForecast(city: City): Promise<CityForecast> {
  const params = new URLSearchParams({
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
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`Open-Meteo request failed: ${response.status}`);
  }
  const data = (await response.json()) as OpenMeteoResponse;
  return {
    ...city,
    sunset: makeForecast(data, "sunset"),
    sunrise: makeForecast(data, "sunrise"),
  };
}

function getLevel(score: number) {
  if (score >= 80) return "强烈推荐";
  if (score >= 70) return "值得出门";
  if (score >= 60) return "可以蹲守";
  if (score > 0) return "谨慎观察";
  return "读取中";
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
              <small>GlowCast · Live weather model</small>
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
            <p className="eyebrow">Open-Meteo live forecast</p>
            <h1 id="hero-title">
              {city.name}
              <span>{modeLabels[mode]}霞光指数</span>
            </h1>
            <p className="hero-summary">{forecast.summary}</p>
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
              <span>云量 / 低云 / 高云 / 湿度 / 能见度 / 降水概率</span>
              {dataError ? <span>{dataError}</span> : null}
            </div>
          </section>

          <section className="score-stage" aria-label={`${city.name}${modeLabels[mode]}霞光指数`}>
            <div className="score-orbit" style={{ "--accent": forecast.color } as React.CSSProperties}>
              <div className="ring ring-one" />
              <div className="ring ring-two" />
              <div className="score-number">
                <span>{forecast.score}</span>
                <small>/100</small>
              </div>
              <div className="score-caption">
                <b>{getLevel(forecast.score)}</b>
                <span>真实气象数据 + 经验指数模型</span>
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
            ["总云量", `${forecast.raw.cloud}%`],
            ["低云", `${forecast.raw.lowCloud}%`],
            ["中云", `${forecast.raw.midCloud}%`],
            ["高云", `${forecast.raw.highCloud}%`],
            ["湿度", `${forecast.raw.humidity}%`],
            ["能见度", `${forecast.raw.visibilityKm} km`],
            ["降水概率", `${forecast.raw.precipitation}%`],
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
          <h2>霞光指数拆解</h2>
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

      <section className="content-band timeline-band">
        <div className="section-heading">
          <p className="eyebrow">Peak timeline</p>
          <h2>{mode === "sunset" ? "日落前后关键时刻" : "日出前后关键时刻"}</h2>
        </div>
        <div className="timeline">
          {forecast.timeline.map((point) => (
            <article key={`${point.time}-${point.label}`} className="timeline-point">
              <div className="timeline-bar">
                <span style={{ height: `${point.value}%`, background: forecast.color }} />
              </div>
              <strong>{point.time}</strong>
              <p>{point.label}</p>
              <small>{point.value}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="content-band city-board">
        <div className="section-heading">
          <p className="eyebrow">Six city board</p>
          <h2>首版城市实时总览</h2>
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
              <small>{getLevel(item.activeForecast.score)} · {item.activeForecast.peak}</small>
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
