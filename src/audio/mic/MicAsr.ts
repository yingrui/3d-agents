/**
 * 麦克风 + VAD + 实时 ASR
 *
 * 链路：getUserMedia → AudioContext → 降采样到 16k → 本地 RMS VAD
 *      → 说话时把 PCM 推给 /api/asr → 拿 partial/final 文本
 *
 * 回合判定在本地做（静音 N 毫秒算说完），服务端 VAD 只负责断句，
 * 这样「什么时候该回答」完全可控，也才能在 TTS 播放时做打断。
 */

import { downsampleToPcm16, rms } from '../vad'

export type MicOptions = {
  threshold: number
  silenceMs: number
  sampleRate: number
}

export type MicCallbacks = {
  onPartial?: (text: string) => void
  onUtterance?: (text: string) => void
  onSpeechStart?: () => void
  onStatus?: (status: 'idle' | 'listening' | 'speech') => void
  onError?: (message: string) => void
}

const CHUNK = 2048
const PREROLL_MS = 400
const MIN_SPEECH_CHUNKS = 2

export class MicAsr {
  private options: MicOptions
  private callbacks: MicCallbacks

  private stream: MediaStream | null = null
  private ctx: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private sink: GainNode | null = null

  private ws: WebSocket | null = null
  private ready = false
  private queue: ArrayBuffer[] = []

  private running = false
  private inSpeech = false
  private above = 0
  private below = 0
  private preroll: Int16Array[] = []
  private prerollSamples = 0
  private prerollLimit = 0
  private chunkMs = 0

  private finals: string[] = []
  private lastPartial = ''
  private finishing = false
  private finishTimer = 0
  private ttsActive = false

  constructor(options: MicOptions, callbacks: MicCallbacks) {
    this.options = options
    this.callbacks = callbacks
    this.prerollLimit = Math.round((PREROLL_MS / 1000) * options.sampleRate)
  }

  get active() {
    return this.running
  }

  /** TTS 播放期间提高门限，尽量只让「真人更大的声音」触发打断 */
  setTtsActive(value: boolean) {
    this.ttsActive = value
  }

