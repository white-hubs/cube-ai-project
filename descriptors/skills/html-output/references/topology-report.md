# 示例：拓扑/关系报告（G6）

**适用场景**：资产拓扑、攻击链、组织/关系网络——用节点-连线图表达实体间关系，配一段研判说明。

**版式要点**：header → daisyUI `stats` 概览 → `card` 内 G6 关系图（容器**固定高度**）+ 分类图例 → 研判 `alert`。主题 `corporate`。依赖：Tailwind+daisyUI+G6+Lucide。

**G6 v5 关键**：UMD 全局 `G6`，`const { Graph } = G6`；节点标签用 `labelText`、颜色用 `style.fill`（可传函数按 `d.data` 取色）；`layout:{type:'d3-force'}`；`behaviors:['drag-canvas','zoom-canvas']`；最后 `graph.render()`。

> **⚠️ 禁用 `autoResize: true`**：与 X6 同理，其容器监听会形成「测高→写高→再测更高」的放大回环，把页面撑到无限滚动。做法：容器给**内联固定高度 + `overflow-hidden`**，构造时一次性 `width/height` 读容器，`autoFit:"view"` 负责内容自适配，`resize` 只挂窗口事件手动 `setSize`。

```html-output
<!doctype html>
<html lang="zh-CN" data-theme="corporate">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>资产拓扑与风险关系报告</title>
    <link rel="stylesheet" href="https://r.kaiheai.com/modules/daisyui/full@4.12.24.min.css" />
    <script src="https://r.kaiheai.com/modules/tailwindcss/3.4.17.js"></script>
  </head>
  <body class="min-h-screen bg-base-200 text-base-content">
    <main class="max-w-5xl mx-auto px-6 py-10 space-y-6">
      <header class="space-y-2 pb-4 border-b border-base-300">
        <p class="text-sm text-base-content/60 flex items-center gap-2"><i data-lucide="network" class="w-4 h-4"></i>网络安全 · 拓扑分析</p>
        <h1 class="text-3xl font-bold tracking-tight">资产拓扑与风险关系报告</h1>
        <p class="text-sm text-base-content/60 font-mono">2026-06-30 · 示例数据</p>
      </header>

      <div class="stats shadow w-full">
        <div class="stat"><div class="stat-title">纳管资产</div><div class="stat-value text-primary">7</div></div>
        <div class="stat"><div class="stat-title">连接关系</div><div class="stat-value">6</div></div>
        <div class="stat"><div class="stat-title">风险节点</div><div class="stat-value text-error">1</div><div class="stat-desc text-error">可疑外联</div></div>
      </div>

      <section class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <div class="flex items-center justify-between flex-wrap gap-2">
            <h2 class="card-title text-base"><i data-lucide="share-2" class="w-5 h-5 text-primary"></i>拓扑关系图</h2>
            <div class="flex flex-wrap gap-3 text-xs">
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full" style="background:#3b82f6"></span>核心</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full" style="background:#22c55e"></span>服务器</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full" style="background:#6366f1"></span>安全设备</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full" style="background:#94a3b8"></span>终端</span>
              <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-full" style="background:#ef4444"></span>风险</span>
            </div>
          </div>
          <div id="topo" class="w-full rounded-lg border border-base-200 overflow-hidden" style="height: 24rem"></div>
        </div>
      </section>

      <div class="alert alert-error">
        <i data-lucide="triangle-alert" class="w-5 h-5"></i>
        <span><span class="font-semibold">研判：</span>「终端 A」与外部「可疑外联 IP」存在连接，疑似 C2 外联；建议隔离该终端、阻断外联并溯源横向移动路径。</span>
      </div>

      <footer class="text-xs text-base-content/50 font-mono pt-2">示例报告 · 数据仅供演示</footer>
    </main>

    <script src="https://r.kaiheai.com/modules/g6/g6@5.min.js"></script>
    <script src="https://r.kaiheai.com/modules/lucide/lucide@1.23.0.min.js"></script>
    <script>
      const catColor = { core: "#3b82f6", server: "#22c55e", security: "#6366f1", endpoint: "#94a3b8", risk: "#ef4444" };
      const { Graph } = G6;
      const el = document.getElementById("topo");
      const graph = new Graph({
        container: el,
        width: el.clientWidth,
        height: el.clientHeight,
        autoFit: "view",
        data: {
          nodes: [
            { id: "边界防火墙", data: { cat: "security" } },
            { id: "核心交换机", data: { cat: "core" } },
            { id: "Web 服务器", data: { cat: "server" } },
            { id: "DB 服务器", data: { cat: "server" } },
            { id: "终端 A", data: { cat: "endpoint" } },
            { id: "终端 B", data: { cat: "endpoint" } },
            { id: "可疑外联 IP", data: { cat: "risk" } },
          ],
          edges: [
            { source: "边界防火墙", target: "核心交换机" },
            { source: "核心交换机", target: "Web 服务器" },
            { source: "核心交换机", target: "DB 服务器" },
            { source: "核心交换机", target: "终端 A" },
            { source: "核心交换机", target: "终端 B" },
            { source: "终端 A", target: "可疑外联 IP" },
          ],
        },
        node: {
          style: {
            size: 40,
            fill: (d) => catColor[d.data.cat] ?? "#94a3b8",
            stroke: "#ffffff",
            lineWidth: 2,
            labelText: (d) => d.id,
            labelPlacement: "bottom",
            labelFill: "#334155",
            labelFontSize: 11,
          },
        },
        edge: {
          style: { stroke: (d) => (d.target === "可疑外联 IP" ? "#ef4444" : "#cbd5e1"), lineWidth: (d) => (d.target === "可疑外联 IP" ? 2 : 1), endArrow: true },
        },
        layout: { type: "d3-force", link: { distance: 110 }, collide: { radius: 40 } },
        behaviors: ["drag-canvas", "zoom-canvas", "drag-element"],
      });
      graph.render();
      addEventListener("resize", () => graph.setSize(el.clientWidth, el.clientHeight));
      lucide.createIcons();
    </script>
  </body>
</html>
```
