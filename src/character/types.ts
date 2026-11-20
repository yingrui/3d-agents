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
  name: string
  kind: CharacterKind
  url: string
  license: string
  framing: Framing
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
