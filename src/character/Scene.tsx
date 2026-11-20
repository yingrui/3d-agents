import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { Character } from './Character'
import { DEFAULT_CHARACTER } from './profiles'
import type { CharacterProfile, Framing } from './types'

type Props = {
  profile?: CharacterProfile
  onProgress?: (value: number) => void
  onLoaded?: () => void
  onError?: (error: unknown) => void
}

/** 相机视差 + 轻微呼吸感；取景参数来自 role profile */
function Rig({ framing }: { framing: Framing }) {
  const base = useMemo(() => new THREE.Vector3(...framing.camera), [framing])
  const lookAt = useMemo(() => new THREE.Vector3(...framing.lookAt), [framing])
  const target = useMemo(() => new THREE.Vector3(), [])

  useFrame((state, delta) => {
    const pointer = state.pointer
    const t = state.clock.elapsedTime
    const k = 1 - Math.exp(-delta * 2.6)
    target.set(
      base.x + pointer.x * 0.13 + Math.sin(t * 0.31) * 0.008,
      base.y + pointer.y * 0.06 + Math.cos(t * 0.27) * 0.005,
      base.z,
    )
    state.camera.position.lerp(target, k)
    state.camera.lookAt(lookAt)
  })

  return null
}

export function Scene({ profile = DEFAULT_CHARACTER, onProgress, onLoaded, onError }: Props) {
  return (
    <Canvas
      dpr={[1, 2]}
      shadows
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{
        fov: profile.framing.fov,
        position: profile.framing.camera,
        near: 0.05,
        far: 30,
      }}
      onCreated={({ gl }) => {
        gl.toneMappingExposure = 0.92
      }}
    >
      <Rig framing={profile.framing} />

      <ambientLight intensity={0.32} />
      <directionalLight
        position={[2.1, 2.7, 2.6]}
        intensity={1.35}
        color="#fff0df"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-2.6, 1.3, 1.9]} intensity={0.45} color="#9db4ff" />
      <directionalLight position={[0.3, 2.1, -2.6]} intensity={1.1} color="#ffb98a" />
      <directionalLight position={[0, 1.45, 2.4]} intensity={0.3} color="#ffd9c2" />
      <pointLight position={[0, 1.18, 1.55]} intensity={0.2} color="#ffdcc0" />

      <Character
        profile={profile}
        onProgress={onProgress}
        onLoaded={onLoaded}
        onError={onError}
      />
    </Canvas>
  )
}
