import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VISEME_SHAPES, type EmotionState, type VisemeShape } from '../driver'
import type { CharacterAdapter, CharacterInput, CharacterProfile } from '../types'

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

type MorphSlot = { mesh: THREE.Mesh; index: number }

type Channels = {
  visemes: Partial<Record<VisemeShape, MorphSlot[]>>
  blinkL: MorphSlot[]
  blinkR: MorphSlot[]
  smileL: MorphSlot[]
  smileR: MorphSlot[]
  frownL: MorphSlot[]
  frownR: MorphSlot[]
  browInner: MorphSlot[]
  browOuterL: MorphSlot[]
  browOuterR: MorphSlot[]
  browDownL: MorphSlot[]
  browDownR: MorphSlot[]
  jawOpen: MorphSlot[]
}

const emptyChannels = (): Channels => ({
  visemes: {},
  blinkL: [],
  blinkR: [],
  smileL: [],
  smileR: [],
  frownL: [],
  frownR: [],
  browInner: [],
  browOuterL: [],
  browOuterR: [],
  browDownL: [],
  browDownR: [],
  jawOpen: [],
})

/** Rocketbox 的 15 个 viseme 形变名 */
const VISEME_TOKENS: Record<VisemeShape, string> = {
  aa: 'AA_VI_10_aa',
  ee: 'AA_VI_11_E',
  ih: 'AA_VI_12_I',
  oh: 'AA_VI_13_O',
  ou: 'AA_VI_14_U',
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

const WAVE_SECONDS = 2.2

/**
 * 通用 glTF / GLB 角色。
 *
 * - 有 viseme 形变（Rocketbox 完整版）就逐元音驱动，口型更准
 * - 有烘焙动画就播 Idle；手臂另外用世界空间旋转修正到自然下垂
 * - 挥手是程序化叠加，不依赖动画片段
 */
export class GltfCharacter implements CharacterAdapter {
  readonly object = new THREE.Group()

  private root: THREE.Object3D | null = null
  private bones = new Map<string, THREE.Object3D>()
  private rest = new Map<string, THREE.Quaternion>()
  private channels = emptyChannels()
  private hasVisemes = false

  private mixer: THREE.AnimationMixer | null = null
  private lastGestureStart = 0
  private waveStart = -1
  private arms = new Map<THREE.Object3D, { sign: number; fore?: boolean }>()

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
    })

    this.root = root
    this.object.add(root)
    this.normalize(root, profile.height ?? 1.7)
    this.collect(root)
    this.setupArms()
    this.setupAnimations(gltf.animations ?? [], profile)
  }

  /** 把角色缩放到目标身高、脚底贴地 */
  private normalize(root: THREE.Object3D, targetHeight: number) {
    root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(root)
    const height = box.max.y - box.min.y
    if (height < 0.1) return
    root.scale.multiplyScalar(targetHeight / height)
    root.updateMatrixWorld(true)
    const scaled = new THREE.Box3().setFromObject(root)
    root.position.y -= scaled.min.y
    root.updateMatrixWorld(true)
  }

  private collect(root: THREE.Object3D) {
    const wanted = [
      'Bip01_Head',
      'Bip01_Neck',
      'Bip01_Spine2',
      'Bip01_L_UpperArm',
      'Bip01_R_UpperArm',
      'Bip01_R_Forearm',
    ]
    const morphEntries: Array<{ name: string; slot: MorphSlot }> = []

    root.traverse((obj) => {
      if (wanted.includes(obj.name)) {
        this.bones.set(obj.name, obj)
        this.rest.set(obj.name, obj.quaternion.clone())
      }
      const mesh = obj as THREE.Mesh
      if (!mesh.isMesh || !mesh.morphTargetDictionary) return
      for (const [name, index] of Object.entries(mesh.morphTargetDictionary)) {
        morphEntries.push({ name, slot: { mesh, index } })
      }
    })

    const pick = (token: string) =>
      morphEntries
        .filter((entry) => entry.name.toLowerCase().includes(token.toLowerCase()))
        .map((entry) => entry.slot)

    this.channels = emptyChannels()
    for (const shape of VISEME_SHAPES) {
      const slots = pick(VISEME_TOKENS[shape])
      if (slots.length) this.channels.visemes[shape] = slots
    }
    this.hasVisemes = Object.keys(this.channels.visemes).length > 0

    this.channels.blinkL = pick('EyeBlinkLeft')
    this.channels.blinkR = pick('EyeBlinkRight')
    this.channels.smileL = pick('MouthSmileLeft')
    this.channels.smileR = pick('MouthSmileRight')
    this.channels.frownL = pick('MouthFrownLeft')
    this.channels.frownR = pick('MouthFrownRight')
    this.channels.browInner = pick('BrowInnerUp')
    this.channels.browOuterL = pick('BrowOuterUpLeft')
    this.channels.browOuterR = pick('BrowOuterUpRight')
    this.channels.browDownL = pick('BrowDownLeft')
    this.channels.browDownR = pick('BrowDownRight')
    this.channels.jawOpen = pick('JawOpen')
  }

  /** 记录双臂骨骼，用于世界空间姿态修正 */
  private setupArms() {
    this.object.updateMatrixWorld(true)
    const sides: Array<[string, number]> = [
      ['Bip01_L_UpperArm', 1],
      ['Bip01_R_UpperArm', -1],
    ]
    for (const [name, sign] of sides) {
      const bone = this.bones.get(name)
      if (!bone) continue
      this.arms.set(bone, { sign })
    }
    const fore = this.bones.get('Bip01_R_Forearm')
    if (fore) this.arms.set(fore, { sign: -1, fore: true })
  }

  private setupAnimations(source: THREE.AnimationClip[], profile: CharacterProfile) {
    const idleSource = source.find((clip) => /idle/i.test(clip.name))
    if (!idleSource) return

    const clip = THREE.AnimationUtils.subclip(
      idleSource,
      'Idle',
      ...(profile.animations?.idle ?? [0, 300]),
      30,
    )
    clip.tracks = clip.tracks.filter(
      (track) =>
        !/^Bip01\.(position|quaternion|scale)$/.test(track.name) &&
        !/^Bip01_(Pelvis|Spine|Spine1|Spine2|Clavicle|L_Clavicle|R_Clavicle|Head|Neck)\.quaternion$/.test(track.name),
    )

    const mixer = new THREE.AnimationMixer(this.root!)
    const action = mixer.clipAction(clip)
    action.setLoop(THREE.LoopRepeat, Infinity)
    action.play()
    this.mixer = mixer
  }

  private set(slots: MorphSlot[], value: number) {
    for (const { mesh, index } of slots) {
      if (mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = value
    }
  }

  update(input: CharacterInput) {
    if (!this.root) return
    const { delta, time: t, camera, mouth, emotion, gesture, speaking } = input
    const dt = Math.min(delta, 1 / 20)
    const s = this.smooth

    // 有动画时先复位头/颈，再推进 mixer，避免视线旋转累积
    if (this.mixer) {
      const headRest = this.rest.get('Bip01_Head')
      const neckRest = this.rest.get('Bip01_Neck')
      const headBone = this.bones.get('Bip01_Head')
      const neckBone = this.bones.get('Bip01_Neck')
      if (headBone && headRest) headBone.quaternion.copy(headRest)
      if (neckBone && neckRest) neckBone.quaternion.copy(neckRest)
    }
    this.mixer?.update(dt)

    // ---- 手势：挥手用程序化目标方向 ----
    if (gesture.tag && gesture.start !== this.lastGestureStart) {
      this.lastGestureStart = gesture.start
      if (gesture.tag === 'wave' || gesture.tag === 'goodbye') {
        this.waveStart = performance.now() / 1000
      }
    }
    const nowSec = performance.now() / 1000
    const waveT = this.waveStart >= 0 ? (nowSec - this.waveStart) / WAVE_SECONDS : 2
    if (waveT >= 1) this.waveStart = -1

    // ---- 手臂：世界空间旋转，从 T/A-pose 拉到自然下垂；挥手时弯肘摆手 ----
    const applyWorld = (bone: THREE.Object3D, target: THREE.Vector3, weight: number) => {
      const parent = bone.parent
      if (!parent) return
      const child = bone.children.find((c) => (c as THREE.Bone).isBone)
      const from = new THREE.Vector3()
      bone.getWorldPosition(from)
      const to = new THREE.Vector3()
      if (child) child.getWorldPosition(to)
      else to.copy(from).add(new THREE.Vector3(0, -1, 0))
      const current = to.sub(from).normalize()
      const q = new THREE.Quaternion().setFromUnitVectors(current, target)
      const pq = parent.getWorldQuaternion(new THREE.Quaternion())
      const delta = pq.clone().invert().multiply(q).multiply(pq)
      if (weight < 1) delta.slerp(new THREE.Quaternion(), 1 - weight)
      bone.quaternion.premultiply(delta)
    }

    for (const [bone, { sign, fore }] of this.arms) {
      if (fore) {
        if (sign < 0 && waveT >= 0 && waveT < 1) {
          const raise = waveT < 0.2 ? waveT / 0.2 : waveT > 0.8 ? (1 - waveT) / 0.2 : 1
          const swing = Math.sin(waveT * Math.PI * 6)
          const target = new THREE.Vector3(0.05 + swing * 0.35, 0.92, 0.2).normalize()
          applyWorld(bone, target, raise)
        }
        continue
      }

      const target = new THREE.Vector3(sign * 0.15, -1, 0).normalize()
      if (sign < 0 && waveT >= 0 && waveT < 1) {
        const raise = waveT < 0.2 ? waveT / 0.2 : waveT > 0.8 ? (1 - waveT) / 0.2 : 1
        // 上臂在身侧、略高于水平，肘部弯曲后前臂竖起
        const out = new THREE.Vector3(-0.92, 0.18, 0.08).normalize()
        target.lerp(out, raise).normalize()
        target.x += Math.sin(waveT * Math.PI * 6) * 0.05 * raise
        target.normalize()
      }
      applyWorld(bone, target, 1)
    }

    // ---- 口型 ----
    for (const key of VISEME_SHAPES) {
      const target = mouth[key]
      const tau = target > s.mouth[key] ? 0.045 : 0.085
      s.mouth[key] += (target - s.mouth[key]) * (1 - Math.exp(-dt / tau))
    }

    // ---- 表情 ----
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

    if (this.hasVisemes) {
      for (const shape of VISEME_SHAPES) {
        const slots = this.channels.visemes[shape]
        if (slots) this.set(slots, clamp01(m[shape] * 0.95))
      }
    } else {
      const jaw = m.aa * 0.85 + m.oh * 0.6 + m.ou * 0.35 + m.ee * 0.25 + m.ih * 0.18
      this.set(this.channels.jawOpen, clamp01(jaw * 0.9 + e.surprised * 0.2))
    }

    const smile = clamp01(e.happy * 0.8 + e.relaxed * 0.15)
    const frown = clamp01(e.sad * 0.6)
    this.set(this.channels.smileL, smile)
    this.set(this.channels.smileR, smile)
    this.set(this.channels.frownL, frown)
    this.set(this.channels.frownR, frown)
    this.set(this.channels.browInner, clamp01(e.surprised * 0.3 + e.sad * 0.25))
    this.set(this.channels.browOuterL, clamp01(e.surprised * 0.7))
    this.set(this.channels.browOuterR, clamp01(e.surprised * 0.7))
    this.set(this.channels.browDownL, clamp01(e.angry * 0.6))
    this.set(this.channels.browDownR, clamp01(e.angry * 0.6))
    this.set(this.channels.blinkL, s.blink)
    this.set(this.channels.blinkR, s.blink)

    // ---- 头/颈：看向相机（叠加在动画之上） ----
    const head = this.bones.get('Bip01_Head')
    const neck = this.bones.get('Bip01_Neck')

    if (head) {
      const headPos = new THREE.Vector3()
      head.getWorldPosition(headPos)
      const dx = camera.position.x - headPos.x
      const dy = camera.position.y - headPos.y
      const dz = camera.position.z - headPos.z
      const yaw = Math.max(-0.45, Math.min(0.45, Math.atan2(dx, dz)))
      const pitch = Math.max(-0.25, Math.min(0.25, Math.atan2(dy, Math.hypot(dx, dz))))
      const k = 1 - Math.exp(-dt * 4)
      s.yaw += (yaw - s.yaw) * k
      s.pitch += (pitch - s.pitch) * k

      const speak = speaking ? Math.sin(t * 6.2) * 0.01 : 0
      const idleYaw = Math.sin(t * 0.37) * 0.03
      const idlePitch = Math.sin(t * 0.53) * 0.015
      const look = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(s.pitch + speak + idlePitch, s.yaw * 0.7 + idleYaw, 0, 'YXZ'),
      )
      const rest = this.rest.get('Bip01_Head')
      if (rest) head.quaternion.copy(rest).multiply(look)
      else head.quaternion.multiply(look)
    }

    if (neck) {
      const look = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(s.pitch * 0.2, s.yaw * 0.2, 0, 'YXZ'),
      )
      const rest = this.rest.get('Bip01_Neck')
      if (rest) neck.quaternion.copy(rest).multiply(look)
      else neck.quaternion.multiply(look)
    }

    // ---- 呼吸：没有动画时才程序化 ----
    if (!this.mixer) {
      const spine = this.bones.get('Bip01_Spine2')
      const spineRest = this.rest.get('Bip01_Spine2')
      if (spine && spineRest) {
        const breath = Math.sin(t * 1.45) * 0.012
        spine.quaternion
          .copy(spineRest)
          .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(breath, 0, 0)))
      }
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
