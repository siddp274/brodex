// Persistent sessions, modeled on opencode's design but kept dependency-light:
// SQLite via Bun's built-in `bun:sqlite` (no Drizzle, no Effect). Two tables
// mirroring opencode:
//   session  — one row of metadata per thread (id, parent_id, title, cost,
//              tokens, created/updated)
//   message  — append-only, one row per message keyed to a session, ordered by
//              creation; the message body is JSON in `data`
// Plus a tiny `meta` table holding the active-thread pointer.
//
// IDs are sortable like opencode's (`ses_` + a monotonic descending key) so
// "newest first" needs no timestamp sort. Messages persist incrementally as the
// loop produces them, so an interrupted run is recoverable.
import { Database } from "bun:sqlite"
import { resolve, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { mkdirSync } from "node:fs"
import type { Message } from "./types.ts"

const HERE = dirname(fileURLToPath(import.meta.url))
// brodex/.sessions/brodex.db (two levels up from src/agent/)
const SESSIONS_DIR = resolve(HERE, "..", "..", ".sessions")
const DB_PATH = resolve(SESSIONS_DIR, "brodex.db")

export interface SessionInfo {
  id: string
  parentId?: string
  title: string
  cost: number
  tokensInput: number
  tokensOutput: number
  timeCreated: number
  timeUpdated: number
  cwd: string
  agent: string
}

// ---- DB bootstrap -----------------------------------------------------------

let _db: Database | undefined

function db(): Database {
  if (_db) return _db
  mkdirSync(SESSIONS_DIR, { recursive: true })
  const d = new Database(DB_PATH)
  // WAL is faster but needs shared-memory support some filesystems lack; fall
  // back to the default rollback journal if it isn't available.
  try {
    d.exec("PRAGMA journal_mode = WAL;")
  } catch {
    /* keep default journal mode */
  }
  d.exec(`
    CREATE TABLE IF NOT EXISTS session (
      id            TEXT PRIMARY KEY,
      parent_id     TEXT,
      title         TEXT NOT NULL DEFAULT '',
      cost          REAL NOT NULL DEFAULT 0,
      tokens_input  INTEGER NOT NULL DEFAULT 0,
      tokens_output INTEGER NOT NULL DEFAULT 0,
      time_created  INTEGER NOT NULL,
      time_updated  INTEGER NOT NULL,
      cwd           TEXT NOT NULL DEFAULT '/workspace',
      agent         TEXT NOT NULL DEFAULT 'build'
    );
    CREATE INDEX IF NOT EXISTS session_parent_idx ON session(parent_id);
    CREATE INDEX IF NOT EXISTS session_updated_idx ON session(time_updated DESC);

    CREATE TABLE IF NOT EXISTS message (
      id           TEXT PRIMARY KEY,
      session_id   TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
      seq          INTEGER NOT NULL,
      time_created INTEGER NOT NULL,
      data         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS message_session_seq_idx ON message(session_id, seq);

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  // Migration: add cwd to older session tables that predate it.
  try {
    const cols = d.query(`PRAGMA table_info(session)`).all() as Array<{ name: string }>
    if (!cols.some((c) => c.name === "cwd")) {
      d.exec(`ALTER TABLE session ADD COLUMN cwd TEXT NOT NULL DEFAULT '/workspace'`)
    }
    if (!cols.some((c) => c.name === "agent")) {
      d.exec(`ALTER TABLE session ADD COLUMN agent TEXT NOT NULL DEFAULT 'build'`)
    }
  } catch {
    /* ignore */
  }
  _db = d
  return d
}

// ---- ID generation (sortable, opencode-style) -------------------------------

let _lastTime = 0
let _counter = 0

/** Monotonic descending key so newer ids sort BEFORE older ones lexically. */
function descendingKey(): string {
  let now = Date.now()
  if (now <= _lastTime) {
    _counter++
  } else {
    _lastTime = now
    _counter = 0
  }
  // Invert time so larger timestamps produce smaller strings (descending).
  const inverted = (0xffffffffffff - now).toString(16).padStart(12, "0")
  const ctr = _counter.toString(16).padStart(4, "0")
  return `${inverted}${ctr}`
}

export function newThreadId(): string {
  return "ses_" + descendingKey()
}

// ---- Session CRUD -----------------------------------------------------------

export function createSession(title: string, parentId?: string, cwd = "/workspace", agent = "build"): SessionInfo {
  const now = Date.now()
  const info: SessionInfo = {
    id: newThreadId(),
    parentId,
    title: title.slice(0, 200),
    cost: 0,
    tokensInput: 0,
    tokensOutput: 0,
    timeCreated: now,
    timeUpdated: now,
    cwd,
    agent,
  }
  db()
    .query(
      `INSERT INTO session (id, parent_id, title, cost, tokens_input, tokens_output, time_created, time_updated, cwd, agent)
       VALUES (?, ?, ?, 0, 0, 0, ?, ?, ?, ?)`,
    )
    .run(info.id, info.parentId ?? null, info.title, info.timeCreated, info.timeUpdated, info.cwd, info.agent)
  return info
}

export function sessionExists(threadId: string): boolean {
  const row = db().query(`SELECT 1 FROM session WHERE id = ?`).get(threadId)
  return !!row
}

export function getSession(threadId: string): SessionInfo | undefined {
  const row = db().query(`SELECT * FROM session WHERE id = ?`).get(threadId) as any
  if (!row) return undefined
  return rowToInfo(row)
}

function rowToInfo(row: any): SessionInfo {
  return {
    id: row.id,
    parentId: row.parent_id ?? undefined,
    title: row.title,
    cost: row.cost,
    tokensInput: row.tokens_input,
    tokensOutput: row.tokens_output,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
    cwd: row.cwd ?? "/workspace",
    agent: row.agent ?? "build",
  }
}

/** Touch updated time (and optionally token/cost deltas) after activity. */
export function touchSession(threadId: string, deltas?: { tokensInput?: number; tokensOutput?: number; cost?: number }): void {
  db()
    .query(
      `UPDATE session
         SET time_updated = ?,
             tokens_input  = tokens_input + ?,
             tokens_output = tokens_output + ?,
             cost          = cost + ?
       WHERE id = ?`,
    )
    .run(Date.now(), deltas?.tokensInput ?? 0, deltas?.tokensOutput ?? 0, deltas?.cost ?? 0, threadId)
}

/** Rename a session (set its title). */
export function renameSession(threadId: string, title: string): void {
  db().query(`UPDATE session SET title = ?, time_updated = ? WHERE id = ?`).run(title.slice(0, 200), Date.now(), threadId)
}

/**
 * Delete a session and its messages. The message rows cascade via the foreign
 * key, but we delete explicitly too in case foreign_keys pragma is off. Clears
 * the active pointer if it referenced this thread.
 */
export function deleteSession(threadId: string): void {
  const d = db()
  d.query(`DELETE FROM message WHERE session_id = ?`).run(threadId)
  d.query(`DELETE FROM session WHERE id = ?`).run(threadId)
  const active = d.query(`SELECT value FROM meta WHERE key = 'active'`).get() as { value: string } | null
  if (active && active.value === threadId) {
    d.query(`DELETE FROM meta WHERE key = 'active'`).run()
  }
}

/** Set a session's working directory (the project dir it's scoped to). */
export function setSessionCwd(threadId: string, cwd: string): void {
  db().query(`UPDATE session SET cwd = ?, time_updated = ? WHERE id = ?`).run(cwd, Date.now(), threadId)
}

/** Set a session's active agent. */
export function setSessionAgent(threadId: string, agent: string): void {
  db().query(`UPDATE session SET agent = ?, time_updated = ? WHERE id = ?`).run(agent, Date.now(), threadId)
}

// ---- Messages (append-only) -------------------------------------------------

/** Load a session's messages in order, as the loop's Message[] shape. */
export function loadMessages(threadId: string): Message[] {
  const rows = db()
    .query(`SELECT data FROM message WHERE session_id = ? ORDER BY seq ASC`)
    .all(threadId) as Array<{ data: string }>
  return rows.map((r) => JSON.parse(r.data) as Message)
}

/**
 * Replace a session's message log with the given list. The loop calls this on
 * each persist tick; we diff by count and only append new rows so persistence
 * stays append-only and cheap (matches opencode's incremental model).
 */
export function persistMessages(threadId: string, messages: Message[]): void {
  const d = db()
  const countRow = d.query(`SELECT COUNT(*) AS n FROM message WHERE session_id = ?`).get(threadId) as { n: number }
  const existing = countRow.n
  if (messages.length <= existing) {
    // Nothing new to append (or a reset — we don't rewrite history here).
    touchSession(threadId)
    return
  }
  const insert = d.query(
    `INSERT INTO message (id, session_id, seq, time_created, data) VALUES (?, ?, ?, ?, ?)`,
  )
  const now = Date.now()
  const tx = d.transaction((items: Message[]) => {
    for (let i = existing; i < items.length; i++) {
      insert.run(`msg_${descendingKey()}`, threadId, i, now, JSON.stringify(items[i]))
    }
  })
  tx(messages)
  touchSession(threadId)
}

// ---- Active-thread pointer ---------------------------------------------------

export function getActiveThreadId(): string | undefined {
  const row = db().query(`SELECT value FROM meta WHERE key = 'active'`).get() as { value: string } | null
  if (!row) return undefined
  return sessionExists(row.value) ? row.value : undefined
}

export function setActiveThreadId(threadId: string): void {
  db()
    .query(`INSERT INTO meta (key, value) VALUES ('active', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(threadId)
}

// ---- Listing ----------------------------------------------------------------

export function listSessions(): Array<Pick<SessionInfo, "id" | "title" | "timeUpdated" | "tokensInput" | "tokensOutput" | "agent">> {
  const rows = db()
    .query(`SELECT id, title, time_updated, tokens_input, tokens_output, agent FROM session ORDER BY time_updated DESC`)
    .all() as Array<{ id: string; title: string; time_updated: number; tokens_input: number; tokens_output: number }>
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    timeUpdated: r.time_updated,
    tokensInput: r.tokens_input,
    tokensOutput: r.tokens_output,
    agent: (r as any).agent ?? "build",
  }))
}

export { SESSIONS_DIR, DB_PATH }
