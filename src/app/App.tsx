import { useState } from 'react'
import { Scene } from '../character/Scene'
import { ChatPanel } from '../components/ChatPanel'
import type { Phase } from '../shared/types'
import { useCapabilities } from './useCapabilities'
import { CHARACTERS, DEFAULT_CHARACTER } from '../character/profiles'
import { useDigitalHumanSession } from './useDigitalHumanSession'

const STATUS_LABEL: Record<Phase, string> = {
  idle: '待机',
  listening: '聆听中',
  thinking: '思考中',
  speaking: '说话中',
}

export default function App() {
  const caps = useCapabilities()
  const [characterId, setCharacterId] = useState(DEFAULT_CHARACTER.id)
  const profile = CHARACTERS.find((item) => item.id === characterId) ?? DEFAULT_CHARACTER
  const session = useDigitalHumanSession(caps, profile)

  const [progress, setProgress] = useState(0)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const switchCharacter = (id: string) => {
    if (id === characterId) return
    setCharacterId(id)
    setReady(false)
    setProgress(0)
    setError(null)
  }

  return (
    <div className="app">
      <section className="stage">
        <div className="stage-glow" />
        <div className="canvas-wrap">
          <Scene
            profile={profile}
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
              {profile.displayName} <span className="brand-tag">Stage 7</span>
            </h1>
            <p>three.js · DeepSeek · Fun-ASR · Gesture</p>
          </div>
          <select
            className="character-select"
            value={profile.id}
            onChange={(event) => switchCharacter(event.target.value)}
            aria-label="选择角色"
          >
            {CHARACTERS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </header>

        <div className={`status status-${session.phase}`}>
          <span className="status-dot" />
          {STATUS_LABEL[session.phase]}
        </div>

        <div className="stage-hint">
          对话：{caps.llm === 'cloud' ? 'DeepSeek' : '本地 mock'}
          {' · '}
          语音：{caps.tts === 'cloud' ? '阿里云百炼' : '浏览器合成'}
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

        {(session.ttsError || session.asrError) && (
          <div className="tts-error">
            {session.ttsError ? `语音服务：${session.ttsError}` : session.asrError}
          </div>
        )}
      </section>

      <ChatPanel
        messages={session.messages}
        phase={session.phase}
        onSend={session.send}
        ttsMode={caps.tts}
        llmMode={caps.llm}
        micOn={session.micOn}
        micAvailable={caps.asr === 'cloud'}
        partial={session.partial}
        onToggleMic={session.toggleMic}
        characterName={profile.displayName}
      />
    </div>
  )
}
