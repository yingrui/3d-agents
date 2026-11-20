import { describe, expect, it } from 'vitest'
import { analyzeSyllable, charToViseme, timelineFromWords } from './visemes'

describe('analyzeSyllable', () => {
  it('拆分声母韵母', () => {
    expect(analyzeSyllable('zhong')).toEqual({ initial: 'zh', final: 'ong' })
    expect(analyzeSyllable('yuan')).toEqual({ initial: '', final: 'van' })
  })

  it('j/q/x 后面的 u 是 ü', () => {
    expect(analyzeSyllable('ju')).toEqual({ initial: 'j', final: 'v' })
  })
})

describe('charToViseme', () => {
  it('元音映射到口型', () => {
    expect(charToViseme('啊')?.shape).toBe('aa')
    expect(charToViseme('，')).toBeNull()
  })
})

describe('timelineFromWords', () => {
  it('时间戳是任务级绝对时间，不再叠加句子偏移', () => {
    const events = timelineFromWords([
      { text: '你好', begin: 100, end: 300 },
    ])
    expect(events).toHaveLength(2)
    expect(events[0].start).toBeCloseTo(0.1)
    expect(events[1].end).toBeCloseTo(0.3)
  })
})
