import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { createServerPlugins } from './server/index.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), ...createServerPlugins(env)],
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
