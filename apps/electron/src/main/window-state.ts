import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

const MIN_WIDTH = 760
const MIN_HEIGHT = 540
const FALLBACK_AREA = { x: 0, y: 0, width: 1280, height: 800 }

// Wayland gives an app neither its window's position nor a way to set one, and Electron reports
// a placeholder instead, so positions are only kept where the platform really has them.
const positionsWork = !(process.platform === 'linux' && process.env['WAYLAND_DISPLAY'])

function statePath(dataDir: string): string {
  return join(dataDir, 'window.electron.json')
}

/**
 * The area a window must fit: the display it was left on, where positions are known, or else
 * the smallest connected display. On Wayland the window can land on any screen, so only a size
 * that fits the smallest is safe.
 */
function targetArea(position?: { x: number; y: number }): Rectangle {
  const displays = screen.getAllDisplays()
  if (!displays.length) return FALLBACK_AREA
  if (position) return screen.getDisplayNearestPoint(position).workArea
  return displays
    .map((display) => display.workArea)
    .reduce((smallest, area) => (area.width * area.height < smallest.width * smallest.height ? area : smallest))
}

function onAnyDisplay(bounds: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea }) => {
    const width = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x)
    const height = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y)
    return width > bounds.width / 2 && height > bounds.height / 2
  })
}

const defaultSize = (area: Rectangle): { width: number; height: number } => ({
  width: Math.max(MIN_WIDTH, Math.min(1600, Math.round(area.width * 0.9))),
  height: Math.max(MIN_HEIGHT, Math.round(area.height * 0.9))
})

/** Where and how large the window opens: as it was left, made to fit, or 90% of the target display. */
export function initialWindowState(dataDir: string): WindowState {
  try {
    const saved = JSON.parse(readFileSync(statePath(dataDir), 'utf8')) as Partial<WindowState>
    const { width, height, x, y } = saved
    if (typeof width === 'number' && typeof height === 'number' && width >= MIN_WIDTH && height >= MIN_HEIGHT) {
      const hasPosition = positionsWork && typeof x === 'number' && typeof y === 'number' && onAnyDisplay({ x, y, width, height })
      const area = targetArea(hasPosition ? { x, y } : undefined)
      return {
        width: Math.max(MIN_WIDTH, Math.min(width, area.width)),
        height: Math.max(MIN_HEIGHT, Math.min(height, area.height)),
        ...(hasPosition ? { x, y } : {}),
        maximized: saved.maximized === true
      }
    }
  } catch {
    // No saved state yet, or an unreadable file: fall through to the default.
  }
  return { ...defaultSize(targetArea()), maximized: false }
}

export const windowMinimums = { minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT }

/**
 * Shrinks the window if it no longer fits once the display list settles. Wayland can report
 * only some displays at startup — one launch in six saw just a 1440p screen, sized the window
 * for it, and had it placed on a 1080p screen at 125% — so the first seconds are re-checked.
 */
export function keepWindowFitting(window: BrowserWindow): void {
  const fit = (): void => {
    if (window.isDestroyed() || window.isMaximized() || window.isFullScreen()) return
    const area = targetArea(positionsWork ? window.getBounds() : undefined)
    const [width, height] = window.getSize()
    if (width > area.width || height > area.height) {
      const size = defaultSize(area)
      window.setSize(Math.min(width, size.width), Math.min(height, size.height))
    }
  }
  screen.on('display-added', fit)
  screen.on('display-removed', fit)
  screen.on('display-metrics-changed', fit)
  window.once('show', fit)
  setTimeout(() => {
    screen.off('display-added', fit)
    screen.off('display-removed', fit)
    screen.off('display-metrics-changed', fit)
  }, 5000)
}

/** Saves the un-maximised size — and position, where real — on close. */
export function rememberWindowState(window: BrowserWindow, dataDir: string): void {
  window.on('close', () => {
    const { x, y, width, height } = window.getNormalBounds()
    const state: WindowState = { width, height, ...(positionsWork ? { x, y } : {}), maximized: window.isMaximized() }
    try {
      writeFileSync(statePath(dataDir), JSON.stringify(state))
    } catch {
      // Losing the window size is not worth failing a close over.
    }
  })
}
