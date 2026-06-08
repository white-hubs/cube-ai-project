# 直连 Vendor 例外清单

> ADR-0003：尚未收口到 LLM 网关 / catalog 的已知直连 vendor 路径。禁止静默新增。

| 路径 | 原因 | 收口意图 | 状态 |
|------|------|----------|------|
| Langflow 外部运行时 | 经 `LANGFLOW_BASE_URL` 调外部 LF 服务，LF 内部直连 vendor | 长期例外；LF 作为外部依赖 | 登记 |
| flow cube-linear 节点 legacy `api_key` | 历史节点 config 内嵌 key | `LlmProviderPort` + catalog modelRef；key-override fallback 迁移完成后 sunset | 软过渡 |
| engine `AGENTIC_ENGINE_OPENAI_API_KEY` 等 env | 本地 dev / 单测 noop 路径 | catalog 权威；env 仅 dev 兜底 | dev-only |

## CI 门禁

新增直连 vendor HTTP 调用（`api.openai.com`、`dashscope.aliyuncs.com` 等）须在本表登记，或改走 `LlmProviderPort` / `/v1/*` 网关。

检查命令（人工 / CI optional）：

```bash
rg -n "api\\.openai\\.com|dashscope\\.aliyuncs\\.com|anthropic\\.com" --glob '!docs/**' --glob '!**/test-fixtures/**' packages apps infra
```
