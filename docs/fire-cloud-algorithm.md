# 霞光预报网火烧云预测算法说明

版本：`fire-cloud-v2-burst-calibrated`  
城市校准版本：`city-calibration-v1`  
当前实现位置：`app/page.tsx`  
城市校准配置：`backend/algorithm/city_calibration.json`

## 1. 算法目标

本算法不是简单判断“天气好不好”，而是判断：

```text
光源 × 光路 × 云画布 × 空气通透度 × 模型一致性
```

核心原则：

- 太阳方向光路必须能穿过来。
- 本地天空必须有可被染色的中高云画布。
- AOD、降水、能见度、模型一致性会影响最终分。
- `stable_score` 保持保守，减少白跑。
- `burst_score` 捕捉不稳定但可能爆发的机会，减少漏报。

## 2. 当前数据来源

当前 MVP 使用 Open-Meteo 聚合接口读取：

| 数据 | 当前接口 | 用途 |
| --- | --- | --- |
| GFS 主模型 | `https://api.open-meteo.com/v1/gfs` | 主评分、云量、低中高云、湿度、能见度、降水概率 |
| ECMWF 对照 | `https://api.open-meteo.com/v1/ecmwf` | 模型一致性与分歧机会 |
| AOD | `https://air-quality-api.open-meteo.com/v1/air-quality` | AOD 色彩因子、雾霾遮光判断 |
| 日出/日落 | GFS daily `sunrise,sunset` | 确定目标时间 |
| 太阳方位/高度 | 前端按经纬度和时间计算 | 判断太阳方向与供光条件 |

注意：剖面图目前是基于本地 GFS/ECMWF/AOD 数据推导的可视化近似，并非已经沿太阳方向逐点采样 0-600km 的真实剖面。

## 3. 输出字段

每个城市、每个模式（日出/日落）输出一个 `Forecast`：

| 字段 | 含义 |
| --- | --- |
| `score` | 当前主指数，等于 `stable_score` |
| `level` | 大烧 / 小烧 / 无烧 |
| `stable_score` | 稳定命中分，保守主模型 |
| `burst_score` | 爆发潜力分，捕捉不稳定机会 |
| `horizon_gap_score` | 地平线云缝机会 |
| `horizon_gap_label` | 云缝机会高 / 中 / 低 |
| `confidence` | 数值置信度 |
| `confidence_label` | 高置信 / 中等置信 / 稳定条件一般 / 模型分歧 |
| `tags` | 解释标签 |
| `advice` | 出门建议 |
| `algorithm_version` | 算法版本 |
| `city_calibration_version` | 城市校准版本 |

## 4. 基础公式：stable_score

`stable_score` 是保守主模型，用于回答“大概率是否值得蹲”。

```text
stable_score =
100
× sqrt(光路通透度 × 云层画布质量)
× AOD色彩因子
× 太阳供光因子
× 降水惩罚因子
× 模型一致性因子
```

代码中：

```ts
stableScore = clamp(
  100 *
    Math.sqrt(core.lightPath * core.cloudCanvas) *
    core.aodFactor *
    solarFactor *
    core.precipFactor *
    core.consistencyFactor,
)
```

这个公式是乘法模型。优点是严格、少误报；缺点是任何单项偏低都会压低总分，所以需要 `burst_score` 补充漏报控制。

## 5. 光路通透度 lightPath

作用：判断太阳方向的低角度光线能不能穿过来。

当前公式：

```text
adjustedLow = lowCloud × low_cloud_penalty

lightPath =
((100 - adjustedLow) / 100)
× min(visibility / 18000, 1)
× (1 - precipitation / 130)
× (1 - max(AOD - 0.45, 0) / 0.65)
```

最终限制在 `0-1`。

解释：

- 低云越多，光路越差。
- 能见度越高，光路越好。
- 降水概率越高，光路越差。
- AOD 过高时视为雾霾遮光。
- `low_cloud_penalty` 由城市校准控制。

