#!/usr/bin/env bash
# scripts/build-image.sh — 发布镜像 buildx 一键脚本（runtime-binary）
#
# ref: deploy/docker-compose/Dockerfile.ai-center（target: runtime-binary）
#
# 职责：构建并可选推送 **发布镜像**；不做远程 SSH / compose 部署。
# 本地排障用的 runtime-source / runtime-binary-prebuilt 不在本脚本暴露。
#
# 用法：
#   # 默认：单架构 + load 到本地（tag: dev-local-<sha7>）
#   scripts/build-image.sh
#
#   # 多架构 build + push（tag: <sha7>；dirty 工作区默认拒绝）
#   scripts/build-image.sh --push
#
#   # 显式追加 tag（latest 不会默认推送）
#   scripts/build-image.sh --push --extra-tag latest --extra-tag v0.3.0
#
#   # 仅预热 build cache（不 load 不 push）
#   scripts/build-image.sh --no-output
#
#   # 指定 tag / registry / 平台
#   TAG=v0.1.0 REGISTRY=registry.example.com/cube-ai scripts/build-image.sh --push
#   BUN_CI_IMAGE=... DEBIAN_RUNTIME_IMAGE=... scripts/build-image.sh
#   scripts/build-image.sh --push --platform linux/amd64
#
#   # 内网 HTTP registry：指定 BuildKit registry 配置后创建 builder
#   scripts/build-image.sh --buildkit-config deploy/buildkit/nexus-guhecloud.toml --recreate-builder
#
# 环境变量（命令行参数优先级更高）：
#   REGISTRY           发布镜像仓库前缀，默认 registry.kh.internal/cube-ai
#   BUN_CI_IMAGE       构建阶段基础镜像（deps / build-* / runtime-source）
#   DEBIAN_RUNTIME_IMAGE  运行阶段基础镜像（runtime-binary*）
#   IMAGE_NAME         镜像名，默认 cube-ai-center
#   TAG                主 tag。load 默认 dev-local-<sha7>；push 默认 <sha7>
#   PLATFORMS          buildx 平台列表，默认 linux/amd64,linux/arm64
#   BUILDER            buildx builder 名，默认 cube-ai-center-builder
#   BUILDKIT_CONFIG    buildkitd.toml 路径（传给 buildx create --config）
#   EXTRA_TAGS         追加 tag（空格分隔），如 EXTRA_TAGS="latest stable"
#   CACHE_FROM         覆写 --cache-from
#   CACHE_TO           覆写 --cache-to（未含 ignore-error 时自动追加 ignore-error=true）
#   NO_CACHE_FROM      设为 1 时不传 --cache-from
#   NO_CACHE_TO        设为 1 时不传 --cache-to
#
# push 成功判定：发布镜像已在 registry 可达即 exit 0；cache 导出等非关键步骤失败仅 WARN。
#
# 退出码：
#   0  成功
#   2  参数错误
#   3  环境检查失败（docker / buildx / git）
#   4  构建失败
#   5  拒绝 dirty 工作区 push（需 --allow-dirty）

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." &>/dev/null && pwd)"
DOCKERFILE_PATH="${REPO_ROOT}/deploy/docker-compose/Dockerfile.ai-center"
BUILD_TARGET="runtime-binary"

REGISTRY="${REGISTRY:-registry.kh.internal/cube-ai}"
BUN_CI_IMAGE="${BUN_CI_IMAGE:-}"
DEBIAN_RUNTIME_IMAGE="${DEBIAN_RUNTIME_IMAGE:-}"
IMAGE_NAME="${IMAGE_NAME:-cube-ai-center}"
PLATFORMS="${PLATFORMS:-linux/amd64,linux/arm64}"
BUILDER="${BUILDER:-cube-ai-center-builder}"
BUILDKIT_CONFIG="${BUILDKIT_CONFIG:-}"
EXTRA_TAGS="${EXTRA_TAGS:-}"

OUTPUT_MODE="load"
NO_CACHE=0
DRY_RUN=0
ALLOW_DIRTY=0
RECREATE_BUILDER=0
PROGRESS="auto"
CLI_EXTRA_TAGS=""

