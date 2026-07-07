#!/usr/bin/env bash
#
# Cube AI monorepo one-shot SDK publish script.
#
# Publishes all @cube-ai/* frontend SDK packages in dependency order.
#
# Workflow:
# 0. interactive version bump (unless --no-bump / --dry-run): pick a semver
#    release type (major/minor/patch/pre*/prerelease/release — alpha.N -> alpha.N+1),
#    write every SDK package.json, sync bun.lock versions, optionally prepend a
#    CHANGELOG entry, and commit the bump.
# 1. git working tree clean check (unless --skip-git-check)
# 2. bun install --frozen-lockfile
# 3. bun run typecheck (all workspaces)
# 4. bun test (full suite must pass)
# 5. build SDK packages (emit dist/) + artifact validation
# 6. rewrite package.json for publish (merge publishConfig, resolve deps)
# 7. bun publish in dependency order (see scripts/sdk-publish-manifest.ts)
#
# Usage:
#   scripts/publish.sh                       # interactive bump, then publish (tag inferred from version)
#   scripts/publish.sh --release-as=prerelease # non-interactive alpha.N -> alpha.N+1
#   scripts/publish.sh --release-as=minor      # non-interactive minor bump
#   scripts/publish.sh --release-as=1.2.3      # non-interactive explicit version
#   scripts/publish.sh --no-bump               # publish the current version as-is (no bump/commit)
#   scripts/publish.sh --yes                   # skip the bump confirmation prompt
#   scripts/publish.sh --dry-run               # inspect tarball contents only (no bump/commit)
#   scripts/publish.sh --tag=latest            # force dist-tag (default: preid for pre-release, latest for stable)
#   scripts/publish.sh --tag=alpha             # publish to the alpha channel
#   scripts/publish.sh --tag=rc                # publish to the release-candidate channel
#   scripts/publish.sh --access=public         # scoped public release (default)
#   scripts/publish.sh --skip-git-check        # skip dirty workspace gate
#
# Tag inference: when --tag is omitted, a pre-release version (contains "-")
# publishes under its preid (e.g. alpha / rc) and a stable version under "latest".
#
# Requirements:
# - bun >= 1.3
# - valid npm credentials (bun login, NPM_TOKEN env, or ~/.npmrc)
# - write access to @cube-ai scope on Nexus npm-hosted
#
set -euo pipefail

REGISTRY="http://nexus.guhecloud.com:8888/repository/npm-hosted/"

RED=$'\033[0;31m'
GREEN=$'\033[0;32m'
YELLOW=$'\033[1;33m'
CYAN=$'\033[0;36m'
BOLD=$'\033[1m'
RESET=$'\033[0m'

DRY_RUN=""
TAG=""
TAG_EXPLICIT=0
ACCESS="public"
SKIP_GIT_CHECK=0
NO_BUMP=0
RELEASE_AS=""
ASSUME_YES=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN="--dry-run"
      shift
      ;;
    --tag)
      TAG="$2"
      TAG_EXPLICIT=1
      shift 2
      ;;
    --tag=*)
      TAG="${1#*=}"
      TAG_EXPLICIT=1
      shift
      ;;
    --access)
      ACCESS="$2"
      shift 2
      ;;
    --access=*)
      ACCESS="${1#*=}"
      shift
      ;;
    --release-as)
      RELEASE_AS="$2"
      shift 2
      ;;
    --release-as=*)
      RELEASE_AS="${1#*=}"
      shift
      ;;
    --no-bump)
      NO_BUMP=1
      shift
      ;;
    --yes|-y)
      ASSUME_YES=1
      shift
      ;;
    --skip-git-check)
      SKIP_GIT_CHECK=1
      shift
      ;;
    -h|--help)
      # Print only the leading comment block (stop at first non-comment line).
      awk 'BEGIN { h = 0 } /^#!/ { next } /^#/ { sub(/^# ?/, ""); print; h = 1; next } h { exit }' "$0"
      exit 0
      ;;
    *)
      printf "%sUnknown argument: %s%s\n" "$RED" "$1" "$RESET" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"
PUBLISH_BUNFIG="$SCRIPT_DIR/publish.bunfig.toml"

# Keep in sync with scripts/sdk-publish-manifest.ts
PACKAGES=(
  "packages/contracts"
  "packages/agent/sdk-client"
  "packages/agent/sdk-client-mock"
  "packages/flow/sdk-client"
  "packages/flow/sdk-console"
  "packages/kb/sdk-client"
  "packages/kb/sdk-console"
  "packages/llm/sdk-console"
  "packages/agent/sdk-console"
  "packages/agent/sdk-client-assistant"
  "packages/agent/sdk-client-vue"
)
MIRRORED_FILES=("README.md")

