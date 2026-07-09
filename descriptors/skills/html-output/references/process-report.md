# 示例：流程/DAG 报告（X6）

**适用场景**：流程编排、状态流转、DAG、审批链——用带箭头的节点-连线表达「步骤 + 分支」，配说明。

**版式要点**：header → daisyUI `stats` → `card` 内 X6 流程图（容器**固定高度**）+ 阶段图例 → 说明 `alert`。主题 `corporate`。依赖：Tailwind+daisyUI+X6+Lucide。

**X6 v3 关键**：UMD 全局 `X6`，`const { Graph } = X6`；`new Graph({ container, width, height, interacting:false, background, grid })` → `graph.fromJSON({ nodes, edges })` → `graph.zoomToFit({ padding, maxScale:1 })`。节点用 `x/y/width/height/label/attrs`，边用 `source/target/labels/attrs.line/router/connector`。静态展示关掉 `interacting`。

> **⚠️ 禁用 `autoResize: true`**：它的 sizeSensor 会「测容器高→写回容器内联高→铺满新高→再测更高」形成放大回环，把页面撑到无限滚动。做法：容器给**内联固定高度 + `overflow-hidden`**，构造时一次性 `width/height` 读容器，`resize` 只挂窗口事件手动调。G6/ECharts 同理。

```html-output
<!doctype html>
<html lang="zh-CN" data-theme="corporate">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>告警处置流程报告</title>
    <link rel="stylesheet" href="https://r.kaiheai.com/modules/daisyui/full@4.12.24.min.css" />
    <script src="https://r.kaiheai.com/modules/tailwindcss/3.4.17.js"></script>
  </head>
  <body class="min-h-screen bg-base-200 text-base-content">
    <main class="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <header class="space-y-2 pb-4 border-b border-base-300">
        <p class="text-sm text-base-content/60 flex items-center gap-2"><i data-lucide="git-branch" class="w-4 h-4"></i>运营流程 · 编排</p>
        <h1 class="text-3xl font-bold tracking-tight">告警处置流程报告</h1>
        <p class="text-sm text-base-content/60 font-mono">2026-06-30 · 示例数据</p>
      </header>

      <div class="stats shadow w-full">
        <div class="stat"><div class="stat-title">流程节点</div><div class="stat-value text-primary">7</div></div>
        <div class="stat"><div class="stat-title">分支</div><div class="stat-value">2</div></div>
        <div class="stat"><div class="stat-title">平均闭环</div><div class="stat-value">36<span class="text-lg">min</span></div><div class="stat-desc text-success">-12%</div></div>
      </div>

      <section class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <h2 class="card-title text-base"><i data-lucide="workflow" class="w-5 h-5 text-primary"></i>处置流程</h2>
            <div class="flex flex-wrap gap-3 text-xs">
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded" style="background:#22c55e"></span>起止</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded" style="background:#3b82f6"></span>处理</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded" style="background:#f59e0b"></span>研判</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded" style="background:#ef4444"></span>告警</span>
            </div>
          </div>
          <div id="flow" class="w-full rounded-lg border border-base-200 overflow-hidden" style="height: 20rem"></div>
        </div>
      </section>

      <div class="alert alert-info">
        <i data-lucide="info" class="w-5 h-5"></i>
        <span><span class="font-semibold">说明：</span>研判命中风险即生成告警工单并推送责任人；正常则归档。两分支均汇入闭环复盘，确保处置结果可追溯。</span>
      </div>

      <footer class="text-xs text-base-content/50 font-mono pt-2">示例报告 · 数据仅供演示</footer>
    </main>

    <script src="https://r.kaiheai.com/modules/x6/index@3.js"></script>
    <script src="https://r.kaiheai.com/modules/lucide/lucide@1.23.0.min.js"></script>
    <script>
      const { Graph } = X6;
      const mk = (id, x, y, label, fill, stroke) => ({
        id, x, y, width: 120, height: 44, label,
        attrs: { body: { rx: 8, ry: 8, fill, stroke, strokeWidth: 1.5 }, label: { fill: "#0f172a", fontSize: 13 } },
      });
      const edge = (source, target, text) => ({
        source, target, router: { name: "manhattan" }, connector: { name: "rounded" },
        attrs: { line: { stroke: "#94a3b8", strokeWidth: 1.5, targetMarker: { name: "block", width: 8, height: 8 } } },
        labels: text ? [{ attrs: { label: { text, fill: "#64748b", fontSize: 12 }, body: { fill: "#f8fafc" } } }] : [],
      });

      const el = document.getElementById("flow");
      const graph = new Graph({
        container: el,
        width: el.clientWidth,
        height: el.clientHeight,
        interacting: false,
        background: { color: "transparent" },
        grid: { visible: true, type: "dot", args: { color: "#e5eaf1", thickness: 1 } },
      });
      graph.fromJSON({
        nodes: [
          mk("n1", 16, 128, "开始", "#ecfdf5", "#22c55e"),
          mk("n2", 168, 128, "数据采集", "#eff6ff", "#3b82f6"),
          mk("n3", 320, 128, "规则校验", "#eff6ff", "#3b82f6"),
          mk("n4", 472, 128, "风险研判", "#fffbeb", "#f59e0b"),
          mk("n5", 648, 56, "正常归档", "#ecfdf5", "#22c55e"),
          mk("n6", 648, 200, "告警工单", "#fef2f2", "#ef4444"),
          mk("n7", 824, 128, "闭环复盘", "#eef2ff", "#6366f1"),
        ],
        edges: [
          edge("n1", "n2"), edge("n2", "n3"), edge("n3", "n4"),
          edge("n4", "n5", "正常"), edge("n4", "n6", "异常"),
          edge("n5", "n7"), edge("n6", "n7"),
        ],
      });
      graph.zoomToFit({ padding: 20, maxScale: 1 });
      addEventListener("resize", () => graph.resize(el.clientWidth, el.clientHeight));
      lucide.createIcons();
    </script>
  </body>
</html>
```
