/** "under a minute", "about a minute", "about 6 minutes". */
export function roughly(seconds: number): string {
  if (seconds < 60) return 'under a minute'
  const minutes = Math.round(seconds / 60)
  return minutes === 1 ? 'about a minute' : `about ${minutes} minutes`
}

export function timeLeft(seconds: number | null): string {
  return seconds === null ? 'estimating time left…' : `${roughly(seconds)} left`
}

/** Elapsed time as m:ss. */
export function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}
