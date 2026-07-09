# 示例：BI 大屏（深色 + 动效背景）

**适用场景**：指挥中心/监控大屏/看板/驾驶舱——深色主题、动效背景、发光大字 KPI、多面板图表铺满一屏。**不是**浅色报表（那走 `bi-report.md`）。

**用法：照抄下方骨架，只换数据。** 主题、Vanta 背景、玻璃面板类、发光 KPI 类名、ECharts 深色配置**原样保留不动**；只替换这些：KPI 标签/数字/发光色 → 区块 `<h2>` 标题 → `setOption` 里的 `data`/`series`/坐标轴类目 → header 标题与周期。**别**把它「改写」成浅色卡片版。

**硬性要求（缺一即塌成扁平死灰的丑图）**：
1. 主题 `data-theme="business"`（深色）——**严禁** `corporate`/`light`。
2. Vanta waves 作 `fixed inset-0 -z-10` 满屏背景（**three.js 必须先于 vanta 加载**），`#bg` 挂个兜底深色 `style="background:#0b1220"`（Vanta 没起来也不发白）。
3. **透明底三连（漏一个动效背景就被盖住、退回死色——「没加 transparent 就丑」的根因）**：`data-theme` **只放 `<html>`** → `<body>` **必须透明**（`style="background:transparent"` 或 `bg-transparent`）→ body/铺满屏的外层容器**不铺** `bg-base-*`。daisyUI 会给 `[data-theme]` 及一切 `bg-*` 元素刷**不透明**底色，一旦落在 body/满屏外层就盖住 `-z-10` 的 Vanta 画布（面板用 `bg-base-100/70` 半透明玻璃不受影响，它本就该让波浪透出来）。
4. 每个面板都用 `rounded-xl bg-base-100/70 backdrop-blur border border-white/10`——**禁**纯灰实底、**禁** daisyUI `stats/card`。
5. KPI 只放「标签 + 发光大数字」，居中，内联 `text-shadow`；**禁**堆环比小字、**禁**一排 badge 塞满头部。
6. ECharts 深色化：轴/网格低对比灰、文字浅色、配色用发光色系 + `LinearGradient` 渐变、饼图用底色描边。
7. 版心 `max-w-[1600px]`，多面板网格铺满一屏。
8. 依赖：Tailwind+daisyUI+three.js+Vanta+ECharts+Lucide。

**反例（别这么干）**：`data-theme="corporate"` 硬调深色拼凑 ✗；`bg-base-200` / 纯灰卡片无玻璃无发光 ✗；用 daisyUI `stats` 当大屏 KPI ✗；header 堆一排 badge/副标题 ✗；省略 Vanta 只留死黑底 ✗。

