import type { Platform } from '@ludoteca/core'

declare global {
  interface Window {
    ludoteca?: Platform
  }
}

/** Installed by whichever shell is hosting this page. */
export function usePlatform(): Platform {
  const platform = window.ludoteca
  if (!platform) {
    throw new Error('No platform bridge: the shell did not install window.ludoteca.')
  }
  return platform
}
