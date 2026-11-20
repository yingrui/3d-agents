/** 文本处理：给 TTS 的清洗 + 切句 */

/** 去掉会被 TTS 念出来的 markdown / emoji */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*#`>_~|]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
}

/** 找到最后一个句末标点的位置（返回切分点），没有则返回 0 */
export function lastSentenceEnd(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (/[。！？!?\n]/.test(text[i])) return i + 1
  }
  return 0
}
