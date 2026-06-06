# Brodex

An autonomous coding agent that **runs entirely inside an isolated Linux
container** as a long-lived server, exposing an **HTTP + WebSocket API**. Thin
clients (the terminal TUI now; a phone or web app later) connect over a published
port to talk to it. The agent never touches the host — it works in its own Linux
environment and only sees the directories you mount as `/workspace`.

Built in TypeScript/Bun, using [opencode](https://github.com/anomalyco/opencode)
as a per-feature reference.

## Status: Phases 0–4 done

- **Phase 0 — host/container split + lifecycle.** Persistent, host-managed
  sandbox container, customizable workspace volume, resource limits.
- **Phase 1 — agent loop + provider + container tools.** A lean, framework-free
  agent loop (model → run tools → loop → done) running on the host; an Azure AI
  Foundry provider (OpenAI Responses API, api-key auth); coding tools (read,
  write, edit, glob, grep, shell) and container-capability tools (system stats,
  process/app management, package install) — all executing in the sandbox.

- **Phase 2 — interactive TUI (MVP).** An Ink (React-for-terminal) full-screen
  UI: streaming transcript with tool-call cards and edit diffs, slash commands +
  a Ctrl+K command palette, a Ctrl+S session switcher, multi-line input with
  draft history, and clipboard copy keys.

- **Phase 3 — approval / sandbox permission modes.** An inner permission gate
  (the container is the outer sandbox). Modes: **ask** (default — every gated
  tool call, including file reads, prompts), **read-only** (reads ask, all
  mutations denied), **full** (no prompts). Each prompt offers Allow once /
  Allow for session / Deny. Approval shows a dialog in the TUI and a terminal
  prompt in headless `agent` runs.

## Permissions

The agent can never reach host files — its tools only ever run inside the
container, confined to `/workspace`. On top of that hard boundary, a permission
mode controls what the agent may do **without asking you**:

| Mode | File reads | Writes / shell / installs |
|---|---|---|
| **ask** (default) | ask | ask |
| **read-only** | ask | denied |
| **full** | allow | allow |

Each prompt lets you pick **Allow once**, **Allow for session** (stop asking for
that tool), or **Deny**. Switch modes live in the TUI with `/permissions` (cycles
ask → read-only → full); the current mode shows in the status bar. For headless
runs, pass `--mode`:

```bash
./bin/brodex agent --mode read-only "explain the auth module"
./bin/brodex agent --mode full "run the whole test suite and fix failures"
```

## Extensibility (Phase 4)

All four live in the workspace under `/workspace` and load automatically; the
agent server (inside the container) reads them on each run.

**Defaults are seeded on container start.** The first time the container comes
up, Brodex creates starter `.brodex/` config in the workspace if it's missing —
an `AGENTS.md`, a `.brodex/memory.md`, a sample `example` skill, an empty
`hooks.json`, and an `mcp.json` pre-wired with the **LangChain docs** MCP server
(remote HTTP, `https://docs.langchain.com/mcp`). Seeding is idempotent: your
edits are never overwritten.

### Projects & per-project config

A session has a **working directory** (cwd). When you start a new thread in the
TUI, a picker asks how to scope it:

1. **Use an existing project** under `/workspace` (e.g. `projectA`)
2. **Create a new project** (you name it; the directory is created)
3. **No project** — chat with the barebone agent (cwd = `/workspace`)

The cwd is **stored on the session**, so resuming a thread keeps its project.
Headless runs set it with `--cwd /workspace/projectA`.

Config resolution is **deeper-replaces**: if the project dir has its own
`.brodex/` (skills, hooks, mcp, memory), Brodex uses *that* and ignores the
root's for that config type. A project without a given config falls back to the
workspace root. So `workspace/projectA/.brodex/skills` fully replaces
`workspace/.brodex/skills` for sessions scoped to `projectA`.

### Memory / project instructions

On every run the server prepends these files (if present) to the system prompt:
`AGENTS.md`, `CLAUDE.md`, and `.brodex/memory.md`. Use them for conventions,
build commands, and gotchas. The agent can also save durable notes itself with
the **`remember`** tool, which appends to `.brodex/memory.md`.

### Skills

Reusable workflows. Create `.brodex/skills/<name>/SKILL.md`:

```markdown
---
name: review-pr
description: Review a pull request for correctness and security
---
# Review checklist
1. Read the diff.
2. Check for missing tests.
3. Flag any secrets or unsafe shell calls.
```

The agent sees available skills in the **`skill`** tool's description and loads
one (injecting its body) when a task matches.

### Hooks

Shell commands that run around tool calls. Create `.brodex/hooks.json`:

```json
{
  "hooks": {
    "after_write":  ["prettier -w \"$BRODEX_TOOL\""],
    "after_edit":   ["bun run lint"],
    "before_shell": ["echo running a command…"],
    "after_run":    ["bun test"]
  }
}
```

Each command runs from the workspace root inside the container; `$BRODEX_TOOL`
holds the triggering tool name. Output is surfaced in the transcript.

### MCP servers

Connect external [MCP](https://modelcontextprotocol.io) tool servers; their
tools join the agent's toolset (namespaced `<server>__<tool>`) and are
permission-gated like any tool. Create `.brodex/mcp.json` using the standard MCP
schema (`mcpServers`, `type: "stdio" | "http"`):

```json
{
  "mcpServers": {
    "langchain-docs": { "type": "http", "url": "https://docs.langchain.com/mcp" },
    "github": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "..." }
    }
  }
}
```

`stdio` servers are spawned as a local command; `http` servers connect over
streamable HTTP (`headers` optional for auth). The legacy `servers` /
`type:"local"|"remote"` form is still accepted. A server that fails to connect is
skipped (non-fatal). The default `mcp.json` ships with the LangChain docs server.

`local` servers are spawned over stdio; `remote` servers connect over streamable
HTTP. A server that fails to connect is skipped (non-fatal).


### Agents

An **agent** is a named persona — a system prompt plus an optional tool
allowlist. Built-ins: **build** (full-access, default) and **plan** (read-only:
explore and plan, no edits). Switch with `/agent` (or `Ctrl+A`) in the TUI, or
`--agent <name>` headless; the choice is stored per session.

Define your own in `.brodex/agents/<name>.json`:

```json
{
  "name": "reviewer",
  "description": "Reviews code for security issues",
  "prompt": "You are a security reviewer. Read diffs and flag risks; do not edit.",
  "tools": ["read", "glob", "grep"]
}
```

Omit `tools` to allow all. A session's active agent persists across resumes.


# Reference

## CLI commands (host side)

Run as `./bin/brodex <command>` (or `brodex <command>` if on your PATH).

### Container lifecycle

| Command | Args / options | What it does |
|---|---|---|
| `brodex up` | `--rebuild` | Build the image if needed and start the persistent sandbox. `--rebuild` recreates it from a fresh image. Idempotent: a no-op if already running. |
| `brodex down` | `--rm` | Stop the sandbox (the host volume persists). `--rm` also removes the container (volume untouched). |
| `brodex status` | — | Show whether the sandbox is running. |
| `brodex shell` | — | Open an interactive shell inside the running sandbox. |
| `brodex build` | — | Build the sandbox image only (no run). |

### Running the agent

| Command | Args / options | What it does |
|---|---|---|
| `brodex agent <prompt>` | `--resume <id>`, `--new`, `--mode <ask\|read-only\|full>`, `--cwd <dir>` | Run the agent headlessly on a task. `--cwd` scopes it to a project dir under `/workspace`. |
| `brodex tui` | `--resume <id>`, `--new` | Open the interactive TUI. |
| `brodex sessions` | — | List saved threads (newest first), with token usage. |
| `brodex session rename <id> <title>` | — | Rename a thread. |
| `brodex session delete <id>` | — | Delete a thread and its history. |

**Shared agent/TUI flags**

| Flag | Effect |
|---|---|
| *(none)* | Continue the **active** thread (default), so consecutive runs remember context. |
| `--new` | Start a **fresh** thread instead of continuing the active one. |
| `--resume <thread-id>` | Jump to a specific thread by id (from `brodex sessions`). |
| `--mode ask` | **Default.** Every gated tool call — including file reads — prompts for approval. |
| `--mode read-only` | Reads prompt; all writes / shell / installs are denied. |
| `--mode full` | No prompts; the agent runs everything. (`agent` only; the TUI switches modes live with `/permissions`.) |

In headless `agent` runs, an approval prompt appears on the terminal:
`[a]llow once · [s]ession · [d]eny`.

### Workspace mounts

| Command | Args / options | What it does |
|---|---|---|
| `brodex mount list` | — | Show configured host→container mounts. |
| `brodex mount add <path>` | `--at <container-path>`, `--ro` | Mount a host directory (takes effect on the next `up`). `--at` sets the container path; `--ro` mounts read-only. |
| `brodex mount remove <container-path>` | — | Remove a mount. |

## TUI commands & keys

```bash
./bin/brodex up                  # sandbox must be running first
./bin/brodex tui                 # continues your active thread
./bin/brodex tui --new           # start a fresh thread
./bin/brodex tui --resume ses_…  # open a specific thread
```

On a **new thread**, the TUI shows a project picker: use an existing project
dir under `/workspace`, create a new one, or start a barebone chat (no project).
The choice sets the session's working directory, which scopes its tools and
`.brodex` config (see *Projects & per-project config* above). Headless runs set
it with `--cwd /workspace/<project>`.

**Keybindings**

| Key | Action |
|---|---|
| `Ctrl+K` | Open the command palette (filter + run any command) |
| `Ctrl+S` | Open the session switcher (Enter switch · `n` new · `r` rename · `x` delete · Esc close) |
| `Ctrl+A` | Choose the active agent (build / plan / custom) |
| `Ctrl+Y` | Copy the last assistant reply to the clipboard |
| `@` then text | Fuzzy-search workspace files; `↑/↓`, Tab/Enter to insert the path |
| `Up` / `Down` | Recall previous prompts (draft history) |
| `Esc` | Close an open overlay/dialog |
| `Ctrl+C` | Quit |

The status bar shows the active thread, permission mode, and **token usage**
(input↑ / output↓) for the thread.

**Slash commands** (type in the prompt; also available in the palette)

| Command | Action |
|---|---|
| `/new` | Start a fresh thread |
| `/sessions` / `/resume` | Open the session switcher |
| `/agent` | Choose the active agent (build / plan / custom) |
| `/permissions` (or `/mode`) | Cycle permission mode: ask → read-only → full |
| `/clear` | Clear the transcript view |
| `/help` | Show keybindings and commands |
| `/quit` (or `/exit`) | Exit Brodex |

**Approval dialog** (appears when a tool call needs approval)

| Key | Choice |
|---|---|
| `a` or select **Allow once** | Run just this call |
| `s` or select **Allow for session** | Stop asking for this tool for the rest of the session |
| `d` / `Esc` or select **Deny** | Skip this call |
| `←` / `→` then `Enter` | Move between choices and confirm |

The status bar shows the active thread and the current permission mode. Mouse
capture is off, so your terminal's normal click, drag-select, and copy work
everywhere. In-app mouse interactions are a planned later addition.

## How it works

Brodex is an **agent server that lives inside the container**. The host runs only
thin **clients** that connect to it over a port.

```
  CONTAINER (the agent, long-running)        clients (connect over the port)
  ┌────────────────────────────────┐
  │ brodex-agent  (server)         │  :7000   ┌──────────────┐
  │  • HTTP: sessions, prompt, mode│ ───────▶ │ TUI (client) │  localhost
  │  • WebSocket: stream + approval│ ◀─────── │              │
  │  • agent loop, NATIVE tools    │          └──────────────┘
  │  • SQLite, permissions, LLM    │          (phone / web later,
  │  • /workspace  (mounted volume)│           same API)
  └────────────────────────────────┘
```

- **The agent runs in the container.** Loop, tools, sessions, permissions, and
  LLM calls all run server-side. Tools are **native** (`fs`/`spawn`) — no
  `docker exec` indirection.
- **Clients connect over the published port.** `brodex up` starts the server and
  publishes its port; `brodex tui` is a client of it. The protocol (HTTP +
  WebSocket) is designed so a phone or web client can connect later — local only
  for now, but **auth-ready** (optional bearer token).
- **Approval happens over the WebSocket.** When a tool needs permission, the
  server pauses, asks the connected client, and resumes on the reply.
- **The mounted volume** (`/workspace`) is the only host filesystem the agent
  sees. The container is the isolation boundary.
- **Provider API keys** live inside the container (injected from `.env` at start),
  never on the host clients and never baked into the image.
- **Code delivery:** the container git-clones Brodex from `repo` in the config if
  set, otherwise runs from the local source mounted at `/brodex` (dev fallback).

## Quick start

### Prerequisites

- **[Bun](https://bun.sh) installed on the host.** Brodex itself runs on your Mac
  via Bun, so it must be on your PATH. Install it with:

  ```bash
  curl -fsSL https://bun.sh/install | bash
  source ~/.zshrc        # or restart your terminal
  bun --version          # confirm it's available
  ```
- **Docker Desktop** installed and running (it provides the Linux sandbox).

### Run

```bash
cp .env.example .env          # add your LLM provider key(s)
bun install                   # install Brodex's host-side deps

# Mount your workspace folder to /workspace (the shared volume).
./bin/brodex mount add ~/path/to/workspace --at /workspace

./bin/brodex up               # build (first time) + start the persistent sandbox
./bin/brodex agent "add a hello function to projectA/utils.ts"
./bin/brodex shell            # optional: poke around the sandbox yourself
./bin/brodex down             # stop the sandbox (volume persists)
```

The agent needs an LLM provider configured in `.env` (see Azure setup below).

### Sessions (resumable threads)

Sessions are stored in **SQLite** (`.sessions/brodex.db`, via Bun's built-in
`bun:sqlite`), modeled on opencode's design: a `session` table of thread metadata
plus an append-only `message` table, with sortable `ses_`-prefixed ids. Messages
persist incrementally as the loop runs, so an interrupted run is recoverable.

By **default, consecutive `agent` runs continue the same (active) thread**, so an
ordinary back-and-forth just works — the agent remembers earlier turns:

```bash
./bin/brodex agent "Hello, my name is Sid"      # new thread, becomes active
./bin/brodex agent "Do you remember my name?"   # continues it — yes, it does
```

Control the thread explicitly:

```bash
./bin/brodex agent --new "start a different task"        # force a fresh thread
./bin/brodex sessions                                    # list threads (newest first)
./bin/brodex agent --resume ses_fe616c08… "continue this one"   # jump to a thread
```

## Adding directories mid-work

Docker fixes bind mounts at container-creation time, so attaching a **new** host
directory means a fresh container — a quick restart:

```bash
brodex mount add ~/code/another-project
brodex up        # restarts with the new directory mounted
```

This is the deliberate, native-Docker model (chosen over a broad parent mount or
a dynamic remount daemon).

## Configuration

`config/brodex.mounts.json` lists the mounts, the image tag, and the container
resource limits. Edit it by hand or via `brodex mount add/remove`. Host paths may
use `~` and are validated to exist before launch.

### Resource limits

Since there's no compose file, CPU/RAM caps live in the config and are applied as
`docker run --cpus / --memory`. Defaults are **4 CPUs / 8 GB RAM**:

```json
"resources": { "cpus": 4, "memory": "8g" }
```

Edit those values to change the caps (unset either to fall back to Docker's
defaults). Changes take effect on the next `brodex up`.

### Why no `docker-compose.yml`?

Deliberate. The mount list is generated at run time from
`config/brodex.mounts.json`, so `brodex up` builds the `docker run` invocation
programmatically in `src/container/launcher.ts`. A static compose file hardcodes
its volumes, which would mean hand-editing YAML on every `brodex mount add` and
defeat the customizable-mount feature. Keeping a single source of truth (the
mount config → the launcher) is what makes dynamic mounts work.

## Layout

```
brodex/
├── bin/brodex                  # host launcher shim (runs the CLI via Bun)
├── src/
│   ├── index.ts                # CLI entry (up/down/status/shell/agent/tui/sessions/mount)
│   ├── container/
│   │   ├── launcher.ts         # lifecycle: build, run (detached), start/stop, status
│   │   ├── exec.ts             # the docker-exec backend (the one boundary tools cross)
│   │   └── mounts.ts           # read/write/validate the mount + resources config
│   ├── agent/
│   │   ├── index.ts            # headless agent entry (sessions, --mode, terminal approver)
│   │   ├── loop.ts             # the agent loop + permission gate
│   │   ├── provider.ts         # provider selection from env
│   │   ├── providers/azure.ts  # Azure AI Foundry (Responses API)
│   │   ├── tools/              # read/write/edit/glob/grep/shell + system tools
│   │   ├── permission.ts       # allow/ask/deny model, modes, session grants
│   │   ├── session.ts          # SQLite session store (bun:sqlite)
│   │   └── env.ts              # loads brodex/.env into the host process
│   └── tui/                    # Ink TUI: app, components, use-agent hook
├── Dockerfile                  # Debian + git + ripgrep; the sandbox image
├── config/brodex.mounts.json   # mounts, image tag, resource limits
└── .env.example
```

## Roadmap

Done (MVP): **Phase 0** host/container split + lifecycle · **Phase 1** agent loop
+ Azure provider + container tools · **Phase 2** Ink TUI · **Phase 3** permission
modes. Plus SQLite-backed resumable sessions.

Next:

- **@-file autocomplete** in the prompt, and in-app mouse interactions.
- **Extensibility** — MCP / memory / skills / hooks / SDK.
- **Multi-agent & parallelism.**
- **Git / CI + PR automation.**
