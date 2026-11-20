/**
 * 对话管线（纯逻辑，不依赖 React / DOM）
 *
 * 输入：LLM 的 token 流
 * 输出：三段式回调
 *   - onText     去掉情绪标签后的「干净文本」（给气泡显示）
 *   - onEmotion  情绪标签变化（驱动表情/动作）
 *   - onSpeech   新增的、可朗读的文本增量（给 TTS）
 */
import { parseTag, type CharacterTag } from './tags'
import { speakable } from './text'

export type ConversationSink = {
  onText: (text: string) => void
  onTag: (tag: CharacterTag) => void
  onSpeech: (delta: string) => void
}

export async function pumpConversation(
  source: AsyncIterable<string>,
  sink: ConversationSink,
): Promise<string> {
  let raw = ''
  let clean = ''
  let lastTag: CharacterTag | null = null
  let fed = 0

  for await (const chunk of source) {
    raw += chunk
    const parsed = parseTag(raw)
    clean = parsed.text

    if (parsed.tag && parsed.tag !== lastTag) {
      lastTag = parsed.tag
      sink.onTag(parsed.tag)
    }

    sink.onText(clean)

    const delta = clean.slice(fed)
    if (delta) sink.onSpeech(speakable(delta))
    fed = clean.length
  }

  return clean
}
