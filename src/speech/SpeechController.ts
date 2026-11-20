/**
 * 语音播放 + 口型驱动
 *
 * 设计要点（和真实后端一致）：
 * 1. 句子级队列：上游流式吐字，凑够一句就入队，不必等全文。
 * 2. 音频时钟为准：口型时间轴相对「本句音频起点」，用 onboundary 校正漂移。
 * 3. 可打断：cancel() 立即停音频、清队列、闭嘴。
 */
import { driver, resetMouth } from '../avatar/driver'
import { buildTimeline, findEvent, type MouthEvent } from './visemes'

type StateListener = (speaking: boolean) => void

function splitSentences(text: string): string[] {
  const out: string[] = []
  let buf = ''

  const flush = () => {
    const s = buf.trim()
    if (s) out.push(s)
    buf = ''
  }

  for (const ch of text) {
    buf += ch
    if (/[。！？!?；;\n]/.test(ch) && buf.trim().length > 1) {
      flush()
    } else if (/[，,、]/.test(ch) && buf.trim().length >= 16) {
      // 长从句先切出去，降低首句延迟
      flush()
    }
  }
  flush()
  return out
}

export class SpeechController {
  private queue: string[] = []
  private busy = false
  private generation = 0
  private listeners = new Set<StateListener>()
  private synth: SpeechSynthesis | null =
    typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
  private voice: SpeechSynthesisVoice | null = null
  private voiceHandler: (() => void) | null = null

  constructor() {
    this.pickVoice()
  }

  get speaking() {
    return this.busy
  }

  onState(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  enqueue(text: string) {
    const parts = splitSentences(text)
    if (!parts.length) return
    this.queue.push(...parts)
    if (!this.busy) void this.run()
  }

  cancel() {
    this.generation++
    this.queue = []
    if (this.synth) {
      try {
        this.synth.cancel()
      } catch {
        /* noop */
      }
    }
    this.setBusy(false)
    resetMouth()
  }

  dispose() {
    this.cancel()
    this.listeners.clear()
    this.queue = []
    if (this.synth && this.voiceHandler) {
      this.synth.onvoiceschanged = null
      this.voiceHandler = null
    }
  }

  private setBusy(value: boolean) {
    if (this.busy === value) return
    this.busy = value
    driver.speaking = value
    for (const l of this.listeners) l(value)
  }

  private pickVoice() {
    if (!this.synth) return
    const load = () => {
      const voices = this.synth?.getVoices() ?? []
      const preferred =
        voices.find(
          (v) =>
            /^zh/i.test(v.lang) &&
            /Ting|Xiaoxiao|Xiaoyi|Yunxi|Huihui|Yaoyao|Meijia|普通话|Mandarin/i.test(v.name),
        ) ?? voices.find((v) => /^zh/i.test(v.lang))
      this.voice = preferred ?? null
    }
    load()
    // 部分浏览器首次 getVoices() 为空，需要等 voiceschanged
    this.voiceHandler = load
    this.synth.onvoiceschanged = load
  }

  private async run() {
    if (this.busy) return
    const gen = this.generation
    this.setBusy(true)

    while (this.queue.length && gen === this.generation) {
      const text = this.queue.shift()
      if (!text) break
      await this.speakOne(text, gen)
    }

    if (gen === this.generation) {
      this.setBusy(false)
      resetMouth()
    }
  }

  private speakOne(text: string, gen: number): Promise<void> {
    const { events, charTime, duration } = buildTimeline(text)

    return new Promise((resolve) => {
      let settled = false
      let raf = 0
      let safety = 0
      let started = false
      let anchor = performance.now() / 1000

      const finish = () => {
        if (settled) return
        settled = true
        cancelAnimationFrame(raf)
        window.clearTimeout(safety)
        if (gen === this.generation) resetMouth()
        resolve()
      }

      const tick = () => {
        if (settled) return
        if (gen !== this.generation) {
          finish()
          return
        }
        const now = performance.now() / 1000 - anchor
        const ev: MouthEvent | undefined = findEvent(events, now)
        const mouth = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }
        if (ev) mouth[ev.shape] = ev.weight
        driver.mouth = mouth
        raf = requestAnimationFrame(tick)
      }

      // 兜底：即使 TTS 静默失败，也按时间轴演一遍，方便调试
      safety = window.setTimeout(finish, duration * 1000 + 3000)
      raf = requestAnimationFrame(tick)

      if (!this.synth) {
        window.setTimeout(finish, duration * 1000)
        return
      }

      const u = new SpeechSynthesisUtterance(text)
      u.lang = 'zh-CN'
      u.rate = 1.0
      u.pitch = 1.03
      u.volume = 1
      if (this.voice) u.voice = this.voice

      u.onstart = () => {
        started = true
        anchor = performance.now() / 1000
      }
      u.onboundary = (event) => {
        const idx = event.charIndex
        if (typeof idx === 'number' && charTime[idx] !== undefined) {
          anchor = performance.now() / 1000 - charTime[idx]
        }
      }
      u.onend = finish
      u.onerror = () => {
        if (started) {
          finish()
          return
        }
        // 没有可用语音（例如无中文音色）：按时间轴静默演完，保证口型演示不断
        const elapsed = performance.now() / 1000 - anchor
        const remain = Math.max(0, duration - elapsed) * 1000 + 80
        window.setTimeout(finish, remain)
      }

      try {
        this.synth.speak(u)
      } catch {
        window.setTimeout(finish, duration * 1000)
      }
    })
  }
}
