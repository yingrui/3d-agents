/**
 * LLM 代理（OpenAI 兼容协议 → DeepSeek）
 *
 *   POST /api/chat  { messages: [{role, content}, ...] }
 *   ← text/event-stream，逐 token 返回
 *
 * Key 只存在服务端，浏览器拿不到。
 */
import type { Plugin } from 'vite'
import { readBody, sendJson } from './shared/http'

export type LlmPluginOptions = {
  apiKey?: string
  baseUrl?: string
  model?: string
}

type ChatTurn = { role: 'user' | 'assistant'; content: string }

const DEFAULT_PERSONA = '你是小岚，一个跑在浏览器里的 3D 数字人助手，正在和用户面对面聊天。'

const BASE_RULES = `要求：
- 口语化，像真人说话，不要书面语。
- 每次回答控制在 1~3 句、60 字以内，说完就停。
- 不要用 markdown、列表、代码块、emoji，不要加「名字：」这种前缀。
- 只用中文口语，不要用英文单词或数字梗（语音合成读不好）。
- 你说话时会有口型和表情，所以句子要短，标点要自然。
- 每句话开头必须加一个标签，标签会被系统去掉，用户看不到也不会被念出来，不要解释它。
  情绪标签（控制表情）：[happy] [sad] [angry] [surprised] [relaxed] [thinking] [excited] [shy]
  动作标签（控制身体）：[wave] 挥手 [nod] 点头 [shake_head] 摇头 [shrug] 摊手 [think_chin] 摸下巴 [point_self] 指自己 [goodbye] 告别
  例如：[happy]很高兴见到你。用户打招呼时用 [wave]，道别时用 [goodbye]，同意用 [nod]，
  不同意用 [shake_head]，不知道或无奈用 [shrug]。动作标签也会带表情，不要一句话堆多个标签。
- 被问到技术实现时，可以简单说自己是 three.js 实时渲染 + 语音合成驱动的。
- 用户的话可能来自语音识别，有错别字时按最合理的理解回答，不要纠正。`

function buildSystemPrompt(persona?: string) {
  const who = persona?.trim() ? persona.trim().slice(0, 600) : DEFAULT_PERSONA
  return `${who}\n\n${BASE_RULES}`
}

export function deepseekLlm(options: LlmPluginOptions): Plugin {
  const apiKey = options.apiKey ?? ''
  const baseUrl = (options.baseUrl ?? 'https://api.deepseek.com/v1').replace(/\/$/, '')
  const model = options.model ?? 'deepseek-flash'

  return {
    name: 'deepseek-llm',
    configureServer(server) {
      server.middlewares.use('/api/chat', async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed' })
          return
        }
        if (!apiKey) {
          sendJson(res, 503, { error: 'LLM 未配置（缺少 OPENAI_API_KEY）' })
          return
        }

        let messages: ChatTurn[]
        let persona: string | undefined
        try {
          const body = JSON.parse(await readBody(req)) as {
            messages?: ChatTurn[]
            persona?: string
          }
          messages = Array.isArray(body.messages) ? body.messages.slice(-16) : []
          persona = typeof body.persona === 'string' ? body.persona : undefined
        } catch {
          sendJson(res, 400, { error: 'bad request' })
          return
        }

        const abort = new AbortController()
        req.on('close', () => abort.abort())

        let upstream: Response
        try {
          upstream = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              model,
              stream: true,
              temperature: 0.8,
              max_tokens: 400,
              // deepseek-flash 默认会先吐 reasoning_content，首字要多等 ~600ms；
              // 语音对话里这 0.6 秒很贵，直接关掉思考
              thinking: { type: 'disabled' },
              messages: [{ role: 'system', content: buildSystemPrompt(persona) }, ...messages],
            }),
            signal: abort.signal,
          })
        } catch (error) {
          sendJson(res, 502, { error: `上游连接失败: ${(error as Error).message}` })
          return
        }

        if (!upstream.ok || !upstream.body) {
          const detail = await upstream.text().catch(() => '')
          sendJson(res, 502, { error: `上游返回 ${upstream.status}`, detail: detail.slice(0, 500) })
          return
        }

        res.statusCode = 200
        res.setHeader('content-type', 'text/event-stream; charset=utf-8')
        res.setHeader('cache-control', 'no-cache, no-transform')
        res.setHeader('connection', 'keep-alive')
        res.setHeader('x-accel-buffering', 'no')
        res.flushHeaders?.()

        const reader = upstream.body.getReader()
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            res.write(value)
          }
        } catch {
          /* 客户端断开或上游异常 */
        } finally {
          res.end()
        }
      })

      if (!apiKey) {
        server.config.logger.warn('[llm] 未配置 OPENAI_API_KEY，对话回落到本地 mock')
      } else {
        server.config.logger.info(`[llm] ${model} @ ${baseUrl} 已就绪`)
      }
    },
  }
}
