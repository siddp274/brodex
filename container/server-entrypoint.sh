#!/usr/bin/env bash
# Runs INSIDE the container as the main process. Gets Brodex's code (clone from
# $BRODEX_REPO, or use the source mounted at /brodex), installs deps, and starts
# the agent server. The server then runs for the life of the container.
set -euo pipefail

APP_DIR=/app
BRODEX_REPO="${BRODEX_REPO:-}"
BRODEX_REF="${BRODEX_REF:-dev-tui}"

if [ -n "${BRODEX_REPO}" ]; then
  if [ ! -d "${APP_DIR}/.git" ]; then
    echo "brodex-server: cloning ${BRODEX_REPO} (${BRODEX_REF})..." >&2
    rm -rf "${APP_DIR}"
    git clone --depth 1 --branch "${BRODEX_REF}" "${BRODEX_REPO}" "${APP_DIR}"
  else
    echo "brodex-server: updating existing clone..." >&2
    (cd "${APP_DIR}" && git pull --ff-only || true)
  fi
elif [ -d /brodex/src ]; then
  echo "brodex-server: using mounted source at /brodex (dev fallback)." >&2
  APP_DIR=/brodex
else
  echo "brodex-server: no code source. Set BRODEX_REPO or mount source at /brodex." >&2
  exit 1
fi

cd "${APP_DIR}"

# Install deps (idempotent: only when package.json changed).
marker="node_modules/.brodex-deps-hash"
current="$(sha256sum package.json | cut -d' ' -f1)"
if [ ! -f "${marker}" ] || [ "$(cat "${marker}" 2>/dev/null)" != "${current}" ]; then
  echo "brodex-server: installing dependencies..." >&2
  bun install
  echo "${current}" > "${marker}"
fi

# Seed default .brodex config into the workspace (idempotent).
if [ -f "${APP_DIR}/container/seed-defaults.sh" ]; then
  bash "${APP_DIR}/container/seed-defaults.sh" || true
fi

echo "brodex-server: starting on :${BRODEX_PORT:-7000}" >&2
exec bun run "${APP_DIR}/src/server/index.ts"
