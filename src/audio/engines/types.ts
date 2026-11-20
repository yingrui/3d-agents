/**
 * 语音引擎统一接口：云端 TTS 和浏览器本地合成都要实现它。
 *
 * 上层只做三件事：start() → feed(增量文本) → finish()，
 * 至于「什么时候切句、怎么排队、用哪个时钟」，都由引擎自己负责。
 */
export type SpeechStateListener = (speaking: boolean) => void

export interface SpeechEngine {
  readonly speaking: boolean
  start(): void
  /** 流式喂入增量文本（已去掉情绪标签） */
  feed(text: string): void
  /** 文本结束，把缓冲的尾句合成完 */
  finish(): void
  cancel(): void
  onState(listener: SpeechStateListener): () => void
  dispose(): void
  /** 可选：合成失败时的提示 */
  onError?: (message: string) => void
}
