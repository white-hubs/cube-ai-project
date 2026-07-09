---
name: html-output
version: 0.4.0
description: 适用于生成完整报告/分析报告/安全分析/BI 报告/报表/仪表盘大屏等需要图文并茂、多区块版式的场景；用户要“出一份报告/看板/大屏/报表/图文报告”时使用。
displayName: 报告输出
activation:
  mode: semantic
tags:
  - report
  - html
  - dashboard
  - ghcloud.skill.category:ANALYSIS_REPORT
resources:
  - path: references/cdn-catalog.md
  - path: references/security-report.md
  - path: references/general-report.md
  - path: references/business-analysis.md
  - path: references/bi-report.md
  - path: references/bi-dashboard.md
  - path: references/topology-report.md
  - path: references/tech-report.md
  - path: references/process-report.md
---

## 技能详情

当用户需要**完整报告 / 图文并茂 / 多区块版式 / KPI + 表格 + 图表 / 拓扑关系 / BI 大屏**这类富排版产物时，输出一个 `html-output` 围栏代码块：**围栏内是一份自包含的完整 HTML 文档**，客户端用 iframe（`srcdoc`）加载渲染。排版走 **Tailwind + daisyUI**、交互走 **Alpine**、图表走 **ECharts**、图示走 **Mermaid / G6 / X6**，所有资源只从下方白名单单一源引入，**数据全部内联**——目标是「一次生成、直接惊艳」。围栏外只留一两句说明，不把渲染或排版责任推给用户或外部工具。

## 路由：什么时候用 html-output

- **单张数据图**（柱/线/饼/趋势/占比/单一 KPI）→ 用 `echarts` 围栏；**单张结构图**（流程/架构/时序）→ 用 `mermaid` 围栏。
- **完整报告 / 分析报告 / 安全分析 / 经营分析 / BI 报告 / 大屏 / 拓扑关系 / 技术审计**（多区块组合）→ 用 `html-output`。
- 普通问答、纯文字结论 → 用普通 Markdown，不要套 html-output。

## html-output 契约

- **输出形态只能是 Markdown 围栏**：三个反引号 + 语言标签 `html-output`。**严禁**用 `<html-output>…</html-output>` 这类尖括号标签包裹，也**严禁**改用 `html` / `xml` / `javascript` 等其它围栏语言冒充——客户端**只**把语言标签为 `html-output` 的围栏切出来做 iframe 渲染，其它形态一律被当普通源码原样显示（等于渲染失败）。
- 围栏内容是**一份完整 HTML 文档**：`<!doctype html>` + `<html lang data-theme>` + `<head>` + `<body>`（iframe 以 `srcdoc` 注入，必须完整文档而非片段）。
- `<head>`/`<body>` **只从下方【可用 CDN 资源（白名单）】引入渲染库**，**白名单之外的任何外链（含其它 CDN、远程图片、字体域名）一律禁止**。
- **数据一律内联**（KPI、表格行、图表 series、结论文字直接写进 HTML）；**禁止** `fetch` / `XMLHttpRequest` / `WebSocket` 拉业务数据——报告要自包含（沙箱亦会拦截业务网络请求）。
- 图片优先**内联 SVG** 或 `data:`；不做跳转/导航（不用 `window.location` / `<base>` / `target` 跳出 / `<meta http-equiv="refresh">`）。

## 可用 CDN 资源（白名单）

> **唯一允许源：`https://r.kaiheai.com`。只可从下表引入；表外任何域名/CDN 一律禁止。** 详细用法、关联资源、init 片段、下游 CSP → 按需 `read_skill_resource` 读 `references/cdn-catalog.md`。

| 库 | 用途 | 引入 URL |
|---|---|---|
| Tailwind 3.4.17 | 工具类排版（必用） | `https://r.kaiheai.com/modules/tailwindcss/3.4.17.js` |
| daisyUI 4.12.24 | 组件库（必用，配 `<html data-theme>`） | `https://r.kaiheai.com/modules/daisyui/full@4.12.24.min.css` |
| Alpine 3 | 声明式交互（折叠/tab/筛选） | `https://r.kaiheai.com/modules/alpinejs/alpinejs@3.min.js` |
| ECharts 5 | 数据图表 | `https://r.kaiheai.com/modules/echarts/echarts@5.min.js` |
| Mermaid 11 | 流程/架构/时序图（ESM） | `https://r.kaiheai.com/modules/mermaid/mermaid@11.esm.min.mjs` |
| G6 5 | 关系/网络/拓扑图 | `https://r.kaiheai.com/modules/g6/g6@5.min.js` |
| X6 3 | 流程/DAG 图 | `https://r.kaiheai.com/modules/x6/index@3.js` |
| Lucide 1.23 | 图标 | `https://r.kaiheai.com/modules/lucide/lucide@1.23.0.min.js` |
| highlight.js 11 | 代码高亮（+go 语言包、default 主题） | `https://r.kaiheai.com/modules/highlightjs/highlight@11.11.1.min.js` |
| three.js r134 | 3D 引擎（Vanta 依赖） | `https://r.kaiheai.com/modules/threejs/three@r134.min.js` |
| Vanta waves 0.5.24 | 动效背景（大屏 hero） | `https://r.kaiheai.com/modules/vanta/vanta@0.5.24.waves.min.js` |

