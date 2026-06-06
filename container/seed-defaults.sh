#!/usr/bin/env bash
# Seed default Brodex config into the workspace on container start. Idempotent:
# only creates files that don't already exist, so user edits are never
# overwritten. Provides sensible starting points for memory, skills, hooks, and
# MCP (including the LangChain docs server over remote HTTP).
set -euo pipefail

WS="${BRODEX_WORKSPACE:-/workspace}"
BRODEX_DIR="${WS}/.brodex"

mkdir -p "${BRODEX_DIR}/skills/example"

# --- memory: AGENTS.md + .brodex/memory.md --------------------------------
if [ ! -f "${WS}/AGENTS.md" ]; then
  cat > "${WS}/AGENTS.md" <<'EOF'
# Project instructions

Edit this file with conventions Brodex should always follow in this workspace,
e.g. coding style, build/test commands, and gotchas.

- Build:
- Test:
- Style:
EOF
fi

if [ ! -f "${BRODEX_DIR}/memory.md" ]; then
  cat > "${BRODEX_DIR}/memory.md" <<'EOF'
# Brodex memory

Durable facts the agent has learned. The agent appends here via the `remember`
tool; you can also edit it by hand.
EOF
fi

# --- skills: a sample skill -----------------------------------------------
if [ ! -f "${BRODEX_DIR}/skills/example/SKILL.md" ]; then
  cat > "${BRODEX_DIR}/skills/example/SKILL.md" <<'EOF'
---
name: example
description: A sample skill — replace with your own reusable workflow
---
# Example skill

This is a starter skill. When loaded, its instructions are injected into the
conversation. Replace this body with a real workflow (e.g. a review checklist,
a release procedure, a debugging playbook).
EOF
fi

# --- hooks: a no-op example ------------------------------------------------
if [ ! -f "${BRODEX_DIR}/hooks.json" ]; then
  cat > "${BRODEX_DIR}/hooks.json" <<'EOF'
{
  "$comment": "Shell commands run around tool calls. Events: before_shell, after_write, after_edit, after_run. $BRODEX_TOOL holds the triggering tool name.",
  "hooks": {
    "after_write": [],
    "after_edit": [],
    "before_shell": [],
    "after_run": []
  }
}
EOF
fi

# --- mcp: LangChain docs server (remote HTTP) ------------------------------
if [ ! -f "${BRODEX_DIR}/mcp.json" ]; then
  cat > "${BRODEX_DIR}/mcp.json" <<'EOF'
{
  "$comment": "External MCP tool servers. 'local' = a stdio command; 'remote' = an HTTP URL. Their tools join the agent's toolset as <server>__<tool>.",
  "servers": {
    "langchain-docs": {
      "type": "remote",
      "url": "https://docs.langchain.com/mcp"
    }
  }
}
EOF
fi

echo "brodex-server: default .brodex config ensured in ${WS}" >&2
