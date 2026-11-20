import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRM, VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm'
import {
  VISEME_SHAPES,
  type EmotionState,
  type VisemeShape,
} from '../driver'
import { sampleGesture } from '../gestures'
import type { CharacterAdapter, CharacterInput, CharacterProfile } from '../types'

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

/**
 * VRM 实现：加载 VRM 1.0/0.x，程序化驱动呼吸、眨眼、视线、口型、表情、手势。
 *
 * 和具体对话逻辑完全解耦——每帧只接收 CharacterInput。
 */
export class VrmCharacter implements CharacterAdapter {
  readonly object = new THREE.Group()

  private vrm: VRM | null = null
  private lookTarget = new THREE.Object3D()
  private headWorld = new THREE.Vector3()

  private smooth: SmoothState = {
    mouth: { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 },
    emotion: { happy: 0, sad: 0, angry: 0, surprised: 0, relaxed: 0.12 },
    blink: 0,
    nextBlink: 2.4,
    blinkT: -1,
    yaw: 0,
    pitch: 0,
  }

  constructor() {
    this.object.add(this.lookTarget)
  }

  async load(profile: CharacterProfile, onProgress?: (value: number) => void): Promise<void> {
    const loader = new GLTFLoader()
    loader.register((parser) => new VRMLoaderPlugin(parser))

    const gltf = await loader.loadAsync(profile.url, (event) => {
      if (event.total > 0) onProgress?.(clamp(event.loaded / event.total, 0, 1))
    })

    const vrm = gltf.userData.vrm as VRM | undefined
    if (!vrm) throw new Error('文件里没有 VRM 数据')

    // 清理 & 合并，减少 draw call；VRM 0.x 需要转 180°
    VRMUtils.removeUnnecessaryVertices(gltf.scene)
    VRMUtils.combineSkeletons(gltf.scene)
    VRMUtils.rotateVRM0(vrm)

    // 蒙皮网格包围盒不随骨骼更新，先关视锥剔除
    vrm.scene.traverse((obj) => {
      obj.frustumCulled = false
      obj.castShadow = true
      obj.receiveShadow = true
    })

    if (vrm.lookAt) vrm.lookAt.target = this.lookTarget

    // 从 T-pose 放下来，进入自然站姿
    vrm.humanoid.getNormalizedBoneNode('leftUpperArm')?.rotation.set(0.05, 0.04, -1.24)
    vrm.humanoid.getNormalizedBoneNode('rightUpperArm')?.rotation.set(0.05, -0.04, 1.24)
    vrm.humanoid.getNormalizedBoneNode('leftLowerArm')?.rotation.set(0, -0.14, 0)
    vrm.humanoid.getNormalizedBoneNode('rightLowerArm')?.rotation.set(0, 0.14, 0)

    // MToon：轻微描边 + 稍微加强明暗分界，避免脸糊成一片
    for (const material of vrm.materials ?? []) {
      const mat = material as unknown as {
        name?: string
        color?: THREE.Color
        outlineWidthFactor?: number
        outlineColorFactor?: THREE.Color
        shadingShiftFactor?: number
        shadingToonyFactor?: number
      }
      if (mat.color) {
        const name = mat.name ?? ''
        if (name.startsWith('Tops')) mat.color.set(0xc9d9ea)
        else if (name.startsWith('Bottoms')) mat.color.set(0x8b83a0)
        else if (name.startsWith('Shoes')) mat.color.set(0x7d6f74)
        else if (name.includes('SKIN')) mat.color.set(0xffe3d2)
        else if (name.startsWith('Hair')) mat.color.set(0xf2e2d4)

        // 皮肤/头发单独加强明暗分界，让五官有体积
        const skin = name.includes('SKIN')
        const hair = name.startsWith('Hair')
        if (skin || hair) {
          mat.shadingShiftFactor = skin ? -0.24 : -0.12
          mat.shadingToonyFactor = 0.98
          const shade = (mat as unknown as { shadeColorFactor?: THREE.Color }).shadeColorFactor
          if (shade) shade.set(skin ? 0xf0c8bc : 0xc9a88e)
        }
      }
    }

    this.vrm = vrm
    this.object.add(vrm.scene)
  }

