// 页面状态集中管理；定位失败时以南京作为友好回退。
const state = { lat: 32.0603, lon: 118.7969, city: "南京", period: "evening", days: [] };
const el = (selector) => document.querySelector(selector);
const cities = [
  ["北京", 39.9042, 116.4074, "华北"], ["上海", 31.2304, 121.4737, "华东"],
  ["广州", 23.1291, 113.2644, "华南"], ["深圳", 22.5431, 114.0579, "华南"],
  ["杭州", 30.2741, 120.1551, "华东"], ["南京", 32.0603, 118.7969, "华东"],
  ["成都", 30.5728, 104.0668, "西南"], ["重庆", 29.5630, 106.5516, "西南"],
  ["武汉", 30.5928, 114.3055, "华中"], ["西安", 34.3416, 108.9398, "西北"],
  ["长沙", 28.2282, 112.9388, "华中"], ["厦门", 24.4798, 118.0894, "华南"],
  ["青岛", 36.0671, 120.3826, "华北"], ["昆明", 25.0389, 102.7183, "西南"],
  ["三亚", 18.2528, 109.5119, "华南"], ["拉萨", 29.6520, 91.1721, "西南"]
];

function updateLocationUI() {
  el("#locationName").textContent = state.city;
  el("#mobileLocation").textContent = `${state.city} · 选择城市`;
}

function updatePeriodUI() {
  const isMorning = state.period === "morning";
  document.querySelectorAll(".period-switch button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.period === state.period)));
  el("#forecastTypeLabel").textContent = isMorning ? "朝霞预测" : "晚霞预测";
  el("#heroTimeWord").textContent = isMorning ? "今晨" : "今晚";
  el("#resultLabel").textContent = isMorning ? "今日朝霞潜力" : "今日晚霞潜力";
}

function formatDate(iso, index) {
  const date = new Date(`${iso}T12:00:00`);
  const week = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
  return `${index === 0 ? "今天" : week} · ${date.getMonth() + 1}月${date.getDate()}日`;
}

function metric(label, value, unit, max = 100) {
  const width = Math.max(2, Math.min(100, value / max * 100));
  return `<div class="metric"><div class="metric-label"><span>${label}</span><span>${value}${unit}</span></div><div class="metric-track"><div class="metric-fill" style="width:${width}%"></div></div></div>`;
}

function renderCards(days) {
  el("#forecastGrid").innerHTML = days.map((day, index) => `
    <article class="forecast-card ${index === 0 ? "active" : ""}" data-index="${index}">
      <div class="card-top"><span class="card-date">${formatDate(day.date, index)}</span><span class="weather-icon" aria-hidden="true"></span></div>
      <p class="card-score">${day.score}<small> / 100</small></p>
      <p class="card-level">${day.level}</p><p class="card-summary">${day.summary}</p>
      <button class="detail-toggle" type="button" data-index="${index}">查看预测依据 <span>↗</span></button>
    </article>`).join("");
  document.querySelectorAll(".detail-toggle").forEach((button) => button.addEventListener("click", () => {
    const index = Number(button.dataset.index); const day = state.days[index];
    try { sessionStorage.setItem("xiaForecastDetail", JSON.stringify({ day, index, lat: state.lat, lon: state.lon, city: state.city, period: state.period })); } catch (_) { /* 文件预览环境可能禁用存储。 */ }
    const params = new URLSearchParams({ date: day.date, index, lat: state.lat, lon: state.lon, city: state.city, period: state.period, score: day.score, level: day.level });
    window.location.href = `forecast-detail.html?${params}`;
  }));
}

function animateNumber(node, target, duration = 900) {
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / duration);
    node.textContent = Math.round(target * (1 - Math.pow(1 - progress, 3))).toLocaleString("zh-CN");
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function loadForecast() {
  try {
    const response = await fetch(`/api/forecast?lat=${state.lat}&lon=${state.lon}&period=${state.period}`);
    if (!response.ok) throw new Error("接口返回异常");
    const data = await response.json(); state.days = data.days; renderCards(data.days);
    animateNumber(el("#heroScore"), data.days[0].score);
    el("#heroLevel").textContent = data.days[0].level;
    el("#heroSummary").textContent = data.days[0].summary;
    el("#predictionCount").dataset.target = data.stats.forecasts;
    el("#feedbackCount").dataset.target = data.stats.feedback;
    if (data.is_mock) {
      el("#dataNotice").textContent = "演示模式 · 当前展示确定性模拟气象数据";
    } else if (data.is_stale) {
      el("#dataNotice").textContent = `缓存模式 · ${data.data_source || "Open-Meteo"} 暂时不可用，正在使用最近一次真实预报`;
    } else {
      const time = data.fetched_at ? new Date(data.fetched_at).toLocaleString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : "刚刚";
      el("#dataNotice").textContent = `实时模式 · ${data.data_source || "Open-Meteo / CAMS"} · ${time} 更新`;
    }
    initCounters();
  } catch (error) {
    // 双击 HTML 或后端未启动时，仍提供完整可操作的确定性演示界面。
    const base = new Date();
    const demoScores = state.period === "morning" ? [54, 76, 38] : [68, 82, 43];
    const days = demoScores.map((score, index) => {
      const current = new Date(base); current.setDate(base.getDate() + index);
      return {
        date: current.toISOString().slice(0, 10), score,
        level: score >= 72 ? "大烧" : (score >= 45 ? "小烧" : "无烧"),
        summary: index === 1 ? `${state.period === "morning" ? "日出东北" : "日落西北"}方向光路通透；本地高云画布 54%，薄云透光。结论：值得一蹲！` : `${state.period === "morning" ? "日出" : "日落"}方向光路一般；本地有可上色高云。结论：有机会，路过可等等。`,
        metrics: { light_channel: 46 + index * 19, high_cloud: 38 + index * 8, visibility: 16 + index * 4, cloud_base: 5800 + index * 700 }
      };
    });
    state.days = days; renderCards(days); animateNumber(el("#heroScore"), days[0].score);
    el("#heroLevel").textContent = days[0].level; el("#heroSummary").textContent = days[0].summary;
    el("#dataNotice").textContent = "离线演示 · 启动后端后自动切换为坐标预测";
    initCounters();
  }
}

function initReveal() {
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); }
  }), { threshold: .14 });
  document.querySelectorAll(".reveal").forEach((node) => observer.observe(node));
}

