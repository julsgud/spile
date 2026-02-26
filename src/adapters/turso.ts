import type { Conversation, ImportResult, SpileAdapter } from '../types.ts'

interface TursoArg {
  type: 'text' | 'integer' | 'null'
  value: string | null
}

interface TursoStatement {
  sql: string
  args: TursoArg[]
}

// Turso HTTP API requires all values to be strings, even for integer types
const t = (v?: string | null): TursoArg =>
  v == null ? { type: 'null', value: null } : { type: 'text', value: v }

const n = (v?: number | null): TursoArg =>
  v == null || isNaN(v) ? { type: 'null', value: null } : { type: 'integer', value: String(Math.round(v)) }

const b = (v?: boolean | null): TursoArg =>
  v == null ? { type: 'null', value: null } : { type: 'integer', value: v ? '1' : '0' }

function isoToMs(s?: string | null): TursoArg {
  if (!s) return { type: 'null', value: null }
  const ms = Date.parse(s)
  return isNaN(ms) ? { type: 'null', value: null } : { type: 'integer', value: String(ms) }
}

const BATCH = 100

async function tursoExec(url: string, token: string, statements: TursoStatement[]): Promise<void> {
  const resp = await fetch(`${url}/v2/pipeline`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        ...statements.map(stmt => ({ type: 'execute', stmt })),
        { type: 'close' },
      ],
    }),
  })
  if (!resp.ok) {
    throw new Error(`Turso HTTP ${resp.status}: ${await resp.text()}`)
  }
  const data = (await resp.json()) as {
    results?: Array<{ type: string; error?: { message: string } }>
  }
  const errs = (data.results ?? [])
    .filter(r => r.type === 'error')
    .map(r => r.error?.message ?? 'unknown')
  if (errs.length > 0) throw new Error(`Turso SQL: ${errs.join('; ')}`)
}

async function flush(
  url: string,
  token: string,
  batch: TursoStatement[],
  counter: { n: number },
): Promise<void> {
  if (!batch.length) return
  counter.n += batch.length
  await tursoExec(url, token, batch)
  batch.length = 0
}

const INIT_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT    PRIMARY KEY,
  source          TEXT    NOT NULL DEFAULT 'claude_ai',
  name            TEXT    NOT NULL,
  summary         TEXT,
  model           TEXT,
  platform        TEXT,
  is_starred      INTEGER NOT NULL DEFAULT 0,
  is_temporary    INTEGER NOT NULL DEFAULT 0,
  started_at      INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER,
  current_leaf_message_uuid TEXT
);
CREATE TABLE IF NOT EXISTS ai_messages (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT NOT NULL REFERENCES sessions(id),
  uuid                TEXT NOT NULL,
  parent_uuid         TEXT,
  sender              TEXT NOT NULL,
  seq                 INTEGER NOT NULL,
  input_mode          TEXT,
  truncated           INTEGER NOT NULL DEFAULT 0,
  stop_reason         TEXT,
  text                TEXT,
  files_json          TEXT,
  attachments_json    TEXT,
  sync_sources_json   TEXT,
  created_at          INTEGER NOT NULL,
  updated_at          INTEGER
);
CREATE TABLE IF NOT EXISTS ai_content_blocks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id      INTEGER NOT NULL REFERENCES ai_messages(id),
  seq             INTEGER NOT NULL,
  type            TEXT NOT NULL,
  text            TEXT,
  citations_json  TEXT,
  summaries_json  TEXT,
  cut_off         INTEGER NOT NULL DEFAULT 0,
  start_timestamp INTEGER,
  stop_timestamp  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_session  ON ai_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_ai_blocks_message    ON ai_content_blocks(message_id);
`

export interface TursoAdapterOptions {
  url: string
  authToken: string
}

export class TursoAdapter implements SpileAdapter {
  private url: string
  private token: string
  private initialized = false

  constructor(opts: TursoAdapterOptions) {
    this.url = opts.url
    this.token = opts.authToken
  }

  private async ensureSchema(): Promise<void> {
    if (this.initialized) return
    const stmts = INIT_SQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(sql => ({ sql, args: [] }))
    await tursoExec(this.url, this.token, stmts)
    this.initialized = true
  }

  async exportConversation(conv: Conversation): Promise<ImportResult> {
    const start = Date.now()
    await this.ensureSchema()

    const { uuid: sessionId, chat_messages: messages = [] } = conv
    if (!sessionId) throw new Error('Missing conversation uuid')

    await tursoExec(this.url, this.token, [{
      sql: `INSERT INTO sessions
        (id, source, name, summary, model, platform, is_starred, is_temporary,
         started_at, updated_at, current_leaf_message_uuid)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          name=excluded.name, summary=excluded.summary,
          model=excluded.model, updated_at=excluded.updated_at,
          current_leaf_message_uuid=excluded.current_leaf_message_uuid`,
      args: [
        t(conv.uuid), t('claude_ai'),
        t(conv.name ?? 'Untitled'),
        t(conv.summary), t(conv.model), t(conv.platform),
        b(conv.is_starred), b(conv.is_temporary),
        isoToMs(conv.created_at), isoToMs(conv.updated_at),
        t(conv.current_leaf_message_uuid),
      ],
    }])

    const batch: TursoStatement[] = []
    const counter = { n: 0 }
    let blockCount = 0

    for (const msg of messages) {
      batch.push({
        sql: `INSERT OR IGNORE INTO ai_messages
          (session_id, uuid, parent_uuid, sender, seq, input_mode,
           truncated, stop_reason, text, files_json, attachments_json,
           sync_sources_json, created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        args: [
          t(sessionId), t(msg.uuid), t(msg.parent_message_uuid),
          t(msg.sender), n(msg.index), t(msg.input_mode),
          b(msg.truncated), t(msg.stop_reason), t(msg.text),
          t(msg.files ? JSON.stringify(msg.files) : null),
          t(msg.attachments ? JSON.stringify(msg.attachments) : null),
          t(msg.sync_sources ? JSON.stringify(msg.sync_sources) : null),
          isoToMs(msg.created_at), isoToMs(msg.updated_at),
        ],
      })

      if (batch.length >= BATCH) await flush(this.url, this.token, batch, counter)

      for (const [seq, block] of (msg.content ?? []).filter(b => b.type !== 'thinking').entries()) {
        batch.push({
          sql: `INSERT OR IGNORE INTO ai_content_blocks
            (message_id, seq, type, text, citations_json, summaries_json,
             cut_off, start_timestamp, stop_timestamp)
            SELECT id, ?, ?, ?, ?, ?, ?, ?, ?
            FROM ai_messages WHERE uuid = ? AND session_id = ?`,
          args: [
            n(seq), t(block.type), t(block.text),
            t(block.citations ? JSON.stringify(block.citations) : null),
            t(block.summaries ? JSON.stringify(block.summaries) : null),
            b(block.cut_off), isoToMs(block.start_timestamp), isoToMs(block.stop_timestamp),
            t(msg.uuid), t(sessionId),
          ],
        })
        blockCount++
        if (batch.length >= BATCH) await flush(this.url, this.token, batch, counter)
      }
    }

    await flush(this.url, this.token, batch, counter)

    return {
      session_id: sessionId,
      messages: messages.length,
      blocks: blockCount,
      elapsed_ms: Date.now() - start,
    }
  }
}