可调参数：

| 参数 | 当前值/位置 | 调整影响 |
| --- | --- | --- |
| `low_cloud_penalty` | `city_calibration.json` | 越大，低云扣分越重 |
| `18000` | `visibility / 18000` | 越小，能见度更容易满分 |
| `130` | `precipitation / 130` | 越小，降水扣分越重 |
| `0.45` | AOD 遮光起点 | 越小，AOD 更容易扣分 |
| `0.65` | AOD 遮光尺度 | 越小，AOD 高值扣分更猛 |

## 6. 云层画布质量 cloudCanvas

作用：判断本地天空有没有适合被染色的中高云。

当前公式：

```text
midHigh = min(100, midCloud + highCloud)

canvasAmount =
1 - min(abs(midHigh - 52) / 52, 1)

canvasThinness =
1 - max(adjustedLow - 38, 0) / 70

canvasStability =
1 - abs(cloudNext - cloudPrev) / 85

cloudCanvas =
(
  canvasAmount × 0.55
  + highCloud / 100 × 0.25
  + canvasStability × 0.20
)
× canvasThinness
```

解释：

- 中高云不是越多越好，当前认为 `midHigh ≈ 52%` 最理想。
- 高云单独加分，因为更容易被低角度阳光染色。
- 云量稳定加分，代表稳定命中概率更高。
- 低云过厚会削弱画布质量。

可调参数：

| 参数 | 当前值 | 调整影响 |
| --- | --- | --- |
| `52` | 最优中高云量 | 调高会偏好更多云，调低会偏好更开阔天空 |
| `0.55` | 中高云量权重 | 越高，画布数量更重要 |
| `0.25` | 高云权重 | 越高，高云更容易拉分 |
| `0.20` | 稳定性权重 | 越高，稳定云量更重要 |
| `38` | 低云开始削弱画布的阈值 | 越低，低云更容易扣分 |
| `70` | 低云削弱尺度 | 越小，低云扣分更陡 |

## 7. AOD 色彩因子 aodFactor

作用：判断气溶胶是否处于利于显色的区间。

当前公式：

```text
aodFactor =
0.72 + 0.34 × exp(-((AOD - aod_optimal) / 0.18)^2)
```

解释：

- AOD 太低：颜色可能不够浓。
- AOD 适中：色彩更鲜艳。
- AOD 太高：雾霾遮光，光路里另有扣分。
- `aod_optimal` 按城市校准。

可调参数：

| 参数 | 当前值/位置 | 调整影响 |
| --- | --- | --- |
| `aod_optimal` | `city_calibration.json` | 每个城市最佳 AOD |
| `0.72` | 基础系数 | 越高，AOD 对总分影响越弱 |
| `0.34` | 峰值增益 | 越高，AOD 适中时加分越明显 |
| `0.18` | 最优区间宽度 | 越小，AOD 要更接近最优值才加分 |

## 8. 太阳供光因子 solarFactor

作用：判断目标时刻太阳高度是否适合给云层供光。

当前公式：

```text
solarFactor =
0.78 + (1 - min(abs(solarAltitude + 3) / 13, 1)) × 0.27
```

解释：

- 当前把太阳高度约 `-3°` 视为较优供光窗口。
- 离 `-3°` 越远，供光因子越低。
- 这个因子主要影响日出/日落前后峰值窗口。

可调参数：

| 参数 | 当前值 | 调整影响 |
| --- | --- | --- |
| `-3°` | 最优太阳高度 | 调整峰值偏向日落前或日落后 |
| `13` | 容忍范围 | 越大，窗口更宽 |
| `0.78` | 基础系数 | 越高，太阳高度影响越弱 |
| `0.27` | 峰值增益 | 越高，太阳高度影响越强 |

## 9. 降水惩罚因子 precipFactor

作用：降低雨幕、降水对光路和观测的影响。

当前公式：

```text
precipFactor = 1 - precipitation / 115
```

最终限制在 `0-1`。

