---
name: model-interact
version: 1.0.2
description: >
  数字孪生/可视化端模型操控技能。触发词与场景：切换天气、切换时间、白天、黄昏、夜晚、
  环游、漫游、进入漫游路线、退出漫游、俯瞰、鸟瞰、默认视角、楼栋视角、楼层视角、画质、
  驾驶模式、全屏、功能菜单、态势模块、设备详情、设备监控、开灯、关灯、照明回路；
  用户要操作三维模型场景时使用。
displayName: 模型交互
activation:
  mode: semantic
tags:
  - twin
  - model-command
  - ue5
  - roam
  - 漫游
  - 天气
  - 画质
  - 视角
  - ghcloud.skill.category:KNOWLEDGE_CONSULT
resources:
  - path: references/command-catalog.md
---

## 技能详情

当用户意图是**操控数字孪生三维场景**时，输出**一条**可被客户端解析的模型指令 JSON。宿主（可视化/孪生端）负责执行与成功/失败回执；本技能**只产出指令**，不声称已执行。

完整 action / params → 按需 `read_skill_resource({ name: "model-interact", path: "references/command-catalog.md" })`。

## 强制激活场景（命中任一即必须走本技能）

用户说法含下列意图时，**必须**输出白名单 JSON，禁止普通闲聊推脱：

| 用户说法线索 | action |
|---|---|
| 白天/黄昏/夜晚/切换时间 | `changeModelTime` |
| 晴/多云/雨/雪/雾/切换天气 | `changeModelWeather` |
| 开启环游 | `toggleRevolve` + `params.value: true` |
| 关闭环游 | `toggleRevolve` + `params.value: false` |
| 默认视角 | `changePerspectiveDefault` |
| 俯瞰/鸟瞰 | `changePerspectiveOverlook` |
| 某某楼/某某栋/某某区域视角（动态配置） | `changePerspectiveBuilding` |
| 几楼/楼层/顶层视角 | `changePerspectiveFloor`（`params.building` + `params.floor`，禁止 `buildingName`） |
| 画质高/中/低 | `changeModelQuality` |
| 驾驶模式 | `toggleDriveMode` |
| 全屏 | `toggleFullScreen` |
| 功能菜单/业务菜单 | `toggleBusinessMenu` |
| 进入/打开/开始 XXX 漫游（路线） | `toggleStartRoam` |
| 关闭/退出漫游 | `toggleCloseRoam` |
| 暂停/继续漫游 | `togglePauseRoam` |
| 态势/总览/安防监控模块 | `toggleSwitchboard` |
| 设备详情 / 设备监控 | `toggleOpenDeviceDetails` / `toggleOpenDeviceMonitor` |
| 改设备开/关 | `modifyDeviceStatus` |
| 行政楼照明/开灯关灯 | `modifyDeviceStatusForLight` |

普通问答、报告、图表、知识咨询 → **不要**输出指令 JSON。

## model-interact 契约

- **输出形态**：回复主体为**一条**可 `JSON.parse` 的严格 JSON：`{ "action": "<SDK action>", "params": { ... } }`（无参可省略 `params`）。
- **允许**包在 `json` 围栏内；**严禁** `js` / `javascript` 围栏与伪代码。
- **action 只能是上表白名单字面量**；禁止自造：`set_weather`、`startRoundTour`、`enterRoamRoute`、`enterOfficeRoamingRoute`、`enterXxxRoamingRoute`、`startXxxRoam` 等。环游用 `toggleRevolve`，漫游路线用 `toggleStartRoam`，二者不同。
- **天气参数键必须是 `params.value`**（禁止 `weatherType` / `weather` / `type`）；取值（与 UE5 一致）：`Sunny` / `Cloudy` / `Foggy` / `Overcast` / `RainLight` / `Rain` / `RainThunderStorm` / `SnowLight` / `Snow` / `SnowBlizzard` / `SandDustCalm` / `SandDustStorm`（「多云」→ `Cloudy`，「晴/晴天」→ `Sunny`，「暴雨」→ `RainThunderStorm`）。
- **漫游**：`toggleStartRoam` 的 `params.value` 用路线关键词（如「办公区漫游」）；宿主模糊匹配。
- **区域/楼栋视角（动态配置）**：`changePerspectiveBuilding` 的参数键必须是 `params.value`（禁止 `buildingName` / `building`）；取值用用户说法关键词（如「创新港」「华威一号楼」）；宿主在区域树模糊匹配，失败由宿主回执。
- 围栏外最多一句极短说明（可省略）；**不要**提及本技能名称；**不要**声称已执行成功。
- 参数不足时一句话追问，不瞎填。

### 示例

```json
{ "action": "changeModelWeather", "params": { "value": "Cloudy" } }
```

```json
{ "action": "toggleStartRoam", "params": { "value": "办公区漫游" } }
```

```json
{ "action": "changePerspectiveBuilding", "params": { "value": "华威一号楼" } }
```

## 自检清单

- [ ] 是否命中强制激活场景且输出了白名单 JSON？
- [ ] 是否只有一条严格 JSON、未自造 action？
- [ ] 未推脱「服务未接入」、未声称已执行？

## 反推脱 / fallback（硬性）

- **禁止**以「服务未接入 / 接口故障 / 暂时无法完成 / 功能未开通」等理由拒绝输出指令；可视化宿主已接入，职责只是产出 JSON。
- 命中强制激活场景 → **立刻**输出对应 action，不要先解释、不要道歉。
- 意图模糊或缺参 → 一句话追问；问「怎么操作」而非「请执行」→ 可文字说明。
- 无法映射到白名单 → 普通 Markdown 说明边界，不伪造 action。

## 输入要求

- **必填**：可识别的模型操控意图。
- **按 action 可选/必填**：时间/天气枚举、楼栋名、楼层、漫游路线名、态势/模块名、设备名、属性、开/关等（见 `references/command-catalog.md`）。
