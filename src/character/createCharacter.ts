import type { CharacterAdapter, CharacterProfile } from './types'
import { VrmCharacter } from './vrm/VrmCharacter'

/** 按 profile.kind 创建对应的 adapter；以后加 MetaHuman 就是加一个 case */
export function createCharacter(profile: CharacterProfile): CharacterAdapter {
  switch (profile.kind) {
    case 'vrm':
      return new VrmCharacter()
    default:
      throw new Error(`Unsupported character kind: ${(profile as CharacterProfile).kind}`)
  }
}