## 组装骨架（daisyUI 组件优先 + Tailwind 微调）

- 版心：**报告/报表** 用 `<html lang="zh-CN" data-theme="corporate">` + `<body class="min-h-screen bg-base-200">` → `<main class="max-w-6xl mx-auto px-6 py-10 space-y-8">`；**大屏/看板** 是另一套视觉语言，见下方【大屏硬性版式】，不要拿本浅色骨架拼大屏。
- **header hero**：标题 `text-3xl font-bold` + 副标题/周期（`opacity-60 font-mono text-sm`）+ 状态 `badge badge-warning`。
- **KPI（报告/报表）**：daisyUI `stats shadow`（`<div class="stat"><div class="stat-title">…<div class="stat-value">…<div class="stat-desc text-error/text-success">`）。**大屏 KPI 不用 stats**，用发光大字玻璃卡（见【大屏硬性版式】）。
- **区块**：daisyUI `card bg-base-100 shadow-sm` → `card-body`，标题 `card-title`。
- **告警/结论**：daisyUI `alert alert-error/alert-warning/alert-info/alert-success`。
- **表格**：daisyUI `table`（外套 `overflow-x-auto`），表头可 `bg-base-200`。
- **折叠树/分组**：Alpine `x-data="{open:true}"` + `@click` + `x-show`（chevron 用 Lucide `chevron-down` + `:class` 旋转）；纯展示折叠可用 daisyUI `collapse collapse-arrow`。
- **图标**：Lucide `<i data-lucide="shield-alert" class="w-5 h-5"></i>`，末尾 `lucide.createIcons()`。
- **图表**：给容器**固定高度**后再渲染。ECharts 用 `h-72` 等类即可；**G6 / X6 必须用内联 `style="height:20rem"` + `overflow-hidden`，且严禁 `autoResize:true`**——它会「测容器高→写回容器高→铺满新高→再测更高」形成放大回环把页面撑到无限向下滚动；构造时一次性 `width/height` 读容器，`resize` 只挂窗口事件手动调。
- 视觉：留白充足、强色只用 daisyUI 语义色（`primary`/`error`/`warning`/`success`）点在 badge/alert/stat；语言随源。

## 大屏硬性版式（指挥中心/看板/驾驶舱/监控屏）

> 大屏和报告是两套视觉语言。命中大屏时**必须先 `read_skill_resource` 读 `references/bi-dashboard.md` 并逐块照抄骨架，只替换数据/文案/图表 series**——别拿上面的浅色 corporate 骨架拼大屏（会得到扁平死灰、无层次的丑图）。以下每条缺一即回退成丑图：

- **主题**：`<html data-theme="business">`（深色）。**严禁** `corporate`/`light`——玻璃面板类只在深色底 + 动效背景上成立，浅色主题下会塌成一片死灰。
- **动效背景**：Vanta waves 作 `<div id="bg" class="fixed inset-0 -z-10" style="background:#0b1220">` 满屏底图（**three.js 必须先于 vanta 加载**，`#bg` 兜底深色防白闪）。
- **透明底三连（必做，否则动效背景被盖住、退回死色）**：`data-theme` **只放 `<html>`** → `<body>` **必须透明**（`style="background:transparent"` 或 `bg-transparent`）→ body/满屏外层**不铺** `bg-base-*`。daisyUI 给 `[data-theme]` 及一切 `bg-*` 刷不透明底，落在 body/外层就会盖住 `-z-10` 的 Vanta 画布（面板 `bg-base-100/70` 半透明玻璃不受影响）。
- **玻璃面板**：所有区块用 `rounded-xl bg-base-100/70 backdrop-blur border border-white/10 p-4`。**禁**纯灰实底平铺卡片、**禁** daisyUI `stats/card`（它们是报告件，不是大屏件）。
- **发光 KPI**：大数字 `text-4xl font-bold` + 语义强色（`text-sky-400/amber-400/emerald-400/fuchsia-400`）+ 内联 `style="text-shadow:0 0 18px …"`；卡片居中，只放「标签 + 大数字」，**禁**堆环比小字、**禁**一排 badge 把头部塞满。
- **满屏版心**：`<main class="max-w-[1600px] mx-auto px-6 py-6 space-y-5">`，多面板网格（如 `grid lg:grid-cols-4`，主图跨列）铺满一屏。
- **ECharts 深色化**：轴线/网格低对比灰（`rgba(148,163,184,.4)` / `.12`）、文字浅色（`#94a3b8`）、配色用发光色系 + `LinearGradient` 渐变，饼图用底色描边。