可调参数：

| 参数 | 当前值 | 调整影响 |
| --- | --- | --- |
| `115` | 降水惩罚尺度 | 越小，降水概率扣分越重 |

## 10. 模型一致性因子 consistencyFactor

作用：GFS 和 ECMWF 分歧越大，稳定分越保守。

当前公式：

```text
modelDiff =
(abs(GFS_totalCloud - ECMWF_totalCloud)
+ abs(GFS_lowCloud - ECMWF_lowCloud)) / 2

consistencyFactor =
1 - modelDiff / 115
```

最终限制在 `0-1`。

解释：

- 在 `stable_score` 中，模型分歧会扣分。
- 在 `burst_score` 中，如果光路和画布没有全坏，模型分歧可以作为变化机会的一部分。

可调参数：

| 参数 | 当前值 | 调整影响 |
| --- | --- | --- |
| `115` | 分歧扣分尺度 | 越小，模型分歧对稳定分扣得越重 |

## 11. 爆发潜力分 burst_score

`burst_score` 用于捕捉“稳定分不高，但仍可能突然大烧”的场景：

- 雨后转晴。
- 低云开缝。
- 低云边缘透光。
- 日落后突然爆发。
- 云量快速变化。
- GFS/ECMWF 分歧但并非全坏。

当前公式：

```text
burst_score =
(
  horizon_gap_score × 35%
  + cloudCanvas × 25%
  + cloud_variability_score × 15%
  + post_rain_signal × 10%
  + AOD色彩潜力 × 10%
  + model_disagreement_opportunity × 5%
)
× burst_bonus
```

代码中：

```ts
burstScore = clamp(
  (
    horizonGapScore * 0.35 +
    clamp(cloudCanvas * 100) * 0.25 +
    cloudVariabilityScore * 0.15 +
    postRainSignal * 0.1 +
    clamp(aodFactor * 100, 0, 110) * 0.1 +
    (lightPath > 0.28 && cloudCanvas > 0.25 ? modelDisagreementSignal : 0) * 0.05
  ) * calibration.burst_bonus
)
```

可调参数：

| 参数 | 当前值/位置 | 调整影响 |
| --- | --- | --- |
| `0.35` | 云缝概率权重 | 越高，低云开缝型更容易被提示 |
| `0.25` | 云画布权重 | 越高，中高云存在更重要 |
| `0.15` | 云量变化权重 | 越高，日落后爆发/快速变化更容易加分 |
| `0.10` | 雨后信号权重 | 越高，雨后开缝更容易加分 |
| `0.10` | AOD 色彩潜力权重 | 越高，AOD 适中更容易提升爆发分 |
| `0.05` | 模型分歧机会权重 | 越高，分歧场景更容易提示机会 |
| `burst_bonus` | `city_calibration.json` | 城市级爆发潜力放大/缩小 |
| `lightPath > 0.28` | 分歧机会前置条件 | 越低，模型分歧更容易参与爆发分 |
| `cloudCanvas > 0.25` | 分歧机会前置条件 | 越低，云画布较弱时也会给机会 |

## 12. 地平线云缝分 horizon_gap_score

作用：判断太阳方向是否可能存在“地平线云缝”。

当前公式：

```text
horizon_gap_score =
低云区间基础分
+ min(midHigh, 70) × 0.28
+ (100 - precipitation) × 0.14
+ min(visibility / 1000, 18)
+ cloud_variability_score × 0.18
- max(AOD - 0.5, 0) × 70
```

低云区间基础分：

```text
lowCloud 20%-65%：38 分
lowCloud < 20%：18 分
lowCloud > 65%：4 分
```

标签规则：

```text
horizon_gap_score >= 68：云缝机会高
42 <= horizon_gap_score < 68：云缝机会中
horizon_gap_score < 42：云缝机会低
```

解释：

- 云缝不是低云越少越好。
- 中等低云 + 中高云存在 + 降水下降 + 能见度不差 + 云量变化明显，才是爆发机会。

