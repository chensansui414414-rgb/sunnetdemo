# 霞光预报网 GlowCast

面向中国城市的朝霞、晚霞潜力预测网站。当前 MVP 支持南京、上海、北京、广州、南通和成都。

算法不只判断本地天气，而是同时评估：

```text
光源 × 太阳方向光路 × 中高云画布 × 空气通透度 × 模型一致性
```

当前算法版本：`fire-cloud-v2-burst-calibrated`

城市校准版本：`city-calibration-v1`

## 当前能力

- 朝霞、晚霞双时段预测；
- `stable_score`：保守的稳定命中分；
- `burst_score`：雨后开缝、云量变化等不稳定爆发机会；
- `horizon_gap_score`：地平线云缝机会；
- 六城独立 AOD、湿度、低云惩罚和阈值配置；
- 数据来源、fallback 状态和置信度说明；
- CMA 高空站太阳方向稀疏剖面采样。

## 数据源

| 优先级 | 数据源 | 主要用途 |
|---|---|---|
| 国内主源 | 和风天气 | 小时天气预报 |
| 国内实况 | CMA 地面气象站 | 湿度、能见度、降水校准 |
| 国内实况 | CMA 高空气象站 | 压力层湿度、分层云校准 |
| 国内辅助 | CMA 雷达 | 当前仅查询文件元数据，尚未解析 PNG |
| 国内空气 | 生态环境部/中国环境监测总站 | AQI、PM 及 AOD 代理 |
| 真实 AOD | NASA AERONET | 有可用站点和时次时优先 |
| 海外降级 | Open-Meteo GFS/ECMWF/Air Quality | 天气、分层云、模型对照、AOD fallback |

真实观测、模式预报、代理数据和 fallback 会在界面与接口中区分。PM/AQI 推导值不能等同于真实 AOD；雷达元数据不能等同于雷达图像解析。

## 技术栈

- Next.js 16
- React 19
- TypeScript
- vinext / Cloudflare Workers
- OpenAI Sites 部署配置

Node.js 要求：`>=22.13.0`

## 本地启动

```bash
npm ci
cp .env.example .env.local
npm run dev
```

生产构建：

```bash
npm run build
```

测试：

```bash
npm test
```

## 环境变量

所有第三方账号和密钥只能放在服务端环境变量中，不得使用 `NEXT_PUBLIC_*` 暴露。

| 变量 | 用途 |
|---|---|
| `QWEATHER_API_KEY` | 和风天气密钥 |
| `QWEATHER_API_HOST` | 和风天气专属 Host |
| `CMA_GROUND_USER_ID` / `CMA_GROUND_PASSWORD` | CMA 地面站 |
| `CMA_UPPER_AIR_USER_ID` / `CMA_UPPER_AIR_PASSWORD` | CMA 高空站 |
| `CMA_RADAR_USER_ID` / `CMA_RADAR_PASSWORD` | CMA 雷达 |
| `NEXT_PUBLIC_CHINA_WEATHER_PROXY_URL` | 可选独立天气代理 |
| `NEXT_PUBLIC_MEE_AIR_PROXY_URL` | 可选独立空气质量代理 |

完整说明见 [.env.example](.env.example)。提交前请确认没有 `.env`、账号、密码或 API Key 进入 Git。

## 项目结构

```text
app/
  api/                 服务端数据代理
  globals.css          全局样式
  layout.tsx           页面元信息
  page.tsx             页面与预测算法
backend/algorithm/     城市校准配置
docs/                  PRD 与算法说明
public/                静态资源
tests/                 构建产物测试
worker/                Cloudflare Worker 入口
.openai/hosting.json   Sites 项目标识
```

## 文档

- [当前算法与数据源 PRD](docs/霞光预报网_V1.4_当前算法与数据源_PRD.md)
- [火烧云预测算法说明](docs/fire-cloud-algorithm.md)

## 当前限制

- 中国大陆稳定访问仍取决于国内部署、域名备案、DNS 和后端代理；
- 和风天气缺少完整低云/中云/高云分层；
- AERONET 站点覆盖有限；
- CMA 高空站剖面属于真实站点的空间稀疏近似，不是连续格点真值；
- CMA 雷达目前只有文件元数据，尚未完成 PNG 下载与图像解析；
- 经验权重需要通过 30–90 天六城回测继续校准。

## 字体

当前代码未再依赖 Google Fonts。后续若将 MiSans 字体文件随网站发布，应使用小米官方字体包、遵守 MiSans 许可协议，并在软件中注明使用 MiSans。