print_usage() {
  sed -n '2,45p' "$0"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --push)          OUTPUT_MODE="push"; shift ;;
    --load)          OUTPUT_MODE="load"; shift ;;
    --no-output)     OUTPUT_MODE="none"; shift ;;
    --platform)      PLATFORMS="$2"; shift 2 ;;
    --platforms)     PLATFORMS="$2"; shift 2 ;;
    --tag)           TAG="$2"; shift 2 ;;
    --registry)      REGISTRY="$2"; shift 2 ;;
    --bun-ci-image)  BUN_CI_IMAGE="$2"; shift 2 ;;
    --debian-runtime-image) DEBIAN_RUNTIME_IMAGE="$2"; shift 2 ;;
    --image-name)    IMAGE_NAME="$2"; shift 2 ;;
    --buildkit-config) BUILDKIT_CONFIG="$2"; shift 2 ;;
    --recreate-builder) RECREATE_BUILDER=1; shift ;;
    --extra-tag)     CLI_EXTRA_TAGS="${CLI_EXTRA_TAGS} $2"; shift 2 ;;
    --allow-dirty)   ALLOW_DIRTY=1; shift ;;
    --no-cache)      NO_CACHE=1; shift ;;
    --dry-run)       DRY_RUN=1; shift ;;
    --progress)      PROGRESS="$2"; shift 2 ;;
    --source|--binary|--flavor|--prebuilt)
      echo "[build-image] release script only supports runtime-binary; omit --source/--binary/--flavor/--prebuilt." >&2
      exit 2
      ;;
    -h|--help)       print_usage; exit 0 ;;
    *) echo "[build-image] unknown flag: $1" >&2; exit 2 ;;
  esac
done

require() {
  command -v "$1" >/dev/null 2>&1 || { echo "[build-image] missing: $1" >&2; exit 3; }
}
require docker
docker buildx version >/dev/null 2>&1 || {
  echo "[build-image] 'docker buildx' is not available; install Docker 20.10+ with buildx." >&2
  exit 3
}

GIT_SHA="unknown"
GIT_SHORT="local"
GIT_DIRTY=""
if git -C "${REPO_ROOT}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  GIT_SHA="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
  GIT_SHORT="$(git -C "${REPO_ROOT}" rev-parse --short=7 HEAD)"
  if ! git -C "${REPO_ROOT}" diff --quiet 2>/dev/null \
     || ! git -C "${REPO_ROOT}" diff --cached --quiet 2>/dev/null; then
    GIT_DIRTY="-dirty"
  fi
fi

if [ "${OUTPUT_MODE}" = "push" ]; then
  TAG_DEFAULT="${GIT_SHORT}${GIT_DIRTY}"
else
  TAG_DEFAULT="dev-local-${GIT_SHORT}${GIT_DIRTY}"
fi
TAG="${TAG:-${TAG_DEFAULT}}"

if [ "${OUTPUT_MODE}" = "push" ] && [ -n "${GIT_DIRTY}" ] && [ "${ALLOW_DIRTY}" != "1" ]; then
  echo "[build-image] ERROR: refusing to push from dirty working tree (tag would be '${TAG}')." >&2
  echo "[build-image] Commit first, or pass --allow-dirty to override." >&2
  exit 5
fi

if [ "${OUTPUT_MODE}" = "push" ] && [ -n "${GIT_DIRTY}" ] && [ "${ALLOW_DIRTY}" = "1" ]; then
  echo "[build-image] WARN: pushing dirty working-tree tag '${TAG}' (--allow-dirty)." >&2
fi

ALL_EXTRA_TAGS="${EXTRA_TAGS}${CLI_EXTRA_TAGS}"
IMAGE_FQN="${REGISTRY}/${IMAGE_NAME}"
PRIMARY_REF="${IMAGE_FQN}:${TAG}"
BUILD_CREATED="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

resolve_buildkit_config() {
  if [ -z "${BUILDKIT_CONFIG}" ]; then
    return 0
  fi
  if [ ! -f "${BUILDKIT_CONFIG}" ]; then
    echo "[build-image] ERROR: buildkit config not found: ${BUILDKIT_CONFIG}" >&2
    exit 3
  fi
  BUILDKIT_CONFIG="$(cd -- "$(dirname -- "${BUILDKIT_CONFIG}")" &>/dev/null && pwd)/$(basename -- "${BUILDKIT_CONFIG}")"
}

builder_config_file() {
  docker buildx inspect "${BUILDER}" --format '{{index .DriverOptions "config"}}' 2>/dev/null \
    || docker buildx inspect "${BUILDER}" --format '{{.DriverOptions.config}}' 2>/dev/null \
    || true
}

