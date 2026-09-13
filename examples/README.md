# Library file examples

Files you can import on the **Settings** tab with **Import…**, for building a library by hand or with a script instead of connecting a store.

| File | What it shows |
| --- | --- |
| [`library-minimal.csv`](library-minimal.csv) / [`library-minimal.json`](library-minimal.json) | The smallest valid file: titles only. |
| [`library.csv`](library.csv) / [`library.json`](library.json) | Every column worth writing yourself. |

Both formats of each pair import to the same games, and both accept the same values. A CSV import first shows how its columns were matched so you can correct them; a JSON import is read directly.

**Importing replaces the games in your library** with the ones in the file. Games you added by hand in the app are kept, unless the file has the same title on the same store. Your edits and hidden flags are kept too, as long as each game has the same store and id as before (see `store_game_id` below). Export a backup first if you have anything to lose.

## Required

**Only the title.** That is the `title` column in a CSV, or the `"title"` key in JSON.

- A row or entry without a title is skipped.
- A JSON file must be an array (`[ … ]`) with at least one titled entry, or the import is refused.

Everything else is optional and has a default.

## Recommended

- **`store`**: without it, every game counts as `other`.
- **`store_game_id`**: the game's id on its store; for Steam, the number in `store.steampowered.com/app/<id>`.
  - **Metadata:** a Steam id lets **Fetch metadata** match the exact game instead of searching by title.
  - **Stable identity:** your edits and hidden flags are attached to store + id. Without an id, the row's position in the file stands in for it, so re-importing a file with rows added or reordered can move your edits onto other games.

## Columns

| CSV column | JSON key | Accepted values | If missing or unrecognised |
| --- | --- | --- | --- |
| **`title`** *(required)* | **`title`** | Any text | Row skipped |
| `store` | `store` | `steam`, `gog`, `epic`, `other`. Longer names such as `Steam`, `GOG.com` or `Epic Games Store` also work | `other` |
| `store_game_id` | `storeGameId` | Text. **In JSON it must be a string**: `"620"`, not `620` | The row's position in the file |
| `platform` | `platform` | `pc`, `xbox`, `playstation`, `switch`, `other`. Names like `Windows`, `Steam Deck`, `PS5`, `Xbox Series X` or `Nintendo Switch` also work | `pc` if empty; `other` if it cannot be placed |
| `status` | `playStatus` | `played`, `unplayed`, `unknown`. `never played` also reads as unplayed, and `completed` or `finished` as played | `unknown` |
| `playtime_minutes` | `playtimeMinutes` | A number of minutes. In a CSV, a playtime column whose header does not contain "minute" (`hours`, `hours_played`, `playtime`) is read as **hours**, and `14.5` becomes 870 minutes | No playtime |
| `genres` | `genres` | CSV: separated by `;`, as in `Action; RPG`. JSON: an array of strings | None |
| `release_year` | `releaseYear` | A whole number, such as `2019` | None |
| `developer` | `developer` | Text | None |
| `publisher` | `publisher` | Text | None |
| `notes` | `notes` | Text | None |

- **Values are matched loosely too**, in both formats: case and punctuation are ignored.
- **CSV headers are matched loosely**, ignoring case, spaces and punctuation, and common alternatives are recognised: `name` or `game` for the title, `hours_played` for playtime, `app_id` or `id` for the store id. Anything still unmatched can be assigned on the confirmation screen before the import is written.
- **JSON numbers must be numbers.** A value like `"2019"` in quotes is dropped rather than guessed at.

## Columns to leave out

An **Export** writes more columns than these: scores, review summaries, cover and store links, Steam match details, family-sharing ownership, hidden flags, edits, and timestamps such as `enriched_at`. They exist so a backup restores exactly, and the app fills them in itself: **Fetch metadata** looks up any game without `enriched_at`, and store sync writes ownership. A hand-built file does not need them, and an export shows their format if a script ever does.
