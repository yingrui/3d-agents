/**
 * 阿里云百炼 Qwen-Audio-TTS 本地代理（Vite 插件）
 *
 * 浏览器不能直接带 API Key 连百炼（会泄露 + 跨域），所以中间加一层：
 *   浏览器 ws://localhost:5288/api/tts  →  本插件  →  wss://dashscope.aliyuncs.com
 *
 * 协议（浏览器 ↔ 代理）：
 *   → { type:'start' }                   开一个合成任务
 *   → { type:'text', text }              流式喂文本，服务端自己分句
 *   → { type:'end' }                     文本结束
 *   → { type:'cancel' }                  打断
 *   ← { type:'sentence', index, text, words, startSample, sampleRate }
 *   ← <binary>                           16-bit LE mono PCM
 *   ← { type:'done' } / { type:'error', message }
 */
import type { Plugin } from 'vite'
import { WebSocket, type RawData } from 'ws'
import { createTaskId, dashscopeHeaders, dashscopeWsUrl } from './shared/dashscope'
import { attachWebSocket } from './shared/ws'

export type TtsPluginOptions = {
  apiKey?: string
  workspaceId?: string
  model?: string
  voice?: string
}

const SAMPLE_RATE = 22050
const MAX_IDLE_MS = 25_000

type WordTiming = { text: string; begin: number; end: number }

class TtsSession {
  private upstream: WebSocket | null = null
  private taskId = createTaskId()
  private pending: string[] = []
  private started = false
  private ended = false
  private closed = false
  private samples = 0
  private idleTimer: NodeJS.Timeout | null = null

  constructor(
    private client: WebSocket,
    private options: Required<TtsPluginOptions>,
  ) {
    client.on('message', (raw, isBinary) => {
      if (isBinary) return
      try {
        this.onClientMessage(JSON.parse(raw.toString()))
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

  private onClientMessage(message: { type?: string; text?: string }) {
    this.touch()
    if (message.type === 'start') {
      this.connect()
    } else if (message.type === 'text' && message.text) {
      if (this.started) this.sendText(message.text)
      else this.pending.push(message.text)
    } else if (message.type === 'end') {
      this.ended = true
      if (this.started) this.finishTask()
    } else if (message.type === 'cancel') {
      this.close()
    }
  }

  private connect() {
    if (this.upstream) return
    const { apiKey, workspaceId, model, voice } = this.options
    const upstream = new WebSocket(dashscopeWsUrl(workspaceId), {
      headers: dashscopeHeaders(apiKey),
    })
    this.upstream = upstream

    upstream.on('open', () => {
      upstream.send(
        JSON.stringify({
          header: { action: 'run-task', task_id: this.taskId, streaming: 'duplex' },
          payload: {
            task_group: 'audio',
            task: 'tts',
            function: 'SpeechSynthesizer',
            model,
            parameters: {
              text_type: 'PlainText',
              voice,
              format: 'pcm',
              sample_rate: SAMPLE_RATE,
              volume: 50,
              rate: 1,
              pitch: 1,
              enable_ssml: false,
              // 关键：开启后每个句子的 words[] 里带 begin_time / end_time（毫秒）
              word_timestamp_enabled: true,
            },
            input: {},
          },
        }),
      )
    })

    upstream.on('message', (data: RawData, isBinary: boolean) => {
      this.touch()
      if (isBinary) {
        const buffer = Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)
        this.samples += buffer.length / 2
        this.sendBinary(buffer)
        return
      }
      this.onServerEvent(JSON.parse(data.toString()))
    })

    upstream.on('error', () => this.fail('上游连接失败'))
    upstream.on('close', () => {
      this.upstream = null
    })
  }

  private onServerEvent(message: {
    header?: {
      event?: string
      error_message?: string
    }
    payload?: {
      output?: {
        type?: string
        sentence?: {
          index: number
          original_text?: string
          words?: Array<{ text: string; begin_time: number; end_time: number }>
        }
      }
    }
  }) {
    const event = message.header?.event

    if (event === 'task-started') {
      this.started = true
      for (const text of this.pending) this.sendText(text)
      this.pending = []
      if (this.ended) this.finishTask()
      return
    }

    if (event === 'result-generated') {
      const output = message.payload?.output
      if (!output) return
      const type = output.type
      if ((type === 'sentence-begin' || type === 'sentence-end') && output.sentence) {
        const sentence = output.sentence
        const words: WordTiming[] = (sentence.words ?? []).map((w) => ({
          text: w.text,
          begin: w.begin_time,
          end: w.end_time,
        }))
        this.sendJson({
          type: 'sentence',
          // begin 时 words 可能只覆盖句首，end 时才是完整对齐
          phase: type === 'sentence-end' ? 'end' : 'begin',
          index: sentence.index,
          text: sentence.original_text ?? '',
          words,
          startSample: this.samples,
          sampleRate: SAMPLE_RATE,
        })
      }
      return
    }

    if (event === 'task-finished') {
      this.sendJson({ type: 'done' })
      this.close()
      return
    }

    if (event === 'task-failed') {
      this.fail(message.header?.error_message ?? '合成失败')
    }
  }

  private sendText(text: string) {
    this.upstream?.send(
      JSON.stringify({
        header: { action: 'continue-task', task_id: this.taskId, streaming: 'duplex' },
        payload: { input: { text } },
      }),
    )
  }

  private finishTask() {
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

  private sendBinary(buffer: Buffer) {
    if (this.client.readyState === WebSocket.OPEN) this.client.send(buffer, { binary: true })
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

export function dashscopeTts(options: TtsPluginOptions): Plugin {
  const resolved: Required<TtsPluginOptions> = {
    apiKey: options.apiKey ?? '',
    workspaceId: options.workspaceId ?? '',
    model: options.model ?? 'qwen-audio-3.1-tts-flash',
    voice: options.voice ?? 'longanhuan_v3.1',
  }

  return {
    name: 'dashscope-tts',
    configureServer(server) {
      if (!resolved.apiKey) {
        server.config.logger.warn('[tts] 未配置 DASHSCOPE_API_KEY，语音回落到浏览器本地合成')
        return
      }

      attachWebSocket(server, '/api/tts', (client) => new TtsSession(client, resolved))

      server.config.logger.info(
        `[tts] 阿里云百炼已就绪 · ${resolved.model} · ${resolved.voice} (${resolved.workspaceId ? 'workspace 域名' : 'legacy 域名'})`,
      )
    },
  }
}
