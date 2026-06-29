# 共享部署运行时模板

两套面向 **共享部署环境** 的 docker compose 样本（非本地 dev profile 栈）：

| 模板                   | 路径                           | 说明                                                           |
| ---------------------- | ------------------------------ | -------------------------------------------------------------- |
| **外置依赖运行时模板** | [`external/`](./external/)     | 仅 ai-center；MySQL / Redis / Qdrant 等通过 `.env` 连外部服务  |
| **全内置运行时模板**   | [`standalone/`](./standalone/) | ai-center + MySQL + Redis + Qdrant；OTel 可选 `--profile otel` |

本地开发 / 集成测试仍用 [`deploy/docker-compose/`](../docker-compose/)。

发布镜像构建见仓库根 [`scripts/build-image.sh`](../../scripts/build-image.sh)。

---

## 首次共享部署验收清单

按顺序勾选。external / standalone **共用前 6 步**；第 7 步起按所选模板分支。

### 共用（构建与配置）

- [ ] **1. 构建发布镜像** — 仓库根执行 `bun run build:image`（本地 load）或 `bun run build:image:push`（多架构 push）。目标 **`runtime-binary`**；**不要**用 `runtime-binary-prebuilt` 或 dev compose build 作为共享部署输入。
- [ ] **2. 镜像 tag 可追溯** — push 使用 git 短 SHA tag；`latest` 仅通过 `--extra-tag` 显式追加；dirty 工作区 push 需 `--allow-dirty`。
- [ ] **3. 选定模板** — 仅 ai-center + 外部依赖 → [`external/`](./external/)；需要内置 MySQL/Redis/Qdrant 样本 → [`standalone/`](./standalone/)。
- [ ] **4. 准备 `.env`** — `cp .env.example .env`；`AI_CENTER_IMAGE=<registry>/cube-ai-center:<sha7>` 指向**已推送**的发布镜像（运行时模板 **仅 pull**，不在 compose 内 build）。
- [ ] **5. Descriptor 配置包** — 配置 `DESCRIPTORS_DIR` / `CONFIG_DIR` / `GLOBAL_PROMPT_FILE` 挂载路径（默认相对 monorepo；生产环境指向独立发布的配置包目录，不 bake 进镜像）。
- [ ] **6. MCP 配置** — `cp config/mcp-servers.example.json config/mcp-servers.json`（或生产等价物），确保 compose 挂载的 `config/` 目录存在。

### 外置依赖（[`external/`](./external/)）

- [ ] **7a. 外部依赖连通** — `.env` 填外部 MySQL / Redis / Qdrant 地址与凭证；schema 已在外部库就绪（样本 DDL 见 `deploy/docker-compose/mysql/init/`）。
- [ ] **7b. 可选 Nacos** — 需要 descriptor / secret 从 Nacos 拉取时填 `NACOS_ADDRESS`；默认纯 env。
- [ ] **8a. 启动** — `cd deploy/runtime-compose/external && docker compose up -d`。

### 全内置（[`standalone/`](./standalone/)）

- [ ] **7c. 内置依赖** — `docker compose up -d` 会起 mysql / redis / qdrant + ai-center；首次 mysql 卷为空时会跑 `deploy/docker-compose/mysql/init/` 样本 DDL。
- [ ] **7d. OTel（可选）** — 需要本地 collector 时：`docker compose --profile otel up -d`，并在 `.env` 设 `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318`。
- [ ] **8b. 启动** — `cd deploy/runtime-compose/standalone && docker compose up -d`。

### 共用（鉴权、LLM、验收）

- [ ] **9. 鉴权** — 共享部署默认 **ghcloud 身份**（`JWT_KEY_URL`）；本地冒烟可临时 `USE_GHCLOUD_IDENTITY=0` + `AGENTIC_ENGINE_AUTH_MODE=mock`（见各模板 README）。
- [ ] **10. LLM** — 默认 **`agentic-platform-llm-catalog`**（catalog 与 engine/flow/kb 同库 MySQL）；`noop` 仅用于 health 骨架验证。
- [ ] **11. HTTP 冒烟** — `bash deploy/scripts/verify-ai-center-http.sh http://127.0.0.1:${AI_CENTER_HOST_PORT:-3000}`（mock 鉴权时见脚本注释）。
- [ ] **12. 健康** — `curl http://<host>:<AI_CENTER_HOST_PORT>/health/live` 返回 UP；`/health/ready` 依赖项均为 UP。

### 不应出现的情况

- [ ] 未 push 的本地 build / prebuilt 二进制当作共享环境镜像
- [ ] 默认 `latest` tag 且无 SHA 追溯
- [ ] 生产 compose 长期保持 `USE_GHCLOUD_IDENTITY=0` + mock 鉴权
- [ ] `AGENTIC_ENGINE_PROVIDER=noop` 却期望真实对话 Turn

---

## 与 agentic-engine 运行时模板的差异

| 维度            | cube-ai-project                | cube-agentic-engine      |
| --------------- | ------------------------------ | ------------------------ |
| 服务名          | `ai-center`                    | `engine`                 |
| 默认端口        | 3000                           | 8080                     |
| 镜像名          | `cube-ai-center`               | `cube-agentic-engine`    |
| 拓扑            | 单进程 agent + flow + kb + llm | 仅 engine；平台 API 外置 |
| 鉴权            | ghcloud JWT（`JWT_KEY_URL`）   | OAuth2 introspection     |
| standalone 内置 | MySQL + Redis + Qdrant         | + Nacos（需 seed）       |
