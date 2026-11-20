import { BrowserTts } from './BrowserTts'
import { CloudTts } from './CloudTts'
import type { SpeechEngine } from './types'

/** 有云端 TTS 就用百炼，否则回落到浏览器合成 */
export function createSpeechEngine(cloud: boolean): SpeechEngine {
  return cloud ? new CloudTts() : new BrowserTts()
}
