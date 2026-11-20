/**
 * 流式对话（OpenAI 兼容协议，走本地 /api/chat 代理）
 *
 * 代理返回的是标准 SSE：data: {"choices":[{"delta":{"content":"..."}}]}
 * 这里只做解析，不关心上游是 DeepSeek 还是别的兼容服务。
 */
export type ChatTurn = { role: 'user' | 'assistant'; content: string }

export async function* streamLLM(
  messages: ChatTurn[],
  signal: AbortSignal,
  persona?: string,
): AsyncGenerator<string> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages, persona }),
    signal,
  })

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => '')
    throw new Error(`LLM ${response.status}: ${detail.slice(0, 160)}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const raw of lines) {
      const line = raw.trim()
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload) continue
      if (payload === '[DONE]') return
      try {
        const json = JSON.parse(payload)
        const delta = json?.choices?.[0]?.delta?.content
        if (typeof delta === 'string' && delta) yield delta
      } catch {
        // 上游偶尔会切出半行，忽略即可
      }
    }
  }
}

/** 去掉会被 TTS 念出来的 markdown / emoji */
export function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*#`>_~|]/g, '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
}
