const query = new URLSearchParams(location.search);
const fallbackContext = {
  date: query.get("date") || new Date().toISOString().slice(0, 10), index: Number(query.get("index") || 0),
  lat: Number(query.get("lat") || 32.0603), lon: Number(query.get("lon") || 118.7969),
  city: query.get("city") || "南京", period: query.get("period") || "evening",
  score: Number(query.get("score") || 68), level: query.get("level") || "小烧"
};
let context = null;
try { context = JSON.parse(sessionStorage.getItem("xiaForecastDetail")); } catch (_) { /* 文件预览可能禁用存储。 */ }
context = { ...fallbackContext, ...(context || {}) };
let periodDays = { [context.period]: context.day || buildFallbackDay(context.period) };
let activePeriod = context.period;
let gribProfile = null;
const byId = (id) => document.getElementById(id);

function buildFallbackDay(period) {
  const isMorning = period === "morning"; const score = context.score;
  return {
    date: context.date, score, level: context.level,
    summary: `${isMorning ? "日出东北" : "日落西北"}方向光路一般；本地存在可上色高云。结论：${score >= 72 ? "值得一蹲！" : "有机会，可提前观察。"}`,
    event_time: `${context.date}T${isMorning ? "05:08" : "19:06"}:00+08:00`, sun_azimuth: isMorning ? 63.2 : 296.8,
    source_label: "离线示意数据", metrics: { high_cloud: 54, mid_cloud: 37, low_cloud: 18, corridor_low_cloud: 24, visibility: 18, aod: .16, cloud_base: 7200, optical_depth: 3.8, light_channel: 65 }
  };
}

