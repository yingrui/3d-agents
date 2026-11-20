import { describe, expect, it } from 'vitest'
import { lastSentenceEnd, speakable } from './text'

describe('lastSentenceEnd', () => {
  it('返回最后一个句末标点之后的位置', () => {
    expect(lastSentenceEnd('你好。世界')).toBe(3)
    expect(lastSentenceEnd('你好')).toBe(0)
  })
})

describe('speakable', () => {
  it('去掉 markdown 和 emoji', () => {
    expect(speakable('**你好**，[点这里](http://x)😊')).toBe('你好，点这里')
  })
})
