import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { createCharacter } from './createCharacter'
import { driver } from './driver'
import type { CharacterProfile } from './types'

type Props = {
  profile: CharacterProfile
  onProgress?: (value: number) => void
  onLoaded?: () => void
  onError?: (error: unknown) => void
}

/**
 * 把「对话层的语义状态」每帧喂给角色 adapter。
 * 这里是唯一知道 driver（口型/表情/动作）的地方，avatar 实现内部不依赖全局。
 */
export function Character({ profile, onProgress, onLoaded, onError }: Props) {
  const adapter = useMemo(() => createCharacter(profile), [profile])
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__character = adapter
  }
  const camera = useThree((state) => state.camera)

  // 用 ref 存回调，避免父组件每次渲染都触发重新加载模型
  const callbacks = useRef({ onProgress, onLoaded, onError })
  callbacks.current = { onProgress, onLoaded, onError }

  useEffect(() => {
    let alive = true
    adapter
      .load(profile, (value) => callbacks.current.onProgress?.(value))
      .then(() => {
        if (alive) callbacks.current.onLoaded?.()
      })
      .catch((error) => {
        if (alive) callbacks.current.onError?.(error)
      })
    return () => {
      alive = false
      adapter.dispose()
    }
  }, [adapter, profile])

  useFrame((state, delta) => {
    adapter.update({
      delta,
      time: state.clock.elapsedTime,
      camera,
      mouth: driver.mouth,
      emotion: driver.emotion,
      gesture: driver.gesture,
      speaking: driver.speaking,
    })
  })

  return <primitive object={adapter.object} />
}
