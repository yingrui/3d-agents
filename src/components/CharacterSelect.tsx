import type { CharacterProfile } from '../character/types'

type Props = {
  characters: CharacterProfile[]
  onSelect: (id: string) => void
}

export function CharacterSelect({ characters, onSelect }: Props) {
  return (
    <div className="select-screen">
      <header className="select-head">
        <div className="select-mark">◈</div>
        <h1>选择你的数字人</h1>
        <p>不同角色有不同外形、声音和性格。选一个开始对话。</p>
      </header>

      <div className="character-grid">
        {characters.map((character) => (
          <button
            key={character.id}
            type="button"
            className="character-card"
            onClick={() => onSelect(character.id)}
          >
            <div className="character-thumb">
              <img src={character.thumbnail} alt={character.displayName} />
              <span className="character-tag">{character.tagline}</span>
            </div>
            <div className="character-info">
              <h2>{character.displayName}</h2>
              <p>{character.blurb}</p>
              <span className="character-cta">开始对话 →</span>
            </div>
          </button>
        ))}
      </div>

      <footer className="select-foot">
        语音由阿里云百炼驱动 · 对话由 DeepSeek 驱动 · 角色全部在浏览器里实时渲染
      </footer>
    </div>
  )
}
