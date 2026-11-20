import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VISEME_SHAPES, type EmotionState, type VisemeShape } from '../driver'
import { sampleGesture } from '../gestures'
import type { CharacterAdapter, CharacterInput, CharacterProfile } from '../types'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

type MorphSlot = { mesh: THREE.Mesh; index: number }

type SmoothState = {
  mouth: Record<VisemeShape, number>
  emotion: EmotionState
  blink: number
  nextBlink: number
  blinkT: number
  yaw: number
  pitch: number
}

/**
 * 通用 glTF / GLB 角色。
 *
 * 适配「网格 + 骨骼 + morph target」的写实资产（Rocketbox / CC4 / MetaHuman 导出）。
 * 表情用 morph target 驱动，动作先用头/颈，手部留待烘焙 clip。
 */
export class GltfCharacter implements CharacterAdapter {
  readonly object = new THREE.Group()

  private root: THREE.Object3D | null = null
  private bones = new Map<string, THREE.Object3D>()
  private rest = new Map<string, THREE.Quaternion>()
  private morphs = new Map<string, MorphSlot[]>()

  private static readonly MORPH_NAMES = [
    'JawOpen',
    'MouthSmileLeft',
    'MouthSmileRight',
    'EyeBlinkLeft',
    'EyeBlinkRight',
    'BrowInnerUp',
  ]

  private smooth: SmoothState = {
    mouth: { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 },
    emotion: { happy: 0, sad: 0, angry: 0, surprised: 0, relaxed: 0 },
    blink: 0,
    nextBlink: 2.4,
    blinkT: -1,
    yaw: 0,
    pitch: 0,
  }

  async load(profile: CharacterProfile, onProgress?: (value: number) => void): Promise<void> {
    const loader = new GLTFLoader()
    const gltf = await loader.loadAsync(profile.url, (event) => {
      if (event.total > 0) onProgress?.(clamp01(event.loaded / event.total))
    })

    const root = gltf.scene
    root.rotation.y = profile.rotationY ?? 0
    root.scale.setScalar(profile.scale ?? 1)
    root.traverse((obj) => {
      obj.frustumCulled = false
      const mesh = obj as THREE.Mesh
      if (mesh.isMesh) mesh.castShadow = false
    })

    this.root = root
    this.object.add(root)
    this.collect(root)
  }

  private collect(root: THREE.Object3D) {
    const wanted = ['Bip01_Head', 'Bip01_Neck', 'Bip01_Spine2', 'Bip01_L_UpperArm', 'Bip01_R_UpperArm']
    root.traverse((obj) => {
      if (wanted.includes(obj.name)) {
        this.bones.set(obj.name, obj)
        this.rest.set(obj.name, obj.quaternion.clone())
      }
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh || !mesh.morphTargetDictionary) return
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
        // target 名字形如 "blendShape1.AK_25_JawOpen"，按后缀匹配
        const short = GltfCharacter.MORPH_NAMES.find((key) => name.includes(key))
        if (!short) continue
        const list = this.morphs.get(short) ?? []
        list.push({ mesh, index })
        this.morphs.set(short, list)
      }
    })
  }

  private setMorph(name: string, value: number) {
    const slots = this.morphs.get(name)
    if (!slots) return
    for (const { mesh, index } of slots) {
      if (!mesh.morphTargetInfluences) continue
      mesh.morphTargetInfluences[index] = value
    }
  }

  update(input: CharacterInput) {
    if (!this.root) return
    const { delta, time: t, camera, mouth, emotion, gesture, speaking } = input
    const dt = Math.min(delta, 1 / 20)
    const s = this.smooth
    const age = performance.now() / 1000 - gesture.start

    // ---- 口型平滑 ----
    for (const key of VISEME_SHAPES) {
      const target = mouth[key]
      const tau = target > s.mouth[key] ? 0.045 : 0.085
      s.mouth[key] += (target - s.mouth[key]) * (1 - Math.exp(-dt / tau))
    }

    // ---- 表情平滑 ----
    for (const key of ['happy', 'sad', 'angry', 'surprised', 'relaxed'] as const) {
      const target = emotion[key]
      const tau = target > s.emotion[key] ? 0.18 : 0.55
      s.emotion[key] += (target - s.emotion[key]) * (1 - Math.exp(-dt / tau))
    }

    // ---- 眨眼 ----
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

    const m = s.mouth
    const e = s.emotion
    const jaw = m.aa * 0.85 + m.oh * 0.6 + m.ou * 0.35 + m.ee * 0.25 + m.ih * 0.18
    const smile = e.happy * 0.8 + (m.ee + m.ih) * 0.2 + e.relaxed * 0.15

    this.setMorph('JawOpen', clamp01(jaw * 0.9 + e.surprised * 0.2))
    this.setMorph('MouthSmileLeft', clamp01(smile))
    this.setMorph('MouthSmileRight', clamp01(smile))
    this.setMorph('BrowInnerUp', clamp01(e.surprised * 0.7))
    this.setMorph('EyeBlinkLeft', s.blink)
    this.setMorph('EyeBlinkRight', s.blink)

    // ---- 头/颈：看向相机 + 动作叠加 ----
    const head = this.bones.get('Bip01_Head')
    const neck = this.bones.get('Bip01_Neck')
    const pose = sampleGesture(gesture.tag, age)

    if (head) {
      const headPos = new THREE.Vector3()
      head.getWorldPosition(headPos)
      const dx = camera.position.x - headPos.x
      const dy = camera.position.y - headPos.y
      const dz = camera.position.z - headPos.z
      const yaw = Math.max(-0.45, Math.min(0.45, Math.atan2(dx, dz)))
      const pitch = Math.max(-0.25, Math.min(0.25, -Math.atan2(dy, Math.hypot(dx, dz))))
      const k = 1 - Math.exp(-dt * 4)
      s.yaw += (yaw - s.yaw) * k
      s.pitch += (pitch - s.pitch) * k

      const speak = speaking ? Math.sin(t * 6.2) * 0.01 : 0
      const euler = new THREE.Euler(
        s.pitch + speak + (pose?.head?.x ?? 0),
        s.yaw * 0.7 + (pose?.head?.y ?? 0),
        (pose?.head?.z ?? 0),
        'YXZ',
      )
      const rest = this.rest.get('Bip01_Head')
      if (rest) head.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromEuler(euler))
    }

    if (neck) {
      const rest = this.rest.get('Bip01_Neck')
      if (rest) {
        const euler = new THREE.Euler(
          (pose?.neck?.x ?? 0) + s.pitch * 0.2,
          (pose?.neck?.y ?? 0) + s.yaw * 0.2,
          0,
          'YXZ',
        )
        neck.quaternion.copy(rest).multiply(new THREE.Quaternion().setFromEuler(euler))
      }
    }

    // ---- 呼吸 ----
    const spine = this.bones.get('Bip01_Spine2')
    const spineRest = this.rest.get('Bip01_Spine2')
    if (spine && spineRest) {
      const breath = Math.sin(t * 1.45) * 0.012
      spine.quaternion
        .copy(spineRest)
        .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(breath, 0, 0)))
    }
  }

  dispose() {
    if (!this.root) return
    this.object.remove(this.root)
    this.root.traverse((obj) => {
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.geometry?.dispose()
      const material = mesh.material
      if (Array.isArray(material)) material.forEach((m) => m.dispose())
      else material?.dispose()
    })
    this.root = null
  }
}
