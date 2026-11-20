/**
 * 角色驱动器：语音/对话层与渲染层之间唯一的共享状态。
 *
 * 这里刻意不用 React state —— 口型每帧都在变，用 React 重渲染会直接掉帧。
 * 上层写入「目标值」，角色 adapter 在每帧做平滑插值。
 */
import type { CharacterTag, GestureName } from '../conversation/tags'
import { isGestureTag } from '../conversation/tags'
import { GestureDirector } from './gestureDirector'

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

/** 标签 → 表情权重。动作标签也会带一点基础情绪。 */
export function emotionForTag(tag: CharacterTag): Partial<EmotionState> {
  switch (tag) {
    case 'happy':
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
    case 'thinking':
      return { relaxed: 0.35 }
    case 'shy':
      return { happy: 0.25, relaxed: 0.3 }
    case 'wave':
    case 'goodbye':
      return { happy: 0.5 }
    case 'nod':
      return { relaxed: 0.35, happy: 0.15 }
    case 'shake_head':
      return { relaxed: 0.3 }
    case 'shrug':
      return { relaxed: 0.4 }
    case 'think_chin':
      return { relaxed: 0.35 }
    case 'point_self':
      return { happy: 0.2, relaxed: 0.2 }
    default:
      return {}
  }
}

export const driver = {
  /** 口型目标值，0..1，由语音层每帧写入 */
  mouth: emptyMouth(),
  /** 是否正在说话 */
  speaking: false,
  /** 表情目标值，0..1 */
  emotion: emptyEmotion(),
  /** 最近一次动作标签，角色 adapter 按时间采样 */
  gesture: { tag: null as CharacterTag | null, start: 0 },
}

export function resetMouth() {
  driver.mouth = emptyMouth()
}

/** 动作调度器：高优先级打断，低优先级排队 */
const gestureDirector = new GestureDirector((state) => {
  driver.gesture = state
})

export function applyTag(tag: CharacterTag) {
  // 表情立即切换，和动作互不阻塞
  driver.emotion = { ...emptyEmotion(), ...emotionForTag(tag) }
  if (isGestureTag(tag)) gestureDirector.request(tag)
}

export function resetEmotion() {
  driver.emotion = emptyEmotion()
  gestureDirector.reset()
}

/** 给需要显式播放动作的地方用（比如未来的 UI 按钮） */
export function playGesture(name: GestureName) {
  applyTag(name)
}
