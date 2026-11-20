/**
 * 文本 → 口型时间轴（Stage 1 的 mock 方案）
 *
 * 真实项目里这一步应该换成 TTS 返回的 viseme / 音素时间戳，
 * 或者 GPU 上的 Audio2Face。这里用拼音韵母做近似，只为把
 * 「音频时钟驱动口型」这条链路跑通。
 *
 * 关键点：时间轴的单位是「音频秒」，不是「字符数」。
 */
import { pinyin } from 'pinyin-pro'
import type { VisemeShape } from '../avatar/driver'

export type MouthEvent = {
  start: number
  end: number
  shape: VisemeShape
  weight: number
}

export type Timeline = {
  events: MouthEvent[]
  /** 每个字符对应的起始时间，供 SpeechSynthesis 的 onboundary 重新对齐 */
  charTime: number[]
  duration: number
}

const INITIALS = [
  'zh', 'ch', 'sh',
  'b', 'p', 'm', 'f', 'd', 't', 'n', 'l',
  'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w',
]

/** 零声母音节的规范写法 */
const ZERO_INITIAL: Record<string, string> = {
  yi: 'i', ya: 'ia', ye: 'ie', yao: 'iao', you: 'iou', yan: 'ian',
  yin: 'in', yang: 'iang', ying: 'ing', yong: 'iong',
  yu: 'v', yue: 've', yuan: 'van', yun: 'vn',
  wu: 'u', wa: 'ua', wo: 'uo', wai: 'uai', wei: 'uei',
  wan: 'uan', wen: 'uen', wang: 'uang', weng: 'ueng',
}

/** 韵母 → (口型, 强度) */
const FINAL_TABLE: Record<string, [VisemeShape, number]> = {
  a: ['aa', 0.95], ia: ['aa', 0.85], ua: ['aa', 0.8],
  ai: ['aa', 0.85], uai: ['aa', 0.75],
  an: ['aa', 0.8], uan: ['aa', 0.75], ang: ['aa', 0.9], uang: ['aa', 0.8],
  ao: ['aa', 0.85], iao: ['aa', 0.75],

  o: ['oh', 0.8], uo: ['oh', 0.75], ou: ['oh', 0.75],
  iou: ['oh', 0.6], ong: ['oh', 0.8], iong: ['oh', 0.7],

  e: ['ee', 0.72], ei: ['ee', 0.7], uei: ['ee', 0.6],
  en: ['ee', 0.55], eng: ['ee', 0.6], ie: ['ee', 0.7],
  ve: ['ee', 0.6], er: ['ee', 0.5], van: ['ee', 0.5],

  i: ['ih', 0.72], in: ['ih', 0.6], ing: ['ih', 0.65],

  u: ['ou', 0.72], uen: ['ou', 0.55], ueng: ['ou', 0.5],
  v: ['ou', 0.55], vn: ['ou', 0.5],
}

/** 舌尖元音（zhi / chi / shi / ri / zi / ci / si）嘴形很小 */
const APICAL_INITIALS = new Set(['zh', 'ch', 'sh', 'r', 'z', 'c', 's'])

const PAUSE: Record<string, number> = {
  '。': 0.34, '！': 0.34, '？': 0.34,
  '，': 0.18, '、': 0.14, '；': 0.24, '：': 0.2,
  '.': 0.34, '!': 0.34, '?': 0.34, ',': 0.18, ';': 0.24,
  '\n': 0.3,
}

const LATIN_SHAPE: Record<string, VisemeShape> = {
  a: 'aa', e: 'ee', i: 'ih', o: 'oh', u: 'ou', y: 'ih',
}

export function analyzeSyllable(raw: string): { initial: string; final: string } {
  const s = raw.replace(/ü/g, 'v').replace(/[^a-z]/g, '')
  if (!s) return { initial: '', final: '' }
  if (ZERO_INITIAL[s]) return { initial: '', final: ZERO_INITIAL[s] }

  let initial = ''
  for (const cand of INITIALS) {
    if (s.startsWith(cand)) {
      initial = cand
      break
    }
  }

  let final = s.slice(initial.length)
  // ju / qu / xu / juan / jun 实际是 ü 系
  if ((initial === 'j' || initial === 'q' || initial === 'x') && final.startsWith('u')) {
    final = 'v' + final.slice(1)
  }
  if (!final) final = initial === 'y' ? 'i' : initial === 'w' ? 'u' : 'e'

  return { initial, final }
}

