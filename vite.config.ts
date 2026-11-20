import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { dashscopeTts } from './server/ttsPlugin.ts'
import { deepseekLlm } from './server/llmPlugin.ts'
import { dashscopeAsr } from './server/asrPlugin.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      dashscopeTts({
        apiKey: env.DASHSCOPE_API_KEY,
        workspaceId: env.DASHSCOPE_WORKSPACE_ID,
        model: env.DASHSCOPE_TTS_MODEL,
        voice: env.DASHSCOPE_TTS_VOICE,
      }),
      deepseekLlm({
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL,
        model: env.LLM_MODEL,
      }),
      dashscopeAsr({
        apiKey: env.DASHSCOPE_API_KEY,
        workspaceId: env.DASHSCOPE_WORKSPACE_ID,
        model: env.ASR_MODEL,
        sampleRate: Number(env.ASR_SAMPLE_RATE) || 16000,
        vadThreshold: Number(env.VAD_THRESHOLD) || 0.02,
        silenceMs: Number(env.VAD_SILENCE_MS) || 700,
        context: env.ASR_CONTEXT,
      }),
    ],
    server: {
      // 5173 常被别的项目占用（且 localhost 会优先走 ::1），这里固定一个专用端口
      host: '127.0.0.1',
      port: 5288,
      strictPort: true,
      watch: {
        // 本地调试用的临时目录，避免 Chrome profile 触发整页刷新
        ignored: ['**/.tmp/**'],
      },
    },
    // preview 同样固定地址，避免落到 ::1 上打不开
    preview: {
      host: '127.0.0.1',
      port: 4174,
      strictPort: true,
    },
  }
})
