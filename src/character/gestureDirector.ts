/**
 * 动作调度：避免一句话里多个标签互相打断。
 *
 * 规则：
 * - 高优先级动作可以打断低优先级（挥手 > 点头/摇头 > 摊手/思考）
 * - 同优先级或低优先级不打断，排进队列等当前动作播完
 * - 队列最多 2 个，重复动作去重
 */
import type { CharacterTag, GestureName } from '../conversation/tags'
import { isGestureTag } from '../conversation/tags'
import { GESTURE_CATALOG } from './gestures'

export type GestureState = { tag: CharacterTag | null; start: number }

const PRIORITY: Record<GestureName, number> = {
  wave: 3,
  goodbye: 3,
  nod: 2,
  shake_head: 2,
  shrug: 1,
  think_chin: 1,
  point_self: 1,
}

const MAX_QUEUE = 2

export class GestureDirector {
  private current: GestureName | null = null
  private startedAt = 0
  private queue: GestureName[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private onChange: (state: GestureState) => void,
    private now: () => number = () => performance.now() / 1000,
  ) {}

  get active(): GestureName | null {
    return this.current
  }

  get pending(): GestureName[] {
    return [...this.queue]
  }

  request(tag: CharacterTag | null): void {
    if (!isGestureTag(tag)) return

    if (this.current && this.isPlaying()) {
      if (PRIORITY[tag] > PRIORITY[this.current]) {
        this.play(tag)
        return
      }
      this.enqueue(tag)
      return
    }

    this.play(tag)
  }

  reset(): void {
    this.clearTimer()
    this.current = null
    this.queue = []
    this.onChange({ tag: null, start: 0 })
  }

  private isPlaying(): boolean {
    if (!this.current) return false
    return this.now() - this.startedAt < GESTURE_CATALOG[this.current].duration
  }

  private enqueue(name: GestureName) {
    if (this.queue.length >= MAX_QUEUE) return
    if (name === this.current) return
    if (this.queue[this.queue.length - 1] === name) return
    this.queue.push(name)
  }

  private play(name: GestureName) {
    this.clearTimer()
    this.current = name
    this.startedAt = this.now()
    this.onChange({ tag: name, start: this.startedAt })

    // 动作结束后再放队首；+40ms 留一点余量，避免姿势没完全收回去
    const delay = GESTURE_CATALOG[name].duration * 1000 + 40
    this.timer = setTimeout(() => {
      this.timer = null
      this.advance()
    }, delay)
  }

  private advance() {
    const next = this.queue.shift()
    if (next) {
      this.play(next)
      return
    }
    this.current = null
    this.onChange({ tag: null, start: 0 })
  }

  private clearTimer() {
    if (!this.timer) return
    clearTimeout(this.timer)
    this.timer = null
  }
}
