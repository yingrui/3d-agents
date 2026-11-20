/**
 * 角色驱动器：语音引擎与渲染层之间唯一的共享状态。
 *
 * 这里刻意不用 React state —— 口型每帧都在变，用 React 重渲染会直接掉帧。
 * 语音引擎写入「目标值」，Avatar 组件在 useFrame 里做平滑插值。
 */

export type VisemeShape = 'aa' | 'ih' | 'ou' | 'ee' | 'oh'

export type MouthState = Record<VisemeShape, number>

export const VISEME_SHAPES: VisemeShape[] = ['aa', 'ih', 'ou', 'ee', 'oh']

export function emptyMouth(): MouthState {
  return { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }
}

export const driver = {
  /** 口型目标值，0..1，由 SpeechController 每帧写入 */
  mouth: emptyMouth(),
  /** 是否正在说话（用于点头、嘴部微动等次级动作） */
  speaking: false,
  /** 叠加表情目标值，0..1 */
  emotion: { happy: 0, relaxed: 0 },
}

export function resetMouth() {
  driver.mouth = emptyMouth()
}
