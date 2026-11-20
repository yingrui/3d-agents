/**
 * 云端 TTS 播放器（阿里云百炼 Qwen-Audio-TTS）
 *
 * 职责：
 * 1. 把 LLM 的流式文本喂给本地代理（服务端自动分句、合成）
 * 2. 把返回的 PCM 分片按采样时钟排进 WebAudio
 * 3. 用服务端字级时间戳驱动口型
 *
 * 关键：口型时间轴和音频共用同一个时钟（AudioContext.currentTime），
 * 所以不会出现「声音和嘴对不上」的漂移。
 */
import { driver, resetMouth } from '../avatar/driver'
import { findEvent, timelineFromWords, type MouthEvent, type WordTiming } from './visemes'

type StateListener = (speaking: boolean) => void

type ServerMessage =
  | {
      type: 'sentence'
      phase: 'begin' | 'end'
      index: number
      text: string
      words: WordTiming[]
      startSample: number
      sampleRate: number
    }
  | { type: 'done' }
  | { type: 'error'; message: string }

export class CloudTts {
  private ws: WebSocket | null = null
  private ctx: AudioContext
  private gain: GainNode
  private queue: string[] = []
  private events: MouthEvent[] = []
  /** 每个句子的口型事件；sentence-end 会用完整对齐覆盖 begin 的残缺版本 */
  private bySentence = new Map<number, MouthEvent[]>()
  private sources = new Set<AudioBufferSourceNode>()
  private listeners = new Set<StateListener>()

  private nextTime = 0
  private anchor = 0
  private hasAnchor = false
  private raf = 0
  private doneTimer = 0
  private sampleRate = 22050

  private speaking = false
  private cancelled = false

  onError?: (message: string) => void

  constructor() {
    this.ctx = new AudioContext()
    this.gain = this.ctx.createGain()
    this.gain.gain.value = 1
    this.gain.connect(this.ctx.destination)
  }

  get isSpeaking() {
    return this.speaking
  }

  onState(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start() {
    if (this.ws) return
    this.cancelled = false
    this.events = []
    this.queue = []
    this.nextTime = 0
    this.anchor = 0
    this.hasAnchor = false
    void this.ctx.resume()
    this.setSpeaking(true)

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${location.host}/api/tts`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => {
      this.send({ type: 'start' })
      for (const message of this.queue) ws.send(message)
      this.queue = []
    }
    ws.onmessage = (event) => {
      if (typeof event.data === 'string') this.onJson(event.data)
      else this.playChunk(event.data as ArrayBuffer)
    }
    ws.onerror = () => this.fail('语音服务连接失败')
    ws.onclose = () => {
      this.ws = null
      if (!this.cancelled) this.scheduleStop()
    }

    this.loop()
  }

  /** 流式喂入 LLM 的增量文本 */
  feed(text: string) {
    if (!text) return
    this.send({ type: 'text', text })
  }

  /** 文本结束，让服务端把缓存的分句合成完 */
  finish() {
    this.send({ type: 'end' })
  }

  cancel() {
    this.cancelled = true
    this.clearAudio()
    this.ws?.close()
    this.ws = null
    this.stopSpeaking()
  }

  dispose() {
    this.cancel()
    this.listeners.clear()
    void this.ctx.close()
  }

  // ---------------------------------------------------------------------------

  private send(payload: unknown) {
    const message = JSON.stringify(payload)
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(message)
    else this.queue.push(message)
  }

  private onJson(raw: string) {
    let message: ServerMessage
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }

    if (message.type === 'sentence') {
      this.sampleRate = message.sampleRate || this.sampleRate
      const events = timelineFromWords(message.words)
      if (events.length) this.bySentence.set(message.index, events)
      this.events = [...this.bySentence.values()].flat().sort((a, b) => a.start - b.start)
      if (import.meta.env.DEV) {
        console.debug(
          '[tts] sentence',
          message.index,
          'words',
          message.phase,
          message.words.length,
          'span',
          `${message.words[0]?.begin ?? 0}–${message.words[message.words.length - 1]?.end ?? 0}ms`,
        )
      }
      return
    }

    if (message.type === 'done') {
      this.scheduleStop()
      return
    }

    if (message.type === 'error') {
      this.fail(message.message)
    }
  }

  private playChunk(data: ArrayBuffer) {
    if (this.cancelled) return
    const ctx = this.ctx
    const pcm = new Int16Array(data)
    if (!pcm.length) return

    const float = new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) float[i] = pcm[i] / 32768

    const buffer = ctx.createBuffer(1, float.length, this.sampleRate)
    buffer.copyToChannel(float, 0)

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(this.gain)

    const now = ctx.currentTime
    const at = Math.max(now + 0.05, this.nextTime)
    // 如果因为卡顿排到了后面，把口型时钟一起平移，保持音画同步
    if (this.nextTime > 0 && at > this.nextTime + 0.004) this.anchor += at - this.nextTime
    if (!this.hasAnchor) {
      this.anchor = at
      this.hasAnchor = true
    }

    source.start(at)
    this.nextTime = at + buffer.duration
    this.sources.add(source)
    source.onended = () => this.sources.delete(source)
  }

  private loop = () => {
    if (!this.speaking) return
    if (this.hasAnchor) {
      const time = this.ctx.currentTime - this.anchor
      const event = findEvent(this.events, time)
      const mouth = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }
      if (event) mouth[event.shape] = event.weight
      driver.mouth = mouth
    }
    this.raf = requestAnimationFrame(this.loop)
  }

  private scheduleStop() {
    if (this.doneTimer) return
    const remaining = this.hasAnchor
      ? Math.max(0, this.nextTime - this.ctx.currentTime) * 1000 + 120
      : 120
    this.doneTimer = window.setTimeout(() => this.stopSpeaking(), remaining)
  }

  private stopSpeaking() {
    if (!this.speaking) return
    this.speaking = false
    cancelAnimationFrame(this.raf)
    if (this.doneTimer) {
      clearTimeout(this.doneTimer)
      this.doneTimer = 0
    }
    resetMouth()
    for (const listener of this.listeners) listener(false)
  }

  private clearAudio() {
    if (this.doneTimer) {
      clearTimeout(this.doneTimer)
      this.doneTimer = 0
    }
    for (const source of this.sources) {
      try {
        source.stop()
      } catch {
        /* noop */
      }
    }
    this.sources.clear()
    this.events = []
    this.bySentence.clear()
    this.nextTime = 0
    this.anchor = 0
    this.hasAnchor = false
  }

  private setSpeaking(value: boolean) {
    if (this.speaking === value) return
    this.speaking = value
    for (const listener of this.listeners) listener(value)
  }

  private fail(message: string) {
    this.onError?.(message)
    this.cancelled = true
    this.clearAudio()
    this.ws?.close()
    this.ws = null
    this.stopSpeaking()
  }
}
