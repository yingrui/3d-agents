import { randomUUID } from 'node:crypto'

/** 百炼 WebSocket 地址：有 workspace 走专属域名，没有走 legacy */
export function dashscopeWsUrl(workspaceId?: string): string {
  return workspaceId
    ? `wss://${workspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/inference`
    : 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
}

/** 百炼鉴权头（注意是小写 bearer） */
export function dashscopeHeaders(apiKey: string): Record<string, string> {
  return { Authorization: `bearer ${apiKey}` }
}

/** 32 位十六进制 task_id */
export function createTaskId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 32)
}