## 13. 补充信号

### 13.1 云量变化 cloud_variability_score

```text
cloud_variability_score =
abs(cloudNext - cloudPrev) × 2.25
+ abs(lowCloudNow - lowCloudPrev) × 0.8
```

用途：

- 捕捉云量快速变化。
- 辅助判断日落后窗口和开缝机会。

### 13.2 雨后转晴 post_rain_signal

```text
post_rain_signal =
(precipPrev - precipNext) × 1.6
+ max(0, 55 - precipNow) × 0.45
```

用途：

- 捕捉雨后降水概率下降。
- 识别雨后开缝型晚霞。

### 13.3 模型分歧机会 model_disagreement_signal

```text
model_disagreement_signal = modelDiff × 1.4
```

用途：

- 在 `stable_score` 中，模型分歧扣分。
- 在 `burst_score` 中，如果光路和云画布没有全坏，模型分歧代表变化机会。

## 14. 等级与标签

### 14.1 等级

默认阈值：

```text
score >= 72：大烧
45 <= score < 72：小烧
score < 45：无烧
```

城市可覆盖：

```json
{
  "big_burn_threshold": 70,
  "small_burn_threshold": 43
}
```

### 14.2 标签

当前标签规则：

| 标签 | 触发条件 |
| --- | --- |
| 高置信 | `stable_score >= big_burn_threshold` 且 `consistencyFactor >= 0.78` |
| 低云风险 | `lowCloud > 58` |
| 爆发潜力高 | `burst_score >= 68` |
| 云缝机会 | `horizon_gap_score >= 58` |
| 雨后窗口 | `post_rain_signal >= 42` |
| 模型分歧 | `model_disagreement_signal >= 35` |
| 日落后窗口 | `cloud_variability_score >= 55` |
| 条件稳定 | 无其他标签时兜底 |

## 15. 出门建议 advice

当前规则：

| 条件 | 文案方向 |
| --- | --- |
| `burst_score - stable_score >= 18` 且 `burst_score >= 65` | 稳定条件一般，但存在突然爆发机会，建议近距离蹲守 20 分钟 |
| `stable_score >= 72` | 稳定命中分较高，建议提前到位 |
| `lowCloud > 70` | 低云遮挡强，不建议远距离专程 |
| `cloudCanvas < 0.28` | 光路可用但云画布不足 |
| 其他 | 顺路观察，重点看地平线是否开缝 |

## 16. 城市本地校准

配置文件：`backend/algorithm/city_calibration.json`

默认配置：

```json
{
  "aod_optimal": 0.16,
  "low_cloud_penalty": 1.0,
  "humidity_optimal": 65,
  "burst_bonus": 1.0,
  "big_burn_threshold": 72,
  "small_burn_threshold": 45
}
```

字段说明：

| 字段 | 含义 | 调大影响 | 调小影响 |
| --- | --- | --- | --- |
| `aod_optimal` | 城市最佳 AOD | 更偏好较浑浊空气显色 | 更偏好干净空气显色 |
| `low_cloud_penalty` | 低云惩罚倍率 | 低云更容易压低光路和画布 | 对低云更宽容 |
| `humidity_optimal` | 最佳湿度预留字段 | 当前暂未实质参与主公式 | 当前暂未实质参与主公式 |
| `burst_bonus` | 爆发潜力倍率 | 更容易提示爆发机会 | 更保守 |
| `big_burn_threshold` | 大烧阈值 | 更难大烧 | 更容易大烧 |
| `small_burn_threshold` | 小烧阈值 | 更难小烧 | 更容易小烧 |

当前城市校准摘要：

