# File Capture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Capture file paths from claude.ai generated outputs (PDFs, markdown) during bookmarklet export and store them in Turso alongside the conversation.

**Architecture:** The bookmarklet walks the React fiber tree from `[aria-label="Download"]` buttons to extract `/mnt/user-data/...` file paths. These are sent as `captured_files: string[]` in the POST body alongside the conversation JSON. The TursoAdapter stores them in a new `ai_session_files` table (UNIQUE on session_id + path).

**Tech Stack:** Node 22, TypeScript (`--experimental-strip-types`), Hono, Turso HTTP API, vanilla JS bookmarklet

---

## Files Overview

```
spile/
├── bookmarklet.js                  ← Task 4: add React fiber walk + captured_files in body
├── src/
│   ├── types.ts                    ← Task 1: add captured_files to Conversation, files to ImportResult
│   ├── server.ts                   ← Task 3: update success alert to include files count
│   └── adapters/
│       └── turso.ts                ← Task 2: ai_session_files table + insert + return files count
```

---

## Current POST body shape

```json
{ "uuid": "...", "name": "...", "chat_messages": [...], ... }
```

## New POST body shape

```json
{ "uuid": "...", "name": "...", "chat_messages": [...], ..., "captured_files": ["/mnt/user-data/outputs/foo.md"] }
```

---

### Task 1: Update `src/types.ts`

**Files:**
- Modify: `src/types.ts`

**Step 1: Add `captured_files` to `Conversation` and `files` to `ImportResult`**

Edit `src/types.ts`. Current `Conversation` ends at `chat_messages`. Add one field. Current `ImportResult` has `elapsed_ms`. Add `files`.

Full updated file:

```typescript
export interface ContentBlock {
  type: string
  text?: string
  thinking?: string
  citations?: unknown[]
  summaries?: unknown[]
  cut_off?: boolean
  start_timestamp?: string
  stop_timestamp?: string
}

export interface ChatMessage {
  uuid: string
  parent_message_uuid?: string
  sender: string
  index?: number
  input_mode?: string
  truncated?: boolean
  stop_reason?: string
  text?: string
  content?: ContentBlock[]
  files?: unknown[]
  attachments?: unknown[]
  sync_sources?: unknown[]
  created_at?: string
  updated_at?: string
}

export interface Conversation {
  uuid: string
  name?: string
  summary?: string
  model?: string
  platform?: string
  is_starred?: boolean
  is_temporary?: boolean
  created_at?: string
  updated_at?: string
  current_leaf_message_uuid?: string
  chat_messages?: ChatMessage[]
  captured_files?: string[]
}

export interface ImportResult {
  session_id: string
  messages: number
  blocks: number
  files: number
  elapsed_ms: number
}

/** Implement this interface to plug in a custom storage backend. */
export interface SpileAdapter {
  exportConversation(conv: Conversation): Promise<ImportResult>
}
```

**Step 2: Verify TypeScript parses**

```bash
cd /home/moltbot/spile
node --experimental-strip-types --input-type=module - <<'EOF'
import type { Conversation } from './src/types.ts'
const c: Conversation = { uuid: 'test', captured_files: ['/mnt/test.md'] }
console.log('types.ts OK', c.captured_files)
EOF
```

Expected: `types.ts OK [ '/mnt/test.md' ]`

**Step 3: Commit**

```bash
cd /home/moltbot/spile
git add src/types.ts
git commit -m "feat(spile): add captured_files to Conversation type, files to ImportResult"
```

---

### Task 2: Update `src/adapters/turso.ts`

**Files:**
- Modify: `src/adapters/turso.ts`

This is the main storage change. Two additions:
1. A new `ai_session_files` table in `INIT_SQL`
2. Insert captured file paths after the session upsert
3. Return `files` count in `ImportResult`

**Step 1: Add `ai_session_files` table to `INIT_SQL`**

In `src/adapters/turso.ts`, find `INIT_SQL`. After the last `CREATE INDEX` line and before the closing backtick, append:

