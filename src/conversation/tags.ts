/**
 * 标签协议：LLM 用 `[happy]`、`[nod]` 这样的前缀同时控制表情和动作。
 *
 * - 表情标签：只改脸
 * - 动作标签：改脸 + 触发一个程序化动作
 *
 * 流式解析的难点是标签可能被切成两半（"[nod" + "]你好"），
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

export const GESTURE_TAGS = [
  'wave',
  'nod',
  'shake_head',
  'shrug',
  'think_chin',
  'point_self',
  'goodbye',
] as const

export type EmotionTag = (typeof EMOTION_TAGS)[number]
export type GestureName = (typeof GESTURE_TAGS)[number]
export type CharacterTag = EmotionTag | GestureName

const ALIASES: Record<string, CharacterTag> = {
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
  挥手: 'wave',
  点头: 'nod',
  摇头: 'shake_head',
  摊手: 'shrug',
  摸下巴: 'think_chin',
  指自己: 'point_self',
  再见: 'goodbye',
}

const KEYS = [...EMOTION_TAGS, ...GESTURE_TAGS, ...Object.keys(ALIASES)].join('|')
const TAG_RE = new RegExp(`\\[(${KEYS})\\]`, 'gi')

function normalize(value: string): CharacterTag | null {
  const lower = value.toLowerCase()
  if ((EMOTION_TAGS as readonly string[]).includes(lower)) return lower as EmotionTag
  if ((GESTURE_TAGS as readonly string[]).includes(lower)) return lower as GestureName
  return ALIASES[value] ?? null
}

export function isGestureTag(tag: CharacterTag | null): tag is GestureName {
  return tag !== null && (GESTURE_TAGS as readonly string[]).includes(tag)
}

export function parseTag(raw: string): { text: string; tag: CharacterTag | null } {
  let tag: CharacterTag | null = null
  for (const match of raw.matchAll(TAG_RE)) {
    tag = normalize(match[1]) ?? tag
  }

  const text = raw
    .replace(TAG_RE, '')
    // 不认识的短标签也直接吞掉，避免被 TTS 念出来
    .replace(/\[[^\]]{0,16}\]/g, '')
    // 流式时末尾可能是未闭合的 "[nod"
    .replace(/\[[a-zA-Z]*$/, '')

  return { text, tag }
}
