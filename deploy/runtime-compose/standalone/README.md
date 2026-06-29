# 全内置运行时模板

面向 **共享部署环境** 的自包含样本：ai-center + MySQL + Redis + Qdrant 同栈启动。OTel Collector 通过 `--profile otel` 可选追加。

> MySQL 样本 DDL 复用 `deploy/docker-compose/mysql/init/`（仅数据卷为空时执行）。权威定义仍以领域迁移体系为准。

## 前置

推送 **发布镜像**（与 external 模板相同）：

```bash
bun run build:image:push
```

准备 MCP 配置（可选）：

```bash
cp config/mcp-servers.example.json config/mcp-servers.json
```

## 快速启动

```bash
cd deploy/runtime-compose/standalone
cp .env.example .env
# 编辑 AI_CENTER_IMAGE=<registry>/cube-ai-center:<sha7>

docker compose up -d
docker compose logs -f ai-center
```

## 可选：启用 OTel Collector

```bash
# .env 中设：
# OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318

docker compose --profile otel up -d
docker compose logs -f otel-collector
```

## 冒烟验证

```bash
bash ../../scripts/verify-ai-center-http.sh "http://127.0.0.1:${AI_CENTER_HOST_PORT:-3000}"
```

## 目录结构

```
standalone/
├── docker-compose.yaml
├── .env.example
├── README.md
└── otel/
    └── otel-collector.yaml   # --profile otel
```

MySQL init SQL 不重复存放，compose 挂载 `../../docker-compose/mysql/init/`。

## 默认行为

| 项       | 值                                                     |
| -------- | ------------------------------------------------------ |
| 鉴权     | 示例默认 mock；共享部署配 `JWT_KEY_URL`                |
| LLM      | **agentic-platform-llm-catalog**（同库 MySQL）         |
| 进程模型 | 单进程 ai-center                                       |
| OTel     | 默认关闭；`--profile otel` 启用本地 collector          |
| 镜像     | pull `AI_CENTER_IMAGE` 发布 tag，不在 compose 内 build |

## 维护

```bash
# 清数据卷重来（会重跑 mysql/init）
docker compose down -v
docker compose up -d
```

## 相关文档

- [外置依赖模板](../external/README.md)
- [运行时模板索引](../README.md)