```sql
CREATE TABLE IF NOT EXISTS ai_session_files (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT    NOT NULL REFERENCES sessions(id),
  path       TEXT    NOT NULL,
  UNIQUE(session_id, path)
);
CREATE INDEX IF NOT EXISTS idx_ai_session_files_session ON ai_session_files(session_id);
```

**Step 2: Insert captured files in `exportConversation`**

In the `exportConversation` method, after the `await tursoExec(...)` call that upserts the session (around line 166) and before the `const batch: TursoStatement[] = []` line, add:

```typescript
// Store captured file paths (from bookmarklet DOM scraping)
const capturedFiles = conv.captured_files ?? []
if (capturedFiles.length > 0) {
  await tursoExec(this.url, this.token, capturedFiles.map(path => ({
    sql: `INSERT OR IGNORE INTO ai_session_files (session_id, path) VALUES (?, ?)`,
    args: [t(sessionId), t(path)],
  })))
}
```

**Step 3: Return `files` count**

In the `return` statement at the end of `exportConversation`, add `files: capturedFiles.length`:

```typescript
return {
  session_id: sessionId,
  messages: messages.length,
  blocks: blockCount,
  files: capturedFiles.length,
  elapsed_ms: Date.now() - start,
}
```

**Step 4: Verify TypeScript parses**

```bash
cd /home/moltbot/spile
node --experimental-strip-types --input-type=module - <<'EOF'
import { TursoAdapter } from './src/adapters/turso.ts'
console.log('turso.ts OK', typeof TursoAdapter)
EOF
```

Expected: `turso.ts OK function`

**Step 5: Commit**

```bash
cd /home/moltbot/spile
git add src/adapters/turso.ts
git commit -m "feat(spile): store captured file paths in ai_session_files table"
```

---

### Task 3: Update `src/server.ts`

**Files:**
- Modify: `src/server.ts`

Minor: the success response already includes `...result` which now has `files`. No server.ts logic change needed — the field flows through automatically. Just verify it's included in the response.

**Step 1: Verify server response includes `files`**

Read `src/server.ts` line 46: `return c.json({ ok: true, ...result })` — `result` now includes `files`. No change needed.

**Step 2: Commit**

No changes to commit for server.ts. The `files` field flows through `...result` automatically.

---

### Task 4: Update `bookmarklet.js`

**Files:**
- Modify: `bookmarklet.js`

This is the most significant change. After fetching the conversation JSON, the bookmarklet must:
1. Query all `[aria-label="Download"]` buttons in the DOM
2. Walk up each button's React fiber tree (up to 20 levels) looking for string props containing `/mnt/user-data/`
3. Deduplicate and include as `captured_files` in the POST body
4. Update the success alert to show file count

**Step 1: Add fiber walk helper and update POST body**

Replace `bookmarklet.js` with:

