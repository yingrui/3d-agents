import { describe, expect, it } from 'vitest'
import { pumpConversation } from './pipeline'

async function* chunks(items: string[]) {
  for (const item of items) yield item
}

describe('pumpConversation', () => {
  it('流式标签被切开也能正确解析', async () => {
    const text: string[] = []
    const emotions: string[] = []
    const speech: string[] = []

    const clean = await pumpConversation(chunks(['[hap', 'py]你好', '，世界。']), {
      onText: (value) => text.push(value),
      onTag: (tag) => emotions.push(tag),
      onSpeech: (delta) => speech.push(delta),
    })

    expect(clean).toBe('你好，世界。')
    expect(emotions).toEqual(['happy'])
    expect(speech.join('')).toBe('你好，世界。')
    expect(text[text.length - 1]).toBe('你好，世界。')
  })

  it('标签变化只通知一次', async () => {
    const emotions: string[] = []
    await pumpConversation(chunks(['[happy]好', '的', '[happy]呀']), {
      onText: () => {},
      onTag: (tag) => emotions.push(tag),
      onSpeech: () => {},
    })
    expect(emotions).toEqual(['happy'])
  })
})
