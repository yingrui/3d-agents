/**
 * Stage 1 的「假大脑」：本地关键词回复 + 逐字流式输出。
 *
 * 换成真后端时，这个 generator 替换成：
 *   POST /api/chat  (SSE / WebSocket 流式 token)
 * 其余逻辑（切句 → TTS → 口型）完全不用改。
 */

type Rule = { test: RegExp; reply: string }

const RULES: Rule[] = [
  {
    test: /你好|您好|hi|hello|嗨|在吗/i,
    reply: '你好呀，我是小岚。一个跑在浏览器里的 3D 数字人，从头发到口型都是实时渲染的。想聊点什么？',
  },
  {
    test: /名字|你是谁|介绍|叫什么/,
    reply: '我叫小岚，是这个项目的第一个数字人原型。现在还很早期，声音用的是系统语音合成，口型是拼音规则算出来的。',
  },
  {
    test: /会什么|能做什么|功能|能力|干什么/,
    reply: '目前我能做三件事：看着你、眨眼和呼吸、还有按句子说话对口型。真正的对话能力，要等接上大模型和流式语音。',
  },
  {
    test: /口型|嘴|怎么对|同步|lipsync|唇/i,
    reply: '口型不是按字切的，是按音频时钟切的。每句话都有一条时间轴，说到哪个元音，嘴就张到哪个形状，再用指数平滑过渡。',
  },
  {
    test: /three|threejs|技术|实现|原理|怎么做/i,
    reply: '整个链路分三层：three.js 负责渲染和骨骼，three-vrm 负责表情与口型，对话逻辑在服务端。你现在看到的每一帧，都是浏览器算出来的。',
  },
  {
    test: /笑话|逗我|幽默|无聊/,
    reply: '我去问了一下显卡，它说自己最近有点热。……好吧，我承认这个笑话是从显存里翻出来的。',
  },
  {
    test: /天气|下雨|冷|热吗/,
    reply: '我没有联网，看不到天气。不过我可以确定，这个房间的光照是三点布光，你那边应该是白天。',
  },
  {
    test: /再见|拜拜|走了|晚安/,
    reply: '好呀，那我们下次再聊。记得回来看看我有没有变聪明一点。',
  },
]

const FALLBACKS = [
  '这个问题有点超出我现在的能力范围了。不过你可以试试问我「口型是怎么对上的」，那是我最熟的部分。',
  '我先记下了。等我接上真正的大模型，应该能回答得更好一点。要不要先听我讲个笑话？',
  '嗯……我想想。以我目前的配置，可能更适合回答关于我自己是怎么做出来的问题。',
]

export function pickReply(input: string): string {
  const matched = RULES.find((rule) => rule.test.test(input))
  if (matched) return matched.reply
  return FALLBACKS[Math.floor(Math.random() * FALLBACKS.length)]
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const id = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      window.clearTimeout(id)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function* streamReply(input: string, signal: AbortSignal): AsyncGenerator<string> {
  const reply = pickReply(input)
  await sleep(420, signal)
  for (const ch of reply) {
    await sleep(13 + Math.random() * 24, signal)
    yield ch
  }
}
