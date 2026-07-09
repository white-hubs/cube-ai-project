---
name: model-interact
version: 1.0.1
description: 适用于数字孪生/可视化端模型操控：切换时间天气、视角、环游、漫游、进入漫游路线、画质、驾驶/全屏、功能菜单、态势模块、设备详情/监控/状态与照明回路等；用户要操作三维模型场景时使用。
displayName: 模型交互
activation:
  mode: semantic
tags:
  - twin
  - model-command
  - ue5
  - roam
  - ghcloud.skill.category:KNOWLEDGE_CONSULT
resources:
  - path: references/command-catalog.md
---

## 技能详情

当用户意图是**操控数字孪生三维场景**（时间、天气、视角、环游、漫游、画质、驾驶模式、全屏、业务菜单、态势模块、设备详情/监控、物联状态、照明回路等）时，输出**一条**可被客户端解析的模型指令 JSON。宿主（可视化/孪生端）负责执行与成功/失败回执；本技能**只产出指令**，不声称已执行。

完整 action / params 枚举与示例 → 按需 `read_skill_resource({ name: "model-interact", path: "references/command-catalog.md" })`。

## 路由：什么时候用 model-interact

- 切换白天/黄昏/夜晚、天气、环游开/关、默认/俯瞰/楼栋/楼层视角、画质、驾驶模式、全屏、功能菜单显隐、**进入/打开/开始某条漫游路线**、关闭/退出/暂停漫游、打开态势/模块、设备详情/监控、改设备开关、行政楼照明 → **必须用本技能输出指令 JSON**。
- 普通问答、报告、图表、知识咨询 → **不要**输出指令 JSON；走其它技能或普通 Markdown。

## model-interact 契约

- **输出形态**：回复主体为**一条**可被 `JSON.parse()` 解析的严格 JSON 对象，形状为：
  - `{ "action": "<SDK action>", "params": { ... } }`
  - 无参数的 action 可省略 `params`，或写 `"params": {}`。
- **允许**包在 Markdown 围栏内，语言标签只能是 `json`（三个反引号 + `json`）。客户端会从整段 JSON 或 `json` 围栏中解析 `action`。
- **action 白名单（只能用下列字面量，禁止自造）**：
  `changeModelTime`、`changeModelWeather`、`toggleRevolve`、`changePerspectiveDefault`、`changePerspectiveOverlook`、`changePerspectiveBuilding`、`changePerspectiveFloor`、`changeModelQuality`、`toggleDriveMode`、`toggleFullScreen`、`toggleBusinessMenu`、`toggleStartRoam`、`toggleCloseRoam`、`togglePauseRoam`、`toggleSwitchboard`、`toggleOpenDeviceDetails`、`toggleOpenDeviceMonitor`、`modifyDeviceStatus`、`modifyDeviceStatusForLight`。
- **严禁自造 action**：例如 `set_weather`、`enterRoamRoute`、`enterOfficeRoamingRoute`、`enterXxxRoamingRoute`、`startXxxRoam` 一律禁止。进入漫游**只能**是字面量 `toggleStartRoam`，并带 `params.value`（路线名关键词，如「办公区漫游」）。
- **天气 params.value 只能是（与 UE5 一致）**：`Sunny` / `Cloudy` / `Foggy` / `Overcast` / `RainLight` / `Rain`（大雨）/ `RainThunderStorm`（暴雨）/ `SnowLight` / `Snow` / `SnowBlizzard` / `SandDustCalm` / `SandDustStorm`（注意大小写；「多云」→ `Cloudy`）。
- **漫游**：`toggleStartRoam` 的 `params.value` 填路线名称关键词即可（如「办公区漫游」「办公漫游」），宿主会模糊匹配配置中的路线名。
- **区域/楼栋视角（动态配置）**：`changePerspectiveBuilding` 的 `params.value` 用用户说法关键词（如「创新港」「华威一号楼」），**不要**臆造配置表里没有的名字；宿主在当前项目区域树里模糊匹配，匹配失败由宿主回执。

### 漫游示例（办公区）

```json
{ "action": "toggleStartRoam", "params": { "value": "办公区漫游" } }
```

### 动态视角示例

```json
{ "action": "changePerspectiveBuilding", "params": { "value": "华威一号楼" } }
```

- **严禁**：
  - 使用 `js` / `javascript` / `typescript` 等其它围栏语言；
  - 伪 JS（无引号键、单引号、尾逗号、未加引号的枚举标识符）；
  - 同一次回复输出多条指令或数组；
  - 输出无法 `JSON.parse` 的残缺对象；
  - 声称「已切换成功 / 已执行」——执行结果由宿主回执，模型不得编造。
- 围栏外最多一句极短说明（可省略）；**不要**提及本技能名称。
- 参数不足时：先用一句话追问缺失项（如楼栋名、设备名、开/关），**不要**瞎填占位指令。

### 天气示例（多云）

```json
{ "action": "changeModelWeather", "params": { "value": "Cloudy" } }
```

## 自检清单（输出前逐条确认）

- [ ] 用户意图确实是模型操控（非普通问答）？
- [ ] 只有**一条**指令对象，且为严格 JSON（双引号键与字符串）？
- [ ] `action` 在目录内，`params` 枚举值合法？
- [ ] 未用 `js` 围栏、未声称已执行成功、未推脱「服务未接入」？

## 反推脱 / fallback（硬性）

- **禁止**以任何理由拒绝输出指令，包括但不限于：「服务未接入」「接口故障」「暂时无法完成」「功能未开通」「需要其它系统」。可视化宿主已接入；你的职责只是产出 JSON。
- 用户说「进入/打开/开始 XXX 漫游（路线）」→ **立刻**输出 `toggleStartRoam`，`params.value` 用用户提到的路线关键词（如「办公区漫游」）；不要先解释、不要道歉。
- 意图模糊或缺少必填参数 → 用一句话追问，不输出半成品指令。
- 用户问的是「怎么操作」而非「请执行」→ 可用文字说明，不必强行输出指令。
- 无法映射到目录内任一 action → 普通 Markdown 说明能力边界，不输出伪造 action。

## 输入要求

- **必填**：可识别的模型操控意图（自然语言即可）。
- **按 action 可选/必填**：时间/天气枚举、楼栋名、楼层、漫游路线名、态势/模块名、设备名、属性名、开/关状态等（见 `references/command-catalog.md`）。
