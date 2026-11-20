import { describe, expect, it } from 'vitest'
import { GESTURE_CATALOG, sampleGesture } from './gestures'

describe('sampleGesture', () => {
  it('点头会摆动头部，结束后归零', () => {
    const pose = sampleGesture('nod', 0.2)
    expect(pose?.head?.x).toBeTypeOf('number')
    expect(sampleGesture('nod', 5)).toBeNull()
  })

  it('摊手会抬起双臂', () => {
    const pose = sampleGesture('shrug', 0.6)
    expect(pose?.leftUpperArm?.z).toBeGreaterThan(0)
    expect(pose?.rightUpperArm?.z).toBeLessThan(0)
  })

  it('情绪标签不会触发动作', () => {
    expect(sampleGesture('happy', 0.2)).toBeNull()
  })

  it('每个动作都有时长', () => {
    for (const name of Object.keys(GESTURE_CATALOG)) {
      expect(GESTURE_CATALOG[name as keyof typeof GESTURE_CATALOG].duration).toBeGreaterThan(0)
    }
  })
})