```javascript
// Minify this and prefix with `javascript:` to use as a bookmarklet.
// Or paste the minified version directly into the bookmarklet URL field.
(async () => {
  const match = location.pathname.match(/\/chat\/([a-f0-9-]{36})/)
  if (!match) {
    alert('spile: not on a claude.ai chat page')
    return
  }
  const uuid = match[1]

  // Get org ID from the organizations API
  let orgId
  try {
    const r = await fetch('https://claude.ai/api/organizations', { credentials: 'include' })
    if (!r.ok) throw new Error('orgs API ' + r.status)
    const orgs = await r.json()
    orgId = orgs[0]?.uuid || orgs[0]?.id
    if (!orgId) throw new Error('no org found')
  } catch (err) {
    alert('spile: could not get org — ' + err.message)
    return
  }

  // Fetch conversation JSON from claude.ai's internal API
  let conv
  try {
    const resp = await fetch(
      `https://claude.ai/api/organizations/${orgId}/chat_conversations/${uuid}?tree=True&rendering_mode=messages`,
      { credentials: 'include' }
    )
    if (!resp.ok) throw new Error('claude.ai API ' + resp.status)
    conv = await resp.json()
  } catch (err) {
    alert(`spile: failed to fetch — ${err.message}`)
    return
  }

  // Extract file paths from React fiber tree via Download buttons
  function extractFilePaths() {
    const paths = []
    document.querySelectorAll('[aria-label="Download"]').forEach(btn => {
      const fiberKey = Object.keys(btn).find(k => k.startsWith('__reactFiber'))
      if (!fiberKey) return
      let fiber = btn[fiberKey]
      let depth = 0
      while (fiber && depth < 20) {
        const props = fiber.memoizedProps
        if (props) {
          for (const v of Object.values(props)) {
            if (typeof v === 'string' && v.includes('/mnt/user-data/')) {
              paths.push(v)
              return
            }
          }
        }
        fiber = fiber.return
        depth++
      }
    })
    return [...new Set(paths)]
  }

  const capturedFiles = extractFilePaths()

  // POST to spile server
  try {
    const resp = await fetch('https://botilcetin.tail67efd7.ts.net/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...conv, captured_files: capturedFiles }),
    })
    const result = await resp.json()
    if (result.ok) {
      const filePart = result.files > 0 ? `, ${result.files} file(s)` : ''
      alert(`spile: imported ${result.messages} messages${filePart} (${result.elapsed_ms}ms)`)
    } else {
      alert(`spile: error — ${result.error}`)
    }
  } catch (err) {
    alert(`spile: could not reach server — ${err.message}`)
  }
})()
```

**Step 2: Minify for bookmarklet use**

The minified one-liner for the bookmarklet URL (manually minify or use the source as-is for testing):

Test the bookmarklet source works first, minify after confirming it works end-to-end.

**Step 3: Verify the server is running and test on a conversation with files**

1. Make sure spile is running on VPS:
   ```bash
   # On VPS:
   ps aux | grep 'node.*spile' | grep -v grep
   ```
   If not running:
   ```bash
   cd /home/moltbot/spile
   set -a && source .env && set +a
   nohup node --experimental-strip-types src/server.ts > /tmp/spile.log 2>&1 &
   ```

2. Navigate to a claude.ai conversation that has generated file outputs (look for Download buttons)

3. Run the bookmarklet

4. Expected alert: `spile: imported 42 messages, 2 file(s) (183ms)`
   Or if no files: `spile: imported 42 messages (183ms)` (unchanged behavior)

**Step 4: Verify rows in Turso**

```bash
# Quick check via curl against Turso HTTP API
curl -s -X POST "$TURSO_DB_URL/v2/pipeline" \
  -H "Authorization: Bearer $TURSO_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"requests":[{"type":"execute","stmt":{"sql":"SELECT * FROM ai_session_files LIMIT 5","args":[]}}]}'
```

Expected: JSON response with rows containing `session_id` and `path` columns.

**Step 5: Commit**

```bash
cd /home/moltbot/spile
git add bookmarklet.js docs/plans/2026-02-26-file-capture.md
git commit -m "feat(spile): capture file paths via React fiber walk in bookmarklet"
git push
```

---

## Notes

**React fiber key:** The `__reactFiber` prefix is stable across React versions. The full key has a random suffix (e.g. `__reactFiber$abc123`). `Object.keys(el).find(k => k.startsWith('__reactFiber'))` handles this correctly.

**Fiber walk depth:** 20 levels is generous. The file path prop is typically 3-8 levels up from the button element.

**Prop search pattern:** We look for any string value containing `/mnt/user-data/` — specific enough to avoid false positives, doesn't rely on knowing the exact prop name.

**No files present:** If a conversation has no Download buttons, `extractFilePaths()` returns `[]`. The `captured_files` key is still sent (empty array), no DB rows written. Alert unchanged.

**UNIQUE constraint:** `ai_session_files(session_id, path)` uses `INSERT OR IGNORE` — re-running the bookmarklet on the same conversation is safe.