function push(events: MouthEvent[], start: number, dur: number, shape: VisemeShape, weight: number) {
  events.push({ start, end: start + dur, shape, weight })
}

/** 韵母 → 口型；供 mock 时间轴和真实 TTS 时间戳共用 */
export function syllableViseme(initial: string, final: string): [VisemeShape, number] {
  const entry = FINAL_TABLE[final]
  if (entry) return entry
  if (APICAL_INITIALS.has(initial)) return ['ih', 0.28]
  return ['ee', 0.5]
}

/** 单个字符 → 口型（标点返回 null） */
export function charToViseme(ch: string): { shape: VisemeShape; weight: number } | null {
  if (/[\u3400-\u9fff]/.test(ch)) {
    const py = pinyin(ch, { toneType: 'none', type: 'array' })[0] ?? ''
    const { initial, final } = analyzeSyllable(py)
    const [shape, weight] = syllableViseme(initial, final)
    return { shape, weight }
  }
  const shape = LATIN_SHAPE[ch.toLowerCase()]
  return shape ? { shape, weight: 0.55 } : null
}

/** 生成单个音节，返回占用时长 */
function emitSyllable(
  events: MouthEvent[],
  start: number,
  initial: string,
  final: string,
): number {
  const [shape, weight] = syllableViseme(initial, final)

  let t = start
  if (initial) {
    const bilabial = initial === 'b' || initial === 'p' || initial === 'm'
    push(events, t, 0.05, bilabial ? 'ou' : shape, bilabial ? 0.1 : weight * 0.45)
    t += 0.05
  }
  push(events, t, 0.17, shape, weight)
  t += 0.17
  return t - start
}

export function buildTimeline(text: string): Timeline {
  const chars = Array.from(text)
  const events: MouthEvent[] = []
  const charTime: number[] = []
  let t = 0

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    charTime[i] = t

    if (PAUSE[ch] !== undefined) {
      t += PAUSE[ch]
      continue
    }
    if (/\s/.test(ch)) {
      t += 0.06
      continue
    }
    if (/[\u3400-\u9fff]/.test(ch)) {
      const py = pinyin(ch, { toneType: 'none', type: 'array' })[0] ?? ''
      const { initial, final } = analyzeSyllable(py)
      t += emitSyllable(events, t, initial, final)
      continue
    }

    const shape = LATIN_SHAPE[ch.toLowerCase()] ?? 'ee'
    push(events, t, 0.1, shape, 0.55)
    t += 0.11
  }

  return { events, charTime, duration: t + 0.15 }
}

/** 二分查找当前时刻的口型事件 */
export function findEvent(events: MouthEvent[], time: number): MouthEvent | undefined {
  let lo = 0
  let hi = events.length - 1
  let found: MouthEvent | undefined
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const ev = events[mid]
    if (ev.start <= time) {
      found = ev
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found && time < found.end ? found : undefined
}


// ---------------------------------------------------------------------------
// 真实 TTS 时间戳 → 口型
// ---------------------------------------------------------------------------

export type WordTiming = {
  text: string
  /** 相对本句音频起点的毫秒数 */
  begin: number
  end: number
}

/**
 * 用服务端返回的字级时间戳生成口型事件。
 *
 * 注意：Qwen-Audio-TTS 的 begin_time / end_time 是**相对整个任务**的毫秒数，
 * 不是相对当前句子（文档示例里一个任务只有一句，容易误判）。
 * 所以这里直接除以 1000 得到全局时间，不能再叠加句子的 startSample。
 */
export function timelineFromWords(words: WordTiming[]): MouthEvent[] {
  const events: MouthEvent[] = []

  for (const word of words) {
    const chars = Array.from(word.text)
    const duration = (word.end - word.begin) / 1000
    if (!chars.length || duration <= 0) continue

    const per = duration / chars.length
    chars.forEach((ch, index) => {
      const viseme = charToViseme(ch)
      if (!viseme) return
      const start = word.begin / 1000 + index * per
      events.push({ start, end: start + per, shape: viseme.shape, weight: viseme.weight })
    })
  }

  return events
}
