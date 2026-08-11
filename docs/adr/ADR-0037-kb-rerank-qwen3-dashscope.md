# ADR-0037: KB 文本精排采用 DashScope qwen3-rerank（openai_rerank）

- **Status**: Accepted
- **Date**: 2026-08-07
- **Deciders**: 产品确认（KB/RAG remediation 交付复核 R-02）
- **Tags**: kb, llm, rerank, catalog, vendor

## Context

W2.1 原计划以 Jina（`jina_rerank`）为生产精排路径。实现前改为 DashScope OpenAI 兼容 `qwen3-rerank`（`endpoint_type=openai_rerank`，`POST {apiBase}/reranks`）。  
交付复核要求书面确认：是否接受「豆包 embedding + 阿里云 rerank」跨厂商组合（凭据仍收束于 llm-core catalog，不违反 ADR-0003）。

## Decision

1. **文本 RAG 精排生产路径** = DashScope **`qwen3-rerank`**，协议 **`openai_rerank`**。
2. Catalog 中 `jina_rerank` **不实现运行时**；调用时 fail-closed 并引导改用 `openai_rerank`。
3. Embedding 可继续使用豆包（Ark）等多模态 embedding；rerank 与 embedding **允许跨厂商**，只要双方凭据均经 llm-core catalog 解析。
4. `qwen3-vl-rerank`（多模态）仍暂缓，见计划 W4.4。
5. 检索侧默认 **`RETRIEVAL_MODEL_RERANK_ENABLED=false`**（G0-9）；开启前须 live golden on/off 依据。

## Consequences

- 运维需为百炼/DashScope 配置独立 apiKey（与豆包 embed 凭据分离）。
- W2.1 计划文件名可保留 `W2.1-jina-rerank-provider.md`，正文以本 ADR + 该文档为准。
- 若未来改回 Jina 或评估豆包/Ark rerank，须新 ADR 或修订本篇 Status。

## Options Considered

| 选项 | 结论 |
| --- | --- |
| A. DashScope qwen3-rerank（现状） | **采纳** |
| B. 恢复 Jina | 否；无现行生产依赖 |
| C. 豆包/Ark rerank | 暂不采纳；可后评估，不阻塞本路径 |
