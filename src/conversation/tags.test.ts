import { describe, expect, it } from 'vitest'
import { isGestureTag, parseTag } from './tags'

describe('parseTag', () => {
  it('去掉完整标签并返回情绪', () => {
    expect(parseTag('[happy]你好')).toEqual({ text: '你好', tag: 'happy' })
  })

  it('支持中文别名', () => {
    expect(parseTag('[开心]太好了')).toEqual({ text: '太好了', tag: 'happy' })
  })

  it('流式半截标签不泄漏到文本里', () => {
    expect(parseTag('[hap')).toEqual({ text: '', tag: null })
    expect(parseTag('[happy')).toEqual({ text: '', tag: null })
  })

  it('多个标签取最后一个', () => {
    const result = parseTag('[thinking]嗯……[happy]好的')
    expect(result.tag).toBe('happy')
    expect(result.text).toBe('嗯……好的')
  })

  it('不认识的短标签也吞掉', () => {
    expect(parseTag('[微笑]你好')).toEqual({ text: '你好', tag: null })
  })
})

describe('gesture tags', () => {
  it('识别动作标签', () => {
    expect(parseTag('[nod]好的')).toEqual({ text: '好的', tag: 'nod' })
    expect(parseTag('[挥手]再见')).toEqual({ text: '再见', tag: 'wave' })
  })

  it('区分情绪和动作', () => {
    expect(isGestureTag('wave')).toBe(true)
    expect(isGestureTag('happy')).toBe(false)
    expect(isGestureTag(null)).toBe(false)
  })
})
