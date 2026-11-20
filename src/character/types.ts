import type * as THREE from 'three'
import type { CharacterTag } from '../conversation/tags'
import type { EmotionState, MouthState } from './driver'

export type CharacterKind = 'vrm' | 'gltf'

export type Framing = {
  /** 相机位置（米） */
  camera: [number, number, number]
  lookAt: [number, number, number]
  fov: number
}

export type CharacterProfile = {
  id: string
  /** UI 下拉里显示的名字 */
  name: string
  /** 对话里自称的名字 */
  displayName: string
  /** 角色人设，传给 LLM 的 system prompt */
  persona: string
  /** 选择页的一句风格标签 */
  tagline: string
  /** 选择页的简介 */
  blurb: string
  /** 选择页缩略图 */
  thumbnail: string
  kind: CharacterKind
  url: string
  license: string
  framing: Framing
  /** 资产朝向修正（弧度） */
  rotationY?: number
  /** 资产缩放修正 */
  scale?: number
  /** 云端 TTS 音色 id */
  voice?: string
  /** 音色风格指令（部分音色支持） */
  voiceStyle?: string
  /** 归一化后的身高（米），默认 1.7 */
  height?: number
  /** 烘焙动画的裁剪帧区间（30fps 源） */
  animations?: {
    idle?: [number, number]
  }
}

/** 每帧喂给角色的语义状态：和具体 rig 无关 */
export type CharacterInput = {
  delta: number
  time: number
  camera: THREE.Camera
  mouth: MouthState
  emotion: EmotionState
  gesture: { tag: CharacterTag | null; start: number }
  speaking: boolean
}

export interface CharacterAdapter {
  /** 挂到 three 场景里的根节点 */
  readonly object: THREE.Object3D
  load(profile: CharacterProfile, onProgress?: (value: number) => void): Promise<void>
  update(input: CharacterInput): void
  dispose(): void
}