cleanup_mirrored_files() {
  for pkg in "${PACKAGES[@]}"; do
    for f in "${MIRRORED_FILES[@]}"; do
      if [[ -f "$ROOT/$f" && -f "$pkg/$f" ]]; then
        if cmp -s "$ROOT/$f" "$pkg/$f" 2>/dev/null; then
          rm -f "$pkg/$f"
        fi
      fi
    done
  done
}

cleanup_publish_manifests() {
  bun scripts/prepare-sdk-package-for-publish.ts restore-all
}

trap 'cleanup_publish_manifests; cleanup_mirrored_files' EXIT

log_step() {
  printf "\n%s▶ %s%s\n" "$CYAN" "$1" "$RESET"
}

log_ok() {
  printf "%s✓ %s%s\n" "$GREEN" "$1" "$RESET"
}

log_warn() {
  printf "%s⚠ %s%s\n" "$YELLOW" "$1" "$RESET"
}

log_fail() {
  printf "%s✗ %s%s\n" "$RED" "$1" "$RESET" >&2
}

# ---- 1/6 git clean -----------------------------------------------------------
log_step "1/6 git working tree"
if [[ $SKIP_GIT_CHECK -eq 0 ]]; then
  if [[ -n "$(git status --porcelain 2>/dev/null || true)" ]]; then
    log_fail "Git working tree is dirty. Commit/stash or pass --skip-git-check."
    git status --short >&2 || true
    exit 1
  fi
  log_ok "clean"
else
  log_warn "skipped per --skip-git-check"
fi

# ---- version bump (interactive semver + lockfile + optional CHANGELOG + commit) -
if [[ $NO_BUMP -eq 0 && -z "$DRY_RUN" ]]; then
  log_step "version bump (semver + lockfile + commit)"
  BUMP_ARGS=()
  [[ -n "$RELEASE_AS" ]] && BUMP_ARGS+=("$RELEASE_AS")
  [[ $ASSUME_YES -eq 1 ]] && BUMP_ARGS+=("--yes")
  bun scripts/bump-version.ts ${BUMP_ARGS[@]+"${BUMP_ARGS[@]}"}

  NEW_VERSION="$(bun --print 'JSON.parse(await Bun.file("packages/contracts/package.json").text()).version')"

  log_step "bun install (sync lockfile to ${NEW_VERSION})"
  bun install
  log_ok "lockfile synced"

  log_step "git commit — chore(release): bump SDK packages to ${NEW_VERSION}"
  for pkg in "${PACKAGES[@]}"; do
    git add "$pkg/package.json"
  done
  git add bun.lock
  if [[ -f CHANGELOG.md ]]; then
    git add CHANGELOG.md
  fi
  git commit -m "chore(release): bump SDK packages to ${NEW_VERSION}"
  log_ok "committed bump ${NEW_VERSION}"
elif [[ -n "$DRY_RUN" ]]; then
  log_warn "version bump skipped (dry-run — publishing current version)"
else
  log_warn "version bump skipped (--no-bump — publishing current version)"
fi

# ---- 2/6 bun install ---------------------------------------------------------
log_step "2/6 bun install --frozen-lockfile"
bun install --frozen-lockfile
log_ok "install OK"

# ---- 3/6 typecheck -----------------------------------------------------------
log_step "3/6 bun run typecheck"
bun run typecheck
log_ok "typecheck OK"

# ---- 4/6 tests (hard gate) ---------------------------------------------------
log_step "4/6 bun test (hard gate — must pass)"
bun test
log_ok "tests PASS"

# ---- 5/6 build SDK packages --------------------------------------------------
log_step "5/6 build SDK packages"
for pkg in "${PACKAGES[@]}"; do
  PKG_NAME="$(bun --print "JSON.parse(await Bun.file('$pkg/package.json').text()).name")"
  printf "  %s•%s building %s%s%s\n" "$CYAN" "$RESET" "$BOLD" "$PKG_NAME" "$RESET"
  (cd "$pkg" && bun run build)
done
log_ok "SDK build OK"

# ---- version sanity ----------------------------------------------------------
VERSION="$(bun --print 'JSON.parse(await Bun.file("packages/contracts/package.json").text()).version')"
MISMATCH=0
for pkg in "${PACKAGES[@]}"; do
  PKG_VERSION="$(bun --print "JSON.parse(await Bun.file('$pkg/package.json').text()).version")"
  if [[ "$PKG_VERSION" != "$VERSION" ]]; then
    log_fail "Version mismatch: contracts=$VERSION vs $(basename "$pkg")=$PKG_VERSION"
    MISMATCH=1
  fi
done
if [[ $MISMATCH -eq 1 ]]; then
  log_fail "All SDK packages must share the same version. Aborting."
  exit 1
