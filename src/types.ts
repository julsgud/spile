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
}

export interface ImportResult {
  session_id: string
  messages: number
  blocks: number
  elapsed_ms: number
}

/** Implement this interface to plug in a custom storage backend. */
export interface SpileAdapter {
  exportConversation(conv: Conversation): Promise<ImportResult>
}
