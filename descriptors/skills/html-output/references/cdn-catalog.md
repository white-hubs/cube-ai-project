# CDN 资源目录（html-output 白名单详解）

> **唯一允许源：`https://r.kaiheai.com`。** 所有外部资源只能从下表引入，**表外任何域名 / CDN / 远程图片 / 字体域名一律禁止**。想用的库不在表内 → 降级到表内等价库 / 内联 SVG / 纯 CSS，绝不引外链。

## 引入总表

| 库 | 用途 | 主引入 | 关联资源 | 何时用 |
|---|---|---|---|---|
| Tailwind 3.4.17 | 工具类排版 | `<script src="https://r.kaiheai.com/modules/tailwindcss/3.4.17.js"></script>` | 无（可选内联 `tailwind.config`） | **必用** |
| daisyUI 4.12.24 | 组件库 | `<link rel="stylesheet" href="https://r.kaiheai.com/modules/daisyui/full@4.12.24.min.css" />` | `<html data-theme="…">` | **必用** |
| Alpine 3 | 声明式交互 | `<script defer src="https://r.kaiheai.com/modules/alpinejs/alpinejs@3.min.js"></script>` | 无 | 折叠/tab/筛选/计数 |
| ECharts 5 | 数据图表 | `<script src="https://r.kaiheai.com/modules/echarts/echarts@5.min.js"></script>` | 无 | 柱/线/饼/仪表盘/环形 |
| Mermaid 11 | 流程/架构/时序图 | ESM `import`（见下） | 无 | 声明式结构图 |
| G6 5 | 关系/网络/拓扑图 | `<script src="https://r.kaiheai.com/modules/g6/g6@5.min.js"></script>` | 无 | 多节点关系网络（见 `topology-report.md`） |
| X6 3 | 流程/DAG 图 | `<script src="https://r.kaiheai.com/modules/x6/index@3.js"></script>` | 无 | 流程编排/状态流转（见 `process-report.md`） |
| Lucide 1.23 | 图标 | `<script src="https://r.kaiheai.com/modules/lucide/lucide@1.23.0.min.js"></script>` | 末尾 `lucide.createIcons()` | 状态点/区块图标 |
| highlight.js 11 | 代码高亮 | `<script src="https://r.kaiheai.com/modules/highlightjs/highlight@11.11.1.min.js"></script>` | **主题 CSS `default@11.11.1.min.css` + 语言包 `go@11.11.1.min.js`** | 代码块（见 `tech-report.md`） |
| three.js r134 | 3D 引擎 | `<script src="https://r.kaiheai.com/modules/threejs/three@r134.min.js"></script>` | Vanta 前置依赖 | 仅作 Vanta 底座 |
| Vanta waves 0.5.24 | 动效背景 | `<script src="https://r.kaiheai.com/modules/vanta/vanta@0.5.24.waves.min.js"></script>` | **必须先加载 three.js（THREE 全局）** | 大屏 hero（见 `bi-dashboard.md`） |

> 「关联资源」= 该库正常工作需一起引入的伴随文件。典型：**highlight.js** 需「核心 JS + 主题 CSS + 语言包」三件；**Vanta** 需「three.js 在前 + vanta 在后」。

## 基础骨架（Tailwind + daisyUI + Lucide）

```html
<!doctype html>
<html lang="zh-CN" data-theme="corporate">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>报告标题</title>
    <link rel="stylesheet" href="https://r.kaiheai.com/modules/daisyui/full@4.12.24.min.css" />
    <script src="https://r.kaiheai.com/modules/tailwindcss/3.4.17.js"></script>
    <script defer src="https://r.kaiheai.com/modules/alpinejs/alpinejs@3.min.js"></script>
  </head>
  <body class="min-h-screen bg-base-200">
    <main class="max-w-6xl mx-auto px-6 py-10 space-y-8"><!-- … --></main>
    <script src="https://r.kaiheai.com/modules/lucide/lucide@1.23.0.min.js"></script>
    <script>lucide.createIcons();</script>
  </body>
</html>
```

## init 片段

**ECharts**（容器先给固定高度，再 init；随窗口 resize）：

```html
<div id="chart1" class="w-full h-72"></div>
<script src="https://r.kaiheai.com/modules/echarts/echarts@5.min.js"></script>
<script>
  const c1 = echarts.init(document.getElementById("chart1"));
  c1.setOption({
    tooltip: {},
    xAxis: { type: "category", data: ["一","二","三"] },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: [12, 24, 18] }],
  });
  addEventListener("resize", () => c1.resize());
</script>
```

**Mermaid**（ESM 模块导入）：

```html
<pre class="mermaid">flowchart LR; A[开始]-->B{判断}; B-->|是|C[处理]; B-->|否|D[结束]</pre>
<script type="module">
  import mermaid from "https://r.kaiheai.com/modules/mermaid/mermaid@11.esm.min.mjs";
  mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
</script>
```

