import type { CharacterProfile } from './types'

/** 角色清单：加新角色就是往这里加一条 + 一个 adapter 实现 */
export const XIAOLAN: CharacterProfile = {
  id: 'xiaolan',
  name: '小岚',
  displayName: '小岚',
  persona:
    '你是小岚，一个住在浏览器里的 3D 数字人。性格温和、好奇，说话轻松自然，偶尔有点小幽默。',
  kind: 'vrm',
  url: '/models/sample.vrm',
  license: 'pixiv three-vrm sample (c) 2022 pixiv Inc.',
  framing: {
    camera: [0, 1.34, 1.62],
    lookAt: [0, 1.33, 0],
    fov: 30,
  },
}

/** 微软 Rocketbox Female_Adult_07 的 GLB 版本（MIT），写实系 */
export const MAYA: CharacterProfile = {
  id: 'maya',
  name: 'Maya · 写实',
  displayName: 'Maya',
  persona:
    '你是 Maya，一个写实风格的 3D 数字人，做过很多年客服，语气沉稳、直接、可靠。你不卖萌，回答简洁清楚，偶尔会给出实用建议。',
  kind: 'gltf',
  url: '/models/rocketbox/maya.glb',
  license: 'Microsoft Rocketbox (MIT), adapted by coasty.ai',
  framing: {
    camera: [0, 1.53, 1.48],
    lookAt: [0, 1.5, 0],
    fov: 30,
  },
}

export const CHARACTERS: CharacterProfile[] = [XIAOLAN, MAYA]

export const DEFAULT_CHARACTER = XIAOLAN
