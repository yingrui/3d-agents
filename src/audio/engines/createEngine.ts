import { BrowserTts } from './BrowserTts'
import { CloudTts } from './CloudTts'
import type { SpeechEngine } from './types'

export type EngineVoice = {
  voice?: string
  instructions?: string
}

/** 有云端 TTS 就用百炼，否则回落到浏览器合成 */
export function createSpeechEngine(cloud: boolean, options?: EngineVoice): SpeechEngine {
  return cloud ? new CloudTts(options) : new BrowserTts()
}
