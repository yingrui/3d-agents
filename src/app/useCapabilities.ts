import { useEffect, useState } from 'react'

export type Mode = 'checking' | 'cloud' | 'mock'

export type AsrConfig = {
  model: string
  sampleRate: number
  vadThreshold: number
  silenceMs: number
}

export type Capabilities = {
  tts: Mode
  llm: Mode
  asr: Mode
  asrConfig: AsrConfig
  ready: boolean
}

const DEFAULT_ASR: AsrConfig = {
  model: 'fun-asr-realtime',
  sampleRate: 16000,
  vadThreshold: 0.02,
  silenceMs: 700,
}

/**
 * 一次探测三套能力：TTS / LLM / ASR。
 * 任何一边没配 Key 就返回 false，上层据此降级。
 */
export function useCapabilities(): Capabilities {
  const [caps, setCaps] = useState<Capabilities>({
    tts: 'checking',
    llm: 'checking',
    asr: 'checking',
    asrConfig: DEFAULT_ASR,
    ready: false,
  })

  useEffect(() => {
    let alive = true
    void (async () => {
      const data = await fetch('/api/health')
        .then((response) => response.json())
        .catch(() => null)
      if (!alive) return

      setCaps({
        tts: data?.tts?.enabled ? 'cloud' : 'mock',
        llm: data?.llm?.enabled ? 'cloud' : 'mock',
        asr: data?.asr?.enabled ? 'cloud' : 'mock',
        asrConfig: data?.asr?.enabled
          ? {
              model: data.asr.model ?? DEFAULT_ASR.model,
              sampleRate: data.asr.sampleRate ?? DEFAULT_ASR.sampleRate,
              vadThreshold: data.asr.vadThreshold ?? DEFAULT_ASR.vadThreshold,
              silenceMs: data.asr.silenceMs ?? DEFAULT_ASR.silenceMs,
            }
          : DEFAULT_ASR,
        ready: true,
      })
    })()
    return () => {
      alive = false
    }
  }, [])

  return caps
}
