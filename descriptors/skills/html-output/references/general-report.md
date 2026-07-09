# 示例：普通/通用报告（基线 quickstart）

**适用场景**：一般图文报告——概述 + 几组 KPI + 分区块内容 + 表格 + 结论。**依赖最小**（只 Tailwind + daisyUI + Lucide，无图表/交互），是所有报告的起点骨架；需要图表再按 `cdn-catalog.md` 加 ECharts、需要折叠再加 Alpine。

**版式要点**：header hero → daisyUI `stats` 一排 KPI → `card` 区块（正文 + 要点）→ `table` → 结论 `alert` → footer。主题 `corporate`。

```html-output
<!doctype html>
<html lang="zh-CN" data-theme="corporate">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>月度运营情况报告</title>
    <link rel="stylesheet" href="https://r.kaiheai.com/modules/daisyui/full@4.12.24.min.css" />
    <script src="https://r.kaiheai.com/modules/tailwindcss/3.4.17.js"></script>
  </head>
  <body class="min-h-screen bg-base-200 text-base-content">
    <main class="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <header class="space-y-2 pb-4 border-b border-base-300">
        <p class="text-sm text-base-content/60 flex items-center gap-2"><i data-lucide="file-text" class="w-4 h-4"></i>运营中心 · 月报</p>
        <h1 class="text-3xl font-bold tracking-tight">月度运营情况报告</h1>
        <p class="text-sm text-base-content/60 font-mono">2026-06-01 ~ 2026-06-30 · 示例数据</p>
      </header>

      <div class="stats shadow w-full">
        <div class="stat">
          <div class="stat-title">工单总量</div>
          <div class="stat-value text-primary">3,428</div>
          <div class="stat-desc text-success">较上月 +12.4%</div>
        </div>
        <div class="stat">
          <div class="stat-title">按时完成率</div>
          <div class="stat-value">91.7%</div>
          <div class="stat-desc text-success">+2.1pp</div>
        </div>
        <div class="stat">
          <div class="stat-title">平均响应时长</div>
          <div class="stat-value">18<span class="text-lg">min</span></div>
          <div class="stat-desc text-error">+3min</div>
        </div>
      </div>

      <section class="card bg-base-100 shadow-sm">
        <div class="card-body space-y-3">
          <h2 class="card-title text-lg"><i data-lucide="clipboard-list" class="w-5 h-5 text-primary"></i>本月概述</h2>
          <p class="text-sm leading-relaxed text-base-content/80">本月整体运营平稳，工单量环比上升，主要由夜间时段增量贡献。按时完成率稳中有升，但平均响应时长受高峰并发影响略有延长，需在下月优先优化。</p>
          <ul class="text-sm space-y-1.5">
            <li class="flex items-start gap-2"><i data-lucide="check" class="w-4 h-4 text-success mt-0.5"></i>东区完成率领先，达 96.3%。</li>
            <li class="flex items-start gap-2"><i data-lucide="check" class="w-4 h-4 text-success mt-0.5"></i>自动派单覆盖率提升至 78%。</li>
            <li class="flex items-start gap-2"><i data-lucide="triangle-alert" class="w-4 h-4 text-warning mt-0.5"></i>高峰时段响应时长超阈值，集中在 20:00–22:00。</li>
          </ul>
        </div>
      </section>

      <section class="card bg-base-100 shadow-sm">
        <div class="card-body space-y-3">
          <h2 class="card-title text-lg"><i data-lucide="table" class="w-5 h-5 text-primary"></i>分区运营明细</h2>
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead><tr><th>区域</th><th>工单量</th><th>完成率</th><th>平均响应</th></tr></thead>
              <tbody>
                <tr><td>东区</td><td>1,024</td><td class="text-success">96.3%</td><td>14 min</td></tr>
                <tr><td>西区</td><td>886</td><td>90.1%</td><td>19 min</td></tr>
                <tr><td>南区</td><td>792</td><td class="text-warning">86.7%</td><td>22 min</td></tr>
                <tr><td>北区</td><td>726</td><td>92.5%</td><td>17 min</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div class="alert alert-info">
        <i data-lucide="info" class="w-5 h-5"></i>
        <span><span class="font-semibold">结论：</span>下月重点优化高峰时段并发调度与南区响应时长，目标平均响应回落至 16 min 以内。</span>
      </div>

      <footer class="text-xs text-base-content/50 font-mono pt-2">示例报告 · 数据仅供演示</footer>
    </main>

    <script src="https://r.kaiheai.com/modules/lucide/lucide@1.23.0.min.js"></script>
    <script>lucide.createIcons();</script>
  </body>
</html>
```
