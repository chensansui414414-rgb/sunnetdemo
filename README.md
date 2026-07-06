# 霞光时刻

一个面向摄影爱好者与追云者的三日朝晚霞预测 MVP。项目用“光照通道 × 高云画布”的物理门控生成 0—100 分指数，不使用随机数；真实气象依赖不可用时，会自动切换为可复现的模拟数据，先保证产品界面完整可用。

## 3 分钟启动

```bash
cd /Users/chenyan/Desktop/预报
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-lite.txt
python -m backend.api
```

浏览器打开 `http://127.0.0.1:8000`。接口文档位于 `http://127.0.0.1:8000/docs`。

如果暂时不想安装任何依赖，可先运行 `python3 preview.py`。它同样会默认请求 Open-Meteo 真实数据，只是不支持实拍图片上传。

## 真实数据状态

默认启用 Open-Meteo：天气使用全球 Best Match 模式，AOD 使用 CAMS Global。每个坐标缓存 3 小时；网络失败时先使用最近一次真实缓存，完全没有缓存时才切换为确定性 Mock。设置 `USE_OPEN_METEO=0` 可强制关闭联网获取。接口会返回 `is_mock`、`is_stale`、`data_source` 和 `fetched_at`，前端据此明确显示数据状态。

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

基础预报默认使用 Open-Meteo / CAMS；压力层 GRIB 作为详情页按需能力，不会阻塞首页。GFS 负责全球主剖面，ECMWF Open Data 用于交叉验证；HRRR 仅覆盖北美，不用于南京等中国城市。

## 启用 GFS / ECMWF 压力层剖面

完整依赖安装后，用以下方式启动 FastAPI 服务：

```bash
source .venv/bin/activate
pip install -r requirements.txt
ENABLE_GRIB_PROFILE=1 python -m backend.api
```

进入“预测依据”页时，后端会沿太阳方位生成 0—600 km、间隔 50 km 的 13 个采样点。主模型使用 NOAA GFS 0.25° 的 1000、925、850、700、500、300、200 hPa 压力层；ECMWF IFS Open Data 0.25° 用作湿度剖面对照。GRIB 与解析结果缓存 6 小时，建议为本地缓存预留 5—10 GB。

首次进入详情页可能需要数分钟下载。若依赖、网络或模式时次不可用，`/api/profile` 会返回 `available: false`，详情页继续显示 Open-Meteo 示意剖面，不影响三日预测。

## 目录

```text
backend/        FastAPI、物理算法、天气下载器、SQLite
frontend/       原生 HTML/CSS/JS 响应式网站
miniprogram/    微信小程序原生适配版
data/           运行后自动创建的缓存、数据库与用户实拍
```

所有设计令牌都集中在 `frontend/style.css` 顶部的 CSS 变量中。默认地点为南京；桌面端可点击右上角定位，浏览器拒绝定位时继续使用南京。
