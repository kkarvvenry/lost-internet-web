export function uid() { return Math.random().toString(36).slice(2, 11) }

export function fmt(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function fmtBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`
}

export function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)) }

export function dbToGain(db: number) { return Math.pow(10, db / 20) }

export function parseName(fileName: string) {
  const base = fileName.replace(/\.[^.]+$/, '')
  const parts = base.split(' - ')
  if (parts.length >= 2) return { artist: parts[0].trim() || 'unknown artist', title: parts.slice(1).join(' - ').trim() || base }
  return { artist: 'unknown artist', title: base || 'unknown title' }
}