**Lucide**（图标；HTML 里用 `data-lucide`，末尾统一 `createIcons`）：

```html
<i data-lucide="shield-alert" class="w-5 h-5 text-error"></i>
<script src="https://r.kaiheai.com/modules/lucide/lucide@1.23.0.min.js"></script>
<script>lucide.createIcons();</script>
```

**highlight.js**（核心 JS + 主题 CSS + go 语言包三件；代码放 `<pre><code class="language-go">`）：

```html
<link rel="stylesheet" href="https://r.kaiheai.com/modules/highlightjs/default@11.11.1.min.css" />
<pre><code class="language-go">func main() { fmt.Println("hi") }</code></pre>
<script src="https://r.kaiheai.com/modules/highlightjs/highlight@11.11.1.min.js"></script>
<script src="https://r.kaiheai.com/modules/highlightjs/go@11.11.1.min.js"></script>
<script>hljs.highlightAll();</script>
```

**Vanta waves**（three.js 必须在前；固定定位置底做背景。**透明底三连**：`data-theme` 只放 `<html>`、`<body>` 透明、body/满屏外层不铺 `bg-base-*`——否则 daisyUI 给 `[data-theme]`/`bg-*` 刷的**不透明底**会盖住 `-z-10` 的 Vanta 画布，动效背景消失退回死色）：

```html
<body class="min-h-screen text-slate-100 bg-transparent"><!-- 必须透明，否则盖住下面的 #bg -->
<div id="bg" class="fixed inset-0 -z-10" style="background:#0f172a"></div><!-- 兜底深色，Vanta 没加载也不发白 -->
<script src="https://r.kaiheai.com/modules/threejs/three@r134.min.js"></script>
<script src="https://r.kaiheai.com/modules/vanta/vanta@0.5.24.waves.min.js"></script>
<script>
  VANTA.WAVES({ el: "#bg", color: 0x0f172a, shininess: 30, waveHeight: 15, waveSpeed: 0.8, zoom: 0.9 });
</script>
```

**G6 / X6**：完整可运行代码分别见 `references/topology-report.md`、`references/process-report.md`（版本敏感，以示例文件为准）。

## 下游 iframe CSP（需逐条放行，单一源）

```
default-src 'none';
script-src  https://r.kaiheai.com 'unsafe-inline' 'unsafe-eval';
style-src   https://r.kaiheai.com 'unsafe-inline';
img-src     'self' data: https://r.kaiheai.com;
font-src    https://r.kaiheai.com data:;
connect-src 'none';
```

- `'unsafe-eval'`：Tailwind Play CDN 运行时编译 + Alpine 表达式求值都需要。
- `'unsafe-inline'`：ECharts / Mermaid / Alpine / Lucide / highlight.js 的 init 内联脚本需要。
- `connect-src 'none'`：报告自包含，禁一切网络请求（与「数据内联」契约一致）。

## 注意事项

- **daisyUI 语义色**（`btn-primary`/`badge-error`/`alert-info`/`text-success`）来自 daisyUI CSS；自定义细粒度颜色用 **Tailwind 内置调色板**（`text-rose-600` 等），不要臆造 daisyUI 未提供的 `text-primary` 之类工具类。
- **主题**：报告/报表用 `data-theme="corporate"`（或 `light`）；**大屏必用 `data-theme="business"`（深色）**——大屏的玻璃面板（`bg-base-100/70 backdrop-blur border border-white/10`）+ 发光 KPI 只在深色主题 + Vanta 背景上成立，浅色主题下会塌成死灰（见 `bi-dashboard.md`）。
- **Vanta 背景要露出来 → 透明底三连**：daisyUI 的 `:root,[data-theme]{background-color:…}` 会给带 `data-theme` 的元素及任何 `bg-*` 刷**不透明**底；该层若落在 `<body>`/满屏外层，会盖住 `-z-10` 的 `#bg` 画布，动效背景全无、退回死色。所以：`data-theme` **只放 `<html>`**、`<body>` **显式 `bg-transparent`/`background:transparent`**、body 与满屏外层**不铺** `bg-base-*`；`#bg` 再挂兜底深色防白闪（面板 `bg-base-100/70` 半透明玻璃不受影响）。
- **图表/图容器必须有固定高度**，否则 ECharts/G6/X6 渲染高度为 0；**G6/X6 用内联 `style="height:…"` + `overflow-hidden` 而非仅 Tailwind 高度类**（Play CDN 异步生成类，init 时可能还没生效被内联高度覆盖）。
- **G6/X6 严禁 `autoResize:true`**：其容器监听会「测高→写回容器内联高→铺满新高→再测更高」形成放大回环，把页面撑到无限向下滚动。做法：构造时一次性 `width/height` 读容器（`el.clientWidth/clientHeight`），`resize` 只挂窗口事件手动 `graph.resize()`（X6）/ `graph.setSize()`（G6）。
- Mermaid 是 **ESM**（`<script type="module">`），其余库是 UMD（普通 `<script>`）。
