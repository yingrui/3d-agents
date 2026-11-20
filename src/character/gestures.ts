/**
 * 程序化动作库：语义动作名 → 骨骼的「附加旋转量」。
 *
 * 这是兜底实现，不依赖动画片段。接 MetaHuman 后可以换成烘焙 clip，
 * 但语义名（greet/nod/shrug…）和上层调度不用改。
 */
import { isGestureTag, type CharacterTag, type GestureName } from '../conversation/tags'

type Axis = { x?: number; y?: number; z?: number }

export type GesturePose = {
  head?: Axis
  neck?: Axis
  chest?: Axis
  leftUpperArm?: Axis
  rightUpperArm?: Axis
  rightLowerArm?: Axis
}

export const GESTURE_CATALOG: Record<GestureName, { duration: number; label: string }> = {
  wave: { duration: 1.8, label: '打招呼挥手' },
  goodbye: { duration: 2.0, label: '告别挥手' },
  nod: { duration: 0.9, label: '点头' },
  shake_head: { duration: 1.0, label: '摇头' },
  shrug: { duration: 1.2, label: '摊手' },
  think_chin: { duration: 1.6, label: '思考摸下巴' },
  point_self: { duration: 1.2, label: '指自己' },
}

function envelope(age: number, duration: number, attack = 0.2, release = 0.3) {
  const rise = Math.min(1, age / attack)
  const fall = Math.min(1, Math.max(0, (duration - age) / release))
  return Math.max(0, Math.min(rise, fall))
}

/** 返回附加到基础姿势上的旋转量；动作结束后返回 null */
export function sampleGesture(tag: CharacterTag | null, age: number): GesturePose | null {
  if (!isGestureTag(tag)) return null

  const { duration } = GESTURE_CATALOG[tag]
  if (age < 0 || age > duration) return null
  const env = envelope(age, duration)

  switch (tag) {
    case 'wave':
    case 'goodbye': {
      return {
        rightUpperArm: { z: -1.5 * env, y: 0.02 * env },
        rightLowerArm: { z: -1.1 * env },
        head: { z: 0.05 * env, y: 0.03 * env },
      }
    }

    case 'nod': {
      const bob = Math.sin(age * 13) * 0.11 * env
      return { head: { x: bob }, neck: { x: bob * 0.4 } }
    }

    case 'shake_head': {
      const shake = Math.sin(age * 15) * 0.16 * env
      return { head: { y: shake }, neck: { y: shake * 0.3 } }
    }

    case 'shrug': {
      return {
        leftUpperArm: { z: 0.22 * env },
        rightUpperArm: { z: -0.22 * env },
        head: { z: 0.06 * env },
        chest: { x: -0.02 * env },
      }
    }

    // 这两个动作需要手部 IK / 烘焙 clip，程序化做出来会像「手臂横着伸出去」，
    // 所以先只做头部与上身的语义动作，手部留给动作素材。
    case 'think_chin': {
      return {
        head: { z: 0.16 * env, x: 0.05 * env, y: 0.08 * env },
        neck: { z: 0.05 * env },
      }
    }

    case 'point_self': {
      return {
        head: { x: 0.05 * env },
        chest: { x: 0.02 * env },
      }
    }

    default:
      return null
  }
}

export { GESTURE_TAGS } from '../conversation/tags'
