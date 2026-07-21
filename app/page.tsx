"use client";

import { useEffect, useMemo, useState } from "react";

type Mode = "sunset" | "sunrise";

type Factor = {
  label: string;
  value: number;
  note: string;
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
  timeline: { time: string; value: number; label: string }[];
};

type CityForecast = {
  name: string;
  en: string;
  latlon: string;
  sunset: Forecast;
  sunrise: Forecast;
};

const cities: CityForecast[] = [
  {
    name: "南京",
    en: "NANJING",
    latlon: "32.06N / 118.79E",
    sunset: {
      score: 82,
      confidence: 76,
      verdict: "今晚，值得等一场霞光。",
      summary: "西向低云被切开，湿度和高空薄云都在可用区间，日落后 18 分钟最容易出颜色。",
      peak: "19:22",
      sunTime: "19:04",
      updatedAt: "16:40",
      trend: "+12",
      color: "#ff6a3d",
      factors: [
        { label: "Canvas", value: 86, note: "西侧云量留出足够透光窗口" },
        { label: "Tunnel", value: 78, note: "近地平线遮挡较少" },
        { label: "Atmosphere", value: 81, note: "湿度和气溶胶利于暖色散射" },
        { label: "Evolution", value: 72, note: "云系移动速度偏稳" },
      ],
      timeline: [
        { time: "18:40", value: 46, label: "暖色预热" },
        { time: "18:58", value: 68, label: "西天开口" },
        { time: "19:22", value: 82, label: "峰值窗口" },
        { time: "19:42", value: 53, label: "余晖回落" },
      ],
    },
    sunrise: {
      score: 67,
      confidence: 71,
      verdict: "明早有机会，但别把闹钟压太死。",
      summary: "低层云量略高，若 04:50 前后云底打开，会出现短暂粉橙色带。",
      peak: "05:07",
      sunTime: "05:15",
      updatedAt: "16:40",
      trend: "+5",
      color: "#ffd166",
      factors: [
        { label: "Canvas", value: 64, note: "云底偏厚但有层次" },
        { label: "Tunnel", value: 70, note: "东南向视野相对干净" },
        { label: "Atmosphere", value: 69, note: "水汽充足，色彩偏柔" },
        { label: "Evolution", value: 62, note: "窗口较短，变化快" },
      ],
      timeline: [
        { time: "04:42", value: 35, label: "天光抬升" },
        { time: "04:56", value: 58, label: "云缝成形" },
        { time: "05:07", value: 67, label: "峰值窗口" },
        { time: "05:25", value: 41, label: "转入晨光" },
      ],
    },
  },
  {
    name: "上海",
    en: "SHANGHAI",
    latlon: "31.23N / 121.47E",
    sunset: {
      score: 74,
      confidence: 73,
      verdict: "有漂亮边缘光，颜色偏克制。",
      summary: "海风带来的湿度不错，但西侧中云略密，适合看金边和云缝亮带。",
      peak: "18:59",
      sunTime: "18:43",
      updatedAt: "16:35",
      trend: "+8",
      color: "#ff7d51",
      factors: [
        { label: "Canvas", value: 72, note: "中云覆盖略多" },
        { label: "Tunnel", value: 68, note: "低空透光通道一般" },
        { label: "Atmosphere", value: 84, note: "海风湿度利于扩散" },
        { label: "Evolution", value: 71, note: "云层移动温和" },
      ],
      timeline: [
        { time: "18:24", value: 42, label: "云边变亮" },
        { time: "18:43", value: 61, label: "日落" },
        { time: "18:59", value: 74, label: "峰值窗口" },
        { time: "19:18", value: 47, label: "蓝调接管" },
      ],
    },
    sunrise: {
      score: 58,
      confidence: 66,
      verdict: "明早偏朦胧，适合拍城市剪影。",
      summary: "东侧湿度高，色彩可能被雾化，建筑边缘和江面反光会更稳定。",
      peak: "04:58",
      sunTime: "05:06",
      updatedAt: "16:35",
      trend: "-3",
      color: "#a7d8ff",
      factors: [
        { label: "Canvas", value: 57, note: "低云偏碎" },
        { label: "Tunnel", value: 55, note: "地平线通透度不足" },
        { label: "Atmosphere", value: 76, note: "水汽充足但易雾化" },
        { label: "Evolution", value: 51, note: "云形变化不确定" },
      ],
      timeline: [
        { time: "04:30", value: 28, label: "灰蓝天光" },
        { time: "04:48", value: 49, label: "雾面泛亮" },
        { time: "04:58", value: 58, label: "峰值窗口" },
        { time: "05:16", value: 39, label: "晨雾增强" },
      ],
    },
  },
  {
    name: "北京",
    en: "BEIJING",
    latlon: "39.90N / 116.40E",
    sunset: {
      score: 63,
      confidence: 69,
      verdict: "有概率出金色云底，别期待满天烧。",
      summary: "高空云形不错，但近地层通透度一般，适合找开阔西向机位。",
      peak: "19:36",
      sunTime: "19:19",
      updatedAt: "16:30",
      trend: "+4",
      color: "#f5b04c",
      factors: [
        { label: "Canvas", value: 70, note: "高云形态可用" },
        { label: "Tunnel", value: 54, note: "低空透明度一般" },
        { label: "Atmosphere", value: 61, note: "散射条件中等" },
        { label: "Evolution", value: 66, note: "后半段可能改善" },
      ],
      timeline: [
        { time: "18:58", value: 32, label: "西侧发白" },
        { time: "19:19", value: 52, label: "日落" },
        { time: "19:36", value: 63, label: "峰值窗口" },
        { time: "19:55", value: 45, label: "色温降低" },
      ],
    },
    sunrise: {
      score: 72,
      confidence: 74,
      verdict: "明早更值得冲，北方天空会更干净。",
      summary: "夜间风场改善通透度，东方云带薄而连续，适合城市天际线。",
      peak: "04:55",
      sunTime: "05:03",
      updatedAt: "16:30",
      trend: "+14",
      color: "#ff9f68",
      factors: [
        { label: "Canvas", value: 75, note: "薄云铺展均匀" },
        { label: "Tunnel", value: 77, note: "东方低空更通透" },
        { label: "Atmosphere", value: 69, note: "干空气带来清晰边界" },
        { label: "Evolution", value: 67, note: "峰值维持约 10 分钟" },
      ],
      timeline: [
        { time: "04:24", value: 31, label: "地平线泛亮" },
        { time: "04:42", value: 59, label: "云带染色" },
        { time: "04:55", value: 72, label: "峰值窗口" },
        { time: "05:12", value: 48, label: "亮度盖过色彩" },
      ],
    },
  },
  {
    name: "广州",
    en: "GUANGZHOU",
    latlon: "23.13N / 113.26E",
    sunset: {
      score: 69,
      confidence: 65,
      verdict: "南方湿热的粉紫调，有戏但窗口短。",
      summary: "对流云正在减弱，若西南侧云团散开，日落后会有一段高饱和色。",
      peak: "19:03",
      sunTime: "18:49",
      updatedAt: "16:45",
      trend: "+9",
      color: "#f06c9b",
      factors: [
        { label: "Canvas", value: 68, note: "积云边界立体" },
        { label: "Tunnel", value: 63, note: "西南低空仍有遮挡" },
        { label: "Atmosphere", value: 79, note: "水汽让粉紫更明显" },
        { label: "Evolution", value: 58, note: "对流消散节奏不稳" },
      ],
      timeline: [
        { time: "18:30", value: 38, label: "云塔退场" },
        { time: "18:49", value: 57, label: "日落" },
        { time: "19:03", value: 69, label: "峰值窗口" },
        { time: "19:21", value: 44, label: "湿度增厚" },
      ],
    },
    sunrise: {
      score: 51,
      confidence: 61,
      verdict: "明早偏灰，适合留在窗边观察。",
      summary: "东侧云底偏低，若局地阵雨结束较早，会出现浅粉色边缘。",
      peak: "05:49",
      sunTime: "05:56",
      updatedAt: "16:45",
      trend: "-6",
      color: "#c0b7ff",
      factors: [
        { label: "Canvas", value: 55, note: "云层厚度偏大" },
        { label: "Tunnel", value: 46, note: "低空遮挡明显" },
        { label: "Atmosphere", value: 68, note: "湿度高但透光弱" },
        { label: "Evolution", value: 45, note: "降水残留不确定" },
      ],
      timeline: [
        { time: "05:18", value: 22, label: "云底偏暗" },
        { time: "05:38", value: 42, label: "边缘转粉" },
        { time: "05:49", value: 51, label: "峰值窗口" },
        { time: "06:08", value: 33, label: "日光漫射" },
      ],
    },
  },
  {
    name: "南通",
    en: "NANTONG",
    latlon: "31.98N / 120.89E",
    sunset: {
      score: 79,
      confidence: 72,
      verdict: "江海交界的晚霞条件很好。",
      summary: "低层通道清楚，高云薄而连续，色彩会从橙红过渡到玫瑰粉。",
      peak: "18:57",
      sunTime: "18:40",
      updatedAt: "16:38",
      trend: "+11",
      color: "#ff5d4d",
      factors: [
        { label: "Canvas", value: 82, note: "高云铺展漂亮" },
        { label: "Tunnel", value: 76, note: "西北低空通透" },
        { label: "Atmosphere", value: 74, note: "江面水汽柔化色阶" },
        { label: "Evolution", value: 70, note: "云带移速稳定" },
      ],
      timeline: [
        { time: "18:20", value: 43, label: "金边出现" },
        { time: "18:40", value: 64, label: "日落" },
        { time: "18:57", value: 79, label: "峰值窗口" },
        { time: "19:17", value: 50, label: "粉色淡出" },
      ],
    },
    sunrise: {
      score: 62,
      confidence: 68,
      verdict: "明早有温柔色，不一定炸裂。",
      summary: "海上低云略厚，东侧云缝若维持，会出现一条干净橙线。",
      peak: "04:54",
      sunTime: "05:02",
      updatedAt: "16:38",
      trend: "+2",
      color: "#ffc857",
      factors: [
        { label: "Canvas", value: 60, note: "云层偏低但有缝" },
        { label: "Tunnel", value: 66, note: "东向通道尚可" },
        { label: "Atmosphere", value: 67, note: "水汽带来柔光" },
        { label: "Evolution", value: 54, note: "峰值较窄" },
      ],
      timeline: [
        { time: "04:25", value: 27, label: "冷色天光" },
        { time: "04:44", value: 51, label: "橙线出现" },
        { time: "04:54", value: 62, label: "峰值窗口" },
        { time: "05:13", value: 38, label: "云层增亮" },
      ],
    },
  },
  {
    name: "成都",
    en: "CHENGDU",
    latlon: "30.57N / 104.07E",
    sunset: {
      score: 56,
      confidence: 64,
      verdict: "云层厚，可能只有短促的缝隙光。",
      summary: "盆地低云偏厚，高空颜色不容易打下来，建议关注西边云缝而非整片天空。",
      peak: "19:44",
      sunTime: "19:28",
      updatedAt: "16:42",
      trend: "-4",
      color: "#b5a6ff",
      factors: [
        { label: "Canvas", value: 52, note: "云幕偏厚" },
        { label: "Tunnel", value: 49, note: "低空通道不足" },
        { label: "Atmosphere", value: 66, note: "湿度足但散射过强" },
        { label: "Evolution", value: 57, note: "后段或有小窗口" },
      ],
      timeline: [
        { time: "19:06", value: 24, label: "云幕压低" },
        { time: "19:28", value: 44, label: "日落" },
        { time: "19:44", value: 56, label: "峰值窗口" },
        { time: "20:03", value: 35, label: "余光散掉" },
      ],
    },
    sunrise: {
      score: 60,
      confidence: 63,
      verdict: "明早比今晚稍好，适合看柔和晨霞。",
      summary: "东侧云底可能在日出前抬升，颜色偏淡，但连续性不错。",
      peak: "06:04",
      sunTime: "06:12",
      updatedAt: "16:42",
      trend: "+7",
      color: "#ffb86b",
      factors: [
        { label: "Canvas", value: 63, note: "云层有渐变空间" },
        { label: "Tunnel", value: 58, note: "低空通道一般" },
        { label: "Atmosphere", value: 64, note: "水汽偏多，颜色柔" },
        { label: "Evolution", value: 55, note: "云底抬升是关键" },
      ],
      timeline: [
        { time: "05:32", value: 26, label: "灰蓝起色" },
        { time: "05:52", value: 47, label: "云底抬升" },
        { time: "06:04", value: 60, label: "峰值窗口" },
        { time: "06:22", value: 40, label: "晨光铺开" },
      ],
    },
  },
];

