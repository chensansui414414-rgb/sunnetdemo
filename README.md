# 霞光时刻

一个面向摄影爱好者与追云者的三日朝晚霞预测 MVP。项目用“光照通道 × 高云画布”的物理门控生成 0—100 分指数，不使用随机数；默认情况下真实气象依赖不可用时，会自动切换为可复现的模拟数据，先保证产品界面完整可用。正式测试可开启严格真实数据模式，禁止展示模拟预测。

## 3 分钟启动

```bash
cd /Users/chenyan/Desktop/预报
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-lite.txt
python -m backend.api
```

浏览器打开 `http://127.0.0.1:8000`。接口文档位于 `http://127.0.0.1:8000/docs`。

项目接口的中文说明、字段表与请求示例见 [`docs/API接口文档.md`](docs/API接口文档.md)。

中国气象数据网的国内替换候选、数据代码和申请问题清单见 [`docs/中国气象数据网替换清单.md`](docs/中国气象数据网替换清单.md)。

如果暂时不想安装任何依赖，可先运行 `python3 preview.py`。它同样会默认请求 Open-Meteo 真实数据，只是不支持实拍图片上传。

## 真实数据状态

默认启用 Open-Meteo：天气使用全球 Best Match 模式，AOD 使用 CAMS Global。每个坐标缓存 3 小时；网络失败时先使用最近一次真实缓存，完全没有缓存时才切换为确定性 Mock。设置 `USE_OPEN_METEO=0` 可强制关闭联网获取。接口会返回 `is_mock`、`is_stale`、`data_source` 和 `fetched_at`，前端据此明确显示数据状态。

如需确保网站只展示真实数据或真实缓存，请使用严格真实数据模式：

```bash
STRICT_REAL_DATA=1 USE_OPEN_METEO=1 python -m backend.api
```

开启后，如果 Open-Meteo / CAMS 请求失败且本地没有可用真实缓存，`/api/forecast` 会返回 `503`，前端会显示“真实数据暂不可用”，不会再展示 Mock 分数。

## 当前算法优化点

当前评分不是只读取日出/日落单个整点，而是额外检查日出/日落前后约 1.5 小时窗口：

- 使用窗口内太阳方向低云最大值，降低“整点看起来通透、实际云墙遮挡”的误判。
- 使用本地低云最大值，降低低云/雾幕导致的假高分。
- 使用窗口内高云画布均值与波动，降低云量快速变化时的假确定性。
- 纳入降水量和降水概率，雨幕或湿低云会压低光路通透度。
- 使用日落前或日出后的直接辐射作为“供光”门控，避免有云但没有足够光源时给高分。

这些优化会让系统更保守：宁愿少报一点“大烧/小烧”，也尽量减少让用户白跑的假阳性。

## 接口

- `GET /api/forecast?lat=32.0603&lon=118.7969&period=evening`：未来三天预测；`period` 可选 `morning`（朝霞）或 `evening`（晚霞）。
- `POST /api/feedback`：提交“命中 / 一般 / 翻车”反馈。
- `POST /api/feedback/photo`：以表单上传反馈与实拍图片，图片最大 8MB。
- `GET /api/health`：服务健康检查。

## 启用完整气象依赖

```bash
pip install -r requirements.txt
ENABLE_REAL_WEATHER=1 python -m backend.api
```

基础预报默认使用 Open-Meteo / CAMS。开启 `ENABLE_GRIB_PROFILE=1` 后，GFS / ECMWF 压力层剖面会正式参与首页三日评分；未开启时保持轻量 Open-Meteo 模式。GFS 负责全球主剖面，ECMWF Open Data 用于交叉验证；HRRR 仅覆盖北美，不用于南京等中国城市。

## 启用 GFS / ECMWF 压力层剖面

完整依赖安装后，用以下方式启动 FastAPI 服务：

```bash
source .venv/bin/activate
pip install -r requirements.txt
ENABLE_GRIB_PROFILE=1 python -m backend.api
```

开启后，`/api/forecast` 与“预测依据”页都会沿太阳方位生成 0—600 km、间隔 50 km 的 13 个采样点。主模型使用 NOAA GFS 0.25° 的 1000、925、850、700、500、300、200 hPa 压力层；ECMWF IFS Open Data 0.25° 用作湿度剖面对照。GRIB 与解析结果缓存 6 小时，建议为本地缓存预留 5—10 GB。

首次请求可能需要数分钟下载。若依赖、网络或模式时次不可用，`/api/profile` 会返回 `available: false`；`/api/forecast` 会继续使用 Open-Meteo / CAMS 真实数据评分，并在 `metrics.profile_used=false`、`metrics.profile_reason` 中说明原因。

## 目录

```text
backend/        FastAPI、物理算法、天气下载器、SQLite
frontend/       原生 HTML/CSS/JS 响应式网站
miniprogram/    微信小程序原生适配版
data/           运行后自动创建的缓存、数据库与用户实拍
```

所有设计令牌都集中在 `frontend/style.css` 顶部的 CSS 变量中。默认地点为南京；桌面端可点击右上角定位，浏览器拒绝定位时继续使用南京。
