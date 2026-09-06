import type { OwnedGame, PlayStatus } from '../connectors/types.js'

const rows: [string, OwnedGame['store'], PlayStatus, number | undefined, string[], number][] = [
  ['Half-Life 2', 'steam', 'played', 1420, ['Shooter'], 2004],
  ['Portal 2', 'steam', 'played', 890, ['Puzzle'], 2011],
  ['Disco Elysium', 'gog', 'played', 2760, ['RPG'], 2019],
  ['The Witcher 3: Wild Hunt', 'gog', 'played', 9840, ['RPG'], 2015],
  ['Hades', 'steam', 'played', 3120, ['Roguelike', 'Action'], 2020],
  ['Control', 'epic', 'unknown', undefined, ['Action'], 2019],
  ['Baldur’s Gate 3', 'gog', 'played', 12400, ['RPG'], 2023],
  ['Outer Wilds', 'epic', 'unknown', undefined, ['Adventure'], 2019],
  ['Return of the Obra Dinn', 'steam', 'unplayed', undefined, ['Puzzle'], 2018],
  ['Hollow Knight', 'steam', 'played', 4300, ['Metroidvania'], 2017],
  ['Slay the Spire', 'steam', 'played', 5600, ['Roguelike'], 2019],
  ['Cyberpunk 2077', 'gog', 'unplayed', undefined, ['RPG'], 2020],
  ['Factorio', 'steam', 'played', 15200, ['Simulation'], 2020],
  ['Subnautica', 'epic', 'unknown', undefined, ['Survival'], 2018],
  ['Stardew Valley', 'steam', 'played', 6800, ['Simulation'], 2016]
]

/** Enough shape to design against before any real import. */
export function sampleLibrary(): OwnedGame[] {
  return rows.map(([title, store, playStatus, playtimeMinutes, genres, releaseYear], index) => ({
    store,
    storeGameId: `sample-${index}`,
    title,
    ownership: { kind: 'owned' as const },
    playStatus,
    playtimeMinutes,
    genres,
    releaseYear
  }))
}
