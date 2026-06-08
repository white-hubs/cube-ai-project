#!/usr/bin/env bash
# scripts/build-host-binary.sh — 宿主机 cross-compile ai-center 二进制
#
# 设计目的：
#   在 HOST 上 `bun build --compile` 一次性 bundle 全图（含 workspace + @tachu/*），
#   再让容器 stage `runtime-binary-prebuilt` 直接 COPY 编译产物，跳过容器内 bun install。
#
# 产物：dist/ai-center（默认 linux/arm64，匹配 macOS M-series Docker Desktop）
#
# 用法：
#   scripts/build-host-binary.sh                   # 默认 linux-arm64
#   scripts/build-host-binary.sh --target=linux-x64
#   TARGET_ARCH=linux-x64 scripts/build-host-binary.sh
#   scripts/build-host-binary.sh --debug           # 不 minify，便于排障
#
# 完成后：
#   bun run dev:up:prebuilt

set -euo pipefail

TARGET_ARCH="${TARGET_ARCH:-linux-arm64}"
MINIFY=1
SOURCEMAP="inline"

for arg in "$@"; do
  case "$arg" in
  --target=*) TARGET_ARCH="${arg#--target=}" ;;
  --target-linux-arm64) TARGET_ARCH="linux-arm64" ;;
  --target-linux-x64) TARGET_ARCH="linux-x64" ;;
  --debug)
    MINIFY=0
    SOURCEMAP="linked"
    ;;
  -h | --help)
    sed -n '2,22p' "$0"
    exit 0
    ;;
  *)
    echo "unknown arg: $arg" >&2
    exit 1
    ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

OUT_DIR="$REPO_ROOT/dist"
OUT_FILE="$OUT_DIR/ai-center"
ENTRY="apps/ai-center/src/main.ts"

# ── 前置检查：依赖已安装 ────────────────────────────────────────────────────
if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
  echo "[fatal] node_modules 缺失，请先在仓库根执行：bun install" >&2
  exit 1
fi

TACHU_PKG="$REPO_ROOT/packages/agent/engine/node_modules/@tachu/core"
if [[ ! -d "$TACHU_PKG" ]]; then
  TACHU_PKG="$REPO_ROOT/node_modules/@tachu/core"
fi
if [[ ! -d "$TACHU_PKG" ]]; then
  echo "[fatal] @tachu/core 未安装，请执行：bun install" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
rm -f "$OUT_FILE"

BUN_TARGET="bun-${TARGET_ARCH}"

BUILD_ARGS=(
  "$ENTRY"
  --compile
  --target="$BUN_TARGET"
  --sourcemap="$SOURCEMAP"
  --external msgpackr-extract
  --external bufferutil
  --external utf-8-validate
  --outfile "$OUT_FILE"
)

if [[ "$MINIFY" == "1" ]]; then
  BUILD_ARGS+=(--minify)
fi

echo "──────────────────────────────────────────────────────────────"
echo " entry         : $ENTRY"
echo " target        : $BUN_TARGET"
echo " tachu         : $TACHU_PKG"
echo " out           : $OUT_FILE"
echo " minify        : $([[ "$MINIFY" == "1" ]] && echo yes || echo no)"
echo "──────────────────────────────────────────────────────────────"
echo

bun build "${BUILD_ARGS[@]}"

chmod +x "$OUT_FILE" || true

SIZE_HUMAN="$(du -h "$OUT_FILE" | awk '{print $1}')"
echo
echo "✓ built: $OUT_FILE  ($SIZE_HUMAN)"
echo "✓ 下一步：bun run dev:up:prebuilt"
