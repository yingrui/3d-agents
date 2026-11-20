import { describe, expect, it } from 'vitest'
import { parseEmotion } from './emotion'

describe('parseEmotion', () => {
  it('去掉完整标签并返回情绪', () => {
    expect(parseEmotion('[happy]你好')).toEqual({ text: '你好', tag: 'happy' })
  })

  it('支持中文别名', () => {
    expect(parseEmotion('[开心]太好了')).toEqual({ text: '太好了', tag: 'happy' })
  })

  it('流式半截标签不泄漏到文本里', () => {
    expect(parseEmotion('[hap')).toEqual({ text: '', tag: null })
    expect(parseEmotion('[happy')).toEqual({ text: '', tag: null })
  })

  it('多个标签取最后一个', () => {
    const result = parseEmotion('[thinking]嗯……[happy]好的')
    expect(result.tag).toBe('happy')
    expect(result.text).toBe('嗯……好的')
  })

  it('不认识的短标签也吞掉', () => {
    expect(parseEmotion('[微笑]你好')).toEqual({ text: '你好', tag: null })
  })
})
