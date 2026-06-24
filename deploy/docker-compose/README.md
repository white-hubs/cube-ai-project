# deploy/docker-compose

本地开发依赖栈（MySQL · Redis · Qdrant），对齐 ADR-0009 单进程 ai-center 拓扑。

## 最常用：仅起依赖，ai-center 在 host 跑

```bash
cp .env.example .env
docker compose --profile deps up -d
cd ../../apps/ai-center && bun run dev
```

## 可选：容器内跑 ai-center

```bash
# 仓库根
bun run dev:up
```

## 预编译二进制形态（对齐 cube-agentic-engine `dev:up:prebuilt`）

宿主机 `bun build --compile` 产出 `dist/ai-center`，容器仅 COPY 二进制。

> **说明**：预编译形态下 flow / kb / agent-engine 均直连 compose MySQL（库 `cube_ai_center`）。
> flow 与 kb 经静态导入的 `mysql2/promise` 适配器初始化，避开 compiled Bun executable 中
> `@dangao/bun-server` 动态 `createRequire('mysql2/promise')` 解析问题（ADR-0013）。

```bash
bun run dev:up:prebuilt
curl -fsS http://localhost:3000/health/live
```

单独编译二进制（默认按 Docker/宿主机架构自动选择 `linux-x64` 或 `linux-arm64`）：

```bash
bun run build:host-binary
# 显式指定（例如 Apple Silicon 上强制 amd64 容器）：
bun run build:host-binary:x64
TARGET_ARCH=linux-arm64 bun run build:host-binary
```

## Testcontainers E2E

```bash
bun run test:containers          # 全部 *.testcontainers.test.ts
bun run test:integration         # mysql-redis-qdrant 冒烟
bun run test:containers:ollama   # 需 RUN_OLLAMA_E2E，首拉极慢
bun run test:containers:cleanup  # 手动清理孤儿（`test:containers` 退出时也会自动 sweep）
```

`test:containers` 在子进程退出后会**自动兜底清理**仍带 `org.testcontainers` 标签的容器。中断请用 **Ctrl+C**（SIGINT），勿 `kill -9`。

## Profiles

| Profile | 服务 |
|---------|------|
| `deps` | mysql, redis, qdrant |
| `ai-center` | ai-center 应用容器（源码形态） |
| `ai-center-prebuilt` | ai-center 预编译二进制容器 |
