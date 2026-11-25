export type ProviderId = 'yandex' | 'spotify' | 'youtube' | 'bandcamp' | 'soundcloud' | 'musicbrainz'

export type TrackLinks = Partial<Record<ProviderId, string>>

type Provider = {
  id: ProviderId
  label: string
  hosts: string[]
  search: (encoded: string) => string
}

export const PROVIDERS: Provider[] = [
  {
    id: 'yandex',
    label: 'Yandex Music',
    hosts: ['music.yandex.ru', 'music.yandex.com', 'music.yandex.kz', 'music.yandex.by'],
    search: q => `https://music.yandex.ru/search?text=${q}`,
  },
  {
    id: 'spotify',
    label: 'Spotify',
    hosts: ['open.spotify.com'],
    search: q => `https://open.spotify.com/search/${q}`,
  },
  {
    id: 'youtube',
    label: 'YouTube Music',
    hosts: ['music.youtube.com', 'youtube.com'],
    search: q => `https://music.youtube.com/search?q=${q}`,
  },
  {
    id: 'bandcamp',
    label: 'Bandcamp',
    hosts: ['bandcamp.com', '*.bandcamp.com'],
    search: q => `https://bandcamp.com/search?q=${q}`,
  },
  {
    id: 'soundcloud',
    label: 'SoundCloud',
    hosts: ['soundcloud.com'],
    search: q => `https://soundcloud.com/search?q=${q}`,
  },
  {
    id: 'musicbrainz',
    label: 'MusicBrainz',
    hosts: ['musicbrainz.org'],
    search: q => `https://musicbrainz.org/search?query=${q}&type=recording&method=indexed`,
  },
]

const BY_ID = Object.fromEntries(PROVIDERS.map(p => [p.id, p])) as Record<ProviderId, Provider>

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BY_ID, value)
}

export function buildSearchQuery(artist: string, title: string): string {
  const cleanArtist = artist.trim()
  const known = cleanArtist && cleanArtist.toLowerCase() !== 'unknown artist'
  return [known ? cleanArtist : '', title.trim()].filter(Boolean).join(' ')
}

export function buildSearchUrl(provider: ProviderId, query: string): string {
  return BY_ID[provider].search(encodeURIComponent(query.trim()))
}

export function normalizeServiceUrl(provider: ProviderId, raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const allowed = BY_ID[provider].hosts.some(entry =>
      entry.startsWith('*.') ? host.endsWith(entry.slice(1)) : host === entry,
    )
    if (!allowed) return null
    url.protocol = 'https:'
    return url.toString()
  } catch {
    return null
  }
}

export function sanitizeLinks(value: unknown): TrackLinks | undefined {
  if (!value || typeof value !== 'object') return undefined
  const source = value as Record<string, unknown>
  const result: TrackLinks = {}
  for (const provider of PROVIDERS) {
    const raw = source[provider.id]
    if (typeof raw !== 'string') continue
    const clean = normalizeServiceUrl(provider.id, raw)
    if (clean) result[provider.id] = clean
  }
  return Object.keys(result).length ? result : undefined
}