```html-output
<!doctype html>
<html lang="zh-CN" data-theme="business">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>运营指挥大屏</title>
    <link rel="stylesheet" href="https://r.kaiheai.com/modules/daisyui/full@4.12.24.min.css" />
    <script src="https://r.kaiheai.com/modules/tailwindcss/3.4.17.js"></script>
  </head>
  <body class="min-h-screen text-slate-100 overflow-x-hidden" style="background: transparent;">
    <!-- data-theme 只在 <html>；body 透明 + #bg 兜底深色，才不会盖住 Vanta 波浪 -->
    <div id="bg" class="fixed inset-0 -z-10" style="background:#0b1220"></div>

    <main class="max-w-[1600px] mx-auto px-6 py-6 space-y-5">
      <header class="flex items-center justify-between">
        <span class="text-sm text-slate-300 font-mono flex items-center gap-2"><i data-lucide="satellite-dish" class="w-4 h-4"></i>实时监控</span>
        <h1 class="text-3xl font-bold tracking-widest" style="text-shadow:0 0 24px rgba(56,189,248,.55)">运营指挥中心 · 数据大屏</h1>
        <span class="text-sm text-slate-300 font-mono" id="clock">2026-06-30 14:25:56</span>
      </header>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="rounded-xl bg-base-100/70 backdrop-blur border border-white/10 p-4 text-center">
          <div class="text-xs text-slate-400">在线设备</div>
          <div class="text-4xl font-bold text-sky-400" style="text-shadow:0 0 18px rgba(56,189,248,.5)">8,642</div>
        </div>
        <div class="rounded-xl bg-base-100/70 backdrop-blur border border-white/10 p-4 text-center">
          <div class="text-xs text-slate-400">今日告警</div>
          <div class="text-4xl font-bold text-amber-400" style="text-shadow:0 0 18px rgba(251,191,36,.5)">126</div>
        </div>
        <div class="rounded-xl bg-base-100/70 backdrop-blur border border-white/10 p-4 text-center">
          <div class="text-xs text-slate-400">处置率</div>
          <div class="text-4xl font-bold text-emerald-400" style="text-shadow:0 0 18px rgba(52,211,153,.5)">96.2%</div>
        </div>
        <div class="rounded-xl bg-base-100/70 backdrop-blur border border-white/10 p-4 text-center">
          <div class="text-xs text-slate-400">数据吞吐</div>
          <div class="text-4xl font-bold text-fuchsia-400" style="text-shadow:0 0 18px rgba(232,121,249,.5)">2.4<span class="text-lg">GB/s</span></div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <section class="rounded-xl bg-base-100/70 backdrop-blur border border-white/10 p-4">
          <h2 class="text-sm text-slate-300 mb-2">设备类型分布</h2><div id="d1" class="w-full h-56"></div>
        </section>
        <section class="rounded-xl bg-base-100/70 backdrop-blur border border-white/10 p-4 lg:col-span-2">
          <h2 class="text-sm text-slate-300 mb-2">24h 告警趋势</h2><div id="d2" class="w-full h-56"></div>
        </section>
        <section class="rounded-xl bg-base-100/70 backdrop-blur border border-white/10 p-4">
          <h2 class="text-sm text-slate-300 mb-2">区域负载</h2><div id="d3" class="w-full h-56"></div>
        </section>
      </div>

      <footer class="text-xs text-slate-400/70 font-mono text-center pt-2">示例大屏 · 数据仅供演示</footer>
    </main>

    <script src="https://r.kaiheai.com/modules/threejs/three@r134.min.js"></script>
    <script src="https://r.kaiheai.com/modules/vanta/vanta@0.5.24.waves.min.js"></script>
    <script src="https://r.kaiheai.com/modules/echarts/echarts@5.min.js"></script>
    <script src="https://r.kaiheai.com/modules/lucide/lucide@1.23.0.min.js"></script>
    <script>
      if (window.VANTA) VANTA.WAVES({ el: "#bg", color: 0x0b1220, shininess: 35, waveHeight: 14, waveSpeed: 0.75, zoom: 0.92 });

      const axis = { axisLine: { lineStyle: { color: "rgba(148,163,184,.4)" } }, axisLabel: { color: "#94a3b8" }, splitLine: { lineStyle: { color: "rgba(148,163,184,.12)" } } };
      const d1 = echarts.init(document.getElementById("d1"));
      d1.setOption({ tooltip: { trigger: "item" }, legend: { bottom: 0, textStyle: { color: "#cbd5e1" } },
        series: [{ type: "pie", radius: ["45%","72%"], label: { show: false }, itemStyle: { borderColor: "#0b1220", borderWidth: 2 },
          data: [{ value: 42, name: "网关" },{ value: 30, name: "传感器" },{ value: 18, name: "摄像" },{ value: 10, name: "其它" }] }],
        color: ["#38bdf8","#34d399","#fbbf24","#e879f9"] });
      const d2 = echarts.init(document.getElementById("d2"));
      d2.setOption({ tooltip: { trigger: "axis" }, grid: { left: 40, right: 16, top: 20, bottom: 28 },
        xAxis: { type: "category", boundaryGap: false, data: ["0时","4时","8时","12时","16时","20时","24时"], ...axis },
        yAxis: { type: "value", ...axis },
        series: [{ type: "line", smooth: true, symbol: "none", lineStyle: { width: 3, color: "#38bdf8" },
          areaStyle: { color: new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:"rgba(56,189,248,.45)"},{offset:1,color:"rgba(56,189,248,0)"}]) },
          data: [12, 8, 18, 34, 28, 42, 26] }] });
      const d3 = echarts.init(document.getElementById("d3"));
      d3.setOption({ tooltip: {}, grid: { left: 48, right: 16, top: 16, bottom: 24 },
        xAxis: { type: "value", max: 100, ...axis }, yAxis: { type: "category", data: ["西部","华北","华南","华东"], ...axis },
        series: [{ type: "bar", data: [46, 63, 78, 92], barWidth: "55%", itemStyle: { borderRadius: [0,4,4,0], color: new echarts.graphic.LinearGradient(0,0,1,0,[{offset:0,color:"#0ea5e9"},{offset:1,color:"#38bdf8"}]) } }] });
      addEventListener("resize", () => [d1,d2,d3].forEach((c) => c.resize()));

      setInterval(() => { document.getElementById("clock").textContent = new Date().toLocaleString("zh-CN", { hour12: false }); }, 1000);
      lucide.createIcons();
    </script>
  </body>
</html>
```