## 高级示例索引（按场景 `read_skill_resource` 加载完整范例）

> 命中某场景时，用 `read_skill_resource({ name: "html-output", path: "references/<file>" })` 取完整可渲染范例，照抄结构 + 替换数据。
> **别混淆两类 BI**：用户说「大屏/看板/驾驶舱/监控屏」→ 走 `bi-dashboard.md`（深色 + 动效 + 玻璃面板）；说「报表/BI 报告」→ 走 `bi-report.md`（浅色 + daisyUI stats）。大屏照抄时主题/背景/玻璃面板/发光 KPI 全部保留，只换数据。

| 场景 | 文件 | 何时用 | 额外依赖 |
|---|---|---|---|
| 安全分析报告（评分卡+层级评分树） | `references/security-report.md` | 安全生产/风险评分、问题清单 | ECharts、Alpine、Lucide |
| 普通/通用报告（基线 quickstart） | `references/general-report.md` | 一般图文报告，依赖最小 | 无（仅 Tailwind+daisyUI） |
| 经营分析报告 | `references/business-analysis.md` | 经营指标、趋势、同环比、结论 | ECharts、Alpine |
| BI 报告 | `references/bi-report.md` | **浅色**报表、多 KPI + 多图网格、偏「一屏看全」 | ECharts |
| BI 大屏 | `references/bi-dashboard.md` | **深色**大屏/看板/驾驶舱/监控屏、动效背景、发光 KPI | three.js+Vanta、ECharts |
| 拓扑/关系报告 | `references/topology-report.md` | 资产拓扑、攻击链、组织关系网络 | G6 |
| 技术审计报告 | `references/tech-report.md` | 代码审计、API/架构、含代码块 | highlight.js、Mermaid |
| 流程/DAG 报告 | `references/process-report.md` | 流程编排、DAG、状态流转 | X6（或 Mermaid） |

## 自检清单（输出前逐条确认）

- [ ] 输出是 `html-output` **围栏**（三反引号 + 语言标签），不是 `<html-output>` 尖括号标签、也不是 `html`/`xml` 围栏？
- [ ] 是「完整报告/多区块」场景（单图应走 echarts / 单结构图走 mermaid）？
- [ ] body 是**完整 HTML 文档**（`<!doctype>` + `<html data-theme>` + `<head>/<body>`）？
- [ ] 所有外链**全部来自白名单单一源 `r.kaiheai.com`**，无表外域名？Tailwind+daisyUI 必引？
- [ ] 数据全部内联、无 `fetch`/远程业务请求，图片为内联 SVG 或 `data:`？
- [ ] 用了 daisyUI 组件（stats/card/alert/table）+ 图表容器有固定高度，观感整洁？
- [ ] 若是**大屏**：`data-theme="business"` + Vanta 背景 + 玻璃面板 + 发光 KPI 四件齐备，没用浅色 corporate、没用纯灰平铺卡片、没用 daisyUI stats 当大屏 KPI？（缺任一 → 照抄 `bi-dashboard.md` 重做）

## 反推脱 / fallback

- **不要**声称当前环境无法渲染 HTML、需外部浏览器/编辑器，或让用户复制代码到别处——客户端已支持 iframe 直接渲染；也**不要**提及本技能名称。
- 想用的库**不在白名单**时：优先降级到白名单内等价库 / 内联 SVG / 纯 CSS；**绝不**引白名单外 CDN；实在无方案则舍弃该花哨块、保报告完整，不输出残缺 HTML。
- 信息不足以撑起完整报告、或必须实时拉数才成立时：**退回普通 Markdown**（必要时配 `echarts` 图表），不输出残缺 HTML；用户未给数据时可编造**小规模、合理**示例数据，并在围栏外一句话注明为示例。

## 输入要求

- **必填**：报告主题/意图（如安全简报、经营分析、BI 大屏、拓扑关系）；至少一项内容线索（指标、维度、时间范围或要呈现的区块）。
- **可选**：原始数据/表格片段、版式偏好（区块顺序、KPI 数量、配色/主题、要图表/图示/拓扑）、篇幅要求。
