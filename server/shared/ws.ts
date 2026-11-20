import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import type { ViteDevServer } from 'vite'
import { WebSocket, WebSocketServer } from 'ws'

/** 在 Vite dev server 上挂一个 WebSocket 端点，和 HMR 共存 */
export function attachWebSocket(
  server: ViteDevServer,
  path: string,
  onConnection: (client: WebSocket) => void,
) {
  const wss = new WebSocketServer({ noServer: true })

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost')
    if (pathname !== path) return
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  }

  server.httpServer?.on('upgrade', onUpgrade)
  server.httpServer?.on('close', () => wss.close())
  wss.on('connection', onConnection)

  return () => {
    server.httpServer?.off('upgrade', onUpgrade)
    wss.close()
  }
}
