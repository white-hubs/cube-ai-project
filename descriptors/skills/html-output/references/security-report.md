# 示例：安全分析报告（评分卡 + 层级评分树）

**适用场景**：安全生产情况、风险评分、问题清单类报告——有一个总分 + 若干评分维度（可下钻到子项/指标）+ 逐项 AI 建议。

**版式要点**：
1. 标题条：`{系统名} · {起~止} 安全生产情况报告`。
2. Hero 评分卡：左 ECharts 环形（总分）+ 中「共分析 N 项，发现 M 项问题，得分 X 分」（问题数 `text-error`、得分大号按阈值着色）+ 一行 AI 摘要 + 分析范围/时间。
3. 层级评分树：Alpine 折叠（`x-show`+`x-transition`，不用 x-collapse 插件），每行 = 状态点 + 名称 + 分数（`<60` error / `60–85` warning / `≥85` success）+ chevron；100 分带上升三角。
4. 底部「AI 建议（共 K 条）」`alert` 列表，每条粗体标签 + 说明。
5. 依赖：Tailwind+daisyUI+Alpine+Lucide+ECharts；主题 `corporate`。

```html-output
<!doctype html>
<html lang="zh-CN" data-theme="corporate">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>安全生产情况报告</title>
    <link rel="stylesheet" href="https://r.kaiheai.com/modules/daisyui/full@4.12.24.min.css" />
    <script src="https://r.kaiheai.com/modules/tailwindcss/3.4.17.js"></script>
    <script defer src="https://r.kaiheai.com/modules/alpinejs/alpinejs@3.min.js"></script>
  </head>
  <body class="min-h-screen bg-base-200 text-base-content">
    <main class="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <!-- 标题条 -->
      <header class="flex items-center gap-2 text-sm text-base-content/60">
        <i data-lucide="shield-check" class="w-4 h-4"></i>
        <span>安全指挥调度系统 · 2026-06-01 ~ 2026-06-30 安全生产情况报告</span>
      </header>

      <!-- Hero 评分卡 -->
      <section class="card bg-base-100 shadow-sm">
        <div class="card-body grid grid-cols-1 md:grid-cols-[160px_1fr] gap-6 items-center">
          <div id="scoreRing" class="w-40 h-40 mx-auto"></div>
          <div class="space-y-3">
            <p class="text-2xl font-semibold leading-relaxed">
              共分析 <span class="font-bold">49</span> 项，发现
              <span class="text-error font-bold">41</span> 项问题，分析得分
              <span class="text-error font-bold text-4xl align-middle">14.96</span> 分
            </p>
            <div class="alert alert-warning py-2 text-sm">
              <i data-lucide="sparkles" class="w-4 h-4"></i>
              <span>AI 建议：当前报警处理率偏低，需优先优化人员响应机制与任务分流；设备在线率偏低，建议排查断网问题并加强网络稳定性监控。</span>
            </div>
            <div class="flex flex-wrap gap-x-6 gap-y-1 text-xs text-base-content/60 font-mono">
              <span>分析范围：2026-06-01 ~ 2026-06-30</span>
              <span>分析时间：2026-06-30 14:25:56</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 层级评分树 -->
      <section class="card bg-base-100 shadow-sm">
        <div class="card-body p-0 divide-y divide-base-200">
          <!-- 叶子行模板：状态点 + 名称 + 分数 -->
          <div class="flex items-center justify-between px-5 py-3">
            <span class="flex items-center gap-3"><span class="w-2 h-2 rounded-full bg-error"></span>安防监控</span>
            <span class="font-semibold text-error">22.6 分</span>
          </div>
          <div class="flex items-center justify-between px-5 py-3">
            <span class="flex items-center gap-3"><span class="w-2 h-2 rounded-full bg-error"></span>电气安全</span>
            <span class="font-semibold text-error">10 分</span>
          </div>
          <div class="flex items-center justify-between px-5 py-3">
            <span class="flex items-center gap-3"><span class="w-2 h-2 rounded-full bg-success"></span>电动车安全</span>
            <span class="font-semibold text-success flex items-center gap-1"><i data-lucide="trending-up" class="w-4 h-4"></i>100 分</span>
          </div>
          <div class="flex items-center justify-between px-5 py-3">
            <span class="flex items-center gap-3"><span class="w-2 h-2 rounded-full bg-error"></span>日常巡检</span>
            <span class="font-semibold text-error">0.51 分</span>
          </div>

          <!-- 可下钻：消防安全 → 水压报警 / 手报 → 手报处理 / 处理效率 -->
          <div x-data="{ open: true }">
            <button @click="open = !open" class="w-full flex items-center justify-between px-5 py-3 hover:bg-base-200/60">
              <span class="flex items-center gap-3"><span class="w-2 h-2 rounded-full bg-error"></span>消防安全</span>
              <span class="flex items-center gap-3">
                <span class="font-semibold text-error">0 分</span>
                <i data-lucide="chevron-down" class="w-4 h-4 transition-transform" :class="open && 'rotate-180'"></i>
              </span>
            </button>
            <div x-show="open" x-transition class="divide-y divide-base-200 bg-base-200/30">
              <div class="flex items-center justify-between pl-11 pr-5 py-2.5 text-sm">
                <span class="flex items-center gap-3"><span class="w-1.5 h-1.5 rounded-full bg-error/70"></span>水压报警</span>
                <span class="font-semibold text-error">0 分</span>
              </div>
              <div x-data="{ open2: true }">
                <button @click="open2 = !open2" class="w-full flex items-center justify-between pl-11 pr-5 py-2.5 text-sm hover:bg-base-200/60">
                  <span class="flex items-center gap-3"><span class="w-1.5 h-1.5 rounded-full bg-error/70"></span>手报</span>
                  <span class="flex items-center gap-2">
                    <span class="font-semibold text-error">0 分</span>
                    <i data-lucide="chevron-down" class="w-3.5 h-3.5 transition-transform" :class="open2 && 'rotate-180'"></i>
                  </span>
                </button>
                <div x-show="open2" x-transition class="text-sm">
                  <div class="flex items-center justify-between pl-16 pr-5 py-2 text-base-content/70">
                    <span class="badge badge-ghost badge-sm">手报处理</span><span class="font-medium text-error">0 分</span>
                  </div>
                  <div class="flex items-center justify-between pl-16 pr-5 py-2 text-base-content/70">
                    <span class="badge badge-ghost badge-sm">处理效率</span><span class="font-medium text-error">0 分</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- AI 建议面板 -->
      <section class="card bg-base-100 shadow-sm">
        <div class="card-body space-y-3">
          <h2 class="card-title text-base"><i data-lucide="lightbulb" class="w-5 h-5 text-warning"></i>AI 建议（共 4 条）</h2>
          <div class="space-y-2 text-sm">
            <div class="alert bg-info/10 border-info/20 py-2 block">
              <span class="font-semibold text-info">水压处理率：</span>报警处理率为 0%，需优先排查处置流程是否缺失或未闭环，建议明确分级响应机制，确保告警及时推送至责任人并跟踪处置结果。
            </div>
            <div class="alert bg-info/10 border-info/20 py-2 block">
              <span class="font-semibold text-info">水压处理效率：</span>处理率为 0，建议重点优化响应流程，缩短维保周期，并提升自动调节系统协同效率。
            </div>
            <div class="alert bg-info/10 border-info/20 py-2 block">
              <span class="font-semibold text-info">安防监控：</span>在线率偏低，建议排查设备网络连通性与断网告警，加强稳定性监控。
            </div>
            <div class="alert bg-info/10 border-info/20 py-2 block">
              <span class="font-semibold text-info">日常巡检：</span>完成率偏低，建议优化人员响应机制与任务分流，压实责任到人。
            </div>
          </div>
        </div>
      </section>

      <footer class="text-xs text-base-content/50 font-mono pt-2">示例报告 · 数据仅供演示</footer>
    </main>

    <script src="https://r.kaiheai.com/modules/echarts/echarts@5.min.js"></script>
    <script src="https://r.kaiheai.com/modules/lucide/lucide@1.23.0.min.js"></script>
    <script>
      const ring = echarts.init(document.getElementById("scoreRing"));
      ring.setOption({
        series: [{
          type: "gauge", startAngle: 90, endAngle: -270, radius: "100%",
          pointer: { show: false }, anchor: { show: false }, splitLine: { show: false },
          axisTick: { show: false }, axisLabel: { show: false },
          axisLine: { lineStyle: { width: 14, color: [[1, "#fee2e2"]] } },
          progress: { show: true, width: 14, roundCap: true, itemStyle: { color: "#ef4444" } },
          detail: { valueAnimation: true, fontSize: 26, fontWeight: "bold", color: "#ef4444", offsetCenter: [0, 0], formatter: "{value}" },
          data: [{ value: 14.96 }], min: 0, max: 100,
        }],
      });
      addEventListener("resize", () => ring.resize());
      lucide.createIcons();
    </script>
  </body>
</html>
```
