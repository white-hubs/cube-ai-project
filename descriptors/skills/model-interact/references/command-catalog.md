# 模型交互指令目录（严格 JSON）

> 输出时键与字符串值一律双引号；布尔用 `true`/`false`；数字不加引号。  
> 示例均为可直接 `JSON.parse` 的对象（可包在 ` ```json ` 围栏内）。

## changeModelTime — 切换模型时间

合法 `params.value`：`day`（白天）、`dusk`（黄昏）、`night`（夜晚）

```json
{ "action": "changeModelTime", "params": { "value": "day" } }
```

## changeModelWeather — 切换模型天气

合法 `params.value`（与 UE5 `modelWeatherList` 一致）：

| 中文 | value |
|---|---|
| 晴 | Sunny |
| 多云 | Cloudy |
| 雾 | Foggy |
| 阴 | Overcast |
| 小雨 | RainLight |
| 大雨 | Rain |
| 暴雨 | RainThunderStorm |
| 小雪 | SnowLight |
| 大雪 | Snow |
| 暴雪 | SnowBlizzard |
| 沙尘 | SandDustCalm |
| 沙暴 | SandDustStorm |

```json
{ "action": "changeModelWeather", "params": { "value": "Sunny" } }
```

## toggleRevolve — 开启/关闭环游

`params.value`：`true` 开启，`false` 关闭

```json
{ "action": "toggleRevolve", "params": { "value": true } }
```

## changePerspectiveDefault — 切换到默认视角

```json
{ "action": "changePerspectiveDefault" }
```

## changePerspectiveOverlook — 俯瞰/鸟瞰视角

```json
{ "action": "changePerspectiveOverlook" }
```

## changePerspectiveBuilding — 切换到指定楼栋/区域视角（动态配置）

`params.value`：用户说法中的区域/楼栋关键词即可（不必背完整配置表）。  
宿主会在**当前项目动态区域树**里模糊匹配 `name` / `aliasName`（如「创新港视角」→「创新港」）。  
匹配失败由宿主回执失败，模型不要编造不存在的楼栋。

```json
{ "action": "changePerspectiveBuilding", "params": { "value": "创新港" } }
```

## changePerspectiveFloor — 切换到指定楼栋楼层视角

`params.building`：楼栋名；`params.floor`：楼层（数字）

```json
{ "action": "changePerspectiveFloor", "params": { "building": "行政大楼", "floor": 3 } }
```

## changeModelQuality — 切换模型画质

合法 `params.value`：`high`、`medium`、`low`（小写）

```json
{ "action": "changeModelQuality", "params": { "value": "high" } }
```

## toggleDriveMode — 驾驶模式进入/退出

`params.value`：`true` 进入，`false` 退出

```json
{ "action": "toggleDriveMode", "params": { "value": true } }
```

## toggleFullScreen — 全屏进入/退出

`params.value`：`true` 进入，`false` 退出

```json
{ "action": "toggleFullScreen", "params": { "value": true } }
```

## toggleBusinessMenu — 功能菜单显示/隐藏

`params.value`：`true` 显示，`false` 隐藏

```json
{ "action": "toggleBusinessMenu", "params": { "value": true } }
```

## toggleStartRoam — 打开/进入漫游

`params.value`：漫游路线名称（字符串）

```json
{ "action": "toggleStartRoam", "params": { "value": "园区主路线" } }
```

## toggleCloseRoam — 关闭/退出漫游

```json
{ "action": "toggleCloseRoam" }
```

## togglePauseRoam — 暂停/继续漫游

`params.value`：`true` 暂停相关态（按宿主约定），`false` 继续

```json
{ "action": "togglePauseRoam", "params": { "value": true } }
```

## toggleSwitchboard — 打开/查看/显示态势或模块

`params.value`：模块名（如 `总览`、`安防监控`）

```json
{ "action": "toggleSwitchboard", "params": { "value": "安防监控" } }
```

## toggleOpenDeviceDetails — 查看/打开设备详情

`params.value`：设备名称或标识

```json
{ "action": "toggleOpenDeviceDetails", "params": { "value": "1号摄像头" } }
```

## toggleOpenDeviceMonitor — 查看/打开设备监控

`params.value`：设备名称或标识

```json
{ "action": "toggleOpenDeviceMonitor", "params": { "value": "1号摄像头" } }
```

## modifyDeviceStatus — 修改设备属性开/关

`params.value`：设备；`params.attribute`：属性名；`params.state`：开 `"1"` / 关 `"0"`（字符串）

```json
{ "action": "modifyDeviceStatus", "params": { "value": "空调-01", "attribute": "电源", "state": "1" } }
```

## modifyDeviceStatusForLight — 行政大楼照明回路开/关

`params.state`：开 `"1"` / 关 `"0"`（字符串）

```json
{ "action": "modifyDeviceStatusForLight", "params": { "state": "1" } }
```

## 意图 → action 速查

| 用户说法线索 | action |
|---|---|
| 白天/黄昏/夜晚/切换时间 | changeModelTime |
| 晴/雨/雪/雾/天气 | changeModelWeather |
| 环游/绕场 | toggleRevolve |
| 默认视角 | changePerspectiveDefault |
| 俯瞰/鸟瞰 | changePerspectiveOverlook |
| 某某楼/某某栋视角 | changePerspectiveBuilding |
| 几楼/楼层视角 | changePerspectiveFloor |
| 画质高中低 | changeModelQuality |
| 驾驶模式 | toggleDriveMode |
| 全屏 | toggleFullScreen |
| 功能菜单/业务菜单 | toggleBusinessMenu |
| 打开/进入漫游 | toggleStartRoam |
| 关闭/退出漫游 | toggleCloseRoam |
| 暂停/继续漫游 | togglePauseRoam |
| 态势/总览/安防监控模块 | toggleSwitchboard |
| 设备详情 | toggleOpenDeviceDetails |
| 设备监控 | toggleOpenDeviceMonitor |
| 改设备开/关 | modifyDeviceStatus |
| 行政楼照明/开灯关灯 | modifyDeviceStatusForLight |
