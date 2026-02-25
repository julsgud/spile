# spile

> A tiny local server that taps your claude.ai conversations into your own store.

Named after the [spile](https://en.wikipedia.org/wiki/Spile) — the tap you drive into a tree to draw out what's inside.

## What it does

1. You visit a claude.ai conversation
2. Click a bookmarklet
3. spile receives the conversation JSON and stores it via your configured adapter
4. Your conversations live in your own database

## Quick start

**Prerequisites:** Node 22+, pnpm

```bash
git clone https://github.com/you/spile
cd spile
pnpm install
cp .env.example .env
# Edit .env with your Turso credentials
pnpm start
```

## Plugging in your own adapter

spile ships with a Turso adapter, but you can store conversations anywhere.

Edit `spile.config.ts`:

```ts
import type { SpileAdapter, Conversation, ImportResult } from './src/types.ts'

class MyAdapter implements SpileAdapter {
  async exportConversation(conv: Conversation): Promise<ImportResult> {
    const start = Date.now()
    // write to Postgres, filesystem, webhook, anywhere
    await writeToMyDatabase(conv)
    return {
      session_id: conv.uuid,
      messages: conv.chat_messages?.length ?? 0,
      blocks: 0,
      elapsed_ms: Date.now() - start,
    }
  }
}

export const adapter: SpileAdapter = new MyAdapter()
```

## Bookmarklet

Copy `bookmarklet.js`, minify it, prefix with `javascript:`, and save as a browser bookmark. Click it on any `claude.ai/chat/*` page to export the conversation.

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `TURSO_DB_URL` | Yes (default adapter) | — | Turso database URL |
| `TURSO_AUTH_TOKEN` | Yes (default adapter) | — | Turso auth token |
| `SPILE_PORT` | No | `7842` | Port to listen on |

## Schema (default Turso adapter)

Three tables: `ai_sessions`, `ai_messages`, `ai_content_blocks`. Imports are idempotent — re-importing the same conversation is safe.

## License

MIT
