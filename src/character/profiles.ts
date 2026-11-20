import type { CharacterProfile } from './types'

/** 角色清单：加新角色就是往这里加一条 + 一个 adapter 实现 */
export const XIAOLAN: CharacterProfile = {
  id: 'xiaolan',
  name: '小岚',
  kind: 'vrm',
  url: '/models/sample.vrm',
  license: 'pixiv three-vrm sample (c) 2022 pixiv Inc.',
  framing: {
    camera: [0, 1.34, 1.62],
    lookAt: [0, 1.33, 0],
    fov: 30,
  },
}

export const CHARACTERS: CharacterProfile[] = [XIAOLAN]

export const DEFAULT_CHARACTER = XIAOLAN
