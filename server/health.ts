import type { Plugin } from 'vite'
import { sendJson } from './shared/http'

export type HealthSnapshot = {
  tts: { enabled: boolean; model: string; voice: string }
  llm: { enabled: boolean; model: string }
  asr: { enabled: boolean; model: string; sampleRate: number; vadThreshold: number; silenceMs: number }
}

/** 一次请求返回三套能力，前端据此决定用云端还是本地降级 */
export function healthPlugin(snapshot: HealthSnapshot): Plugin {
  return {
    name: 'health',
    configureServer(server) {
      server.middlewares.use('/api/health', (_req, res) => sendJson(res, 200, snapshot))
    },
  }
}
