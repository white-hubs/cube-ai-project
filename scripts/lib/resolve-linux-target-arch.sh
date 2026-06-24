#!/usr/bin/env bash
# Map Docker/host machine arch → bun --target suffix (linux-x64 | linux-arm64).

_resolve_linux_target_arch_from_machine() {
  case "$1" in
  x86_64 | amd64) echo "linux-x64" ;;
  aarch64 | arm64) echo "linux-arm64" ;;
  *)
    echo "[resolve-linux-target-arch] unknown arch '$1', defaulting to linux-x64" >&2
    echo "linux-x64"
    ;;
  esac
}

resolve_linux_target_arch() {
  if [[ -n "${DOCKER_DEFAULT_PLATFORM:-}" ]]; then
    case "${DOCKER_DEFAULT_PLATFORM}" in
    linux/amd64 | linux/x86_64) echo "linux-x64"; return 0 ;;
    linux/arm64 | linux/aarch64) echo "linux-arm64"; return 0 ;;
    esac
  fi

  local machine=""
  if command -v docker >/dev/null 2>&1; then
    machine="$(docker info --format '{{.Architecture}}' 2>/dev/null || true)"
  fi
  if [[ -z "$machine" ]]; then
    machine="$(uname -m)"
  fi

  _resolve_linux_target_arch_from_machine "$machine"
}