function formatDay(value) {
  const date = new Date(`${value}T12:00:00`); const week = ["周日","周一","周二","周三","周四","周五","周六"][date.getDay()];
  return `${date.getMonth()+1}月${date.getDate()}日 · ${week}`;
}
function formatTime(value, fallback) { if (!value) return fallback; const date = new Date(value); return Number.isNaN(date.getTime()) ? value.slice(11,16) : date.toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit",hour12:false}); }
function direction(azimuth) { if (azimuth < 90) return "东北"; if (azimuth < 180) return "东南"; if (azimuth < 270) return "西南"; return "西北"; }
function safeMetric(day, key, fallback) { const value = day?.metrics?.[key]; return value === null || value === undefined ? fallback : Number(value); }

function renderHeader(day) {
  byId("headerPlace").textContent = context.city; byId("detailDate").textContent = `${context.city} · ${formatDay(context.date)}`;
  byId("detailPeriod").textContent = `${activePeriod === "morning" ? "朝霞" : "晚霞"}预测依据`;
  byId("detailScore").textContent = day.score; byId("detailLevel").textContent = day.level; byId("detailSummary").textContent = day.summary;
  byId("sourceBadge").textContent = day.source_label || day.source || "数据来源未知";
}

function renderSolarCards() {
  const morning = periodDays.morning || buildFallbackDay("morning"); const evening = periodDays.evening || buildFallbackDay("evening");
  byId("sunriseTime").textContent = formatTime(morning.event_time,"05:08"); byId("sunriseAzimuth").textContent = `${Number(morning.sun_azimuth || 63.2).toFixed(1)}°`; byId("sunriseDirection").textContent = direction(morning.sun_azimuth || 63.2);
  byId("sunsetTime").textContent = formatTime(evening.event_time,"19:06"); byId("sunsetAzimuth").textContent = `${Number(evening.sun_azimuth || 296.8).toFixed(1)}°`; byId("sunsetDirection").textContent = direction(evening.sun_azimuth || 296.8);
  byId("morningCard").classList.toggle("active",activePeriod === "morning"); byId("eveningCard").classList.toggle("active",activePeriod === "evening");
}

function renderMetrics(day) {
  const metrics = [
    ["光照通道",safeMetric(day,"light_channel",65),"%","低云、能见度与 AOD 共同决定",100],
    ["高云画布",safeMetric(day,"high_cloud",54),"%","30%—70% 通常更适合上色",100],
    ["能见度",safeMetric(day,"visibility",18)," km","越高代表霞光传播损耗越小",35],
    ["AOD",safeMetric(day,"aod",.16),"","适量气溶胶增强色彩，过量则遮光",.6]
  ];
  byId("metricGrid").innerHTML = metrics.map(([label,value,unit,note,max]) => `<article class="metric-card"><span>${label}</span><strong>${value}<small>${unit}</small></strong><div class="metric-bar"><i style="width:${Math.min(100,Math.max(3,value/max*100))}%"></i></div><p>${note}</p></article>`).join("");
  const channel = safeMetric(day,"light_channel",65); const canvas = safeMetric(day,"high_cloud",54);
  byId("physicalConclusion").textContent = day.summary || "光路与画布共同决定霞光潜力。";
  byId("formulaResult").textContent = `${channel}% × ${canvas}% → ${day.score} 分`;
}

function renderChart(day) {
  if (gribProfile?.available) { renderGribChart(gribProfile, day); return; }
  const m = day.metrics || {}; const high = safeMetric(day,"high_cloud",54); const mid = safeMetric(day,"mid_cloud",37); const low = safeMetric(day,"low_cloud",18); const corridor = safeMetric(day,"corridor_low_cloud",24); const baseKm = Math.min(10.5,Math.max(5, safeMetric(day,"cloud_base",7200)/1000));
  const azimuth = Number(day.sun_azimuth || (activePeriod === "morning" ? 63.2 : 296.8)); const event = activePeriod === "morning" ? "日出" : "日落";
  byId("chartDirection").textContent = `${event}方向`; byId("chartAzimuth").textContent = `${azimuth.toFixed(1)}°`; byId("chartDirectionText").textContent = direction(azimuth);
  byId("chartRange").textContent = "150KM 光路示意剖面";
  const x0=78,x1=872,y0=425,top=34,w=x1-x0,h=y0-top; const y=(km)=>y0-km/12*h;
  const columns = Array.from({length:6},(_,i)=>{const x=x0+i*w/5;return `<line x1="${x}" y1="${top}" x2="${x}" y2="${y0}" class="grid"/><text x="${x}" y="454" text-anchor="middle">${i*30}k</text>`}).join("");
  const rows = [0,2,4,6,8,10,12].map(k=>`<line x1="${x0}" y1="${y(k)}" x2="${x1}" y2="${y(k)}" class="grid"/><text x="58" y="${y(k)+4}" text-anchor="end">${k}km</text>`).join("");
  const highOpacity=(.08+high/100*.42).toFixed(2),midOpacity=(.05+mid/100*.26).toFixed(2),lowOpacity=(.05+low/100*.28).toFixed(2);
  const rayStart=activePeriod === "morning" ? x0 : x1; const rayEnd=activePeriod === "morning" ? x1 : x0;
  byId("chartWrap").innerHTML = `<svg viewBox="0 0 930 475" role="img" aria-label="${event}方向150公里云层和光路剖面"><defs><linearGradient id="highCloud" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#e7c85b" stop-opacity="${highOpacity}"/><stop offset="1" stop-color="#816b27" stop-opacity=".06"/></linearGradient><linearGradient id="lowCloud" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#e47658" stop-opacity="${lowOpacity}"/><stop offset="1" stop-color="#aa5147" stop-opacity=".05"/></linearGradient><filter id="glow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><style>.grid{stroke:rgba(255,255,255,.08);stroke-width:1}text{fill:#677080;font:12px Inter,sans-serif}.label{font-size:13px;fill:#8d93a0}.ray{stroke:#efca6a;stroke-width:2;stroke-dasharray:7 7;fill:none}.cloudline{fill:none;stroke:#e57c59;stroke-width:3;stroke-dasharray:6 6}</style>${rows}${columns}<rect x="${x0}" y="${y(12)}" width="${w}" height="${y(6)-y(12)}" fill="url(#highCloud)"/><rect x="${x0}" y="${y(6)}" width="${w}" height="${y(3)-y(6)}" fill="#47708c" opacity="${midOpacity}"/><rect x="${x0}" y="${y(3)}" width="${w}" height="${y0-y(3)}" fill="url(#lowCloud)"/><text class="label" x="${x0+14}" y="${y(9)}">高云带 ${high}%</text><text class="label" x="${x0+14}" y="${y(4.4)}">中云带 ${mid}%</text><text class="label" x="${x0+14}" y="${y(1.1)}">低云 ${low}%</text><path class="cloudline" d="M${x0},${y(.5+corridor/42)} C${x0+w*.3},${y(.9+corridor/50)} ${x0+w*.65},${y(.45+low/45)} ${x1},${y(.5+low/40)}"/><path class="ray" filter="url(#glow)" d="M${rayStart},${y(.2)} Q${x0+w*.5},${y(baseKm-.5)} ${rayEnd},${y(baseKm)}"/><circle cx="${rayStart}" cy="${y(.2)}" r="12" fill="#ef7658" filter="url(#glow)"/><text x="${rayStart}" y="${y(.2)+34}" text-anchor="${activePeriod === "morning" ? "start" : "end"}">太阳方向</text><circle cx="${rayEnd}" cy="${y(baseKm)}" r="6" fill="#e9c661"/><text x="${rayEnd}" y="${y(baseKm)-16}" text-anchor="${activePeriod === "morning" ? "end" : "start"}">${context.city} · 云底 ${baseKm.toFixed(1)}km</text></svg>`;
  byId("chartNote").textContent = gribProfile?.reason ? `GRIB 降级：${gribProfile.reason} 当前显示 Open-Meteo 示意剖面。` : "当前显示 Open-Meteo 示意剖面，不代表逐公里压力层扫描。";
}

function renderGribChart(profile, day) {
  const points=profile.points || []; const x0=78,x1=872,y0=425,top=34,w=x1-x0,h=y0-top; const y=(km)=>y0-Math.min(12,Math.max(0,km))/12*h; const x=(distance)=>x0+distance/profile.distance_km*w;
  const rows=[0,2,4,6,8,10,12].map(k=>`<line x1="${x0}" y1="${y(k)}" x2="${x1}" y2="${y(k)}" class="grid"/><text x="58" y="${y(k)+4}" text-anchor="end">${k}km</text>`).join("");
  const columns=points.map((point,index)=>{const px=x(point.distance_km);const label=index%2===0?`<text x="${px}" y="454" text-anchor="middle">${point.distance_km}k</text>`:"";return `<line x1="${px}" y1="${top}" x2="${px}" y2="${y0}" class="grid"/>${label}`}).join("");
  const cellWidth=Math.max(14,w/Math.max(1,points.length-1)-6);
  const cells=points.map(point=>point.layers.map(layer=>{const km=layer.height_m/1000;const opacity=Math.max(.035,Math.min(.78,(layer.rh-45)/55*.72));const color=km>=6?"#d9b84d":(km>=3?"#527d9a":"#df7255");return `<rect x="${x(point.distance_km)-cellWidth/2}" y="${y(km)-17}" width="${cellWidth}" height="34" rx="3" fill="${color}" opacity="${opacity.toFixed(2)}"><title>${point.distance_km}km · ${layer.level_hpa}hPa · RH ${layer.rh}% · ${layer.temperature_c}℃</title></rect>`}).join("")).join("");
  const humidLine=points.map((point,index)=>{const humid=[...point.layers].sort((a,b)=>b.rh-a.rh)[0];return `${index?"L":"M"}${x(point.distance_km)},${y(humid.height_m/1000)}`}).join(" ");
  const azimuth=Number(day.sun_azimuth || (activePeriod==="morning"?63.2:296.8)); const event=activePeriod==="morning"?"日出":"日落"; const compare=profile.comparison?`；ECMWF 湿度差 ${profile.comparison.mean_rh_difference}%（一致度${profile.comparison.agreement}）`:"；ECMWF 对照暂不可用";
  byId("chartDirection").textContent=`${event}方向`;byId("chartAzimuth").textContent=`${azimuth.toFixed(1)}°`;byId("chartDirectionText").textContent=direction(azimuth);byId("chartRange").textContent=`${profile.distance_km}KM 压力层剖面`;
  byId("chartWrap").innerHTML=`<svg viewBox="0 0 930 475" role="img" aria-label="${event}方向${profile.distance_km}公里真实压力层剖面"><defs><filter id="gribGlow"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><style>.grid{stroke:rgba(255,255,255,.08);stroke-width:1}text{fill:#677080;font:12px Inter,sans-serif}.humidity{stroke:#f0c86a;stroke-width:2;stroke-dasharray:7 7;fill:none}</style>${rows}${columns}${cells}<path d="${humidLine}" class="humidity"/><path d="M${x1},${y(.25)} Q${x(300)},${y(7)} ${x0},${y(7.4)}" class="humidity" filter="url(#gribGlow)"/><circle cx="${x1}" cy="${y(.25)}" r="12" fill="#ef7658" filter="url(#gribGlow)"/><text x="${x1}" y="${y(.25)+34}" text-anchor="end">太阳方向</text><circle cx="${x0}" cy="${y(7.4)}" r="6" fill="#e9c661"/><text x="${x0+8}" y="${y(7.4)-14}">${context.city}</text></svg>`;
  byId("chartNote").textContent=`主模型 ${profile.primary_model}，${profile.run_time.slice(0,13).replace("T"," ")} UTC 起报，预报时效 +${profile.forecast_hour}h${compare}。色块透明度表示压力层相对湿度。`;
}

function render() { const day=periodDays[activePeriod] || buildFallbackDay(activePeriod); renderHeader(day); renderSolarCards(); renderChart(day); renderMetrics(day); document.querySelectorAll("[role=tab]").forEach(tab=>tab.setAttribute("aria-selected",String(tab.dataset.period===activePeriod))); }

async function loadRealPair() {
  try {
    const requests = ["morning","evening"].map(period=>fetch(`/api/forecast?lat=${context.lat}&lon=${context.lon}&period=${period}`).then(response=>{if(!response.ok)throw new Error();return response.json();}));
    const [morning,evening]=await Promise.all(requests);
    for (const [period,payload] of [["morning",morning],["evening",evening]]) periodDays[period]=payload.days.find(day=>day.date===context.date) || payload.days[context.index] || payload.days[0];
    render();
  } catch (_) { periodDays.morning ||= buildFallbackDay("morning"); periodDays.evening ||= buildFallbackDay("evening"); render(); }
}

async function loadPressureProfile() {
  try {
    const response=await fetch(`/api/profile?lat=${context.lat}&lon=${context.lon}&forecast_date=${context.date}&period=${activePeriod}`); if(!response.ok)throw new Error("剖面接口异常");
    gribProfile=await response.json(); render();
  } catch (_) { gribProfile={available:false,reason:"无法连接压力层剖面服务"}; render(); }
}

document.addEventListener("DOMContentLoaded",()=>{ document.querySelectorAll("[role=tab]").forEach(tab=>tab.addEventListener("click",()=>{activePeriod=tab.dataset.period;gribProfile=null;render();loadPressureProfile();})); render(); loadRealPair(); loadPressureProfile(); });