canonical_path() {
  local path="$1"
  local dir base
  if [ -z "${path}" ]; then
    return 0
  fi
  dir="$(dirname -- "${path}")"
  base="$(basename -- "${path}")"
  if [ -d "${dir}" ]; then
    printf '%s/%s' "$(cd -- "${dir}" &>/dev/null && pwd)" "${base}"
  else
    printf '%s' "${path}"
  fi
}

# cache 导出失败（如 Nexus Disable redeploy）不应导致发布失败
append_cache_to_ignore_error() {
  local cache_to="$1"
  if [[ "${cache_to}" != *"ignore-error="* ]]; then
    printf '%s,ignore-error=true' "${cache_to}"
  else
    printf '%s' "${cache_to}"
  fi
}

image_ref_in_registry() {
  docker buildx imagetools inspect "$1" >/dev/null 2>&1
}

ensure_builder() {
  resolve_buildkit_config

  if [ "${DRY_RUN}" = "1" ]; then
    return 0
  fi

  if [ "${RECREATE_BUILDER}" = "1" ] && docker buildx inspect "${BUILDER}" >/dev/null 2>&1; then
    echo "[build-image] removing buildx builder for recreate: ${BUILDER}"
    docker buildx rm "${BUILDER}" >/dev/null
  fi

  if docker buildx inspect "${BUILDER}" >/dev/null 2>&1; then
    if [ -n "${BUILDKIT_CONFIG}" ]; then
      existing_config="$(builder_config_file)"
      want_config="$(canonical_path "${BUILDKIT_CONFIG}")"
      existing_canon="$(canonical_path "${existing_config}")"
      if [ -z "${existing_config}" ]; then
        echo "[build-image] ERROR: builder '${BUILDER}' has no buildkit config; pass --recreate-builder to apply:" >&2
        echo "  ${BUILDKIT_CONFIG}" >&2
        exit 3
      fi
      if [ "${existing_canon}" != "${want_config}" ]; then
        echo "[build-image] ERROR: builder '${BUILDER}' uses different buildkit config:" >&2
        echo "  current : ${existing_config}" >&2
        echo "  wanted  : ${BUILDKIT_CONFIG}" >&2
        echo "[build-image] Run with --recreate-builder to replace the builder." >&2
        exit 3
      fi
    fi
    docker buildx use "${BUILDER}" >/dev/null
  else
    echo "[build-image] creating buildx builder: ${BUILDER}"
    create_args=(--name "${BUILDER}" --driver docker-container --use)
    if [ -n "${BUILDKIT_CONFIG}" ]; then
      create_args+=(--config "${BUILDKIT_CONFIG}")
      echo "[build-image]   buildkit config: ${BUILDKIT_CONFIG}"
    fi
    docker buildx create "${create_args[@]}" >/dev/null
  fi
  docker buildx inspect --bootstrap "${BUILDER}" >/dev/null
}

if [ "${OUTPUT_MODE}" = "load" ]; then
  if [[ "${PLATFORMS}" == *","* ]]; then
    HOST_ARCH="$(uname -m)"
    case "${HOST_ARCH}" in
      x86_64|amd64) PLATFORMS="linux/amd64" ;;
      aarch64|arm64) PLATFORMS="linux/arm64" ;;
      *) PLATFORMS="linux/amd64" ;;
    esac
    echo "[build-image] --load 不支持多架构，已收敛为 ${PLATFORMS}（host=${HOST_ARCH}）"
  fi
fi

ensure_builder

BUILD_ARGS=(
  --file "${DOCKERFILE_PATH}"
  --target "${BUILD_TARGET}"
  --platform "${PLATFORMS}"
  --build-arg "AI_CENTER_VERSION=${TAG}"
  --build-arg "BUILD_SHA=${GIT_SHA}"
  --build-arg "BUILD_CREATED=${BUILD_CREATED}"
  --label "org.opencontainers.image.version=${TAG}"
  --label "org.opencontainers.image.revision=${GIT_SHA}"
  --label "org.opencontainers.image.created=${BUILD_CREATED}"
  --label "com.cube-ai.ai-center.image-flavor=binary"
  --tag "${PRIMARY_REF}"
  --progress "${PROGRESS}"
)

if [ -n "${BUN_CI_IMAGE}" ]; then
  BUILD_ARGS+=(--build-arg "BUN_CI_IMAGE=${BUN_CI_IMAGE}")
fi

