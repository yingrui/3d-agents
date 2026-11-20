/**
 * 情绪标签：让 LLM 用 `[happy]` 这样的前缀控制表情，标签本身不朗读、不显示。
 *
 * 流式解析的难点在于标签可能被切成两半（"[hap" + "py]"），
 * 所以清理时要顺手把末尾写了一半的 "[xxx" 去掉。
 */

export const EMOTION_TAGS = [
  'happy',
  'sad',
  'angry',
  'surprised',
  'relaxed',
  'thinking',
  'excited',
  'shy',
] as const

export type EmotionTag = (typeof EMOTION_TAGS)[number]

const ALIASES: Record<string, EmotionTag> = {
  开心: 'happy',
  高兴: 'happy',
  难过: 'sad',
  伤心: 'sad',
  生气: 'angry',
  惊讶: 'surprised',
  吃惊: 'surprised',
  思考: 'thinking',
  害羞: 'shy',
  兴奋: 'excited',
  激动: 'excited',
  平静: 'relaxed',
  放松: 'relaxed',
}

const KEYS = [...EMOTION_TAGS, ...Object.keys(ALIASES)].join('|')
const TAG_RE = new RegExp(`\\[(${KEYS})\\]`, 'gi')

function normalize(value: string): EmotionTag | null {
  const lower = value.toLowerCase()
  if ((EMOTION_TAGS as readonly string[]).includes(lower)) return lower as EmotionTag
  return ALIASES[value] ?? null
}

export function parseEmotion(raw: string): { text: string; tag: EmotionTag | null } {
  let tag: EmotionTag | null = null
  for (const match of raw.matchAll(TAG_RE)) {
    tag = normalize(match[1]) ?? tag
  }

  const text = raw
    .replace(TAG_RE, '')
    // 不认识的短标签也直接吞掉，避免被 TTS 念出来
    .replace(/\[[^\]]{0,16}\]/g, '')
    // 流式时末尾可能是未闭合的 "[hap"
    .replace(/\[[a-zA-Z]*$/, '')

  return { text, tag }
}
