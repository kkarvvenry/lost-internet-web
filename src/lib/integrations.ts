export type IntegrationProvider = 'spotify' | 'yandex'

export type IntegrationTrack = {
  title: string
  artist: string
  album: string
  duration: number
  url?: string
  previewUrl?: string
}

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/
const YANDEX_HOSTS = ['music.yandex.ru', 'music.yandex.com', 'music.yandex.kz', 'music.yandex.by']

function text(value: unknown, max = 180): string {
  return String(value ?? '').trim().slice(0, max)
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

export function parseSpotifyPlaylistUrl(raw: string): string | null {
  const value = raw.trim()
  const uri = value.match(/^spotify:playlist:([A-Za-z0-9]{22})$/)
  if (uri) return uri[1]
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (host !== 'open.spotify.com') return null
    const match = url.pathname.match(/^\/playlist\/([A-Za-z0-9]{22})\/?$/)
    return match && SPOTIFY_ID.test(match[1]) ? match[1] : null
  } catch {
    return null
  }
}

export function parseYandexPlaylistUrl(raw: string): { uid: string; kind: string } | null {
  try {
    const url = new URL(raw.trim())
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    if (!YANDEX_HOSTS.includes(host)) return null
    const full = url.pathname.match(/^\/users\/([A-Za-z0-9_-]+)\/playlists\/([A-Za-z0-9_-]+)\/?$/)
    if (full) return { uid: full[1], kind: full[2] }
    const short = url.pathname.match(/^\/playlists\/([A-Za-z0-9_-]+)\/?$/)
    if (short) return { uid: 'me', kind: short[1] }
    return null
  } catch {
    return null
  }
}

export function mapSpotifyPage(json: unknown): { next: string | null; tracks: IntegrationTrack[] } {
  const root = record(json)
  if (!root) return { next: null, tracks: [] }
  const items = Array.isArray(root.items) ? root.items : []
  const tracks: IntegrationTrack[] = []
  for (const item of items) {
    const wrapper = record(item)
    const raw = record(wrapper?.track)
    if (!raw) continue
    const title = text(raw.name)
    if (!title) continue
    const artists = Array.isArray(raw.artists)
      ? raw.artists.map(a => text(record(a)?.name, 80)).filter(Boolean)
      : []
    const album = record(raw.album)
    const urls = record(raw.external_urls)
    tracks.push({
      title,
      artist: artists.join(', ') || 'unknown artist',
      album: text(album?.name, 120),
      duration: Math.max(0, Math.round(Number(raw.duration_ms ?? 0) / 1000)),
      url: text(urls?.spotify, 300) || undefined,
      previewUrl: text(raw.preview_url, 500) || undefined,
    })
  }
  return { next: typeof root.next === 'string' ? root.next : null, tracks }
}

type SpotifyEmbedTrack = {
  uri?: unknown
  title?: unknown
  subtitle?: unknown
  duration?: unknown
  audioPreview?: { url?: unknown }
}

export async function fetchSpotifyEmbedTracks(playlistId: string): Promise<IntegrationTrack[]> {
  const response = await fetch(`https://open.spotify.com/embed/playlist/${playlistId}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  if (!response.ok) throw new Error(`embed status ${response.status}`)
  const html = await response.text()
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)
  if (!match) throw new Error('embed data missing')
  const data = JSON.parse(match[1]) as {
    props?: { pageProps?: { state?: { data?: { entity?: { trackList?: unknown[] } } } } }
  }
  const list = data.props?.pageProps?.state?.data?.entity?.trackList
  if (!Array.isArray(list)) throw new Error('embed track list missing')
  const tracks: IntegrationTrack[] = []
  for (const item of list) {
    const raw = record(item) as SpotifyEmbedTrack | null
    const title = text(raw?.title)
    if (!raw || !title) continue
    const trackId = String(raw.uri ?? '').match(/^spotify:track:([A-Za-z0-9]{22})$/)?.[1] ?? ''
    const artists = text(raw.subtitle, 300)
      .replace(/\u00a0/g, ' ')
      .split(/,\s*/)
      .map(name => text(name, 80))
      .filter(Boolean)
      .join(', ')
    tracks.push({
      title,
      artist: artists || 'unknown artist',
      album: '',
      duration: Math.max(0, Math.round(Number(raw.duration ?? 0) / 1000)),
      url: trackId ? `https://open.spotify.com/track/${trackId}` : undefined,
      previewUrl: text(raw.audioPreview?.url, 500) || undefined,
    })
  }
  return tracks
}

export function mapYandexPlaylist(json: unknown): IntegrationTrack[] {
  const root = record(json)
  if (!root) return []
  const playlist = record(root.playlist)
  const rawTracks = Array.isArray(root.tracks) ? root.tracks : (Array.isArray(playlist?.tracks) ? playlist.tracks : [])
  const tracks: IntegrationTrack[] = []
  for (const item of rawTracks) {
    const wrapper = record(item)
    const raw = record(wrapper?.track) ?? wrapper
    if (!raw) continue
    const title = text(raw.title)
    if (!title) continue
    const artists = Array.isArray(raw.artists)
      ? raw.artists.map(a => text(record(a)?.name, 80)).filter(Boolean)
      : []
    const album = record(raw.album)
    tracks.push({
      title,
      artist: artists.join(', ') || 'unknown artist',
      album: text(album?.title, 120),
      duration: Math.max(0, Math.round(Number(raw.durationMs ?? 0) / 1000)),
      url: undefined,
    })
  }
  return tracks
}
