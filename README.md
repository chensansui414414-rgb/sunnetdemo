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

当前真实模型下载器已经包含 Herbie 的安全连接入口，但 GRIB 字段映射仍会主动降级到 Mock 数据，避免首次运行下载数 GB 文件。下一阶段应按部署区域接入：GFS 负责全球基础场，HRRR 仅覆盖北美，南京等中国区域需继续使用 GFS 或替换为可授权的区域模式；CAMS 负责 AOD。

## 目录

```text
backend/        FastAPI、物理算法、天气下载器、SQLite
frontend/       原生 HTML/CSS/JS 响应式网站
miniprogram/    微信小程序原生适配版
data/           运行后自动创建的缓存、数据库与用户实拍
```

所有设计令牌都集中在 `frontend/style.css` 顶部的 CSS 变量中。默认地点为南京；桌面端可点击右上角定位，浏览器拒绝定位时继续使用南京。
