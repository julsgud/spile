import { TursoAdapter } from './src/adapters/turso.ts'
import type { SpileAdapter } from './src/types.ts'

if (!process.env.TURSO_DB_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error('ERROR: TURSO_DB_URL and TURSO_AUTH_TOKEN must be set')
  process.exit(1)
}

export const adapter: SpileAdapter = new TursoAdapter({
  url: process.env.TURSO_DB_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})
