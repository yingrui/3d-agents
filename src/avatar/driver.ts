/**
 * 角色驱动器：语音/对话层与渲染层之间唯一的共享状态。
 *
 * 这里刻意不用 React state —— 口型每帧都在变，用 React 重渲染会直接掉帧。
 * 上层写入「目标值」，Avatar 在 useFrame 里做平滑插值。
 */
import type { EmotionTag } from '../chat/emotion'

export type VisemeShape = 'aa' | 'ih' | 'ou' | 'ee' | 'oh'

export type MouthState = Record<VisemeShape, number>

export type EmotionState = {
  happy: number
  sad: number
  angry: number
  surprised: number
  relaxed: number
}

export const VISEME_SHAPES: VisemeShape[] = ['aa', 'ih', 'ou', 'ee', 'oh']

export function emptyMouth(): MouthState {
  return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }
}

export function emptyEmotion(): EmotionState {
  return { happy: 0, sad: 0, angry: 0, surprised: 0, relaxed: 0 }
}

/** 情绪 → VRM 表情权重 */
export function emotionToExpression(tag: EmotionTag): Partial<EmotionState> {
  switch (tag) {
    case 'happy':
      // VRoid 的 happy 会眯眼，给太高会一直闭着眼，0.45 左右最像「笑」
      return { happy: 0.45 }
    case 'excited':
      return { happy: 0.6, surprised: 0.15 }
    case 'sad':
      return { sad: 0.65 }
    case 'angry':
      return { angry: 0.55 }
    case 'surprised':
      return { surprised: 0.8 }
    case 'relaxed':
      return { relaxed: 0.5 }
    case 'shy':
      return { happy: 0.25, relaxed: 0.3 }
    case 'wave':
      return { happy: 0.5 }
    case 'thinking':
      return { relaxed: 0.35 }
    default:
      return {}
  }
}

export const driver = {
  /** 口型目标值，0..1，由语音层每帧写入 */
  mouth: emptyMouth(),
  /** 是否正在说话（用于点头、嘴部微动等次级动作） */
  speaking: false,
  /** 表情目标值，0..1，由对话层按情绪标签写入 */
  emotion: emptyEmotion(),
  /** 一次性小动作，Avatar 按时间衰减播放 */
  gesture: { type: 'relaxed' as EmotionTag, start: 0 },
}

export function resetMouth() {
  driver.mouth = emptyMouth()
}

export function applyEmotion(tag: EmotionTag) {
  driver.emotion = { ...emptyEmotion(), ...emotionToExpression(tag) }
  driver.gesture = { type: tag, start: performance.now() / 1000 }
}

export function resetEmotion() {
  driver.emotion = emptyEmotion()
}
