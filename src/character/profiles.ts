import type { CharacterProfile } from './types'

/** 角色清单：加新角色就是往这里加一条 + 一个 adapter 实现 */
export const XIAOLAN: CharacterProfile = {
  id: 'xiaolan',
  name: '小岚',
  displayName: '小岚',
  persona:
    '你是小岚，一个住在浏览器里的 3D 数字人。性格温和、好奇，说话轻松自然，偶尔有点小幽默。',
  tagline: '二次元 · VRM',
  blurb: '声音轻快，表情丰富，会挥手打招呼。适合轻松闲聊。',
  thumbnail: '/characters/xiaolan.jpg',
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
  tagline: '半写实 · GLB',
  blurb: '客服出身的沉稳角色，回答干脆，适合办事和咨询。',
  thumbnail: '/characters/maya.jpg',
  kind: 'gltf',
  url: '/models/rocketbox/maya.glb',
  license: 'Microsoft Rocketbox (MIT), adapted by coasty.ai',
  framing: {
    camera: [0, 1.53, 1.6],
    lookAt: [0, 1.48, 0],
    fov: 30,
  },
  animations: { wave: [310, 400] },
}

/** Rocketbox Male_Adult_07 完整版：175 个形变，含 15 个 viseme */
export const SAM: CharacterProfile = {
  id: 'sam',
  name: 'Sam · 高写实',
  displayName: 'Sam',
  persona:
    '你是 Sam，一个写实风格的 3D 数字人，做过产品经理，说话沉稳、有条理。你喜欢先给结论再解释，偶尔用一个小例子把问题讲清楚。',
  tagline: '高写实 · 175 形变',
  blurb: '完整 ARKit + 15 个 viseme 形变，口型最细，适合演示接近真人的效果。',
  thumbnail: '/characters/sam.jpg',
  kind: 'gltf',
  url: '/models/rocketbox/sam.glb',
  license: 'Microsoft Rocketbox (MIT), converted locally with Blender',
  framing: {
    camera: [0, 1.45, 1.9],
    lookAt: [0, 1.38, 0],
    fov: 30,
  },
}

export const CHARACTERS: CharacterProfile[] = [XIAOLAN, MAYA, SAM]

export const DEFAULT_CHARACTER = XIAOLAN