if [ -n "${DEBIAN_RUNTIME_IMAGE}" ]; then
  BUILD_ARGS+=(--build-arg "DEBIAN_RUNTIME_IMAGE=${DEBIAN_RUNTIME_IMAGE}")
fi

for extra in ${ALL_EXTRA_TAGS}; do
  [ -n "${extra}" ] || continue
  BUILD_ARGS+=(--tag "${IMAGE_FQN}:${extra}")
done

case "${OUTPUT_MODE}" in
  push) BUILD_ARGS+=(--push) ;;
  load) BUILD_ARGS+=(--load) ;;
  none) ;;
esac

if [ "${NO_CACHE}" = "1" ]; then
  BUILD_ARGS+=(--no-cache)
fi

if [ "${OUTPUT_MODE}" = "push" ] && [ "${NO_CACHE}" != "1" ]; then
  CACHE_FROM_DEFAULT="type=registry,ref=${IMAGE_FQN}:buildcache-binary"
  CACHE_TO_DEFAULT="type=registry,ref=${IMAGE_FQN}:buildcache-binary,mode=max,ignore-error=true"
  CACHE_FROM="${CACHE_FROM:-${CACHE_FROM_DEFAULT}}"
  CACHE_TO="${CACHE_TO:-${CACHE_TO_DEFAULT}}"
  CACHE_TO="$(append_cache_to_ignore_error "${CACHE_TO}")"
  if [ "${NO_CACHE_FROM:-0}" != "1" ]; then BUILD_ARGS+=(--cache-from "${CACHE_FROM}"); fi
  if [ "${NO_CACHE_TO:-0}"   != "1" ]; then BUILD_ARGS+=(--cache-to   "${CACHE_TO}"); fi
fi

BUILD_ARGS+=("${REPO_ROOT}")

cat <<EOF
[build-image] plan
  repo root      : ${REPO_ROOT}
  Dockerfile     : ${DOCKERFILE_PATH}
  target         : ${BUILD_TARGET}
  builder        : ${BUILDER}
  buildkit config: ${BUILDKIT_CONFIG:-<none>}
  platforms      : ${PLATFORMS}
  output mode    : ${OUTPUT_MODE}
  primary tag    : ${PRIMARY_REF}
  extra tags     : ${ALL_EXTRA_TAGS:-<none>}
  git sha        : ${GIT_SHA}${GIT_DIRTY}
  build created  : ${BUILD_CREATED}
  bun-ci image   : ${BUN_CI_IMAGE:-<dockerfile-default>}
  debian runtime : ${DEBIAN_RUNTIME_IMAGE:-<dockerfile-default>}
  allow dirty    : ${ALLOW_DIRTY}
EOF

if [ "${DRY_RUN}" = "1" ]; then
  echo "[build-image] dry-run: docker buildx build ${BUILD_ARGS[*]}"
  exit 0
fi

echo "[build-image] running: docker buildx build ${BUILD_ARGS[*]}"
BUILD_EXIT=0
if ! docker buildx build "${BUILD_ARGS[@]}"; then
  BUILD_EXIT=4
fi

if [ "${OUTPUT_MODE}" = "push" ]; then
  if image_ref_in_registry "${PRIMARY_REF}"; then
    if [ "${BUILD_EXIT}" != "0" ]; then
      echo "[build-image] WARN: buildx exited ${BUILD_EXIT} but release image is in registry: ${PRIMARY_REF}" >&2
      echo "[build-image] WARN: a non-critical step likely failed (e.g. cache export); treating push as success." >&2
    fi
  else
    echo "[build-image] FAILED: release image not found in registry: ${PRIMARY_REF}" >&2
    exit 4
  fi
elif [ "${BUILD_EXIT}" != "0" ]; then
  echo "[build-image] FAILED" >&2
  exit 4
fi

if [ "${OUTPUT_MODE}" = "load" ]; then
  echo "[build-image] verifying OCI labels on ${PRIMARY_REF}…"
  for k in version revision created; do
    val="$(docker image inspect --format "{{ index .Config.Labels \"org.opencontainers.image.${k}\" }}" "${PRIMARY_REF}" 2>/dev/null || echo "")"
    if [ -z "${val}" ] || [ "${val}" = "unknown" ]; then
      echo "[build-image] WARN: label org.opencontainers.image.${k} 缺失或为 'unknown'" >&2
    else
      echo "  org.opencontainers.image.${k} = ${val}"
    fi
  done
fi

echo "[build-image] DONE: ${PRIMARY_REF} (mode=${OUTPUT_MODE})"
