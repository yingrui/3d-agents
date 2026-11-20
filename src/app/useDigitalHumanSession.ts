import { useCallback, useEffect, useRef, useState } from 'react'
import { createSpeechEngine } from '../audio/engines/createEngine'
import type { SpeechEngine } from '../audio/engines/types'
import { MicAsr } from '../audio/mic/MicAsr'
import { applyTag, resetEmotion } from '../character/driver'
import { streamLLM, type ChatTurn } from '../conversation/llm'
import { streamReply } from '../conversation/mock'
import { pumpConversation } from '../conversation/pipeline'
import type { Message, Phase } from '../shared/types'
import type { CharacterProfile } from '../character/types'
import type { Capabilities } from './useCapabilities'

function welcomeMessage(profile: CharacterProfile): Message {
  return {
    id: 'welcome',
    role: 'assistant',
    text: `你好，我是${profile.displayName}。一个完全跑在浏览器里的 3D 数字人。点下面的话题，或者直接打字和我聊聊。`,
  }
}

let seq = 0
const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${seq++}`

/**
 * 数字人会话：把「对话 / 语音引擎 / 麦克风」三块状态收在一起。
 *
 * 拆成三个独立 hook 会绕不开互相引用（语音状态要控制麦克风门限，
 * 麦克风打断又要取消语音），所以这里用一个聚合 hook，App 只负责布局。
 */
export function useDigitalHumanSession(caps: Capabilities, profile: CharacterProfile) {
  const [messages, setMessages] = useState<Message[]>([welcomeMessage(profile)])
  const [phase, setPhase] = useState<Phase>('idle')
  const [ttsError, setTtsError] = useState<string | null>(null)
  const [asrError, setAsrError] = useState<string | null>(null)
  const [micOn, setMicOn] = useState(false)
  const [partial, setPartial] = useState('')

  const engineRef = useRef<SpeechEngine | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const streamingRef = useRef(false)
  const historyRef = useRef<ChatTurn[]>([])
  const micRef = useRef<MicAsr | null>(null)
  const phaseRef = useRef<Phase>('idle')
  const micOnRef = useRef(false)
  const emotionTimerRef = useRef(0)
  const llmModeRef = useRef(caps.llm)
  llmModeRef.current = caps.llm
  const profileRef = useRef(profile)
  profileRef.current = profile

  // 语音引擎：云端 / 本地，同一套接口
  useEffect(() => {
    if (caps.tts === 'checking') return

    const handleState = (speaking: boolean) => {
      micRef.current?.setTtsActive(speaking)
      if (speaking) {
        window.clearTimeout(emotionTimerRef.current)
        setPhase('speaking')
        return
      }

      // 说完几秒后回到平静表情
      window.clearTimeout(emotionTimerRef.current)
      emotionTimerRef.current = window.setTimeout(() => resetEmotion(), 2500)
      setPhase((prev) => {
        if (prev !== 'speaking') return prev
        if (streamingRef.current) return 'thinking'
        return micOnRef.current ? 'listening' : 'idle'
      })
    }

    const engine = createSpeechEngine(caps.tts === 'cloud')
    engine.onError = (message) => setTtsError(message)
    engineRef.current = engine
    const off = engine.onState(handleState)

    return () => {
      off()
      engine.dispose()
      engineRef.current = null
    }
  }, [caps.tts])

  // 切换角色 = 换一个人，清空对话与历史
  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    streamingRef.current = false
    historyRef.current = []
    resetEmotion()
    setPartial('')
    setMessages([welcomeMessage(profile)])
    setPhase('idle')
  }, [profile])

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

    engineRef.current?.cancel()
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

    const engine = engineRef.current
    const useLlm = llmModeRef.current === 'cloud'
    const history = historyRef.current

    void (async () => {
      try {
        const source = useLlm
          ? streamLLM([...history, { role: 'user', content: text }], controller.signal, profileRef.current.persona)
          : streamReply(text, controller.signal)

        let started = false
        const clean = await pumpConversation(source, {
          onText: (visible) =>
            setMessages((prev) =>
              prev.map((m) => (m.id === botId ? { ...m, text: visible, pending: false } : m)),
            ),
          onTag: (tag) => applyTag(tag),
          onSpeech: (delta) => {
            if (!engine) return
            if (!started) {
              engine.start()
              started = true
            }
            engine.feed(delta)
          },
        })

        engine?.finish()
        setMessages((prev) => prev.map((m) => (m.id === botId ? { ...m, pending: false } : m)))

        if (useLlm && clean.trim()) {
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
          if (!engineRef.current?.speaking) setPhase(micOnRef.current ? 'listening' : 'idle')
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
    if (caps.asr !== 'cloud') return

    const config = caps.asrConfig
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
            engineRef.current?.cancel()
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
    } catch (err) {
      setAsrError(`麦克风打开失败：${(err as Error).message}`)
    }
  }, [caps.asr, caps.asrConfig, send])

  return {
    messages,
    phase,
    send,
    toggleMic,
    micOn,
    partial,
    ttsError,
    asrError,
  }
}
