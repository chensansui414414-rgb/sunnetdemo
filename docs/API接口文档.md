# 霞光时刻 API 接口文档

文档版本：1.0  
接口版本：1.0.0  
最后更新：2026-07-06

## 1. 基本信息

- 本地服务地址：`http://127.0.0.1:8000`
- Swagger 调试页面：`http://127.0.0.1:8000/docs`
- OpenAPI 描述文件：`http://127.0.0.1:8000/openapi.json`
- JSON 编码：UTF-8
- 时间格式：ISO 8601
- 当前版本没有登录鉴权。
- 当前开发环境允许跨域访问；正式上线前应限制允许访问的域名。

接口一览：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/health` | 检查后端服务状态 |
| GET | `/api/cities` | 搜索全国城市及港澳台县市 |
| GET | `/api/forecast` | 获取未来三天朝霞或晚霞预测 |
| GET | `/api/profile` | 获取太阳方向600公里压力层剖面 |
| POST | `/api/feedback` | 提交文字观测反馈 |
| POST | `/api/feedback/photo` | 提交反馈及实拍图片 |

## 2. 通用状态说明

预测接口会通过以下字段说明数据状态：

| 字段 | 类型 | 说明 |
|---|---|---|
| `is_mock` | boolean | `true` 表示真实数据和缓存均不可用，当前为确定性模拟数据 |
| `is_stale` | boolean | `true` 表示正在使用超过正常缓存时间的历史真实数据 |
| `strict_real_data` | boolean | `true` 表示服务以严格真实数据模式运行，不会降级到Mock |
| `data_source` | string/null | 本次预测的数据源名称 |
| `fetched_at` | string/null | 上游数据获取时间，ISO 8601 格式 |

正常情况下返回 HTTP `200`。参数格式不正确时，FastAPI 通常返回 HTTP `422`：

```json
{
  "detail": "经纬度超出有效范围"
}
```

如果设置 `STRICT_REAL_DATA=1`，且实时接口和本地真实缓存都不可用，`GET /api/forecast` 会返回 HTTP `503`：

```json
{
  "detail": {
    "message": "严格真实数据模式已开启，但实时天气接口和本地真实缓存均不可用。",
    "strict_real_data": true,
    "data_source": "Open-Meteo / CAMS 实时预报",
    "suggestion": "请检查网络、上游接口或关闭 STRICT_REAL_DATA 后再使用演示数据。"
  }
}
```

## 3. 健康检查

### `GET /api/health`

用于检查后端是否已经启动。

请求示例：

```bash
curl "http://127.0.0.1:8000/api/health"
```

返回示例：

```json
{
  "status": "ok",
  "message": "霞光预测服务运行正常"
}
```

## 4. 城市搜索

### `GET /api/cities`

搜索中国大陆地级市、自治州、地区、盟，以及香港、澳门和台湾县市。空查询返回热门城市。

查询参数：

| 参数 | 类型 | 必填 | 默认值 | 约束 | 说明 |
|---|---|---:|---|---|---|
| `query` | string | 否 | 空字符串 | 最长60字符；非空时至少2个字符 | 城市或行政区名称 |
| `limit` | integer | 否 | `30` | 1—50 | 最大返回数量 |

请求示例：

```bash
curl --get \
  --data-urlencode "query=阿坝" \
  --data-urlencode "limit=10" \
  "http://127.0.0.1:8000/api/cities"
