# 外置依赖运行时模板

面向 **共享部署环境** 的最小样本：只运行 ai-center 容器，MySQL / Redis / Qdrant 等依赖通过 `.env` 指向外部已有服务。

与 `deploy/docker-compose/`（本地 dev/test profile 栈）分离；本目录样本消费 **发布镜像**，不在 compose 内 build。

## 前置

1. 推送发布镜像：

```bash
# 仓库根
bun run build:image:push
# 或指定 registry / tag
REGISTRY=nexus.guhecloud.com:5001/cube-ai-project TAG=<sha7> bash scripts/build-image.sh --push
```

2. 外部 MySQL 已具备 schema（样本 DDL 见 `deploy/docker-compose/mysql/init/`）。

3. 准备 MCP 配置（若使用外部 MCP 工具）：

```bash
cp config/mcp-servers.example.json config/mcp-servers.json
```

## 快速启动

```bash
cd deploy/runtime-compose/external
cp .env.example .env
# 编辑 AI_CENTER_IMAGE、MYSQL_*、REDIS_URL、QDRANT_URL

docker compose up -d
docker compose logs -f ai-center
```

## 冒烟验证

默认 `.env.example` 使用 mock 鉴权（`USE_GHCLOUD_IDENTITY=0` + `AGENTIC_ENGINE_AUTH_MODE=mock`），可直接：

```bash
bash ../../scripts/verify-ai-center-http.sh "http://127.0.0.1:${AI_CENTER_HOST_PORT:-3000}"
```

共享部署切回 ghcloud 身份时，在 `.env` 设 `USE_GHCLOUD_IDENTITY=1`（或删除 `=0`）并填 `JWT_KEY_URL`，同时去掉 mock 鉴权。

## 配置说明

| 项              | 默认                             | 说明                                                                |
| --------------- | -------------------------------- | ------------------------------------------------------------------- |
| 鉴权            | mock（示例）                     | 共享部署应配 `JWT_KEY_URL`；mock 仅用于冒烟                         |
| LLM             | **agentic-platform-llm-catalog** | catalog 数据在 MySQL `cube_ai_center` 库                            |
| 配置源          | 纯 env                           | 可选 `NACOS_ADDRESS` 做 descriptor 发现                             |
| 进程模型        | 单进程                           | agent + flow + kb + llm 同容器                                      |
| 镜像来源        | `AI_CENTER_IMAGE`                | 必须指向已推送的 **发布镜像** tag                                   |
| Descriptor 挂载 | `../../../descriptors`           | 可通过 `DESCRIPTORS_DIR` / `CONFIG_DIR` / `GLOBAL_PROMPT_FILE` 覆盖 |

## 与本地 dev compose 的差异

| 维度      | 本模板                 | `deploy/docker-compose/`         |
| --------- | ---------------------- | -------------------------------- |
| 用途      | 共享部署环境样本       | 本地 dev / 集成测试              |
| 依赖      | 全部外部               | 可选 `--profile deps` 起本地容器 |
| 镜像      | pull 发布镜像          | 默认 compose build               |
| Flow 数据 | 发布镜像内 `/app/data` | dev 可挂载覆盖                   |

## 相关文档

- [运行时模板索引](../README.md)
- [本地 dev compose](../../docker-compose/README.md)
