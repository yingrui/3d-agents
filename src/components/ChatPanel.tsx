import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Message, Phase } from '../shared/types'

type Props = {
  messages: Message[]
  phase: Phase
  onSend: (text: string) => void
  ttsMode: 'checking' | 'cloud' | 'mock'
  llmMode: 'checking' | 'cloud' | 'mock'
  micOn: boolean
  micAvailable: boolean
  partial: string
  onToggleMic: () => void
}

const SUGGESTIONS = ['你好，介绍一下你自己', '口型是怎么对上声音的？', '你会做什么？']

const PLACEHOLDER: Record<Phase, string> = {
  idle: '和她说点什么…',
  listening: '我在听，说完停一下就行…',
  thinking: '她正在想，再说一句可以打断…',
  speaking: '她在说话，发送可以打断她…',
}

export function ChatPanel({
  messages,
  phase,
  onSend,
  ttsMode,
  llmMode,
  micOn,
  micAvailable,
  partial,
  onToggleMic,
}: Props) {
  const [value, setValue] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const text = value.trim()
    if (!text) return
    onSend(text)
    setValue('')
  }

  return (
    <aside className="panel">
      <div className="panel-head">
        <div className="panel-title">
          <span className="panel-dot" />
          对话
        </div>
        <span className="panel-tag">
          {llmMode === 'cloud' ? 'DeepSeek' : '本地 mock'} · {ttsMode === 'cloud' ? 'Qwen TTS' : '本地合成'}
        </span>
      </div>

      <div className="messages" ref={listRef}>
        {messages.map((message) =>
          message.role === 'assistant' ? (
            <div className="msg assistant" key={message.id}>
              <div className="avatar-dot">岚</div>
              <div className="bubble">
                {message.pending && !message.text ? (
                  <span className="typing" aria-label="正在输入">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  message.text
                )}
              </div>
            </div>
          ) : (
            <div className="msg user" key={message.id}>
              <div className="bubble">{message.text}</div>
            </div>
          ),
        )}
      </div>

      <div className="composer">
        <div className="chips">
          {SUGGESTIONS.map((suggestion) => (
            <button
              type="button"
              key={suggestion}
              className="chip"
              onClick={() => onSend(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
        {partial && <div className="partial">{partial}</div>}
        <form className="field" onSubmit={submit}>
          <button
            type="button"
            className={`mic-btn${micOn ? ' on' : ''}`}
            onClick={onToggleMic}
            disabled={!micAvailable}
            title={
              micAvailable
                ? micOn
                  ? '关闭麦克风'
                  : '打开麦克风，直接说话'
                : '未配置语音识别（需要 DASHSCOPE_API_KEY）'
            }
            aria-label="语音输入"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
              <path d="M12 17.5V21" />
            </svg>
          </button>
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={PLACEHOLDER[phase]}
            aria-label="输入消息"
          />
          <button type="submit" disabled={!value.trim()}>
            发送
          </button>
        </form>
        <p className="footnote">
          {llmMode === 'cloud' && ttsMode === 'cloud'
            ? micAvailable
              ? 'Stage 6 · 语音对话 + 情绪表情 + 挥手：Fun-ASR → DeepSeek（情绪/动作标签）→ TTS → 口型/表情/动作'
              : 'Stage 3 · DeepSeek 流式对话 · 百炼 qwen-audio-3.1-tts-flash · 口型来自字级时间戳'
            : llmMode === 'cloud'
              ? 'DeepSeek 对话 · 语音回落到浏览器合成（未配置 DASHSCOPE_API_KEY）'
              : ttsMode === 'cloud'
                ? '本地 mock 对话 · 百炼语音 · 口型来自字级时间戳'
                : 'Stage 1 · 无后端。对话框和语音都在本地。'}
        </p>
      </div>
    </aside>
  )
}
