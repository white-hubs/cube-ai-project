# 示例：BI 报告（多 KPI + 多图网格）

**适用场景**：报表/BI 报告——一排 KPI + 多张图表网格式铺陈（柱/线/饼/雷达/仪表盘），偏「一屏看全」。与经营分析的区别：更重图、更少叙述。

**版式要点**：header → daisyUI `stats` KPI → 2×2 `card` 图表网格（每个容器固定高度）→ 排名/明细表。主题 `corporate`。依赖：Tailwind+daisyUI+ECharts+Lucide（无需 Alpine）。

```html-output
<!doctype html>
<html lang="zh-CN" data-theme="corporate">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>BI 运营报表</title>
    <link rel="stylesheet" href="https://r.kaiheai.com/modules/daisyui/full@4.12.24.min.css" />
    <script src="https://r.kaiheai.com/modules/tailwindcss/3.4.17.js"></script>
  </head>
  <body class="min-h-screen bg-base-200 text-base-content">
    <main class="max-w-6xl mx-auto px-6 py-10 space-y-6">
      <header class="flex items-center justify-between flex-wrap gap-2 pb-4 border-b border-base-300">
        <div>
          <h1 class="text-2xl font-bold tracking-tight flex items-center gap-2"><i data-lucide="layout-dashboard" class="w-6 h-6 text-primary"></i>运营 BI 报表</h1>
          <p class="text-sm text-base-content/60 font-mono">2026-06 · 示例数据</p>
        </div>
        <span class="badge badge-success badge-outline gap-1"><i data-lucide="circle-check" class="w-3.5 h-3.5"></i>数据已更新</span>
      </header>

      <div class="stats shadow w-full">
        <div class="stat"><div class="stat-figure text-primary"><i data-lucide="users" class="w-7 h-7"></i></div><div class="stat-title">活跃用户</div><div class="stat-value text-primary">48.2k</div><div class="stat-desc text-success">+6.3%</div></div>
        <div class="stat"><div class="stat-figure text-primary"><i data-lucide="shopping-cart" class="w-7 h-7"></i></div><div class="stat-title">订单量</div><div class="stat-value">12.9k</div><div class="stat-desc text-success">+9.1%</div></div>
        <div class="stat"><div class="stat-figure text-primary"><i data-lucide="banknote" class="w-7 h-7"></i></div><div class="stat-title">GMV</div><div class="stat-value">¥4.21M</div><div class="stat-desc text-success">+11.8%</div></div>
        <div class="stat"><div class="stat-figure text-warning"><i data-lucide="undo-2" class="w-7 h-7"></i></div><div class="stat-title">退款率</div><div class="stat-value">1.7%</div><div class="stat-desc text-error">+0.3pp</div></div>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section class="card bg-base-100 shadow-sm"><div class="card-body"><h2 class="card-title text-base">区域 GMV</h2><div id="c1" class="w-full h-64"></div></div></section>
        <section class="card bg-base-100 shadow-sm"><div class="card-body"><h2 class="card-title text-base">日活趋势</h2><div id="c2" class="w-full h-64"></div></div></section>
        <section class="card bg-base-100 shadow-sm"><div class="card-body"><h2 class="card-title text-base">流量来源</h2><div id="c3" class="w-full h-64"></div></div></section>
        <section class="card bg-base-100 shadow-sm"><div class="card-body"><h2 class="card-title text-base">目标达成</h2><div id="c4" class="w-full h-64"></div></div></section>
      </div>

      <section class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <h2 class="card-title text-base"><i data-lucide="trophy" class="w-5 h-5 text-warning"></i>商品销量 Top 5</h2>
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead><tr><th>#</th><th>商品</th><th>销量</th><th>环比</th></tr></thead>
              <tbody>
                <tr><td>1</td><td>智能网关 A1</td><td>3,204</td><td class="text-success">+18%</td></tr>
                <tr><td>2</td><td>传感器套件 S</td><td>2,712</td><td class="text-success">+12%</td></tr>
                <tr><td>3</td><td>边缘盒子 E2</td><td>1,986</td><td class="text-error">-4%</td></tr>
                <tr><td>4</td><td>摄像模组 C</td><td>1,540</td><td class="text-success">+7%</td></tr>
                <tr><td>5</td><td>能耗表 M</td><td>1,208</td><td class="text-success">+21%</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <footer class="text-xs text-base-content/50 font-mono pt-2">示例报表 · 数据仅供演示</footer>
    </main>

    <script src="https://r.kaiheai.com/modules/echarts/echarts@5.min.js"></script>
    <script src="https://r.kaiheai.com/modules/lucide/lucide@1.23.0.min.js"></script>
    <script>
      const palette = ["#3b82f6","#22c55e","#f59e0b","#a78bfa","#06b6d4"];
      const c1 = echarts.init(document.getElementById("c1"));
      c1.setOption({ tooltip: {}, grid: { left: 48, right: 16, top: 16, bottom: 28 },
        xAxis: { type: "category", data: ["华东","华南","华北","西部","东北"] }, yAxis: { type: "value" },
        series: [{ type: "bar", data: [128,96,74,52,38], itemStyle: { borderRadius: [4,4,0,0], color: "#3b82f6" }, barWidth: "48%" }] });
      const c2 = echarts.init(document.getElementById("c2"));
      c2.setOption({ tooltip: { trigger: "axis" }, grid: { left: 40, right: 16, top: 16, bottom: 28 },
        xAxis: { type: "category", boundaryGap: false, data: ["一","二","三","四","五","六","日"] }, yAxis: { type: "value" },
        series: [{ type: "line", smooth: true, areaStyle: { opacity: 0.15 }, lineStyle: { width: 3 }, data: [6.2,6.8,6.5,7.1,7.6,8.9,8.2], color: "#22c55e" }] });
      const c3 = echarts.init(document.getElementById("c3"));
      c3.setOption({ tooltip: { trigger: "item" }, legend: { bottom: 0 },
        series: [{ type: "pie", radius: ["40%","68%"], itemStyle: { borderColor: "#fff", borderWidth: 2 }, label: { show: false },
          data: [{ value: 42, name: "自然" },{ value: 28, name: "付费" },{ value: 18, name: "社交" },{ value: 12, name: "直访" }] }], color: palette });
      const c4 = echarts.init(document.getElementById("c4"));
      c4.setOption({ series: [{ type: "gauge", progress: { show: true, width: 12 }, axisLine: { lineStyle: { width: 12 } },
        axisTick: { show: false }, splitLine: { length: 10 }, axisLabel: { fontSize: 10 }, pointer: { width: 4 },
        detail: { valueAnimation: true, fontSize: 22, offsetCenter: [0, "70%"], formatter: "{value}%" }, data: [{ value: 78 }] }], color: ["#3b82f6"] });
      addEventListener("resize", () => [c1,c2,c3,c4].forEach((c) => c.resize()));
      lucide.createIcons();
    </script>
  </body>
</html>
```