  async start() {
    if (this.running) return

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })

    const ctx = new AudioContext({ sampleRate: this.options.sampleRate })
    await ctx.resume()

    const source = ctx.createMediaStreamSource(stream)
    const processor = ctx.createScriptProcessor(CHUNK, 1, 1)
    const sink = ctx.createGain()
    sink.gain.value = 0

    processor.onaudioprocess = (event) => {
      this.onAudio(event.inputBuffer.getChannelData(0), ctx.sampleRate)
    }

    source.connect(processor)
    processor.connect(sink)
    sink.connect(ctx.destination)

    this.stream = stream
    this.ctx = ctx
    this.source = source
    this.processor = processor
    this.sink = sink

    this.chunkMs = (CHUNK / ctx.sampleRate) * 1000
    this.running = true
    this.callbacks.onStatus?.('listening')
  }

  stop() {
    this.running = false
    this.finishing = false
    window.clearTimeout(this.finishTimer)
    this.closeSocket()

    this.processor?.disconnect()
    this.source?.disconnect()
    this.sink?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    void this.ctx?.close()

    this.processor = null
    this.source = null
    this.sink = null
    this.stream = null
    this.ctx = null

    this.resetTurn()
    this.callbacks.onStatus?.('idle')
  }

  /** 打断时丢弃当前这一句（很可能是她自己的回声） */
  cancelTurn() {
    this.finishing = false
    window.clearTimeout(this.finishTimer)
    this.resetTurn()
    this.closeSocket()
    this.callbacks.onStatus?.('listening')
  }

  // ---------------------------------------------------------------------------

  private onAudio(input: Float32Array, inputRate: number) {
    if (!this.running) return

    const level = rms(input)
    const threshold = this.options.threshold * (this.ttsActive ? 2.5 : 1)
    const need = this.ttsActive ? 4 : MIN_SPEECH_CHUNKS

    if (level > threshold) {
      this.above += 1
      this.below = 0
    } else {
      this.above = 0
      this.below += 1
    }

    const pcm = downsampleToPcm16(input, inputRate, this.options.sampleRate)

    if (!this.inSpeech) {
      this.pushPreroll(pcm)
      if (this.above >= need && !this.finishing) {
        this.inSpeech = true
        this.below = 0
        // beginTurn 会把 preroll（含当前这一块）一次性发出去，这里不要再重复发
        this.beginTurn()
        this.callbacks.onSpeechStart?.()
        this.callbacks.onStatus?.('speech')
      }
      return
    }

    this.sendPcm(pcm)

    if (this.below * this.chunkMs >= this.options.silenceMs) {
      this.inSpeech = false
      this.endTurn()
    }
  }

  private pushPreroll(pcm: Int16Array) {
    this.preroll.push(pcm)
    this.prerollSamples += pcm.length
    while (this.prerollSamples > this.prerollLimit && this.preroll.length > 1) {
      const dropped = this.preroll.shift()
      if (dropped) this.prerollSamples -= dropped.length
    }
  }

  private beginTurn() {
    this.finals = []
    this.lastPartial = ''
    this.finishing = false
    this.connectSocket()

    // 把说话前的几百毫秒也补上，避免吞掉第一个字
    for (const chunk of this.preroll) this.sendPcm(chunk)
    this.preroll = []
    this.prerollSamples = 0
  }

  private endTurn() {
    this.finishing = true
    this.callbacks.onStatus?.('listening')
    this.send({ type: 'stop' })

    // 服务端迟迟不返回 done 时兜底
    this.finishTimer = window.setTimeout(() => this.submitTurn(), 1200)
  }

  private submitTurn() {
    if (!this.finishing) return
    this.finishing = false
    window.clearTimeout(this.finishTimer)

    const text = (this.finals.join('') || this.lastPartial).trim()
    this.resetTurn()
    this.closeSocket()

    if (text) this.callbacks.onUtterance?.(text)
  }

  private resetTurn() {
    this.inSpeech = false
    this.above = 0
    this.below = 0
    this.preroll = []
    this.prerollSamples = 0
    this.finals = []
    this.lastPartial = ''
  }

  private connectSocket() {
    if (this.ws) return
    this.ready = false
    this.queue = []

    const protocol = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${protocol}://${location.host}/api/asr`)
    ws.binaryType = 'arraybuffer'
    this.ws = ws

    ws.onopen = () => ws.send(JSON.stringify({ type: 'start' }))
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return
      try {
        this.onServerMessage(JSON.parse(event.data))
      } catch {
        /* noop */
      }
    }
    ws.onerror = () => this.callbacks.onError?.('语音识别连接失败')
    ws.onclose = () => {
      if (this.ws === ws) this.ws = null
    }
  }

  private onServerMessage(message: { type?: string; text?: string; message?: string }) {
    if (message.type === 'ready') {
      this.ready = true
      for (const chunk of this.queue) this.ws?.send(chunk)
      this.queue = []
      return
    }
    if (message.type === 'partial' && message.text) {
      this.lastPartial = message.text
      this.callbacks.onPartial?.(this.finals.join('') + message.text)
      return
    }
    if (message.type === 'final' && message.text) {
      this.finals.push(message.text)
      this.lastPartial = ''
      this.callbacks.onPartial?.(this.finals.join(''))
      return
    }
    if (message.type === 'done') {
      if (this.finishing) this.submitTurn()
      return
    }
    if (message.type === 'error') {
      this.callbacks.onError?.(message.message ?? '语音识别出错')
      if (this.finishing) this.submitTurn()
    }
  }

  private send(payload: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload))
  }

  private sendPcm(pcm: Int16Array) {
    const buffer = new ArrayBuffer(pcm.byteLength)
    new Uint8Array(buffer).set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength))
    if (this.ws?.readyState === WebSocket.OPEN && this.ready) this.ws.send(buffer)
    else if (this.ws) {
      this.queue.push(buffer)
      if (this.queue.length > 60) this.queue.shift()
    }
  }

  private closeSocket() {
    this.ws?.close()
    this.ws = null
    this.ready = false
    this.queue = []
  }
}
