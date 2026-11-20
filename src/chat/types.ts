export type Role = 'user' | 'assistant'

export type Message = {
  id: string
  role: Role
  text: string
  /** 还没收到第一个 token */
  pending?: boolean
}

export type Phase = 'idle' | 'listening' | 'thinking' | 'speaking'
