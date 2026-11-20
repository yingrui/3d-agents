import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GestureDirector, type GestureState } from './gestureDirector'

function setup() {
  let t = 0
  const states: GestureState[] = []
  const director = new GestureDirector((state) => states.push(state), () => t)
  return {
    director,
    states,
    advance(ms: number) {
      t += ms / 1000
      vi.advanceTimersByTime(ms)
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GestureDirector', () => {
  it('空闲时立即播放', () => {
    const { director, states } = setup()
    director.request('nod')
    expect(director.active).toBe('nod')
    expect(states[0]).toEqual({ tag: 'nod', start: 0 })
  })

  it('同优先级排队，等前一个播完', () => {
    const { director, states, advance } = setup()
    director.request('nod')
    director.request('shake_head')

    expect(director.active).toBe('nod')
    expect(director.pending).toEqual(['shake_head'])

    advance(940)
    expect(director.active).toBe('shake_head')
    expect(states[states.length - 1].tag).toBe('shake_head')
  })

  it('高优先级打断低优先级', () => {
    const { director, states } = setup()
    director.request('nod')
    director.request('wave')

    expect(director.active).toBe('wave')
    expect(director.pending).toEqual([])
    expect(states[states.length - 1].tag).toBe('wave')
  })

  it('队列最多两个，重复动作去重', () => {
    const { director } = setup()
    director.request('nod')
    director.request('shrug')
    director.request('shrug')
    director.request('shake_head')
    director.request('think_chin')

    expect(director.pending).toEqual(['shrug', 'shake_head'])
  })

  it('reset 清空当前与队列', () => {
    const { director, states } = setup()
    director.request('nod')
    director.request('shrug')
    director.reset()

    expect(director.active).toBeNull()
    expect(director.pending).toEqual([])
    expect(states[states.length - 1]).toEqual({ tag: null, start: 0 })
  })
})
