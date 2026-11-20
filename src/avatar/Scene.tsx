import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo } from 'react'
import * as THREE from 'three'
import { Avatar } from './Avatar'

type Props = {
  onProgress?: (value: number) => void
  onLoaded?: () => void
  onError?: (error: unknown) => void
}

const CAMERA_POS = new THREE.Vector3(0, 1.34, 1.62)
const LOOK_AT = new THREE.Vector3(0, 1.33, 0)

/** 鼠标带动一点点相机视差，让人感觉「被看着」 */
function Rig() {
  const target = useMemo(() => new THREE.Vector3(), [])

  useFrame((state, delta) => {
    const pointer = state.pointer
    const k = 1 - Math.exp(-delta * 2.6)
    target.set(
      CAMERA_POS.x + pointer.x * 0.13,
      CAMERA_POS.y + pointer.y * 0.06,
      CAMERA_POS.z,
    )
    state.camera.position.lerp(target, k)
    state.camera.lookAt(LOOK_AT)
  })

  return null
}

export function Scene({ onProgress, onLoaded, onError }: Props) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      onCreated={({ gl }) => {
        gl.toneMappingExposure = 1.0
      }}
      camera={{ fov: 30, position: [CAMERA_POS.x, CAMERA_POS.y, CAMERA_POS.z], near: 0.05, far: 30 }}
    >
      <Rig />
      <ambientLight intensity={0.7} />
      <directionalLight position={[1.9, 2.7, 2.8]} intensity={1.7} color="#fff4e8" />
      <directionalLight position={[-2.4, 1.5, 2.2]} intensity={0.8} color="#a8c2ff" />
      <directionalLight position={[0.4, 2.3, -2.6]} intensity={1.4} color="#ffd0a6" />
      <pointLight position={[0, 1.18, 1.55]} intensity={0.38} color="#ffdcc0" />

      <Avatar url="/models/sample.vrm" onProgress={onProgress} onLoaded={onLoaded} onError={onError} />
    </Canvas>
  )
}