| 城市 | AOD 最优 | 低云惩罚 | 湿度最优 | 爆发倍率 | 大烧阈值 | 小烧阈值 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 默认 | 0.16 | 1.00 | 65 | 1.00 | 72 | 45 |
| 南京 | 0.17 | 0.95 | 68 | 1.05 | 72 | 45 |
| 上海 | 0.15 | 0.90 | 72 | 1.08 | 71 | 45 |
| 北京 | 0.13 | 1.06 | 55 | 0.96 | 72 | 45 |
| 广州 | 0.18 | 0.92 | 74 | 1.12 | 72 | 43 |
| 南通 | 0.16 | 0.90 | 72 | 1.10 | 70 | 45 |
| 成都 | 0.20 | 0.86 | 76 | 1.14 | 70 | 42 |

## 17. 调权建议

### 17.1 如果大烧太少

优先调整：

1. 降低城市 `big_burn_threshold`，例如 72 → 70。
2. 提高 `cloudCanvas` 中高云权重，尤其 `highCloud / 100 × 0.25`。
3. 提高 `burst_bonus`，但只影响爆发提示，不影响稳定主分。
4. 放宽 `lightPath > 0.28` 和 `cloudCanvas > 0.25` 的爆发分前置条件。

不建议：

- 直接给 `stable_score` 加固定分。
- 简单把低云扣分全部放松。

### 17.2 如果误报太多

优先调整：

1. 提高 `big_burn_threshold`。
2. 提高 `low_cloud_penalty`。
3. 降低 `burst_bonus`。
4. 降低 `horizon_gap_score` 中低云区间基础分。
5. 提高 `burst_score` 展示高潜力的门槛，例如 68 → 72。

### 17.3 如果雨后开缝漏报

优先调整：

1. 提高 `post_rain_signal` 在 `burst_score` 中的权重，0.10 → 0.14。
2. 提高 `postRainSignal` 触发标签阈值的敏感度，42 → 35。
3. 提高湿润城市的 `burst_bonus`。

### 17.4 如果低云边缘透光漏报

优先调整：

1. 扩大云缝低云区间，例如 `20%-65%` → `18%-72%`。
2. 提高 `horizon_gap_score` 权重，0.35 → 0.40。
3. 降低低云完全遮挡的基础分不要太多，避免中等偏高低云全被判死。

### 17.5 如果模型分歧时漏报

优先调整：

1. 增加 `model_disagreement_signal` 在 `burst_score` 中的权重，0.05 → 0.08。
2. 放宽参与条件：`lightPath > 0.28`、`cloudCanvas > 0.25`。
3. 但不要放松 `stable_score` 的一致性惩罚，保持稳定分保守。

## 18. 后续回测字段

当前已预留：

- `algorithm_version`
- `city_calibration_version`
- `stable_score`
- `burst_score`
- `horizon_gap_score`
- `tags`
- `cloud_variability_score`
- `post_rain_signal`
- `model_disagreement_signal`

后续可以用于：

- 30 天回测。
- 城市本地校准。
- 误报/漏报分析。
- 与 Sunsetbot 或人工观测记录对比。
- 用户反馈 L0-L3 校准。

## 19. 目前实现的注意点

1. 当前 `score` 等于 `stable_score`，用于主指数展示。
2. `burst_score` 是补充指标，不直接抬高主指数。
3. 真实输入来自 Open-Meteo 的 GFS/ECMWF/AOD 聚合接口。
4. 剖面图仍是推导可视化，不是真实逐点剖面。
5. `humidity_optimal` 已在校准文件中预留，但当前主公式尚未使用。后续可加入 `atmosphereFactor` 或 AOD/能见度修正。
6. 如果某些真实数据不可用，页面会降级为默认值或错误提示；不应把默认值当成真实预报结果。

## 20. 推荐下一步

为了继续提高中国城市准确性，建议按顺序优化：

1. 接入中国官方空气质量或城市 AQI，校准 AOD/能见度。
2. 接入风云卫星云图，增强低云边缘和云系移动判断。
3. 把剖面图升级为太阳方向 0-600km 逐点采样。
4. 建立用户反馈和真实观测记录，做城市级 30 天回测。
5. 用回测结果调整 `city_calibration.json` 的城市阈值和爆发倍率。
