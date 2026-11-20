import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import type { EmotionTag } from '../chat/emotion'
import { driver, VISEME_SHAPES, type EmotionState, type VisemeShape } from './driver'

type Props = {
  url: string
  onProgress?: (value: number) => void
  onLoaded?: () => void
  onError?: (error: unknown) => void
}

type SmoothState = {
  mouth: Record<VisemeShape, number>
  emotion: EmotionState
  blink: number
  nextBlink: number
  blinkT: number
  yaw: number
  pitch: number
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** 一次性小动作：按时间指数衰减，不需要动画片段 */
function gestureOffset(type: EmotionTag, age: number) {
  const decay = Math.exp(-age * 2.2)
  switch (type) {
    case 'happy':
    case 'excited':
      return { x: Math.sin(age * 9) * 0.022 * decay, y: 0, z: Math.sin(age * 9 + 1) * 0.02 * decay }
    case 'surprised':
      return { x: -0.13 * decay, y: 0, z: 0 }
    case 'sad':
      return { x: 0.12 * decay, y: 0, z: 0 }
    case 'thinking':
      return { x: 0.03 * decay, y: 0.13 * decay, z: 0.15 * decay }
    case 'angry':
      return { x: 0.06 * decay, y: 0, z: 0 }
    default:
      return { x: 0, y: 0, z: 0.04 * decay }
  }
}

/**
 * 一个「会呼吸、会眨眼、会看你、会对口型」的 VRM 角色。
 *
 * 所有程序化动作都写在 useFrame 里，直接改 normalized bone 的 rotation，
 * 再交给 vrm.update(delta) 把 normalized 姿态烘焙回原始骨骼（含 spring bone）。
 */
export function Avatar({ url, onProgress, onLoaded, onError }: Props) {
  const [vrm, setVrm] = useState<VRM | null>(null)
  const lookTarget = useMemo(() => new THREE.Object3D(), [])
  const headWorld = useMemo(() => new THREE.Vector3(), [])

  const smooth = useRef<SmoothState>({
    mouth: { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 },
    emotion: { happy: 0, sad: 0, angry: 0, surprised: 0, relaxed: 0.12 },
    blink: 0,
    nextBlink: 2.4,
    blinkT: -1,
    yaw: 0,
    pitch: 0,
  })

  useEffect(() => {
    let cancelled = false
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))

    loader.load(
      url,
      (gltf) => {
        if (cancelled) return
        const loadedVrm = gltf.userData.vrm as VRM | undefined
        if (!loadedVrm) {
          onError?.(new Error('文件里没有 VRM 数据'))
          return
        }

        // 1) 清理 & 合并，减少 draw call
        VRMUtils.removeUnnecessaryVertices(gltf.scene)
        VRMUtils.combineSkeletons(gltf.scene)
        // 2) VRM 0.x 朝向 -Z，转 180°；VRM 1.0 原样
        VRMUtils.rotateVRM0(loadedVrm)

        // 蒙皮网格的包围盒不随骨骼更新，先关掉视锥剔除
        loadedVrm.scene.traverse((obj) => {
          obj.frustumCulled = false
        })

        // 3) 视线目标
        if (loadedVrm.lookAt) loadedVrm.lookAt.target = lookTarget

        // 4) 从 T-pose 放下来，进入自然站姿
        loadedVrm.humanoid.getNormalizedBoneNode('leftUpperArm')?.rotation.set(0.05, 0.04, -1.24)
        loadedVrm.humanoid.getNormalizedBoneNode('rightUpperArm')?.rotation.set(0.05, -0.04, 1.24)
        loadedVrm.humanoid.getNormalizedBoneNode('leftLowerArm')?.rotation.set(0, -0.14, 0)
        loadedVrm.humanoid.getNormalizedBoneNode('rightLowerArm')?.rotation.set(0, 0.14, 0)

        setVrm(loadedVrm)
        onLoaded?.()
      },
      (event) => {
        if (event.total > 0) onProgress?.(clamp(event.loaded / event.total, 0, 1))
      },
      (error) => {
        if (!cancelled) onError?.(error)
      },
    )

    return () => {
      cancelled = true
    }
    // onProgress / onLoaded 仅在挂载时使用，避免重复加载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])

  // 卸载时释放显存
  useEffect(() => {
    if (!vrm) return
    return () => {
      VRMUtils.deepDispose(vrm.scene)
    }
  }, [vrm])

  useFrame((state, delta) => {
    if (!vrm) return
    const dt = Math.min(delta, 1 / 20)
    const t = state.clock.elapsedTime
    const s = smooth.current
    const em = vrm.expressionManager
    const camera = state.camera

    // ---- 视线：头和脖子跟着镜头，眼睛再补一点微扫视 ----
    const head = vrm.humanoid.getNormalizedBoneNode('head')
    const neck = vrm.humanoid.getNormalizedBoneNode('neck')
    const chest = vrm.humanoid.getNormalizedBoneNode('chest')
    const spine = vrm.humanoid.getNormalizedBoneNode('spine')

    if (head) {
      head.getWorldPosition(headWorld)
      const dx = camera.position.x - headWorld.x
      const dy = camera.position.y - headWorld.y
      const dz = camera.position.z - headWorld.z
      const yaw = clamp(Math.atan2(dx, dz), -0.5, 0.5)
      const pitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.28, 0.28)
      const k = 1 - Math.exp(-dt * 4)
      s.yaw += (yaw - s.yaw) * k
      s.pitch += (pitch - s.pitch) * k

      const speak = driver.speaking ? 1 : 0
      const age = performance.now() / 1000 - driver.gesture.start
      const gesture = driver.gesture.start ? gestureOffset(driver.gesture.type, age) : { x: 0, y: 0, z: 0 }
      head.rotation.set(
        s.pitch + Math.sin(t * 0.9) * 0.012 + Math.sin(t * 6.2) * 0.006 * speak + gesture.x,
        s.yaw * 0.6 + Math.sin(t * 0.63) * 0.012 + gesture.y,
        Math.sin(t * 0.41) * 0.012 + gesture.z,
      )
    }
    if (neck) {
      neck.rotation.set(s.pitch * 0.3, s.yaw * 0.3, 0)
    }

    // ---- 呼吸 & 重心微移 ----
    if (chest) chest.rotation.x = 0.025 + Math.sin(t * 1.45) * 0.012
    if (spine) {
      spine.rotation.z = Math.sin(t * 0.45) * 0.01
      spine.rotation.y = Math.sin(t * 0.31) * 0.014
    }

    // ---- 手臂自然下垂 + 轻微摆动 ----
    const sway = Math.sin(t * 0.8) * 0.02
    vrm.humanoid.getNormalizedBoneNode('leftUpperArm')?.rotation.set(0.05, 0.04 + sway, -1.24 + sway * 0.5)
    vrm.humanoid.getNormalizedBoneNode('rightUpperArm')?.rotation.set(0.05, -0.04 - sway, 1.24 - sway * 0.5)

    // ---- 眨眼：随机间隔，偶尔连眨 ----
    if (t > s.nextBlink) {
      s.blinkT = 0
      s.nextBlink = t + 2.2 + Math.random() * 3.6
    }
    if (s.blinkT >= 0) {
      s.blinkT += dt
      const p = s.blinkT / 0.15
      if (p >= 1) {
        s.blink = 0
        s.blinkT = -1
        if (Math.random() < 0.18) s.nextBlink = t + 0.16
      } else {
        s.blink = Math.sin(Math.PI * p) ** 0.7
      }
    }
    em?.setValue('blink', s.blink)

    // ---- 口型：向目标值做指数平滑（起音快、收音慢） ----
    for (const key of VISEME_SHAPES) {
      const target = driver.mouth[key]
      const tau = target > s.mouth[key] ? 0.045 : 0.085
      s.mouth[key] += (target - s.mouth[key]) * (1 - Math.exp(-dt / tau))
      em?.setValue(key, Math.min(1, s.mouth[key] * 0.92))
    }

    // ---- 表情：向情绪标签的目标值平滑，起得快、收得慢 ----
    for (const key of ['happy', 'sad', 'angry', 'surprised', 'relaxed'] as const) {
      const target = driver.emotion[key]
      const tau = target > s.emotion[key] ? 0.18 : 0.55
      s.emotion[key] += (target - s.emotion[key]) * (1 - Math.exp(-dt / tau))
      em?.setValue(key, s.emotion[key])
    }

    // ---- 视线目标（世界坐标，带一点微扫视） ----
    lookTarget.position.set(
      camera.position.x + Math.sin(t * 2.7) * 0.03,
      camera.position.y + Math.cos(t * 2.1) * 0.02,
      camera.position.z,
    )

    // 把 normalized 姿态写回骨骼，并更新 spring bone / lookAt
    vrm.update(dt)
  })

  return (
    <group>
      <primitive object={lookTarget} />
      {vrm && <primitive object={vrm.scene} />}
    </group>
  )
}
