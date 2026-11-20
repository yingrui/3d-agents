import { createRoot } from 'react-dom/client'
import App from './app/App'
import { applyTag, driver, resetEmotion } from './character/driver'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root not found')

createRoot(root).render(<App />)

// 开发期调试入口：控制台里可以直接改 __digitalHuman.driver.mouth 观察口型
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__digitalHuman = { driver, applyTag, resetEmotion }
}