  update(input: CharacterInput) {
    const vrm = this.vrm
    if (!vrm) return

    const { delta, time: t, camera, mouth, emotion, gesture, speaking } = input
    const dt = Math.min(delta, 1 / 20)
    const s = this.smooth
    const em = vrm.expressionManager
    const age = performance.now() / 1000 - gesture.start
    const pose = sampleGesture(gesture.tag, age)

    // ---- 视线：头和脖子跟着镜头，眼睛再补一点微扫视 ----
    const head = vrm.humanoid.getNormalizedBoneNode('head')
    const neck = vrm.humanoid.getNormalizedBoneNode('neck')
    const chest = vrm.humanoid.getNormalizedBoneNode('chest')
    const spine = vrm.humanoid.getNormalizedBoneNode('spine')

    if (head) {
      head.getWorldPosition(this.headWorld)
      const dx = camera.position.x - this.headWorld.x
      const dy = camera.position.y - this.headWorld.y
      const dz = camera.position.z - this.headWorld.z
      const yaw = clamp(Math.atan2(dx, dz), -0.5, 0.5)
      const pitch = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.28, 0.28)
      const k = 1 - Math.exp(-dt * 4)
      s.yaw += (yaw - s.yaw) * k
      s.pitch += (pitch - s.pitch) * k

      const speak = speaking ? 1 : 0
      head.rotation.set(
        s.pitch + Math.sin(t * 0.9) * 0.012 + Math.sin(t * 6.2) * 0.006 * speak + (pose?.head?.x ?? 0),
        s.yaw * 0.6 + Math.sin(t * 0.63) * 0.012 + (pose?.head?.y ?? 0),
        Math.sin(t * 0.41) * 0.012 + (pose?.head?.z ?? 0),
      )
    }
    if (neck) {
      neck.rotation.set(
        s.pitch * 0.3 + (pose?.neck?.x ?? 0),
        s.yaw * 0.3 + (pose?.neck?.y ?? 0),
        pose?.neck?.z ?? 0,
      )
    }

    // ---- 呼吸 & 重心微移 ----
    if (chest) chest.rotation.x = 0.025 + Math.sin(t * 1.45) * 0.012 + (pose?.chest?.x ?? 0)
    if (spine) {
      spine.rotation.z = Math.sin(t * 0.45) * 0.01
      spine.rotation.y = Math.sin(t * 0.31) * 0.014
    }

    // ---- 手臂：自然下垂 + 轻微摆动 + 动作库叠加 ----
    const sway = Math.sin(t * 0.8) * 0.02
    const leftArm = pose?.leftUpperArm
    const rightArm = pose?.rightUpperArm
    const rightForearm = pose?.rightLowerArm

    vrm.humanoid
      .getNormalizedBoneNode('leftUpperArm')
      ?.rotation.set(
        0.05 + (leftArm?.x ?? 0),
        0.04 + sway + (leftArm?.y ?? 0),
        -1.24 + sway * 0.5 + (leftArm?.z ?? 0),
      )
    vrm.humanoid
      .getNormalizedBoneNode('rightUpperArm')
      ?.rotation.set(
        0.05 + (rightArm?.x ?? 0),
        -0.04 - sway + (rightArm?.y ?? 0),
        1.24 - sway * 0.5 + (rightArm?.z ?? 0),
      )
    vrm.humanoid
      .getNormalizedBoneNode('rightLowerArm')
      ?.rotation.set(0, 0.14, rightForearm?.z ?? 0)

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

    // ---- 口型：向目标值指数平滑（起音快、收音慢） ----
    for (const key of VISEME_SHAPES) {
      const target = mouth[key]
      const tau = target > s.mouth[key] ? 0.045 : 0.085
      s.mouth[key] += (target - s.mouth[key]) * (1 - Math.exp(-dt / tau))
      em?.setValue(key, Math.min(1, s.mouth[key] * 0.92))
    }

    // ---- 表情：向情绪标签的目标值平滑 ----
    for (const key of ['happy', 'sad', 'angry', 'surprised', 'relaxed'] as const) {
      const target = emotion[key]
      const tau = target > s.emotion[key] ? 0.18 : 0.55
      s.emotion[key] += (target - s.emotion[key]) * (1 - Math.exp(-dt / tau))
      em?.setValue(key, s.emotion[key])
    }

    // ---- 视线目标（世界坐标，带一点微扫视） ----
    this.lookTarget.position.set(
      camera.position.x + Math.sin(t * 2.7) * 0.03,
      camera.position.y + Math.cos(t * 2.1) * 0.02,
      camera.position.z,
    )

    // 写回骨骼并更新 spring bone / lookAt
    vrm.update(dt)
  }

  dispose() {
    if (!this.vrm) return
    this.object.remove(this.vrm.scene)
    VRMUtils.deepDispose(this.vrm.scene)
    this.vrm = null
  }
}
