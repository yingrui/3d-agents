/**
 * 阿里云百炼 Fun-ASR 实时语音识别代理
 *
 *   浏览器 ws://.../api/asr
 *     → { type:'start' }        开一个识别任务
 *     → <binary>                16kHz / 16-bit / 单声道 PCM
 *     → { type:'stop' }         说完了，finish-task
 *   ← { type:'ready' }          任务已启动
 *   ← { type:'partial', text }  中间结果
 *   ← { type:'final', text }    一句的最终结果
 *   ← { type:'done' }           任务结束
 *   ← { type:'error', message }
 */
import type { Plugin } from 'vite'
import { WebSocketServer, WebSocket, type RawData } from 'ws'
import { randomUUID } from 'node:crypto'

export type AsrPluginOptions = {
  apiKey?: string
  workspaceId?: string
  model?: string
  sampleRate?: number
  vadThreshold?: number
  silenceMs?: number
  /** 领域词表，帮助识别专有名词（比如角色名） */
  context?: string
}

type V = Required<AsrPluginOptions>

const MAX_IDLE_MS = 20_000

class AsrSession {
  private upstream: WebSocket | null = null
  private taskId = randomUUID().replace(/-/g, '').slice(0, 32)
  private started = false
  private stopping = false
  private closed = false
  private pending: Buffer[] = []
  private idleTimer: NodeJS.Timeout | null = null

  constructor(
    private client: WebSocket,
    private options: V,
  ) {
    client.on('message', (raw, isBinary) => {
      this.touch()
      if (isBinary) {
        this.onAudio(Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as ArrayBuffer))
        return
      }
      try {
        this.onClientMessage(JSON.parse(String(raw)))
      } catch {
        this.fail('非法消息')
      }
    })
    client.on('close', () => this.close())
    client.on('error', () => this.close())
    this.touch()
  }

  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => this.close(), MAX_IDLE_MS)
  }

  private onClientMessage(message: { type?: string }) {
    if (message.type === 'start') this.connect()
    else if (message.type === 'stop') this.finish()
    else if (message.type === 'cancel') this.close()
  }

  private onAudio(buffer: Buffer) {
    if (this.upstream?.readyState !== WebSocket.OPEN) {
      this.pending.push(buffer)
      if (this.pending.length > 40) this.pending.shift()
      return
    }
    if (!this.started) {
      this.pending.push(buffer)
      return
    }
    this.upstream.send(buffer, { binary: true })
  }

  private connect() {
    if (this.upstream) return
    const { apiKey, workspaceId, model, sampleRate, context } = this.options
    const url = workspaceId
      ? `wss://${workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`
      : 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'

    const upstream = new WebSocket(url, {
      headers: { Authorization: `bearer ${apiKey}` },
    })
    this.upstream = upstream

    upstream.on('open', () => {
      upstream.send(
        JSON.stringify({
          header: { action: 'run-task', task_id: this.taskId, streaming: 'duplex' },
          payload: {
            task_group: 'audio',
            task: 'asr',
            function: 'recognition',
            model,
            parameters: {
              format: 'pcm',
              sample_rate: sampleRate,
              // 服务端 VAD 断句阈值，和浏览器本地 VAD 是两套，互补使用
              max_sentence_silence: Math.max(200, Math.round(this.options.silenceMs * 0.8)),
              language_hints: ['zh'],
            },
            input: context
              ? {
                  context: [
                    {
                      role: 'user',
                      content: [{ type: 'input_text', text: context }],
                    },
                  ],
                }
              : {},
          },
        }),
      )
    })

    upstream.on('message', (data: RawData, isBinary: boolean) => {
      this.touch()
      if (isBinary) return
      this.onServerEvent(JSON.parse(data.toString()))
    })

    upstream.on('error', () => this.fail('识别服务连接失败'))
    upstream.on('close', () => {
      this.upstream = null
    })
  }

  private onServerEvent(message: {
    header?: { event?: string; error_message?: string }
    payload?: {
      output?: {
        sentence?: {
          text?: string
          sentence_end?: boolean
          sentence_begin?: boolean
          heartbeat?: boolean
        }
      }
    }
  }) {
    const event = message.header?.event

    if (event === 'task-started') {
      this.started = true
      this.sendJson({ type: 'ready' })
      for (const chunk of this.pending) this.upstream?.send(chunk, { binary: true })
      this.pending = []
      return
    }

    if (event === 'result-generated') {
      const sentence = message.payload?.output?.sentence
      if (!sentence || sentence.heartbeat) return
      const text = (sentence.text ?? '').trim()
      if (!text) return
      this.sendJson({ type: sentence.sentence_end ? 'final' : 'partial', text })
      return
    }

    if (event === 'task-finished') {
      this.sendJson({ type: 'done' })
      this.close()
      return
    }

    if (event === 'task-failed') {
      this.fail(message.header?.error_message ?? '识别失败')
    }
  }

  private finish() {
    if (this.stopping) return
    this.stopping = true
    this.upstream?.send(
      JSON.stringify({
        header: { action: 'finish-task', task_id: this.taskId, streaming: 'duplex' },
        payload: { input: {} },
      }),
    )
  }

  private sendJson(payload: unknown) {
    if (this.client.readyState === WebSocket.OPEN) this.client.send(JSON.stringify(payload))
  }

  private fail(message: string) {
    this.sendJson({ type: 'error', message })
    this.close()
  }

  private close() {
    if (this.closed) return
    this.closed = true
    if (this.idleTimer) clearTimeout(this.idleTimer)
    try {
      this.upstream?.close()
    } catch {
      /* noop */
    }
    try {
      this.client.close()
    } catch {
      /* noop */
    }
  }
}

export function dashscopeAsr(options: AsrPluginOptions): Plugin {
  const resolved: V = {
    apiKey: options.apiKey ?? '',
    workspaceId: options.workspaceId ?? '',
    model: options.model ?? 'fun-asr-realtime',
    sampleRate: options.sampleRate ?? 16000,
    vadThreshold: options.vadThreshold ?? 0.02,
    silenceMs: options.silenceMs ?? 700,
    context: options.context ?? '',
  }

  return {
    name: 'dashscope-asr',
    configureServer(server) {
      server.middlewares.use('/api/asr/health', (_req, res) => {
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            enabled: Boolean(resolved.apiKey),
            model: resolved.model,
            sampleRate: resolved.sampleRate,
            vadThreshold: resolved.vadThreshold,
            silenceMs: resolved.silenceMs,
          }),
        )
      })

      if (!resolved.apiKey) {
        server.config.logger.warn('[asr] 未配置 DASHSCOPE_API_KEY，麦克风功能不可用')
        return
      }

      const wss = new WebSocketServer({ noServer: true })
      const onUpgrade = (req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
        const { pathname } = new URL(req.url ?? '/', 'http://localhost')
        if (pathname !== '/api/asr') return
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
      }

      server.httpServer?.on('upgrade', onUpgrade)
      server.httpServer?.on('close', () => wss.close())
      wss.on('connection', (client) => new AsrSession(client, resolved))

      server.config.logger.info(`[asr] ${resolved.model} 已就绪（${resolved.sampleRate}Hz）`)
    },
  }
}