let countersStarted = false;
function initCounters() {
  const stats = el(".stats");
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && !countersStarted) {
      countersStarted = true; document.querySelectorAll(".counter").forEach((node) => animateNumber(node, Number(node.dataset.target), 1100));
    }
  }); observer.observe(stats);
}

function nearestCity(lat, lon) {
  const ordered = cities.map((city) => ({ city, distance: Math.hypot(city[1] - lat, (city[2] - lon) * Math.cos(lat * Math.PI / 180)) })).sort((a, b) => a.distance - b.distance);
  return ordered[0].distance < 1.2 ? ordered[0].city[0] : "当前位置";
}

function useCurrentLocation(silent = false) {
  if (!navigator.geolocation) { state.city = "南京"; updateLocationUI(); loadForecast(); return; }
  if (!silent) el("#currentLocationButton").querySelector("strong").textContent = "正在定位…";
  navigator.geolocation.getCurrentPosition((position) => {
    state.lat = position.coords.latitude; state.lon = position.coords.longitude;
    state.city = nearestCity(state.lat, state.lon); updateLocationUI();
    el("#currentLocationButton").querySelector("strong").textContent = "使用当前位置";
    el("#cityDialog").close(); loadForecast();
  }, () => {
    state.city = "南京"; updateLocationUI();
    el("#currentLocationButton").querySelector("strong").textContent = "定位失败，点此重试";
    if (silent) loadForecast();
  }, { enableHighAccuracy: false, timeout: 7000, maximumAge: 600000 });
}

function renderCityList(keyword = "") {
  const normalized = keyword.trim().toLowerCase();
  const matched = cities.filter((city) => !normalized || city[0].includes(normalized) || city[3].includes(normalized));
  el("#cityList").innerHTML = matched.length ? matched.map((city) => `<button class="city-option" type="button" data-city="${city[0]}"><strong>${city[0]}</strong><small>${city[3]} · ${city[1].toFixed(2)}°N</small></button>`).join("") : `<p class="city-empty">暂未找到这个城市</p>`;
  document.querySelectorAll(".city-option").forEach((button) => button.addEventListener("click", () => {
    const city = cities.find((item) => item[0] === button.dataset.city);
    [state.city, state.lat, state.lon] = [city[0], city[1], city[2]];
    updateLocationUI(); el("#cityDialog").close(); loadForecast();
  }));
}

function initLocation() {
  const dialog = el("#cityDialog");
  const open = () => {
    if (el("#menuButton").getAttribute("aria-expanded") === "true") el("#menuButton").click();
    renderCityList(); el("#citySearch").value = ""; dialog.showModal();
  };
  el("#locateButton").addEventListener("click", open); el("#mobileLocation").addEventListener("click", open);
  el("#closeCityDialog").addEventListener("click", () => dialog.close());
  el("#currentLocationButton").addEventListener("click", () => useCurrentLocation(false));
  el("#citySearch").addEventListener("input", (event) => renderCityList(event.target.value));
  updateLocationUI(); useCurrentLocation(true);
}

function initPeriodSwitch() {
  document.querySelectorAll(".period-switch button").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.period === state.period) return;
    state.period = button.dataset.period; updatePeriodUI(); loadForecast();
  }));
  updatePeriodUI();
}

function initFeedback() {
  const dialog = el("#feedbackDialog");
  el("#feedbackButton").addEventListener("click", () => dialog.showModal());
  el("#feedbackForm").addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    form.set("lat", state.lat); form.set("lon", state.lon);
    form.set("forecast_date", state.days[0]?.date || new Date().toISOString().slice(0, 10));
    try {
      const photo = form.get("photo");
      let response;
      if (photo?.size) {
        response = await fetch("/api/feedback/photo", { method: "POST", body: form });
      } else {
        const payload = Object.fromEntries(["lat", "lon", "forecast_date", "result", "note"].map((key) => [key, form.get(key)]));
        response = await fetch("/api/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      }
      if (!response.ok) throw new Error();
      el("#formMessage").textContent = "收到，谢谢你认真看过今天的天空。";
      setTimeout(() => dialog.close(), 1100);
    } catch { el("#formMessage").textContent = "提交失败，请稍后再试。"; }
  });
}

function initMenu() {
  const button = el("#menuButton"); const menu = el("#mobileMenu");
  const close = () => { button.setAttribute("aria-expanded", "false"); menu.classList.remove("open"); menu.setAttribute("aria-hidden", "true"); document.body.classList.remove("menu-open"); };
  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open)); menu.classList.toggle("open", open);
    menu.setAttribute("aria-hidden", String(!open)); document.body.classList.toggle("menu-open", open);
  });
  menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", close));
}

document.addEventListener("DOMContentLoaded", () => { initReveal(); initPeriodSwitch(); initLocation(); initFeedback(); initMenu(); });
