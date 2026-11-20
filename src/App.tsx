import { useCallback, useEffect, useRef, useState } from 'react'
import { Scene } from './avatar/Scene'
import { ChatPanel } from './components/ChatPanel'
import { parseEmotion } from './chat/emotion'
import { streamLLM, speakable, type ChatTurn } from './chat/llm'
import { streamReply } from './chat/mockBrain'
import type { Message, Phase } from './chat/types'
import { CloudTts } from './speech/CloudTts'
import { applyEmotion, resetEmotion } from './avatar/driver'
import { MicAsr } from './speech/MicAsr'
import { SpeechController } from './speech/SpeechController'

const WELCOME: Message = {
  id: 'welcome',
  role: 'assistant',
  text: '你好，我是小岚。一个完全跑在浏览器里的 3D 数字人。点下面的话题，或者直接打字和我聊聊。',
}

const STATUS_LABEL: Record<Phase, string> = {
  idle: '待机',
  listening: '聆听中',
  thinking: '思考中',
  speaking: '说话中',
}

type TtsMode = 'checking' | 'cloud' | 'mock'
type LlmMode = 'checking' | 'cloud' | 'mock'
type AsrMode = 'checking' | 'cloud' | 'off'

type AsrConfig = { model: string; sampleRate: number; vadThreshold: number; silenceMs: number }

function lastSentenceEnd(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (/[。！？!?\n]/.test(text[i])) return i + 1
  }
  return 0
}

