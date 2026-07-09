# 示例：经营分析报告

**适用场景**：经营/业务分析——核心经营指标 + 趋势 + 结构占比 + 多维明细 + 结论。

**版式要点**：header → daisyUI `stats`（营收/毛利/客单价/环比）→ 两张 ECharts（营收趋势折线 + 品类占比环形，**常显、不放进被隐藏的 tab**）→ Alpine `tabs`（区域/渠道/品类明细表切换，表都在 DOM 里用 `x-show`）→ 结论 `alert`。主题 `corporate`。依赖：Tailwind+daisyUI+Alpine+ECharts+Lucide。

```html-output
<!doctype html>
<html lang="zh-CN" data-theme="corporate">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>经营分析报告</title>
    <link rel="stylesheet" href="https://r.kaiheai.com/modules/daisyui/full@4.12.24.min.css" />
    <script src="https://r.kaiheai.com/modules/tailwindcss/3.4.17.js"></script>
    <script defer src="https://r.kaiheai.com/modules/alpinejs/alpinejs@3.min.js"></script>
  </head>
  <body class="min-h-screen bg-base-200 text-base-content">
    <main class="max-w-6xl mx-auto px-6 py-10 space-y-6">
      <header class="space-y-2 pb-4 border-b border-base-300">
        <p class="text-sm text-base-content/60 flex items-center gap-2"><i data-lucide="trending-up" class="w-4 h-4"></i>经营分析 · 季度</p>
        <h1 class="text-3xl font-bold tracking-tight">2026 Q2 经营分析报告</h1>
        <p class="text-sm text-base-content/60 font-mono">2026-04-01 ~ 2026-06-30 · 示例数据</p>
      </header>

      <div class="stats stats-vertical md:stats-horizontal shadow w-full">
        <div class="stat"><div class="stat-title">营收</div><div class="stat-value text-primary">¥8.64M</div><div class="stat-desc text-success">同比 +18.2%</div></div>
        <div class="stat"><div class="stat-title">毛利率</div><div class="stat-value">42.7%</div><div class="stat-desc text-success">+1.9pp</div></div>
        <div class="stat"><div class="stat-title">客单价</div><div class="stat-value">¥326</div><div class="stat-desc text-error">-2.4%</div></div>
        <div class="stat"><div class="stat-title">复购率</div><div class="stat-value">31.5%</div><div class="stat-desc text-success">+3.1pp</div></div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section class="card bg-base-100 shadow-sm lg:col-span-2">
          <div class="card-body">
            <h2 class="card-title text-base"><i data-lucide="line-chart" class="w-5 h-5 text-primary"></i>月度营收趋势</h2>
            <div id="trend" class="w-full h-72"></div>
          </div>
        </section>
        <section class="card bg-base-100 shadow-sm">
          <div class="card-body">
            <h2 class="card-title text-base"><i data-lucide="pie-chart" class="w-5 h-5 text-primary"></i>品类占比</h2>
            <div id="mix" class="w-full h-72"></div>
          </div>
        </section>
      </div>

      <section class="card bg-base-100 shadow-sm" x-data="{ tab: 'region' }">
        <div class="card-body space-y-3">
          <div role="tablist" class="tabs tabs-boxed w-fit">
            <a role="tab" class="tab" :class="tab==='region' && 'tab-active'" @click="tab='region'">区域明细</a>
            <a role="tab" class="tab" :class="tab==='channel' && 'tab-active'" @click="tab='channel'">渠道明细</a>
            <a role="tab" class="tab" :class="tab==='category' && 'tab-active'" @click="tab='category'">品类明细</a>
          </div>
          <div class="overflow-x-auto">
            <table class="table table-sm" x-show="tab==='region'">
              <thead><tr><th>区域</th><th>营收</th><th>同比</th><th>毛利率</th></tr></thead>
              <tbody>
                <tr><td>华东</td><td>¥3.12M</td><td class="text-success">+22.4%</td><td>44.1%</td></tr>
                <tr><td>华南</td><td>¥2.28M</td><td class="text-success">+15.7%</td><td>41.3%</td></tr>
                <tr><td>华北</td><td>¥1.86M</td><td class="text-error">-3.2%</td><td>39.8%</td></tr>
                <tr><td>西部</td><td>¥1.38M</td><td class="text-success">+28.9%</td><td>43.6%</td></tr>
              </tbody>
            </table>
            <table class="table table-sm" x-show="tab==='channel'" style="display:none">
              <thead><tr><th>渠道</th><th>营收</th><th>占比</th><th>转化率</th></tr></thead>
              <tbody>
                <tr><td>直营</td><td>¥4.05M</td><td>46.9%</td><td>3.8%</td></tr>
                <tr><td>电商</td><td>¥2.94M</td><td>34.0%</td><td>2.6%</td></tr>
                <tr><td>分销</td><td>¥1.65M</td><td>19.1%</td><td>—</td></tr>
              </tbody>
            </table>
            <table class="table table-sm" x-show="tab==='category'" style="display:none">
              <thead><tr><th>品类</th><th>营收</th><th>占比</th><th>毛利率</th></tr></thead>
              <tbody>
                <tr><td>核心产品</td><td>¥4.32M</td><td>50.0%</td><td>46.2%</td></tr>
                <tr><td>增值服务</td><td>¥2.16M</td><td>25.0%</td><td>52.8%</td></tr>
                <tr><td>配件耗材</td><td>¥1.30M</td><td>15.0%</td><td>31.4%</td></tr>
                <tr><td>其它</td><td>¥0.86M</td><td>10.0%</td><td>28.0%</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div class="alert alert-info">
        <i data-lucide="info" class="w-5 h-5"></i>
        <span><span class="font-semibold">结论：</span>营收同比双位数增长由华东与西部驱动；客单价下滑需关注促销依赖，Q3 建议以复购与增值服务提升毛利结构。</span>
      </div>

      <footer class="text-xs text-base-content/50 font-mono pt-2">示例报告 · 数据仅供演示</footer>
    </main>

    <script src="https://r.kaiheai.com/modules/echarts/echarts@5.min.js"></script>
    <script src="https://r.kaiheai.com/modules/lucide/lucide@1.23.0.min.js"></script>
    <script>
      const trend = echarts.init(document.getElementById("trend"));
      trend.setOption({
        tooltip: { trigger: "axis" },
        grid: { left: 40, right: 16, top: 24, bottom: 28 },
        xAxis: { type: "category", boundaryGap: false, data: ["1月","2月","3月","4月","5月","6月"] },
        yAxis: { type: "value", axisLabel: { formatter: "{value}万" } },
        series: [{ name: "营收", type: "line", smooth: true, areaStyle: { opacity: 0.15 }, lineStyle: { width: 3 }, data: [118, 132, 126, 145, 158, 185] }],
        color: ["#3b82f6"],
      });
      const mix = echarts.init(document.getElementById("mix"));
      mix.setOption({
        tooltip: { trigger: "item" },
        legend: { bottom: 0 },
        series: [{ type: "pie", radius: ["45%","70%"], avoidLabelOverlap: true, itemStyle: { borderColor: "#fff", borderWidth: 2 },
          label: { show: false }, data: [
            { value: 50, name: "核心产品" }, { value: 25, name: "增值服务" }, { value: 15, name: "配件耗材" }, { value: 10, name: "其它" },
          ] }],
        color: ["#3b82f6","#22c55e","#f59e0b","#a78bfa"],
      });
      addEventListener("resize", () => { trend.resize(); mix.resize(); });
      lucide.createIcons();
    </script>
  </body>
</html>
```