fi

# Infer the dist-tag from the version when the caller did not force one:
# a pre-release (contains "-") goes to its preid (alpha / rc / …), a stable
# version to "latest".
if [[ $TAG_EXPLICIT -eq 0 ]]; then
  if [[ "$VERSION" == *"-"* ]]; then
    TAG="${VERSION#*-}"
    TAG="${TAG%%.*}"
  else
    TAG="latest"
  fi
  log_ok "dist-tag inferred: ${TAG} (from version ${VERSION})"
fi

if [[ "$TAG" == "latest" && "$VERSION" == *"-"* ]]; then
  log_fail "Refusing to publish a pre-release version (${VERSION}) under --tag=latest."
  log_fail "Use --tag=alpha | --tag=rc | --tag=next, or bump to a stable version first."
  exit 1
fi

# ---- mirror root docs into each package --------------------------------------
log_step "mirroring README into SDK packages"
for pkg in "${PACKAGES[@]}"; do
  for f in "${MIRRORED_FILES[@]}"; do
    if [[ -f "$f" && ! -f "$pkg/$f" ]]; then
      cp "$f" "$pkg/$f"
    fi
  done
done
log_ok "mirrored into ${#PACKAGES[@]} packages"

log_step "validating release artifacts"
bun scripts/validate-release-artifacts.ts --require-built-artifacts --require-mirrored-docs
log_ok "release artifact validation OK"

log_step "preparing publish manifests (merge publishConfig, resolve workspace/catalog)"
bun scripts/prepare-sdk-package-for-publish.ts apply-all
bun scripts/prepare-sdk-package-for-publish.ts validate-all
log_ok "publish manifest prepare OK"

# ---- 6/6 publish -------------------------------------------------------------
log_step "6/6 publishing — version ${BOLD}${VERSION}${RESET}${CYAN}, registry=${BOLD}${REGISTRY}${RESET}${CYAN}, tag=${BOLD}${TAG}${RESET}${CYAN}, access=${BOLD}${ACCESS}${RESET}${CYAN}${DRY_RUN:+, dry-run}${RESET}"

PACK_DEST="$ROOT/.tmp/publish-pack"
mkdir -p "$PACK_DEST"

PUBLISHED=()
for pkg in "${PACKAGES[@]}"; do
  PKG_NAME="$(bun --print "JSON.parse(await Bun.file('$pkg/package.json').text()).name")"
  printf "\n  %s•%s publishing %s%s%s\n" "$CYAN" "$RESET" "$BOLD" "$PKG_NAME" "$RESET"
  (
    cd "$pkg"
    # bunfig.toml routes @cube-ai install via npm-group; publish.bunfig.toml overrides scope for npm-hosted.
    # shellcheck disable=SC2086
    bun publish --config="$PUBLISH_BUNFIG" --registry="$REGISTRY" --access="$ACCESS" --tag="$TAG" $DRY_RUN
  )
  PUBLISHED+=("$PKG_NAME@$VERSION")
  log_ok "$PKG_NAME@$VERSION"

  # Local tarball sanity (works for dry-run and real publish)
  TARBALL="$(cd "$pkg" && npm pack --pack-destination "$PACK_DEST" --silent 2>/dev/null | tail -1)"
  if [[ -n "$TARBALL" ]]; then
    TARBALL_PATH="$PACK_DEST/$TARBALL"
    if tar -tzf "$TARBALL_PATH" 2>/dev/null | rg -q '^package/src/'; then
      log_fail "$PKG_NAME tarball contains package/src/ — manifest/files misconfigured"
      exit 1
    fi
    if tar -xOf "$TARBALL_PATH" package/package.json 2>/dev/null | rg '"main"|"import"' | rg -q 'src/'; then
      log_fail "$PKG_NAME tarball package.json still references src/"
      tar -xOf "$TARBALL_PATH" package/package.json | rg '"main"|"import"' >&2 || true
      exit 1
    fi
    rm -f "$TARBALL_PATH"
  fi
done

echo ""
if [[ -n "$DRY_RUN" ]]; then
  log_ok "Dry run complete. No changes published."
  log_warn "Re-run without --dry-run to perform the real publish."
else
  log_ok "Published ${#PUBLISHED[@]} SDK packages with tag '${TAG}':"
  for item in "${PUBLISHED[@]}"; do
    printf "    %s%s%s\n" "$GREEN" "$item" "$RESET"
  done
  printf "%s💡 Install example:%s bun add @cube-ai/agent-sdk-client@%s\n" "$YELLOW" "$RESET" "$TAG"
  printf "%s💡 Tag on git:%s git tag sdk-v%s && git push --tags\n" "$YELLOW" "$RESET" "$VERSION"
fi
