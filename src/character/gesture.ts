/**
 * 程序化小动作：不依赖动画片段，直接叠加骨骼旋转。
 *
 * - gestureOffset: 头部/上半身的一次性动作，指数衰减
 * - waveOffset:   挥手，用包络控制抬起 → 摆动 → 放下
 */
import type { EmotionTag } from '../conversation/emotion'

export const WAVE_DURATION = 1.8

export function waveOffset(age: number) {
  const rise = Math.min(1, age / 0.22)
  const fall = Math.min(1, Math.max(0, (WAVE_DURATION - age) / 0.32))
  const env = Math.max(0, Math.min(rise, fall))
  return {
    // 上臂抬到胸口上方约 30°，小臂再折起来，手落在头侧
    raise: 1.5 * env,
    bend: -1.1 * env,
    sway: Math.sin(age * 9) * 0.14 * env,
  }
}

export function gestureOffset(type: EmotionTag, age: number) {
  const decay = Math.exp(-age * 2.2)
  switch (type) {
    case 'happy':
    case 'excited':
      return { x: Math.sin(age * 9) * 0.022 * decay, y: 0, z: Math.sin(age * 9 + 1) * 0.02 * decay }
    case 'surprised':
      return { x: -0.13 * decay, y: 0, z: 0 }
    case 'sad':
      return { x: 0.12 * decay, y: 0, z: 0 }
    case 'thinking':
      return { x: 0.03 * decay, y: 0.13 * decay, z: 0.15 * decay }
    case 'angry':
      return { x: 0.06 * decay, y: 0, z: 0 }
    case 'wave':
      return { x: -0.02 * decay, y: 0.04 * decay, z: 0.05 * decay }
    default:
      return { x: 0, y: 0, z: 0.04 * decay }
  }
}