```

返回示例：

```json
{
  "cities": [
    {
      "name": "阿坝",
      "lat": 31.8994,
      "lon": 102.2248,
      "province": "四川省",
      "prefecture": "阿坝藏族羌族自治州",
      "country_code": "CN",
      "timezone": "Asia/Shanghai",
      "feature_code": "PPLA2",
      "population": 0,
      "region": "中国大陆",
      "source": "Open-Meteo Geocoding / GeoNames"
    }
  ],
  "query": "阿坝",
  "fallback": false,
  "coverage": "中国大陆地级市、自治州、地区、盟，以及香港、澳门、台湾县市"
}
```

字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `cities` | array | 城市结果列表 |
| `name` | string | 地点名称 |
| `lat` / `lon` | number | 纬度和经度 |
| `province` | string | 省级行政区 |
| `prefecture` | string | 地级行政区，可能为空 |
| `country_code` | string | `CN`、`HK`、`MO` 或 `TW` |
| `timezone` | string | IANA 时区名称 |
| `fallback` | boolean | `true` 表示城市服务不可用，结果来自内置热门城市 |

查询仅输入一个字符时返回：

```json
{
  "cities": [],
  "query": "杭",
  "fallback": false,
  "message": "请至少输入两个字"
}
```

## 5. 三日霞光预测

### `GET /api/forecast`

根据经纬度返回未来三天朝霞或晚霞指数。请求成功后，本次预测会保存到本地 SQLite 历史记录。

查询参数：

| 参数 | 类型 | 必填 | 默认值 | 约束 | 说明 |
|---|---|---:|---|---|---|
| `lat` | number | 否 | `32.0603` | -90—90 | 纬度 |
| `lon` | number | 否 | `118.7969` | -180—180 | 经度 |
| `period` | string | 否 | `evening` | `morning` / `evening` | 朝霞或晚霞 |

请求示例：

```bash
curl "http://127.0.0.1:8000/api/forecast?lat=32.0603&lon=118.7969&period=evening"
```

返回结构示例：

```json
{
  "location": {
    "lat": 32.0603,
    "lon": 118.7969,
    "name": "当前坐标"
  },
  "period": "evening",
  "days": [
    {
      "date": "2026-07-06",
      "score": 68,
      "level": "小烧",
      "summary": "日落西北方向光路通透；本地高云画布54%，薄云透光；剖面高云约62.4%，模型一致性高。结论：有机会，路过可等等。",
      "event_time": "2026-07-06T19:13:00+08:00",
      "sunset": "2026-07-06T19:13:00+08:00",
      "sun_azimuth": 296.8,
      "period": "evening",
      "metrics": {
        "high_cloud": 54,
        "mid_cloud": 37,
        "low_cloud": 18,
        "visibility": 18,
        "aod": 0.16,
        "pm2_5": 12.5,
        "direct_radiation": 42,
        "corridor_low_cloud": 24,
        "cloud_base": 7200,
        "optical_depth": 3.8,
        "light_channel": 65,
        "open_meteo_light_channel": 58,
        "profile_used": true,
        "profile_available": true,
        "profile_reason": null,
        "profile_light_channel": 71,
        "profile_low_obstruction": 0.22,
        "profile_canvas_quality": 74,
        "profile_high_cloud": 62.4,
        "profile_mid_cloud": 31.8,
        "profile_canvas_cover": 53.8,
        "profile_confidence": 100,
        "profile_primary_model": "GFS 0.25°",
        "profile_model_agreement": "高"
      },
      "source": "open-meteo:best-match+cams-global",
      "source_label": "Open-Meteo / CAMS 实时预报",
      "fetched_at": "2026-07-06T08:00:00+00:00",
      "is_stale": false
    }
  ],
  "is_mock": false,
  "is_stale": false,
  "profile_scoring_enabled": true,
  "profile_scoring_used": true,
  "data_source": "Open-Meteo / CAMS 实时预报",
  "fetched_at": "2026-07-06T08:00:00+00:00",
  "stats": {
    "forecasts": 20,
    "feedback": 3
  }
}
```

预测字段说明：

| 字段 | 类型 | 说明 |
|---|---|---|
| `date` | string | 预测日期，格式为 `YYYY-MM-DD` |
| `score` | integer | 火烧云潜力指数，0—100 |
| `level` | string | `大烧`、`小烧`或`无烧` |
| `summary` | string | 预测原因和拍摄建议 |
| `event_time` | string | 当天日出或日落时间 |
| `sun_azimuth` | number | 日出或日落方位角，单位为度 |
| `metrics.high_cloud` | number | 高云量，单位 `%` |
| `metrics.mid_cloud` | number | 中云量，单位 `%` |
| `metrics.low_cloud` | number | 低云量，单位 `%` |
| `metrics.visibility` | number | 能见度，单位 km |
| `metrics.aod` | number | 气溶胶光学厚度 |
| `metrics.pm2_5` | number/null | PM2.5浓度 |
| `metrics.direct_radiation` | number/null | 直接太阳辐射 |
| `metrics.corridor_low_cloud` | number | 太阳方向低云量，单位 `%` |
| `metrics.cloud_base` | number | 估算云底高度，单位 m |
| `metrics.optical_depth` | number | 估算云光学厚度 |
| `metrics.light_channel` | number | 光路通透指数，0—100 |
| `metrics.open_meteo_light_channel` | number | 仅由Open-Meteo/CAMS估算的光路通透指数 |
| `metrics.profile_used` | boolean | 本次主评分是否实际使用GFS/ECMWF压力层剖面 |
| `metrics.profile_available` | boolean | 压力层剖面是否可用 |
| `metrics.profile_reason` | string/null | 压力层剖面不可用原因 |
| `metrics.profile_light_channel` | number/null | GFS/ECMWF剖面估算的太阳方向光路通透指数 |
| `metrics.profile_low_obstruction` | number/null | 0—1，太阳方向低层湿区/低云遮挡强度 |
| `metrics.profile_canvas_quality` | number/null | 0—100，剖面中高层云画布质量 |
| `metrics.profile_high_cloud` | number/null | 由高层相对湿度反推的高云画布估计，单位 `%` |
| `metrics.profile_mid_cloud` | number/null | 由中层相对湿度反推的中云画布估计，单位 `%` |
| `metrics.profile_confidence` | number | GFS与ECMWF一致性置信度，0—100 |
| `metrics.profile_primary_model` | string/null | 主剖面模型名称 |
| `metrics.profile_model_agreement` | string/null | GFS/ECMWF湿度剖面一致性，`高`/`中`/`低` |

评分等级：

| 分数 | 等级 |
|---:|---|
| 72—100 | 大烧 |
| 45—71 | 小烧 |
| 0—44 | 无烧 |

## 6. 压力层光路剖面

### `GET /api/profile`

沿日出或日落方位生成0—600 km光路，每50 km采样一次，共13个点。该接口可能按需下载较大的GRIB文件，首次请求耗时较长。

查询参数：

| 参数 | 类型 | 必填 | 约束 | 说明 |
|---|---|---:|---|---|
| `lat` | number | 是 | -90—90 | 纬度 |
| `lon` | number | 是 | -180—180 | 经度 |
| `forecast_date` | string | 是 | `YYYY-MM-DD` | 预测日期 |
| `period` | string | 否 | `morning` / `evening` | 默认 `evening` |

请求示例：

```bash
curl "http://127.0.0.1:8000/api/profile?lat=32.0603&lon=118.7969&forecast_date=2026-07-06&period=evening"
```

可用时返回结构：

```json
{
  "location": {"lat": 32.0603, "lon": 118.7969},
  "date": "2026-07-06",
  "period": "evening",
  "sun_azimuth": 296.8,
  "event_time": "2026-07-06T19:13:00+08:00",
  "available": true,
  "is_stale": false,
  "distance_km": 600,
  "step_km": 50,
  "levels_hpa": [1000, 925, 850, 700, 500, 300, 200],
  "primary_model": "GFS 0.25°",
  "run_time": "2026-07-06T06:00:00+00:00",
  "forecast_hour": 12,
  "points": [
    {
      "distance_km": 0,
      "lat": 32.0603,
      "lon": 118.7969,
      "layers": [
        {
          "level_hpa": 1000,
          "height_m": 110,
          "temperature_c": 28.2,
          "rh": 72.5,
          "wind_ms": 4.1
        }
      ]
    }
  ],
  "comparison": {
    "mean_rh_difference": 8.4,
    "agreement": "高"
  },
  "models": {
    "gfs": {
      "model": "GFS 0.25°",
      "run_time": "2026-07-06T06:00:00+00:00",
      "forecast_hour": 12
    },
    "ecmwf": {
      "model": "ECMWF IFS Open Data 0.25°",
      "run_time": "2026-07-06T00:00:00+00:00",
      "forecast_hour": 18
    }
  },
  "warning": "",
  "generated_at": "2026-07-06T09:00:00+00:00"
}
```

压力层字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `distance_km` | number | 采样点距离目标位置的距离 |
| `level_hpa` | integer | 等压面，单位 hPa |
| `height_m` | number | 位势高度，单位 m |
| `temperature_c` | number | 温度，单位 ℃ |
| `rh` | number | 相对湿度，单位 `%` |
| `wind_ms` | number | 风速，单位 m/s |
| `comparison.mean_rh_difference` | number | GFS与ECMWF平均相对湿度差 |
| `comparison.agreement` | string | 模式一致度：`高`、`中`或`低` |

GRIB功能未启用或数据无法获取时，接口仍返回 HTTP `200`：

```json
{
  "location": {"lat": 32.0603, "lon": 118.7969},
  "date": "2026-07-06",
  "period": "evening",
  "sun_azimuth": 296.8,
  "event_time": "2026-07-06T19:13:00+08:00",
  "available": false,
  "reason": "压力层 GRIB 尚未启用；请设置 ENABLE_GRIB_PROFILE=1。",
  "distance_km": 600,
  "step_km": 50,
  "corridor": []
}
```

## 7. 提交文字反馈

### `POST /api/feedback`

请求头：

```text
Content-Type: application/json
```

请求字段：

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---:|---|---|
| `lat` | number | 是 | -90—90 | 拍摄地点纬度 |
| `lon` | number | 是 | -180—180 | 拍摄地点经度 |
| `forecast_date` | string | 是 | 当前未做严格日期格式校验 | 对应预测日期 |
| `result` | string | 是 | `命中` / `一般` / `翻车` | 用户评价 |
| `note` | string | 否 | 最长500字符 | 补充说明 |
| `photo_path` | string | 否 | 默认空字符串 | 预留字段，普通前端无需填写 |

请求示例：

```bash
curl -X POST "http://127.0.0.1:8000/api/feedback" \
  -H "Content-Type: application/json" \
  -d '{
    "lat": 32.0603,
    "lon": 118.7969,
    "forecast_date": "2026-07-06",
    "result": "命中",
    "note": "西边高云上色明显"
  }'
