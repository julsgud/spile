import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import type { SpileAdapter } from './types.ts'

const PORT = parseInt(process.env.SPILE_PORT ?? '7842', 10)

// Load adapter from spile.config.ts — user owns this file
let adapter: SpileAdapter
try {
  const config = await import('../spile.config.ts')
  adapter = config.adapter
  if (!adapter || typeof adapter.exportConversation !== 'function') {
    throw new Error('spile.config.ts must export an `adapter` with an exportConversation method')
  }
} catch (err) {
  console.error('ERROR: Could not load spile.config.ts')
  console.error(err)
  process.exit(1)
}

const app = new Hono()

app.use('*', logger())
app.use('*', cors({ origin: 'https://claude.ai' }))

app.get('/', c => c.json({ ok: true, service: 'spile' }))

app.post('/import', async c => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON' }, 400)
  }

  const conv = body as { uuid?: string }
  if (!conv?.uuid) {
    return c.json({ ok: false, error: 'Missing conversation uuid' }, 400)
  }

  try {
    const result = await adapter.exportConversation(conv as never)
    return c.json({ ok: true, ...result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Export failed:', message)
    return c.json({ ok: false, error: message }, 500)
  }
})

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`spile listening on http://127.0.0.1:${PORT}`)
})