const modeLabels: Record<Mode, string> = {
  sunset: "今晚日落",
  sunrise: "明早日出",
};

function getLevel(score: number) {
  if (score >= 80) return "强烈推荐";
  if (score >= 70) return "值得出门";
  if (score >= 60) return "可以蹲守";
  return "谨慎观察";
}

export default function Home() {
  const [cityName, setCityName] = useState("南京");
  const [mode, setMode] = useState<Mode>("sunset");
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    const storedCity = window.localStorage.getItem("glowcast-city");
    if (storedCity && cities.some((city) => city.name === storedCity)) {
      setCityName(storedCity);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("glowcast-city", cityName);
  }, [cityName]);

  const city = useMemo(
    () => cities.find((item) => item.name === cityName) ?? cities[0],
    [cityName],
  );
  const forecast = city[mode];
  const ranked = useMemo(
    () =>
      [...cities]
        .map((item) => ({ ...item, activeForecast: item[mode] }))
        .sort((a, b) => b.activeForecast.score - a.activeForecast.score),
    [mode],
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
              <small>GlowCast V1.3 MVP</small>
            </span>
          </button>
          <nav className="city-nav" aria-label="城市选择">
            {cities.map((item) => (
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
            <p className="eyebrow">Live aurora of the city sky</p>
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
                <span>指数，不是概率</span>
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
              <span>较上次 {forecast.trend}</span>
            </div>
          </aside>
        </div>
      </section>

      <section className="content-band">
        <div className="section-heading">
          <p className="eyebrow">Why this score</p>
          <h2>四个因子解释今天的天空</h2>
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
          <p className="eyebrow">Sky timeline</p>
          <h2>{mode === "sunset" ? "日落前后 80 分钟" : "日出前后 70 分钟"}</h2>
        </div>
        <div className="timeline">
          {forecast.timeline.map((point) => (
            <article key={point.time} className="timeline-point">
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
          <h2>首版城市总览</h2>
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
          <h2 id="feedback-title">今晚你看到的天空，反过来训练明天的预报。</h2>
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
          {feedback ? `已记录：${city.name} ${modeLabels[mode]}「${feedback}」` : "请选择一个观测结果"}
        </p>
      </section>
    </main>
  );
}