```

返回示例：

```json
{
  "message": "反馈已收到，感谢你帮预测变得更准。",
  "id": 12
}
```

## 8. 提交图片反馈

### `POST /api/feedback/photo`

请求格式：`multipart/form-data`

表单字段：

| 字段 | 类型 | 必填 | 约束 |
|---|---|---:|---|
| `lat` | number | 是 | -90—90 |
| `lon` | number | 是 | -180—180 |
| `forecast_date` | string | 是 | 预测日期 |
| `result` | string | 是 | `命中` / `一般` / `翻车` |
| `note` | string | 否 | 保存时最多保留500字符 |
| `photo` | file | 是 | JPG、PNG或WebP，最大8MB |

请求示例：

```bash
curl -X POST "http://127.0.0.1:8000/api/feedback/photo" \
  -F "lat=32.0603" \
  -F "lon=118.7969" \
  -F "forecast_date=2026-07-06" \
  -F "result=命中" \
  -F "note=云层上色很好" \
  -F "photo=@/本地路径/晚霞.webp"
```

返回示例：

```json
{
  "message": "实拍与反馈已收到。",
  "id": 13
}
```

专用错误码：

| HTTP状态码 | 原因 |
|---:|---|
| 413 | 图片超过8MB |
| 415 | 图片不是JPG、PNG或WebP |
| 422 | 经纬度、评价或表单字段不符合要求 |

## 9. 页面与静态资源路由

这些路由用于网站页面，不属于业务数据接口：

| 路径 | 内容 |
|---|---|
| `/` | 网站首页 |
| `/forecast-detail.html` | 预测依据详情页 |
| `/style.css` | 首页样式 |
| `/script.js` | 首页交互脚本 |
| `/forecast-detail.css` | 详情页样式 |
| `/forecast-detail.js` | 详情页交互脚本 |
| `/static/*` | 前端静态文件目录 |

## 10. 本地运行配置

普通启动：

```bash
cd /Users/chenyan/Desktop/预报
source .venv/bin/activate
python -m backend.api
```

启用GFS和ECMWF压力层剖面：

```bash
ENABLE_GRIB_PROFILE=1 USE_OPEN_METEO=1 python -m backend.api
```

当前使用的环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `USE_OPEN_METEO` | `1` | 设置为`0`时关闭Open-Meteo联网天气数据 |
| `STRICT_REAL_DATA` | `0` | 设置为`1`时禁止使用Mock；真实接口和真实缓存都不可用时`/api/forecast`返回503 |
| `ENABLE_GRIB_PROFILE` | `0` | 设置为`1`时启用GFS/ECMWF压力层下载 |
| `ECMWF_OPEN_DATA_SOURCE` | `aws` | ECMWF开放数据下载源 |

`ENABLE_GRIB_PROFILE=1` 时，`/api/forecast` 会把 0—600 km 太阳方向压力层剖面接入主评分；若GRIB依赖、网络或模式时次不可用，接口不会使用模拟剖面，而是保留 Open-Meteo / CAMS 真实评分，并通过 `metrics.profile_used=false` 和 `metrics.profile_reason` 明示降级原因。

## 11. 当前限制

- 当前接口没有用户登录、API Key和访问频率限制。
- SQLite适合本地MVP，不适合多服务器并发部署。
- `/api/profile`首次调用可能需要下载较大文件，响应时间明显长于普通接口。
- 用户实拍目前保存到本机 `data/uploads/`，尚未接入对象存储。
- `forecast_date`在反馈接口中目前是普通字符串，后续可改为严格日期类型。
- 城市搜索依赖外部地名服务，断网时仅返回内置热门城市。
- 当前Swagger模型对部分复杂返回值没有定义完整Pydantic响应模型。