let seq = 0
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${seq++}`

export default function App() {
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ttsMode, setTtsMode] = useState<TtsMode>('checking')
  const [llmMode, setLlmMode] = useState<LlmMode>('checking')
  const [asrMode, setAsrMode] = useState<AsrMode>('checking')
  const [ttsError, setTtsError] = useState<string | null>(null)
  const [micOn, setMicOn] = useState(false)
  const [partial, setPartial] = useState('')
  const [asrError, setAsrError] = useState<string | null>(null)

  const cloudRef = useRef<CloudTts | null>(null)
  const mockRef = useRef<SpeechController | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const streamingRef = useRef(false)
  const historyRef = useRef<ChatTurn[]>([])
  const llmModeRef = useRef<LlmMode>('checking')
  const micRef = useRef<MicAsr | null>(null)
  const asrConfigRef = useRef<AsrConfig>({
    model: 'fun-asr-realtime',
    sampleRate: 16000,
    vadThreshold: 0.02,
    silenceMs: 700,
  })
  const phaseRef = useRef<Phase>('idle')
  const micOnRef = useRef(false)
  const emotionTimerRef = useRef(0)

  // 问一下本地代理：TTS 和 LLM 各自有没有配置 Key
  useEffect(() => {
    let alive = true
    void (async () => {
      const [tts, llm, asr] = await Promise.all([
        fetch('/api/tts/health')
          .then((response) => response.json())
          .catch(() => null),
        fetch('/api/llm/health')
          .then((response) => response.json())
          .catch(() => null),
        fetch('/api/asr/health')
          .then((response) => response.json())
          .catch(() => null),
      ])
      if (!alive) return
      setTtsMode(tts?.enabled ? 'cloud' : 'mock')
      setLlmMode(llm?.enabled ? 'cloud' : 'mock')
      llmModeRef.current = llm?.enabled ? 'cloud' : 'mock'
      setAsrMode(asr?.enabled ? 'cloud' : 'off')
      if (asr?.enabled) {
        asrConfigRef.current = {
          model: asr.model ?? 'fun-asr-realtime',
          sampleRate: asr.sampleRate ?? 16000,
          vadThreshold: asr.vadThreshold ?? 0.02,
          silenceMs: asr.silenceMs ?? 700,
        }
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    if (ttsMode === 'checking') return

    const handleState = (speaking: boolean) => {
      micRef.current?.setTtsActive(speaking)
      if (speaking) {
        window.clearTimeout(emotionTimerRef.current)
        setPhase('speaking')
      } else {
        // 说完几秒后回到平静表情，避免她一直保持笑/惊讶
        window.clearTimeout(emotionTimerRef.current)
        emotionTimerRef.current = window.setTimeout(() => resetEmotion(), 2500)
        setPhase((prev) => {
          if (prev !== 'speaking') return prev
          if (streamingRef.current) return 'thinking'
          return micOnRef.current ? 'listening' : 'idle'
        })
      }
    }

    if (ttsMode === 'cloud') {
      const engine = new CloudTts()
      engine.onError = (message) => setTtsError(message)
      cloudRef.current = engine
      const off = engine.onState(handleState)
      return () => {
        off()
        engine.dispose()
        cloudRef.current = null
      }
    }

    const engine = new SpeechController()
    mockRef.current = engine
    const off = engine.onState(handleState)
    return () => {
      off()
      engine.dispose()
      mockRef.current = null
    }
  }, [ttsMode])

  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  useEffect(() => {
    micOnRef.current = micOn
  }, [micOn])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      window.clearTimeout(emotionTimerRef.current)
      micRef.current?.stop()
      micRef.current = null
    }
  }, [])

  const send = useCallback((raw: string) => {
    const text = raw.trim()
    if (!text) return

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    cloudRef.current?.cancel()
    mockRef.current?.cancel()
    resetEmotion()
    setTtsError(null)
    streamingRef.current = true
    setPhase('thinking')

    const userId = uid('u')
    const botId = uid('a')
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text },
      { id: botId, role: 'assistant', text: '', pending: true },
    ])

    const cloud = cloudRef.current
    const useLlm = llmModeRef.current === 'cloud'
    const history = historyRef.current

    void (async () => {
      let raw = ''
      let clean = ''
      let fed = 0
      let cloudStarted = false
      let lastTag = ''
      try {
        // 有 LLM 就走 DeepSeek 流式，没有就回落到本地关键词 mock
        const source = useLlm
          ? streamLLM([...history, { role: 'user', content: text }], controller.signal)
          : streamReply(text, controller.signal)

        for await (const chunk of source) {
          raw += chunk
          const parsed = parseEmotion(raw)
          clean = parsed.text
          if (parsed.tag && parsed.tag !== lastTag) {
            lastTag = parsed.tag
            applyEmotion(parsed.tag)
          }

          setMessages((prev) =>
            prev.map((m) => (m.id === botId ? { ...m, text: clean, pending: false } : m)),
          )

          if (cloud) {
            // 云端 TTS：只喂「去掉标签之后新增的那一段」，标签不会被念出来
            if (!cloudStarted) {
              cloud.start()
              cloudStarted = true
            }
            const delta = speakable(clean.slice(fed))
            if (delta) cloud.feed(delta)
            fed = clean.length
          } else {
            // 本地 mock：凑够一句就送进语音队列
            const cut = lastSentenceEnd(clean)
            if (cut > fed + 5) {
              mockRef.current?.enqueue(clean.slice(fed, cut))
              fed = cut
            }
          }
        }

        if (cloud) {
          if (!cloudStarted) {
            cloud.start()
            cloudStarted = true
          }
          cloud.finish()
        } else if (clean.length > fed) {
          mockRef.current?.enqueue(clean.slice(fed))
        }

        setMessages((prev) => prev.map((m) => (m.id === botId ? { ...m, pending: false } : m)))

        if (useLlm && clean.trim()) {
          // 只保留最近几轮，避免上下文无限增长
          const next: ChatTurn[] = [
            ...history,
            { role: 'user', content: text },
            { role: 'assistant', content: clean },
          ]
          historyRef.current = next.slice(-12)
        }
      } catch (err) {
        if ((err as DOMException | undefined)?.name !== 'AbortError') {
          console.error(err)
          const hint = useLlm
            ? '模型没接上，检查一下 .env 里的 OPENAI_API_KEY 和 LLM_MODEL。'
            : '我这边出了点问题，再试一次？'
          setMessages((prev) =>
            prev.map((m) => (m.id === botId ? { ...m, text: hint, pending: false } : m)),
          )
        }
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null
          streamingRef.current = false
          const stillSpeaking = cloud ? cloud.isSpeaking : mockRef.current?.speaking
          if (!stillSpeaking) setPhase(micOnRef.current ? 'listening' : 'idle')
        }
      }
    })()
  }, [])

  const toggleMic = useCallback(async () => {
    if (micRef.current?.active) {
      micRef.current.stop()
      micRef.current = null
      setMicOn(false)
      setPartial('')
      setPhase((prev) => (prev === 'speaking' ? prev : 'idle'))
      return
    }
    if (asrMode !== 'cloud') return

    const config = asrConfigRef.current
    const mic = new MicAsr(
      {
        threshold: config.vadThreshold,
        silenceMs: config.silenceMs,
        sampleRate: config.sampleRate,
      },
      {
        onPartial: (text) => setPartial(text),
        onUtterance: (text) => {
          setPartial('')
          send(text)
        },
        onSpeechStart: () => {
          // 她正在说话时你开口 → 立刻打断
          if (phaseRef.current === 'speaking') {
            cloudRef.current?.cancel()
            mockRef.current?.cancel()
            setPhase('listening')
          }
        },
        onError: (message) => setAsrError(message),
      },
    )

    try {
      await mic.start()
      micRef.current = mic
      setMicOn(true)
      setAsrError(null)
      setPhase((prev) => (prev === 'speaking' ? prev : 'listening'))
    } catch (error) {
      setAsrError(`麦克风打开失败：${(error as Error).message}`)
    }
  }, [asrMode, send])

  return (
    <div className="app">
      <section className="stage">
        <div className="stage-glow" />
        <div className="canvas-wrap">
          <Scene
            onProgress={setProgress}
            onLoaded={() => setReady(true)}
            onError={(err) => {
              console.error(err)
              setError('角色模型加载失败，请确认 public/models/sample.vrm 存在。')
            }}
          />
        </div>
        <div className="vignette" />

        <header className="brand">
          <div className="brand-mark">◈</div>
          <div>
            <h1>
              小岚 <span className="brand-tag">Stage 6</span>
            </h1>
            <p>three.js · DeepSeek · Fun-ASR · Gesture</p>
          </div>
        </header>

        <div className={`status status-${phase}`}>
          <span className="status-dot" />
          {STATUS_LABEL[phase]}
        </div>

        <div className="stage-hint">
          对话：{llmMode === 'cloud' ? 'DeepSeek' : '本地 mock'}
          {' · '}
          语音：{ttsMode === 'cloud' ? '阿里云百炼' : '浏览器合成'}
          {' · '}移动鼠标，她会看着你
        </div>

        {!ready && !error && (
          <div className="overlay">
            <div className="loader-card">
              <div className="spinner" />
              <p className="loader-title">正在加载角色</p>
              <div className="bar">
                <i style={{ width: `${Math.max(6, Math.round(progress * 100))}%` }} />
              </div>
              <p className="loader-note">{Math.round(progress * 100)}%</p>
            </div>
          </div>
        )}

        {error && (
          <div className="overlay">
            <div className="loader-card">
              <p className="loader-title">加载失败</p>
              <p className="loader-note">{error}</p>
            </div>
          </div>
        )}

        {(ttsError || asrError) && (
          <div className="tts-error">{ttsError ? `语音服务：${ttsError}` : asrError}</div>
        )}
      </section>

      <ChatPanel
        messages={messages}
        phase={phase}
        onSend={send}
        ttsMode={ttsMode}
        llmMode={llmMode}
        micOn={micOn}
        micAvailable={asrMode === 'cloud'}
        partial={partial}
        onToggleMic={toggleMic}
      />
    </div>
  )
}
