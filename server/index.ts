import type { Plugin } from 'vite'
import { dashscopeAsr } from './asr'
import { healthPlugin } from './health'
import { deepseekLlm } from './llm'
import { dashscopeTts } from './tts'

type Env = Record<string, string | undefined>

/** 从 .env 解析出三套服务的配置，一处定义、插件和健康检查共用 */
export function createServerPlugins(env: Env): Plugin[] {
  const apiKey = env.DASHSCOPE_API_KEY ?? ''
  const workspaceId = env.DASHSCOPE_WORKSPACE_ID ?? ''

  const tts = {
    model: env.DASHSCOPE_TTS_MODEL || 'qwen-audio-3.1-tts-flash',
    voice: env.DASHSCOPE_TTS_VOICE || 'longanhuan_v3.1',
  }

  const asr = {
    model: env.ASR_MODEL || 'fun-asr-realtime',
    sampleRate: Number(env.ASR_SAMPLE_RATE) || 16000,
    vadThreshold: Number(env.VAD_THRESHOLD) || 0.02,
    silenceMs: Number(env.VAD_SILENCE_MS) || 700,
    context: env.ASR_CONTEXT || '',
  }

  const llm = {
    apiKey: env.OPENAI_API_KEY ?? '',
    baseUrl: env.OPENAI_BASE_URL || 'https://api.deepseek.com/v1',
    model: env.LLM_MODEL || 'deepseek-flash',
  }

  return [
    dashscopeTts({ apiKey, workspaceId, ...tts }),
    dashscopeAsr({ apiKey, workspaceId, ...asr }),
    deepseekLlm(llm),
    healthPlugin({
      tts: { enabled: Boolean(apiKey), ...tts },
      llm: { enabled: Boolean(llm.apiKey), model: llm.model },
      asr: {
        enabled: Boolean(apiKey),
        model: asr.model,
        sampleRate: asr.sampleRate,
        vadThreshold: asr.vadThreshold,
        silenceMs: asr.silenceMs,
      },
    }),
  ]
}
