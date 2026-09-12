import type { Platform } from '../platform.js'
import { EpicConnector } from './epic.js'
import { GogConnector } from './gog.js'
import { SteamConnector } from './steam.js'
import type { StoreConnector, StoreId } from './types.js'

export function createConnector(platform: Platform, store: StoreId): StoreConnector {
  switch (store) {
    case 'steam':
      return new SteamConnector(platform)
    case 'gog':
      return new GogConnector(platform)
    case 'epic':
      return new EpicConnector(platform)
    default:
      throw new Error(`${store} has no connector yet.`)
  }
}
