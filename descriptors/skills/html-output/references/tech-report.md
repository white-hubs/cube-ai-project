# 示例：技术审计报告（代码 + 架构图）

**适用场景**：代码审计、架构评审、API/技术文档——含**代码块**（highlight.js）+ **架构/调用链图**（Mermaid）+ 问题清单。

**版式要点**：header → daisyUI `stats` → Mermaid 架构图 → 问题清单 `table` → 代码反例（highlight.js 高亮）+ 修复说明 → 结论 `alert`。主题 `corporate`。

**关联资源要点**：highlight.js 需**三件套**——核心 `highlight@11` + 主题 `default@11.css` + 语言包 `go@11`；末尾 `hljs.highlightAll()`。Mermaid 用 ESM `import`。

```html-output
<!doctype html>
<html lang="zh-CN" data-theme="corporate">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>服务端代码审计报告</title>
    <link rel="stylesheet" href="https://r.kaiheai.com/modules/daisyui/full@4.12.24.min.css" />
    <link rel="stylesheet" href="https://r.kaiheai.com/modules/highlightjs/default@11.11.1.min.css" />
    <script src="https://r.kaiheai.com/modules/tailwindcss/3.4.17.js"></script>
  </head>
  <body class="min-h-screen bg-base-200 text-base-content">
    <main class="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <header class="space-y-2 pb-4 border-b border-base-300">
        <p class="text-sm text-base-content/60 flex items-center gap-2"><i data-lucide="file-code-2" class="w-4 h-4"></i>研发质量 · 代码审计</p>
        <h1 class="text-3xl font-bold tracking-tight">服务端代码审计报告</h1>
        <p class="text-sm text-base-content/60 font-mono">仓库 order-service@main · 2026-06-30 · 示例数据</p>
      </header>

      <div class="stats shadow w-full">
        <div class="stat"><div class="stat-title">扫描文件</div><div class="stat-value text-primary">312</div></div>
        <div class="stat"><div class="stat-title">发现问题</div><div class="stat-value text-warning">17</div></div>
        <div class="stat"><div class="stat-title">严重项</div><div class="stat-value text-error">3</div><div class="stat-desc text-error">需立即修复</div></div>
      </div>

      <section class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <h2 class="card-title text-base"><i data-lucide="workflow" class="w-5 h-5 text-primary"></i>服务架构</h2>
          <pre class="mermaid flex justify-center">
flowchart LR
  C[客户端] -->|HTTPS| G[API 网关]
  G --> A[鉴权服务]
  G --> O[订单服务]
  O --> DB[(MySQL)]
  O --> R[(Redis)]
  O --> MQ[[Kafka]]
          </pre>
        </div>
      </section>

      <section class="card bg-base-100 shadow-sm">
        <div class="card-body">
          <h2 class="card-title text-base"><i data-lucide="list-checks" class="w-5 h-5 text-primary"></i>问题清单</h2>
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead><tr><th>级别</th><th>类型</th><th>位置</th><th>说明</th></tr></thead>
              <tbody>
                <tr><td><span class="badge badge-error badge-sm">严重</span></td><td>SQL 注入</td><td>user_repo.go:42</td><td>字符串拼接查询</td></tr>
                <tr><td><span class="badge badge-warning badge-sm">中</span></td><td>错误未处理</td><td>order_svc.go:88</td><td>忽略 err 返回</td></tr>
                <tr><td><span class="badge badge-ghost badge-sm">低</span></td><td>魔法数字</td><td>pricing.go:15</td><td>硬编码阈值</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section class="card bg-base-100 shadow-sm">
        <div class="card-body space-y-3">
          <h2 class="card-title text-base"><i data-lucide="bug" class="w-5 h-5 text-error"></i>严重项 · SQL 注入（user_repo.go:42）</h2>
          <div class="rounded-lg overflow-hidden border border-base-200">
            <pre><code class="language-go">func GetUser(db *sql.DB, id string) (*User, error) {
    // 反例：拼接字符串导致 SQL 注入
    row := db.QueryRow("SELECT name FROM users WHERE id = " + id)
    var u User
    if err := row.Scan(&u.Name); err != nil {
        return nil, err
    }
    return &u, nil
}</code></pre>
          </div>
          <div class="alert alert-success">
            <i data-lucide="check-check" class="w-5 h-5"></i>
            <span><span class="font-semibold">修复：</span>改用参数化查询 <code class="px-1 rounded bg-base-200">db.QueryRow("SELECT name FROM users WHERE id = ?", id)</code>，并对 <code class="px-1 rounded bg-base-200">id</code> 做类型校验。</span>
          </div>
        </div>
      </section>

      <footer class="text-xs text-base-content/50 font-mono pt-2">示例报告 · 数据仅供演示</footer>
    </main>

    <script type="module">
      import mermaid from "https://r.kaiheai.com/modules/mermaid/mermaid@11.esm.min.mjs";
      mermaid.initialize({ startOnLoad: true, theme: "neutral", securityLevel: "loose" });
    </script>
    <script src="https://r.kaiheai.com/modules/highlightjs/highlight@11.11.1.min.js"></script>
    <script src="https://r.kaiheai.com/modules/highlightjs/go@11.11.1.min.js"></script>
    <script src="https://r.kaiheai.com/modules/lucide/lucide@1.23.0.min.js"></script>
    <script>
      hljs.highlightAll();
      lucide.createIcons();
    </script>
  </body>
</html>
```
