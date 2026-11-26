import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type UIEvent as ReactUIEvent } from 'react'
import { uid, fmt, fmtBytes, clamp, dbToGain, parseName } from '../lib/format'
import { VIRTUALIZE_THRESHOLD, tableWindow } from '../lib/table'
import { translate, type Language } from '../lib/i18n'
import { PROVIDERS, buildSearchQuery, buildSearchUrl, isProviderId, normalizeServiceUrl, sanitizeLinks, type ProviderId, type TrackLinks } from '../lib/links'
import { matchScore } from '../lib/match'
import type { IntegrationProvider, IntegrationTrack } from '../lib/integrations'
import './LostInternetApp.css'

type RepeatMode = 'off' | 'all' | 'one'
type VizMode = 'spectrum' | 'globe' | 'hybrid' | 'scope'
type EqPreset = 'flat' | 'bass' | 'vocal' | 'night' | 'custom'
type Section = 'now' | 'playlist' | 'library' | 'radio' | 'settings' | 'archive' | 'recent' | 'network' | 'favorites' | 'unknown'
type SortField = 'name' | 'artist' | 'album' | 'duration' | 'plays' | 'addedAt' | 'lastPlayed'
type MenuKind = 'file' | 'view' | 'playback' | 'help'
type PopupKind = 'ie' | 'favorites' | 'about' | 'help' | 'links'
type Settings = {
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  vizMode: VizMode
  vizSensitivity: number
  eq: { bass: number; mid: number; treble: number }
  eqPreset: EqPreset
  crossfade: boolean
  crossfadeMs: number
  compressor: boolean
  compressorThreshold: number
  compressorRatio: number
  makeup: number
  scanlines: boolean
  grain: boolean
  glitch: boolean
  calm: boolean
  showPopups: boolean
  theme: 'dark' | 'light'
  language: Language
  defaultProvider: ProviderId
}
type Track = {
  id: string
  blob?: Blob
  artBlob?: Blob
  url: string
  artUrl?: string
  name: string
  artist: string
  album: string
  genre: string
  duration: number
  size: number
  format: string
  bitrate: number
  sampleRate: number
  favorite: boolean
  plays: number
  lastPlayed: number
  addedAt: number
  links?: TrackLinks
}
type Playlist = { id: string; name: string; trackIds: string[] }
type CatalogTrack = {
  id: string
  title: string
  artist: string
  album: string
  genre: string
  format: string
  duration: number
  likes: number
  created_at: number
}
type Popup = { id: string; kind: PopupKind; title: string; x: number; y: number; z: number }

const DB_NAME = 'lost-internet-web'
const DB_VER = 1
const STORE_TRACKS = 'tracks'
const STORE_META = 'meta'
const KEY_SETTINGS = 'settings'
const KEY_PLAYLISTS = 'playlists'
const KEY_LAST_TRACK = 'lastTrack'

const DEFAULT_SETTINGS: Settings = {
  volume: 0.72,
  muted: false,
  shuffle: false,
  repeat: 'off',
  vizMode: 'hybrid',
  vizSensitivity: 1,
  eq: { bass: 0, mid: 0, treble: 0 },
  eqPreset: 'flat',
  crossfade: true,
  crossfadeMs: 600,
  compressor: true,
  compressorThreshold: -18,
  compressorRatio: 4,
  makeup: 2,
  scanlines: true,
  grain: true,
  glitch: true,
  calm: false,
  showPopups: true,
  theme: 'dark',
  language: 'en',
  defaultProvider: 'yandex',
}
const EQ_PRESETS: Record<EqPreset, { bass: number; mid: number; treble: number }> = {
  flat: { bass: 0, mid: 0, treble: 0 },
  bass: { bass: 9, mid: -2, treble: 1 },
  vocal: { bass: -2, mid: 7, treble: 3 },
  night: { bass: 4, mid: -4, treble: -6 },
  custom: { bass: 0, mid: 0, treble: 0 },
}
const SECTIONS: Array<{ id: Section; label: string }> = [
  { id: 'now', label: 'NOW PLAYING   >' },
  { id: 'playlist', label: 'PLAYLIST' },
  { id: 'library', label: 'LIBRARY' },
  { id: 'radio', label: 'RADIO' },
  { id: 'settings', label: 'SETTINGS' },
]
const SECONDARY: Array<{ id: Section; label: string }> = [
  { id: 'network', label: 'NETWORK' },
  { id: 'archive', label: 'ARCHIVE' },
  { id: 'recent', label: 'RECENT' },
  { id: 'favorites', label: 'FAVORITES' },
  { id: 'unknown', label: 'UNKNOWN' },
]
const MENUS: Array<{ id: MenuKind; label: string }> = [
  { id: 'file', label: 'File' },
  { id: 'view', label: 'View' },
  { id: 'playback', label: 'Playback' },
  { id: 'help', label: 'Help' },
]
const EMPTY_LINKS: TrackLinks = {}
const POPUP_WIDTH: Record<PopupKind, number> = { ie: 340, favorites: 260, about: 320, help: 420, links: 440 }
const POPUP_HEIGHT: Record<PopupKind, number> = { ie: 150, favorites: 180, about: 200, help: 440, links: 480 }
const POPUP_TITLE: Record<PopupKind, string> = {
  ie: 'Internet Explorer',
  favorites: '★ Favorites',
  about: 'about_lost_internet.txt',
  help: 'keys.txt',
  links: 'links.txt',
}

let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_TRACKS)) db.createObjectStore(STORE_TRACKS, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'key' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    }).catch(error => {
      dbPromise = null
      throw error
    })
  }
  return dbPromise
}
async function dbGetAll<T>(store: string): Promise<T[]> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const req = tx.objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
    tx.onabort = () => reject(tx.error ?? new Error('Archive read aborted'))
  })
}
async function dbPut(store: string, value: any): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Archive write failed'))
    tx.onabort = () => reject(tx.error ?? new Error('Archive write aborted'))
  })
}
async function dbDelete(store: string, key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Archive delete failed'))
    tx.onabort = () => reject(tx.error ?? new Error('Archive delete aborted'))
  })
}
async function dbClear(store: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('Archive clear failed'))
    tx.onabort = () => reject(tx.error ?? new Error('Archive clear aborted'))
  })
}

function decodeId3Text(payload: Uint8Array) {
  const encoding = payload[0]
  const rest = payload.slice(1)
  let text = ''
  try {
    if (encoding === 1) text = new TextDecoder('utf-16le').decode(rest)
    else if (encoding === 2) text = new TextDecoder('utf-16be').decode(rest)
    else if (encoding === 3) text = new TextDecoder('utf-8').decode(rest)
    else text = new TextDecoder('windows-1251').decode(rest)
  } catch {
    text = new TextDecoder('iso-8859-1').decode(rest)
  }
  return text.replace(/^\uFEFF/, '').replace(/\0/g, '').trim()
}
function syncsafe(b: Uint8Array, o: number) { return (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3] }
async function parseId3(file: File): Promise<{ name?: string; artist?: string; album?: string; genre?: string; artBlob?: Blob }> {
  const buf = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer())
  if (buf.length < 10 || String.fromCharCode(buf[0], buf[1], buf[2]) !== 'ID3') return {}
  const version = buf[3]
  const tag = buf.slice(10, 10 + syncsafe(buf, 6))
  const out: { name?: string; artist?: string; album?: string; genre?: string; artBlob?: Blob } = {}
  let pos = 0
  while (pos + 10 <= tag.length) {
    const id = String.fromCharCode(tag[pos], tag[pos + 1], tag[pos + 2], tag[pos + 3])
    if (id === '\0\0\0\0') break
    const size = version >= 4
      ? syncsafe(tag, pos + 4)
      : ((tag[pos + 4] << 24) | (tag[pos + 5] << 16) | (tag[pos + 6] << 8) | tag[pos + 7]) >>> 0
    const payload = tag.slice(pos + 10, pos + 10 + size)
    pos += 10 + size
    if (size <= 1) continue
    if (id === 'TIT2') out.name = decodeId3Text(payload)
    if (id === 'TPE1') out.artist = decodeId3Text(payload)
    if (id === 'TALB') out.album = decodeId3Text(payload)
    if (id === 'TCON') out.genre = decodeId3Text(payload)
    if (id === 'APIC' && !out.artBlob) {
      const encoding = payload[0]
      const utf16 = encoding === 1 || encoding === 2
      const unit = utf16 ? 2 : 1
      const decoder = new TextDecoder(encoding === 1 ? 'utf-16le' : encoding === 2 ? 'utf-16be' : encoding === 3 ? 'utf-8' : 'latin1')
      const findTerm = (from: number) => {
        let i = from
        while (i + unit <= payload.length) {
          if (payload[i] === 0 && (!utf16 || payload[i + 1] === 0)) return i
          i += unit
        }
        return payload.length
      }
      const mimeEnd = findTerm(1)
      const mime = decoder.decode(payload.slice(1, mimeEnd)).replace(/^\uFEFF/, '')
      const descEnd = findTerm(mimeEnd + unit)
      const image = payload.slice(descEnd + unit)
      if (image.length > 16) out.artBlob = new Blob([image], { type: mime || (image[0] === 0xff ? 'image/jpeg' : 'image/png') })
    }
  }
  return out
}
async function parseWavInfo(file: File): Promise<{ sampleRate: number; bitrate: number }> {
  try {
    const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
    const text = new TextDecoder('latin1').decode(bytes.slice(0, 12))
    if (!text.startsWith('RIFF') || text.slice(8, 12) !== 'WAVE') return { sampleRate: 0, bitrate: 0 }
    let pos = 12
    while (pos + 8 <= bytes.length) {
      const id = new TextDecoder('latin1').decode(bytes.slice(pos, pos + 4))
      const size = bytes[pos + 4] | (bytes[pos + 5] << 8) | (bytes[pos + 6] << 16) | (bytes[pos + 7] << 24)
      if (id === 'fmt ' && pos + 16 <= bytes.length) {
        const rate = bytes[pos + 12] | (bytes[pos + 13] << 8) | (bytes[pos + 14] << 16) | (bytes[pos + 15] << 24)
        const bits = bytes[pos + 18] | (bytes[pos + 19] << 8)
        return { sampleRate: rate, bitrate: Math.round(rate * bits / 1000) }
      }
      pos += 8 + size + (size % 2)
    }
  } catch {}
  return { sampleRate: 0, bitrate: 0 }
}

function renderArt(canvas: HTMLCanvasElement, artUrl: string | undefined, label: string, glitch: boolean, theme: 'dark' | 'light') {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return
  const w = canvas.width = 430
  const h = canvas.height = 430
  const light = theme === 'light'
  const palette = {
    bg: light ? '#D6D6D6' : '#111111',
    grid: light ? '#A5A5A5' : '#252525',
    frame: '#142B83',
    label: light ? '#050505' : '#A5A5A5',
    sub: light ? '#050505' : '#D6D6D6',
    muted: '#555555',
  }
  ctx.fillStyle = palette.bg
  ctx.fillRect(0, 0, w, h)
  ctx.strokeStyle = palette.grid
  ctx.lineWidth = 1
  for (let x = 0; x < w; x += 24) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke() }
  for (let y = 0; y < h; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  const decor = () => {
    ctx.strokeStyle = palette.frame
    ctx.strokeRect(18, 18, 393, 393)
    ctx.beginPath()
    ctx.moveTo(18, 215); ctx.lineTo(411, 215)
    ctx.moveTo(215, 18); ctx.lineTo(215, 411)
    ctx.stroke()
    ctx.fillStyle = palette.label
    ctx.font = 'bold 27px Courier New'
    ctx.textAlign = 'center'
    ctx.fillText(label, 215, 201)
    ctx.font = '12px Courier New'
    ctx.fillStyle = palette.sub
    ctx.fillText('LOSE.EXE // NO SIGNAL', 215, 225)
    ctx.font = '11px Courier New'
    ctx.fillStyle = palette.muted
    ctx.fillText('lost://archive/index.htm', 215, 246)
    ctx.textAlign = 'left'
    ctx.fillText('+' + String(Math.floor(Date.now() / 1000) % 10000).padStart(4, '0'), 30, 404)
  }
  const finish = () => {
    if (glitch) {
      for (let y = 40; y < 400; y += 57) {
        const shift = y % 2 ? 3 : -3
        ctx.drawImage(canvas, 0, y, w, 6, shift, y, w, 6)
      }
    }
    decor()
  }
  if (!artUrl) { finish(); return }
  const img = new Image()
  img.onload = () => {
    const side = Math.min(img.width, img.height)
    ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h)
    for (let i = 0; i < data.data.length; i += 4) {
      const gray = data.data[i] * 0.299 + data.data[i + 1] * 0.587 + data.data[i + 2] * 0.114
      const noise = Math.sin(i * 0.137) * 14
      const v = clamp(gray + noise, 0, 255)
      data.data[i] = v; data.data[i + 1] = v; data.data[i + 2] = v
    }
    const shade = light ? 0.92 : 0.82
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4
        data.data[i] *= shade; data.data[i + 1] *= shade; data.data[i + 2] *= shade
      }
    }
    ctx.putImageData(data, 0, 0)
    finish()
  }
  img.onerror = finish
  img.src = artUrl
}

export function LostInternetApp({ onExit }: { onExit?: () => void }) {
  const [tracks, setTracks] = useState<Track[]>([])
  const [playlists, setPlaylists] = useState<Playlist[]>([{ id: 'p1', name: 'webcore', trackIds: [] }])
  const [settings, setSettings] = useState<Settings>(() => {
    let theme: 'dark' | 'light' = 'dark'
    try { theme = localStorage.getItem('lost-internet-theme') === 'light' ? 'light' : 'dark' } catch { /* storage unavailable */ }
    return { ...DEFAULT_SETTINGS, theme }
  })
  const tr = (text: string) => translate(settings.language, text)
  const [section, setSection] = useState<Section>('library')
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>('p1')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' }>({ field: 'addedAt', dir: 'desc' })
  const [playlistSort, setPlaylistSort] = useState<{ field: SortField; dir: 'asc' | 'desc' } | null>(null)
  const [pendingLikes, setPendingLikes] = useState<string[]>([])
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [duration, setDuration] = useState(0)
  const [popups, setPopups] = useState<Popup[]>([])
  const [linksTarget, setLinksTarget] = useState<{ id?: string; query: string } | null>(null)
  const [importProvider, setImportProvider] = useState<IntegrationProvider>('spotify')
  const [importUrl, setImportUrl] = useState('')
  const [importResults, setImportResults] = useState<IntegrationTrack[]>([])
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState('')
  const [openMenu, setOpenMenu] = useState<MenuKind | null>(null)
  const [status, setStatus] = useState('Ready. Drop into the archive.')
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [catalog, setCatalog] = useState<CatalogTrack[]>([])
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogSort, setCatalogSort] = useState<'recent' | 'likes'>('recent')
  const [catalogLikes, setCatalogLikes] = useState(0)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [storageUsage, setStorageUsage] = useState<{ used: number; quota: number } | null>(null)
  const [tableScrollTop, setTableScrollTop] = useState(0)
  const [tableViewportHeight, setTableViewportHeight] = useState(400)
  const [updateReady, setUpdateReady] = useState(false)
  const [glitchActive, setGlitchActive] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const nextAudioRef = useRef<HTMLAudioElement | null>(null)
  const artRef = useRef<HTMLCanvasElement | null>(null)
  const visRef = useRef<HTMLCanvasElement | null>(null)
  const tableWrapRef = useRef<HTMLDivElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const folderRef = useRef<HTMLInputElement | null>(null)
  const backupRef = useRef<HTMLInputElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const trebleRef = useRef<BiquadFilterNode | null>(null)
  const filtersRef = useRef<{ bass: BiquadFilterNode; mid: BiquadFilterNode; treble: BiquadFilterNode } | null>(null)
  const gainsRef = useRef<{ a: GainNode; b: GainNode } | null>(null)
  const masterGainRef = useRef<GainNode | null>(null)
  const compressorRef = useRef<DynamicsCompressorNode | null>(null)
  const activeSlotRef = useRef<'a' | 'b'>('a')
  const pendingIdRef = useRef<string | null>(null)
  const fadeRafRef = useRef<number | null>(null)
  const fadeLevelsRef = useRef<{ a: number; b: number }>({ a: 1, b: 0 })
  const autoAdvanceRef = useRef<string | null>(null)
  const catalogReqRef = useRef(0)
  const dragDepthRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const levelsRef = useRef(new Float32Array(48))
  const urlsRef = useRef<Map<string, string[]>>(new Map())
  const hydratedRef = useRef(false)
  const popupsSeededRef = useRef(false)
  const popupIdsRef = useRef('')
  const popupFocusRef = useRef<HTMLElement | null>(null)
  const zRef = useRef(20)
  const nextRef = useRef<(fromAuto?: boolean) => void>(() => {})
  const playTokenRef = useRef(0)
  const busyRef = useRef(false)
  const likedPendingRef = useRef<Set<string>>(new Set())
  const storageWarnedRef = useRef('')
  const hydratedOkRef = useRef(true)
  const playUiTokenRef = useRef(0)
  const tracksRef = useRef(tracks)
  const currentIdRef = useRef(currentId)
  const settingsRef = useRef(settings)
  const visibleRef = useRef<Track[]>([])

  tracksRef.current = tracks
  currentIdRef.current = currentId
  settingsRef.current = settings

  const current = useMemo(() => tracks.find(t => t.id === currentId) ?? null, [tracks, currentId])
  function sortTracks(list: Track[], order: { field: SortField; dir: 'asc' | 'desc' }) {
    const dir = order.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      if (['duration', 'plays', 'addedAt', 'lastPlayed'].includes(order.field)) {
        return (Number(a[order.field] ?? 0) - Number(b[order.field] ?? 0)) * dir
      }
      return String(a[order.field] ?? '').localeCompare(String(b[order.field] ?? '')) * dir
    })
  }
  const visibleTracks = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = tracks
    if (section === 'favorites') list = tracks.filter(t => t.favorite)
    if (section === 'unknown') list = tracks.filter(t => !t.artist || t.artist === 'unknown artist')
    if (section === 'playlist' && selectedPlaylistId) {
      const ids = playlists.find(p => p.id === selectedPlaylistId)?.trackIds ?? []
      const byId = new Map(tracks.map(t => [t.id, t]))
      list = ids.map(id => byId.get(id)).filter((t): t is Track => Boolean(t))
      if (playlistSort) list = sortTracks(list, playlistSort)
    }
    if (section === 'radio') list = []
    if (q) list = list.filter(t => `${t.name} ${t.artist} ${t.album} ${t.genre}`.toLowerCase().includes(q))
    if (section !== 'playlist') list = sortTracks(list, sort)
    return list
  }, [tracks, query, section, selectedPlaylistId, playlists, playlistSort, sort])
  visibleRef.current = visibleTracks
  nextRef.current = handleNext

  function getActiveAudio() {
    return activeSlotRef.current === 'a' ? audioRef.current : nextAudioRef.current
  }
  function getOtherAudio() {
    return activeSlotRef.current === 'a' ? nextAudioRef.current : audioRef.current
  }
  function stopFade() {
    if (fadeRafRef.current !== null) {
      cancelAnimationFrame(fadeRafRef.current)
      fadeRafRef.current = null
    }
    pendingIdRef.current = null
  }
  function setSlotLevel(slot: 'a' | 'b', level: number) {
    const value = clamp(level, 0, 1)
    fadeLevelsRef.current[slot] = value
    const gain = gainsRef.current?.[slot]
    if (gain) {
      gain.gain.value = value
      return
    }
    const el = slot === 'a' ? audioRef.current : nextAudioRef.current
    if (el) {
      el.volume = settingsRef.current.muted
        ? 0
        : clamp(settingsRef.current.volume * dbToGain(settingsRef.current.makeup) * value, 0, 1)
    }
  }
  function fadeSlots(from: 'a' | 'b', to: 'a' | 'b', ms: number) {
    stopFade()
    const fromStart = fadeLevelsRef.current[from]
    const toStart = fadeLevelsRef.current[to]
    const started = performance.now()
    const duration = Math.max(100, ms)
    const step = (now: number) => {
      const t = clamp((now - started) / duration, 0, 1)
      setSlotLevel(from, fromStart * (1 - t))
      setSlotLevel(to, toStart + (1 - toStart) * t)
      if (t < 1) {
        fadeRafRef.current = requestAnimationFrame(step)
        return
      }
      fadeRafRef.current = null
      setSlotLevel(from, 0)
      setSlotLevel(to, 1)
      const old = from === 'a' ? audioRef.current : nextAudioRef.current
      old?.pause()
    }
    fadeRafRef.current = requestAnimationFrame(step)
  }
  function makeUrl(blob: Blob, trackId: string) {
    const url = URL.createObjectURL(blob)
    const list = urlsRef.current.get(trackId) ?? []
    list.push(url)
    urlsRef.current.set(trackId, list)
    return url
  }
  function revokeTrackUrls(trackId: string) {
    for (const url of urlsRef.current.get(trackId) ?? []) URL.revokeObjectURL(url)
    urlsRef.current.delete(trackId)
  }
  function notify(message: string) {
    setStatus(message)
    setToast(message)
  }
  function warnStorage(message = 'Archive storage unavailable. Changes are temporary.') {
    if (storageWarnedRef.current === message) return
    storageWarnedRef.current = message
    notify(message)
  }
  function selectSection(id: Section) {
    playUiTokenRef.current += 1
    setSection(id)
    if (id === 'archive') setSort({ field: 'addedAt', dir: 'desc' })
    if (id === 'recent') setSort({ field: 'lastPlayed', dir: 'desc' })
  }
  async function persistTrack(track: Track) {
    if (!tracksRef.current.some(x => x.id === track.id)) return
    const { url: _url, artUrl: _artUrl, ...stored } = track
    void _url; void _artUrl
    await dbPut(STORE_TRACKS, stored)
  }

  useEffect(() => {
    const onUpdate = () => setUpdateReady(true)
    window.addEventListener('lost-internet-update', onUpdate)
    return () => window.removeEventListener('lost-internet-update', onUpdate)
  }, [])

  useEffect(() => {
    const el = tableWrapRef.current
    if (el) el.scrollTop = 0
    setTableScrollTop(0)
  }, [section, query, sort, playlistSort, selectedPlaylistId])

  useEffect(() => {
    const el = tableWrapRef.current
    if (!el) return
    const measure = () => setTableViewportHeight(el.clientHeight || 400)
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure)
      observer.observe(el)
      return () => observer.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [section])

  useEffect(() => {
    if (!ready || section !== 'settings' || !navigator.storage?.estimate) return
    let cancelled = false
    void navigator.storage.estimate().then(({ usage, quota }) => {
      if (!cancelled) setStorageUsage({ used: usage ?? 0, quota: quota ?? 0 })
    }).catch(() => { if (!cancelled) setStorageUsage(null) })
    return () => { cancelled = true }
  }, [ready, section, tracks.length])

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReducedMotion(query.matches)
    sync()
    query.addEventListener?.('change', sync)
    return () => query.removeEventListener?.('change', sync)
  }, [])

  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true
    ;(async () => {
      try {
        const meta = await dbGetAll<{ key: string; value: any }>(STORE_META)
        const savedSettings = meta.find(m => m.key === KEY_SETTINGS)?.value
        const savedPlaylists = meta.find(m => m.key === KEY_PLAYLISTS)?.value
        const lastTrack = meta.find(m => m.key === KEY_LAST_TRACK)?.value
        if (savedSettings) {
          const savedEq = savedSettings.eq ?? {}
          setSettings({
            ...DEFAULT_SETTINGS,
            ...savedSettings,
            eq: {
              bass: Number(savedEq.bass ?? DEFAULT_SETTINGS.eq.bass) || 0,
              mid: Number(savedEq.mid ?? DEFAULT_SETTINGS.eq.mid) || 0,
              treble: Number(savedEq.treble ?? DEFAULT_SETTINGS.eq.treble) || 0,
            },
            theme: savedSettings.theme === 'light' ? 'light' : 'dark',
            language: savedSettings.language === 'ru' ? 'ru' : 'en',
            defaultProvider: isProviderId(savedSettings.defaultProvider) ? savedSettings.defaultProvider : 'yandex',
          })
        }
        if (Array.isArray(savedPlaylists) && savedPlaylists.length) {
          setPlaylists(savedPlaylists)
          setSelectedPlaylistId(savedPlaylists[0].id)
        }
        const stored = await dbGetAll<any>(STORE_TRACKS)
        const hydrated: Track[] = stored.map(t => ({
          ...t,
          url: t.blob ? makeUrl(t.blob, t.id) : t.url,
          artUrl: t.artBlob ? makeUrl(t.artBlob, t.id) : undefined,
          plays: Number(t.plays ?? 0),
          lastPlayed: Number(t.lastPlayed ?? 0),
        }))
        setTracks(hydrated.sort((a, b) => Number(b.addedAt) - Number(a.addedAt)))
        if (lastTrack && hydrated.some(t => t.id === lastTrack)) setCurrentId(lastTrack)
        notify(`Loaded ${hydrated.length} track${hydrated.length === 1 ? '' : 's'} from archive.`)
      } catch {
        hydratedOkRef.current = false
        notify('Archive unavailable. Running in memory mode.')
      } finally {
        setReady(true)
      }
    })()
  }, [])

  useEffect(() => {
    if (!ready || !hydratedOkRef.current) return
    const writes = [
      dbPut(STORE_META, { key: KEY_SETTINGS, value: settings }),
      dbPut(STORE_META, { key: KEY_PLAYLISTS, value: playlists }),
    ]
    if (currentId) writes.push(dbPut(STORE_META, { key: KEY_LAST_TRACK, value: currentId }))
    void Promise.all(writes).catch(() => warnStorage())
  }, [ready, settings, playlists, currentId])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 2800)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    if (!ready) return
    const theme = settings.theme === 'light' ? 'light' : 'dark'
    document.documentElement.dataset.theme = theme
    document.body.dataset.theme = theme
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
      'content',
      theme === 'light' ? '#D6D6D6' : '#050505',
    )
    try { localStorage.setItem('lost-internet-theme', theme) } catch { /* storage unavailable */ }
  }, [ready, settings.theme])

  useEffect(() => {
    if (section !== 'network') return
    const timer = window.setTimeout(() => { void loadCatalog() }, 160)
    return () => window.clearTimeout(timer)
  }, [section, catalogQuery, catalogSort])

  useEffect(() => {
    const gain = dbToGain(settings.makeup)
    const level = settings.muted ? 0 : settings.volume * gain
    const master = masterGainRef.current
    if (master) {
      master.gain.value = clamp(level, 0, 1)
      for (const el of [audioRef.current, nextAudioRef.current]) {
        if (el) { el.volume = 1; el.muted = false }
      }
    } else {
      const a = audioRef.current
      const b = nextAudioRef.current
      if (a) a.volume = settings.muted ? 0 : clamp(settings.volume * gain * fadeLevelsRef.current.a, 0, 1)
      if (b) b.volume = settings.muted ? 0 : clamp(settings.volume * gain * fadeLevelsRef.current.b, 0, 1)
      if (a) a.muted = false
      if (b) b.muted = false
    }
  }, [settings.volume, settings.muted, settings.makeup])

  useEffect(() => {
    const filters = filtersRef.current
    if (!filters) return
    filters.bass.gain.value = settings.eq.bass
    filters.mid.gain.value = settings.eq.mid
    filters.treble.gain.value = settings.eq.treble
  }, [settings.eq])

  useEffect(() => {
    const compressor = compressorRef.current
    const treble = trebleRef.current
    const analyser = analyserRef.current
    if (!compressor || !treble || !analyser) return
    compressor.threshold.value = settings.compressorThreshold
    compressor.knee.value = 12
    compressor.ratio.value = settings.compressorRatio
    try { treble.disconnect() } catch { /* no output yet */ }
    try { compressor.disconnect() } catch { /* no output yet */ }
    if (settings.compressor) {
      treble.connect(compressor)
      compressor.connect(analyser)
    } else {
      treble.connect(analyser)
    }
  }, [settings.compressor, settings.compressorThreshold, settings.compressorRatio])

  useEffect(() => {
    const elements = [audioRef.current, nextAudioRef.current].filter((el): el is HTMLAudioElement => Boolean(el))
    const isActive = (el: HTMLAudioElement) => el === getActiveAudio()
    const onTime = (event: Event) => {
      const el = event.currentTarget as HTMLAudioElement
      if (!isActive(el)) return
      setProgress(el.currentTime * 1000)
      const trackId = pendingIdRef.current || currentIdRef.current
      if (autoAdvanceRef.current && autoAdvanceRef.current !== trackId) autoAdvanceRef.current = null
      const s = settingsRef.current
      if (!s.crossfade || !trackId || autoAdvanceRef.current === trackId) return
      if (!Number.isFinite(el.duration) || el.duration <= 0) return
      const remaining = (el.duration - el.currentTime) * 1000
      if (remaining > 0 && remaining <= Math.max(200, s.crossfadeMs)) {
        autoAdvanceRef.current = trackId
        nextRef.current(true)
      }
    }
    const onPlay = (event: Event) => {
      if (isActive(event.currentTarget as HTMLAudioElement)) setPlaying(true)
    }
    const onPause = (event: Event) => {
      if (isActive(event.currentTarget as HTMLAudioElement)) setPlaying(false)
    }
    const onEnded = (event: Event) => {
      const el = event.currentTarget as HTMLAudioElement
      if (!isActive(el)) return
      if (autoAdvanceRef.current === currentIdRef.current) return
      nextRef.current()
    }
    const onLoaded = (event: Event) => {
      const el = event.currentTarget as HTMLAudioElement
      const trackId = pendingIdRef.current || currentIdRef.current
      const d = Number.isFinite(el.duration) ? el.duration * 1000 : 0
      if (isActive(el)) {
        setDuration(d)
        pendingIdRef.current = null
      }
      const t = tracksRef.current.find(x => x.id === trackId)
      if (t && d > 0) {
        const updated: Track = {
          ...t,
          duration: d,
          bitrate: t.bitrate || Math.round((t.size * 8) / (d / 1000) / 1000),
        }
        setTracks(prev => prev.map(x => x.id === updated.id ? updated : x))
        tracksRef.current = tracksRef.current.map(x => x.id === updated.id ? updated : x)
        void persistTrack(updated).catch(() => warnStorage('Track details could not be saved.'))
      }
    }
    const onError = (event: Event) => {
      if (isActive(event.currentTarget as HTMLAudioElement)) notify('Audio error. File may be unsupported or corrupted.')
    }
    for (const el of elements) {
      el.addEventListener('timeupdate', onTime)
      el.addEventListener('play', onPlay)
      el.addEventListener('pause', onPause)
      el.addEventListener('ended', onEnded)
      el.addEventListener('loadedmetadata', onLoaded)
      el.addEventListener('error', onError)
    }
    return () => {
      for (const el of elements) {
        el.removeEventListener('timeupdate', onTime)
        el.removeEventListener('play', onPlay)
        el.removeEventListener('pause', onPause)
        el.removeEventListener('ended', onEnded)
        el.removeEventListener('loadedmetadata', onLoaded)
        el.removeEventListener('error', onError)
      }
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const key = e.key.toLowerCase()
      const mod = e.ctrlKey || e.metaKey
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpenMenu(null)
        setPopups([])
        if (target && target !== document.body) target.blur()
        return
      }
      if (mod || e.altKey) {
        if (e.key === 'ArrowRight') { e.preventDefault(); handleNext() }
        else if (e.key === 'ArrowLeft') { e.preventDefault(); handlePrev() }
        else if (key === 'f' && !e.altKey) { e.preventDefault(); selectSection('library'); document.querySelector<HTMLInputElement>('.li-search')?.focus() }
        else if (key === 'o' && !e.altKey) { e.preventDefault(); fileRef.current?.click() }
        return
      }
      if (target?.closest('button, input, select, textarea, a, [role="button"], [contenteditable]')) return
      const input = target as HTMLInputElement | null
      const passiveInput = input?.tagName === 'INPUT' && ['range', 'checkbox', 'radio', 'button', 'file', 'submit', 'reset'].includes(input.type)
      const typing = !passiveInput && (input?.tagName === 'INPUT' || input?.tagName === 'TEXTAREA' || Boolean(target?.isContentEditable))
      if (typing) return
      if (e.code === 'Space') {
        e.preventDefault()
        togglePlay()
      }
      else if (key === 'm') setSettings(s => ({ ...s, muted: !s.muted }))
      else if (key === 'n') handleNext()
      else if (key === 'p') handlePrev()
      else if (key === 's') setSettings(s => ({ ...s, shuffle: !s.shuffle }))
      else if (key === 'r') cycleRepeat()
      else if (key === 'f' && current) toggleFavorite(current.id)
      else if (key === '[' || key === ']') setSettings(s => ({ ...s, volume: clamp(s.volume + (key === '[' ? -0.05 : 0.05), 0, 1) }))
      else if (key === 'h') openPopup('help')
      else if (key === 't') setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' }))
      else if (['1', '2', '3', '4'].includes(key)) setSettings(s => ({ ...s, vizMode: key === '1' ? 'spectrum' : key === '2' ? 'globe' : key === '3' ? 'hybrid' : 'scope' }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    const closeMenus = (e: globalThis.MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.li-menubar')) setOpenMenu(null)
    }
    document.addEventListener('mousedown', closeMenus)
    return () => document.removeEventListener('mousedown', closeMenus)
  }, [])

  useEffect(() => {
    if (!currentId || !settings.glitch || settings.calm || reducedMotion) {
      setGlitchActive(false)
      return
    }
    setGlitchActive(true)
    const timer = window.setTimeout(() => setGlitchActive(false), 170)
    return () => {
      window.clearTimeout(timer)
      setGlitchActive(false)
    }
  }, [currentId, settings.glitch, settings.calm, reducedMotion])

  useEffect(() => {
    if (artRef.current) renderArt(artRef.current, current?.artUrl, current ? 'ARCHIVE IMAGE' : 'NO SIGNAL', glitchActive, settings.theme)
  }, [current?.id, current?.artUrl, glitchActive, settings.theme])

  useEffect(() => {
    if (!popups.length) return
    const top = popups.reduce((best, p) => p.z > best.z ? p : best)
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const root = document.querySelector<HTMLElement>(`[data-popup-id="${top.id}"]`)
      if (!root) return
      const focusable = Array.from(root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter(el => el.offsetParent !== null)
      if (!focusable.length) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!root.contains(document.activeElement)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', trap, true)
    return () => document.removeEventListener('keydown', trap, true)
  }, [popups])

  useEffect(() => {
    if (!ready || popupsSeededRef.current || !settings.showPopups) return
    popupsSeededRef.current = true
    const ie = clampPopupPos('ie', 520, 86)
    const favorites = clampPopupPos('favorites', 560, 292)
    setPopups([
      { id: uid(), kind: 'ie', title: POPUP_TITLE.ie, x: ie.x, y: ie.y, z: 21 },
      { id: uid(), kind: 'favorites', title: POPUP_TITLE.favorites, x: favorites.x, y: favorites.y, z: 22 },
    ])
  }, [ready, settings.showPopups])

  useEffect(() => {
    const ids = popups.map(p => p.id).join('|')
    const previous = popupIdsRef.current
    const added = popups.find(p => !previous.split('|').includes(p.id))
    if (added && !popupFocusRef.current) popupFocusRef.current = document.activeElement as HTMLElement | null
    popupIdsRef.current = ids
    if (added) {
      const top = popups.reduce((best, p) => p.z > best.z ? p : best, added)
      window.requestAnimationFrame(() => {
        document.querySelector<HTMLButtonElement>(`[data-popup-id="${top.id}"] .li-popup__close`)?.focus()
      })
    }
    if (!popups.length && popupFocusRef.current) {
      if (document.contains(popupFocusRef.current)) popupFocusRef.current.focus()
      popupFocusRef.current = null
    }
  }, [popups])

  useEffect(() => {
    const onResize = () => {
      setPopups(prev => prev.map(p => {
        const pos = clampPopupPos(p.kind, p.x, p.y)
        return { ...p, x: pos.x, y: pos.y }
      }))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const canvas = visRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let freqData: Uint8Array<ArrayBuffer> | null = null
    let waveData: Uint8Array<ArrayBuffer> | null = null
    let grid: HTMLCanvasElement | null = null
    let gridCtx: CanvasRenderingContext2D | null = null
    let gridW = 0
    let gridH = 0
    let gridTheme = ''
    const gentle = reducedMotion || settings.calm
    let fps = 60
    let fpsFrames = 0
    let fpsMark = 0
    const draw = (time: number) => {
      if (!fpsMark) fpsMark = time
      fpsFrames += 1
      if (time - fpsMark >= 700) {
        fps = Math.round((fpsFrames * 1000) / (time - fpsMark))
        fpsFrames = 0
        fpsMark = time
      }
      const c = visRef.current
      if (!c || !ctx) return
      const cssW = c.clientWidth || 640
      const cssH = c.clientHeight || 170
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const pixelW = Math.max(1, Math.floor(cssW * dpr))
      const pixelH = Math.max(1, Math.floor(cssH * dpr))
      if (c.width !== pixelW || c.height !== pixelH) {
        c.width = pixelW
        c.height = pixelH
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const w = cssW
      const h = cssH
      const s = settingsRef.current
      const analyser = analyserRef.current
      const el = activeSlotRef.current === 'a' ? audioRef.current : nextAudioRef.current
      const active = Boolean(analyser && el && !el.paused && !el.ended)
      const light = s.theme === 'light'
      const bg = light ? '#D6D6D6' : '#050505'
      const gridColor = light ? '#555555' : '#252525'
      const barMain = light ? '#790D18' : '#142B83'
      const barAccent = light ? '#142B83' : '#790D18'
      const lineMain = light ? '#142B83' : '#A5A5A5'
      const lineAlt = light ? '#555555' : '#A5A5A5'
      const labelColor = light ? '#111111' : '#555555'

      if (!grid) {
        grid = document.createElement('canvas')
        gridCtx = grid.getContext('2d')
      }
      if (gridCtx && (gridW !== pixelW || gridH !== pixelH || gridTheme !== s.theme)) {
        grid!.width = pixelW
        grid!.height = pixelH
        gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0)
        gridCtx.fillStyle = bg
        gridCtx.fillRect(0, 0, w, h)
        gridCtx.strokeStyle = gridColor
        gridCtx.lineWidth = 1
        for (let x = 0; x < w; x += 24) { gridCtx.beginPath(); gridCtx.moveTo(x, 0); gridCtx.lineTo(x, h); gridCtx.stroke() }
        for (let y = 0; y < h; y += 24) { gridCtx.beginPath(); gridCtx.moveTo(0, y); gridCtx.lineTo(w, y); gridCtx.stroke() }
        gridW = pixelW
        gridH = pixelH
        gridTheme = s.theme
      }
      if (grid) ctx.drawImage(grid, 0, 0, w, h)

      if (analyser) {
        if (!freqData || freqData.length !== analyser.frequencyBinCount) {
          freqData = new Uint8Array(analyser.frequencyBinCount)
          waveData = new Uint8Array(analyser.fftSize)
        }
        analyser.getByteFrequencyData(freqData)
        if (waveData) analyser.getByteTimeDomainData(waveData)
      }
      const freq = freqData
      const wave = waveData
      const bins = 48
      const levels = levelsRef.current
      const maxBin = freq ? freq.length - 1 : bins - 1
      const glitching = active && !gentle && (time % 9000) < 130
      const shift = glitching ? 2 : 0
      const step = w / bins
      const easing = gentle ? (active ? 0.08 : 0.02) : active ? 0.14 : 0.035
      for (let i = 0; i < bins; i++) {
        const idx = freq ? Math.min(maxBin, Math.floor(Math.pow(i / bins, 1.7) * maxBin)) : 0
        const target = active && freq
          ? clamp((freq[idx] / 255) * s.vizSensitivity, 0, 1)
          : gentle ? 0.045 : 0.025 + 0.018 * (0.5 + 0.5 * Math.sin(time / 900 + i * 0.45))
        levels[i] += (target - levels[i]) * easing
        if (s.vizMode !== 'globe' && s.vizMode !== 'scope') {
          const bh = 2 + levels[i] * h * 0.68
          ctx.fillStyle = i % 9 === 0 ? barAccent : barMain
          ctx.fillRect(i * step + 2 + shift, h - bh - 12, Math.max(2, step - 4), bh)
        }
      }
      if (s.vizMode === 'scope') {
        ctx.lineWidth = 1.6
        for (const [color, offset, amp] of [[barMain, 0, 1], [barAccent, 4, 0.72]] as Array<[string, number, number]>) {
          ctx.strokeStyle = color
          ctx.beginPath()
          for (let x = 0; x <= w; x += 2) {
            const idx = wave ? Math.min(wave.length - 1, Math.floor((x / w) * wave.length)) : 0
            const sample = active && wave ? ((wave[idx] - 128) / 128) * amp : gentle ? 0 : Math.sin(x / 34 + time / 700) * 0.03
            const y = h * 0.46 + offset + sample * h * 0.34
            if (x === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          ctx.stroke()
        }
        ctx.lineWidth = 1
      }
      if (s.vizMode === 'globe' || s.vizMode === 'hybrid') {
        const cx = w * 0.5 + shift
        const cy = h * 0.4
        const r = Math.min(w, h) * 0.25
        const energy = levels.reduce((sum, v) => sum + v, 0) / bins
        ctx.strokeStyle = lineMain
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke()
        ctx.strokeStyle = barMain
        ctx.beginPath(); ctx.ellipse(cx, cy, r, Math.max(2, r * (0.28 + energy * 0.18)), 0, 0, Math.PI * 2); ctx.stroke()
        for (let i = 0; i < 6; i++) {
          const angle = (gentle ? 0 : time / 2600) + i * Math.PI / 6
          ctx.strokeStyle = i % 2 ? lineAlt : lineMain
          ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(2, r * Math.abs(Math.cos(angle))), r, 0, 0, Math.PI * 2); ctx.stroke()
        }
      }
      ctx.fillStyle = labelColor
      ctx.font = '10px Courier New'
      ctx.fillText(`SPECTRUM // ${bins} BANDS // ${s.vizMode.toUpperCase()} // ${fps}FPS`, 12, h - 8)
      ctx.textAlign = 'right'
      ctx.fillText(active ? 'SIGNAL:LOCK' : 'SIGNAL:IDLE', w - 12, h - 8)
      ctx.textAlign = 'left'
    }
    const loop = (time: number) => {
      if (!document.hidden) draw(time)
      rafRef.current = requestAnimationFrame(loop)
    }
    const onResize = () => draw(performance.now())
    draw(performance.now())
    rafRef.current = requestAnimationFrame(loop)
    window.addEventListener('resize', onResize)
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      window.removeEventListener('resize', onResize)
    }
  }, [reducedMotion, settings.calm, settings.theme, settings.vizMode, settings.vizSensitivity])

  useEffect(() => () => {
    for (const list of urlsRef.current.values()) for (const url of list) URL.revokeObjectURL(url)
    urlsRef.current.clear()
  }, [])

  function ensureAudioContext() {
    const audio = audioRef.current
    const nextAudio = nextAudioRef.current
    if (!audio || !nextAudio || audioCtxRef.current) return
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    const context: AudioContext = new Ctx()
    audioCtxRef.current = context
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.82

    const bass = context.createBiquadFilter()
    bass.type = 'lowshelf'
    bass.frequency.value = 140
    const mid = context.createBiquadFilter()
    mid.type = 'peaking'
    mid.frequency.value = 1100
    mid.Q.value = 0.8
    const treble = context.createBiquadFilter()
    treble.type = 'highshelf'
    treble.frequency.value = 5200
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = settingsRef.current.compressorThreshold
    compressor.knee.value = 12
    compressor.ratio.value = settingsRef.current.compressorRatio
    compressor.attack.value = 0.004
    compressor.release.value = 0.18
    const master = context.createGain()
    master.gain.value = settingsRef.current.muted ? 0 : clamp(settingsRef.current.volume * dbToGain(settingsRef.current.makeup), 0, 1)

    try {
      const sourceA = context.createMediaElementSource(audio)
      const sourceB = context.createMediaElementSource(nextAudio)
      const gainA = context.createGain()
      const gainB = context.createGain()
      gainA.gain.value = fadeLevelsRef.current.a
      gainB.gain.value = fadeLevelsRef.current.b
      sourceA.connect(gainA)
      sourceB.connect(gainB)
      gainA.connect(bass)
      gainB.connect(bass)
      bass.connect(mid)
      mid.connect(treble)
      if (settingsRef.current.compressor) {
        treble.connect(compressor)
        compressor.connect(analyser)
      } else {
        treble.connect(analyser)
      }
      analyser.connect(master)
      master.connect(context.destination)
      gainsRef.current = { a: gainA, b: gainB }
      filtersRef.current = { bass, mid, treble }
      compressorRef.current = compressor
      masterGainRef.current = master
      audioCtxRef.current = context
      analyserRef.current = analyser
      audio.volume = 1
      nextAudio.volume = 1
      audio.muted = false
      nextAudio.muted = false
      bass.gain.value = settingsRef.current.eq.bass
      mid.gain.value = settingsRef.current.eq.mid
      treble.gain.value = settingsRef.current.eq.treble
    } catch {
      analyserRef.current = analyser
    }
  }
  function cycleRepeat() {
    setSettings(s => ({ ...s, repeat: s.repeat === 'off' ? 'all' : s.repeat === 'all' ? 'one' : 'off' }))
  }
  function playTrack(id: string, allowFade = true) {
    const t = tracksRef.current.find(x => x.id === id)
    if (!t || !t.url) { notify('Track source is unavailable.'); return }
    const active = getActiveAudio()
    const other = getOtherAudio()
    if (!active || !other) { notify('Audio output is unavailable.'); return }
    const token = ++playTokenRef.current
    const uiToken = playUiTokenRef.current
    const previousId = currentIdRef.current
    const previousSection = section
    const previousProgress = progress
    const previousDuration = duration
    const previousSrc = active.src
    const previousTime = active.currentTime
    const canFade = allowFade && settingsRef.current.crossfade && !active.paused && previousId !== id
    const message = `Playing: ${t.artist} - ${t.name}`
    const commit = () => {
      if (token !== playTokenRef.current) return
      const latest = tracksRef.current.find(x => x.id === id)
      if (!latest) return
      const updated: Track = { ...latest, plays: (latest.plays ?? 0) + 1, lastPlayed: Date.now() }
      setTracks(prev => prev.map(x => x.id === id ? updated : x))
      tracksRef.current = tracksRef.current.map(x => x.id === id ? updated : x)
      setCurrentId(id)
      currentIdRef.current = id
      if (uiToken === playUiTokenRef.current) {
        setSection('now')
        setProgress(0)
      }
      void persistTrack(updated)
        .then(() => notify(message))
        .catch(() => notify(`${message} // history not saved`))
    }
    const rollback = (restore?: HTMLAudioElement) => {
      autoAdvanceRef.current = null
      pendingIdRef.current = null
      setCurrentId(previousId)
      currentIdRef.current = previousId
      if (uiToken === playUiTokenRef.current) {
        setSection(previousSection)
        setProgress(previousProgress)
        setDuration(previousDuration)
      }
      if (restore && previousSrc) {
        try {
          restore.src = previousSrc
          restore.currentTime = Math.min(previousTime, restore.duration || previousTime)
        } catch { /* previous source is no longer playable */ }
      }
      notify('Playback blocked by browser. Click PLAY again.')
    }
    ensureAudioContext()
    void audioCtxRef.current?.resume().catch(() => {})

    if (canFade) {
      const from = activeSlotRef.current
      const to = from === 'a' ? 'b' : 'a'
      const fadeMs = settingsRef.current.crossfadeMs
      stopFade()
      pendingIdRef.current = id
      activeSlotRef.current = to
      other.src = t.url
      other.currentTime = 0
      void other.play()
        .then(() => {
          if (token !== playTokenRef.current) return
          commit()
          if (activeSlotRef.current === to) fadeSlots(from, to, fadeMs)
        })
        .catch(() => {
          if (token !== playTokenRef.current) return
          if (activeSlotRef.current === to) {
            activeSlotRef.current = from
            stopFade()
            setSlotLevel(to, 0)
            setSlotLevel(from, 1)
            other.pause()
            other.currentTime = 0
            rollback()
          }
        })
      return
    }

    stopFade()
    pendingIdRef.current = id
    setSlotLevel(activeSlotRef.current, 1)
    const inactive = activeSlotRef.current === 'a' ? 'b' : 'a'
    setSlotLevel(inactive, 0)
    other.pause()
    active.src = t.url
    active.currentTime = 0
    void active.play()
      .then(() => commit())
      .catch(() => {
        if (token !== playTokenRef.current) return
        stopFade()
        rollback(active)
      })
  }
  function togglePlay() {
    const audio = getActiveAudio()
    if (!audio) return
    if (!current && visibleTracks[0]) { playTrack(visibleTracks[0].id, false); return }
    if (!current) return
    if (!audio.src) {
      ensureAudioContext()
      audio.src = current.url
    }
    if (audio.paused) {
      ensureAudioContext()
      void audioCtxRef.current?.resume().catch(() => {})
      stopFade()
      setSlotLevel(activeSlotRef.current, 1)
      const inactive = activeSlotRef.current === 'a' ? 'b' : 'a'
      setSlotLevel(inactive, 0)
      void audio.play().catch(() => notify('Playback blocked by browser.'))
    } else {
      stopFade()
      audio.pause()
      getOtherAudio()?.pause()
    }
  }
  function handleNext() {
    const list = visibleRef.current.length ? visibleRef.current : tracksRef.current
    if (!list.length) return
    const s = settingsRef.current
    const audio = getActiveAudio()
    if (s.repeat === 'one' && audio) {
      autoAdvanceRef.current = null
      audio.currentTime = 0
      void audio.play().catch(() => notify('Playback blocked by browser.'))
      return
    }
    const index = list.findIndex(t => t.id === currentIdRef.current)
    let next = s.shuffle ? Math.floor(Math.random() * list.length) : index + 1
    if (!s.shuffle && next >= list.length) {
      if (s.repeat === 'all') next = 0
      else {
        stopFade()
        audio?.pause()
        getOtherAudio()?.pause()
        return
      }
    }
    if (s.shuffle && list.length > 1 && list[next]?.id === currentIdRef.current) next = (next + 1) % list.length
    if (list[next]) playTrack(list[next].id)
  }
  function handlePrev() {
    const audio = getActiveAudio()
    if (audio && audio.currentTime > 3) { audio.currentTime = 0; return }
    const list = visibleRef.current.length ? visibleRef.current : tracksRef.current
    if (!list.length) return
    const index = list.findIndex(t => t.id === currentIdRef.current)
    const prev = index <= 0 ? list.length - 1 : index - 1
    if (list[prev]) playTrack(list[prev].id)
  }
  function seek(value: number) {
    playUiTokenRef.current += 1
    const audio = getActiveAudio()
    if (audio && duration > 0) audio.currentTime = (value / 1000) * (duration / 1000)
  }
  async function addFiles(fileList: FileList | null) {
    if (busyRef.current || !fileList?.length) return
    busyRef.current = true
    setBusy(true)
    try {
      const files = Array.from(fileList).filter(f => /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(f.name) || f.type.startsWith('audio/'))
      const known = new Set(tracksRef.current.map(t => `${t.name}:${t.size}`))
      const added: Track[] = []
      const saves: Promise<void>[] = []
      let failed = 0
      for (const file of files) {
        const meta = parseName(file.name)
        const id3 = await parseId3(file).catch(() => ({} as Awaited<ReturnType<typeof parseId3>>))
        const wave = file.name.toLowerCase().endsWith('.wav') ? await parseWavInfo(file) : { sampleRate: 0, bitrate: 0 }
        const name = id3.name || meta.title
        const key = `${name}:${file.size}`
        if (known.has(key)) continue
        const id = uid()
        const track: Track = {
          id,
          blob: file,
          artBlob: id3.artBlob,
          url: makeUrl(file, id),
          artUrl: id3.artBlob ? makeUrl(id3.artBlob, id) : undefined,
          name,
          artist: id3.artist || meta.artist,
          album: id3.album || 'local archive',
          genre: id3.genre || '',
          duration: 0,
          size: file.size,
          format: (file.name.split('.').pop() || '').toUpperCase(),
          bitrate: wave.bitrate,
          sampleRate: wave.sampleRate,
          favorite: false,
          plays: 0,
          lastPlayed: 0,
          addedAt: Date.now() + added.length,
        }
        known.add(key)
        added.push(track)
        tracksRef.current = [...added, ...tracksRef.current.filter(x => !added.some(a => a.id === x.id))]
        saves.push(persistTrack(track).catch(() => { failed += 1 }))
      }
      await Promise.all(saves)
      if (added.length) {
        setTracks(prev => [...added, ...prev])
        if (!currentIdRef.current) setCurrentId(added[0].id)
        playUiTokenRef.current += 1
        setSection('library')
        notify(`Added ${added.length} track${added.length === 1 ? '' : 's'}.${failed ? ` ${failed} could not be saved.` : ''}`)
        if (failed) warnStorage('Some tracks are in memory only. Archive storage is unavailable.')
      } else {
        notify('No new audio files found.')
      }
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  function toggleFavorite(id: string) {
    const t = tracksRef.current.find(x => x.id === id)
    if (!t) return
    const updated: Track = { ...t, favorite: !t.favorite }
    setTracks(prev => prev.map(x => x.id === id ? updated : x))
    tracksRef.current = tracksRef.current.map(x => x.id === id ? updated : x)
    void persistTrack(updated).catch(() => warnStorage('Favorite could not be saved.'))
  }
  function editTrack(id: string) {
    const t = tracksRef.current.find(x => x.id === id)
    if (!t) return
    const name = window.prompt('Title', t.name)
    if (name === null) return
    const artist = window.prompt('Artist', t.artist)
    if (artist === null) return
    const album = window.prompt('Album', t.album)
    if (album === null) return
    const genre = window.prompt('Genre', t.genre)
    if (genre === null) return
    const updated: Track = {
      ...t,
      name: name.trim() || t.name,
      artist: artist.trim() || 'unknown artist',
      album: album.trim() || 'local archive',
      genre: genre.trim(),
    }
    setTracks(prev => prev.map(x => x.id === id ? updated : x))
    tracksRef.current = tracksRef.current.map(x => x.id === id ? updated : x)
    void persistTrack(updated).catch(() => warnStorage('Metadata could not be saved.'))
    notify('Metadata updated.')
  }
  function openLinks(id?: string, query?: string) {
    const track = id ? tracksRef.current.find(x => x.id === id) : undefined
    if (id && !track) return
    setLinksTarget({ id: track?.id, query: query ?? (track ? buildSearchQuery(track.artist, track.name) : '') })
    openPopup('links')
  }
  function saveTrackLink(provider: ProviderId, raw: string) {
    const id = linksTarget?.id
    if (!id) return
    const track = tracksRef.current.find(x => x.id === id)
    if (!track) return
    const normalized = normalizeServiceUrl(provider, raw)
    if (!normalized && raw.trim()) {
      notify(tr('Invalid link for this service.'))
      return
    }
    const nextLinks: TrackLinks = { ...(track.links ?? {}) }
    if (normalized) nextLinks[provider] = normalized
    else delete nextLinks[provider]
    const updated: Track = { ...track, links: Object.keys(nextLinks).length ? nextLinks : undefined }
    setTracks(prev => prev.map(x => x.id === id ? updated : x))
    tracksRef.current = tracksRef.current.map(x => x.id === id ? updated : x)
    void persistTrack(updated).catch(() => warnStorage('Link could not be saved.'))
    notify(normalized ? tr('Link saved.') : tr('Link removed.'))
  }
  function downloadTrack(id: string) {
    const t = tracksRef.current.find(x => x.id === id)
    if (!t) return
    const a = document.createElement('a')
    a.href = t.url
    const fileName = (t.blob as File | undefined)?.name || `${t.artist} - ${t.name}.${t.format.toLowerCase()}`
    a.download = fileName
    a.click()
    notify(`Saved: ${fileName}`)
  }
  async function loadCatalog() {
    const req = ++catalogReqRef.current
    const current = () => req === catalogReqRef.current
    setCatalogLoading(true)
    const params = new URLSearchParams({ sort: catalogSort })
    if (catalogQuery.trim()) params.set('q', catalogQuery.trim())

    try {
      const listRes = await fetch(`/api/catalog?${params.toString()}`)
      if (!listRes.ok) throw new Error('catalog offline')
      const data = (await listRes.json()) as { tracks?: CatalogTrack[] }
      if (current()) setCatalog(data.tracks ?? [])
    } catch {
      if (current()) {
        setCatalog([])
        notify('Network index unavailable.')
      }
    }

    try {
      const statsRes = await fetch('/api/stats')
      if (!statsRes.ok) return
      const stats = (await statsRes.json()) as { likes?: number }
      if (current()) setCatalogLikes(Number(stats.likes ?? 0))
    } catch {
      if (current()) setCatalogLikes(0)
    } finally {
      if (current()) setCatalogLoading(false)
    }
  }
  async function publishTrack(id: string) {
    const t = tracksRef.current.find(x => x.id === id)
    if (!t) return
    try {
      const res = await fetch('/api/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: t.name,
          artist: t.artist,
          album: t.album,
          genre: t.genre,
          format: t.format,
          duration: t.duration,
        }),
      })
      if (!res.ok) throw new Error('publish failed')
      notify(`Published: ${t.name}`)
      await loadCatalog()
    } catch {
      notify('Publish failed. Network index unavailable.')
    }
  }
  async function likeCatalogTrack(id: string) {
    if (likedPendingRef.current.has(id)) return
    likedPendingRef.current.add(id)
    setPendingLikes(prev => [...prev, id])
    try {
      const res = await fetch(`/api/catalog/${encodeURIComponent(id)}/like`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { duplicate?: boolean }
      if (!res.ok) throw new Error('like failed')
      if (data.duplicate) {
        notify('Already liked today.')
        return
      }
      setCatalog(prev => prev.map(t => t.id === id ? { ...t, likes: t.likes + 1 } : t))
      setCatalogLikes(prev => prev + 1)
    } catch {
      notify('Like failed. Network index unavailable.')
    } finally {
      likedPendingRef.current.delete(id)
      setPendingLikes(prev => prev.filter(x => x !== id))
    }
  }
  function findLocalMatch(item: IntegrationTrack): string | null {
    let best: { id: string; score: number } | null = null
    for (const track of tracks) {
      const score = matchScore(item, { title: track.name, artist: track.artist })
      if (score < 2 || (best && score <= best.score)) continue
      best = { id: track.id, score }
    }
    return best?.id ?? null
  }
  async function importPlaylist() {
    const url = importUrl.trim()
    if (!url || importBusy) return
    setImportBusy(true)
    setImportError('')
    setImportResults([])
    try {
      const response = await fetch('/api/integrations/playlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: importProvider, url }),
      })
      const data = (await response.json().catch(() => ({}))) as { tracks?: IntegrationTrack[]; error?: string }
      if (!response.ok) {
        setImportError(data.error ?? `HTTP ${response.status}`)
        return
      }
      const list = Array.isArray(data.tracks) ? data.tracks : []
      setImportResults(list)
      if (!list.length) setImportError(tr('No tracks found in this playlist.'))
    } catch {
      setImportError(tr('Import service is unreachable.'))
    } finally {
      setImportBusy(false)
    }
  }
  function addImportedMatches() {
    const playlist = playlists.find(p => p.id === selectedPlaylistId) ?? playlists[0]
    if (!playlist) {
      notify(tr('Create a playlist first.'))
      return
    }
    const ids: string[] = []
    for (const item of importResults) {
      const id = findLocalMatch(item)
      if (id && !playlist.trackIds.includes(id) && !ids.includes(id)) ids.push(id)
    }
    if (!ids.length) {
      notify(tr('No local matches found.'))
      return
    }
    setPlaylists(prev => prev.map(p => p.id === playlist.id ? { ...p, trackIds: [...p.trackIds, ...ids] } : p))
    notify(`${ids.length}${tr(' tracks added to playlist.')}`)
  }
  function playCatalogTrack(item: CatalogTrack) {
    const title = item.title.trim().toLowerCase()
    const artist = item.artist.trim().toLowerCase()
    const match = tracks.find(t => t.name.trim().toLowerCase() === title && t.artist.trim().toLowerCase() === artist)
      || tracks.find(t => t.name.trim().toLowerCase() === title)
    if (match) playTrack(match.id)
    else notify('Metadata only. Add a matching local file to play this entry.')
  }
  function removeTrack(id: string) {
    if (!window.confirm('Remove this track from the local archive?')) return
    const wasPending = pendingIdRef.current === id
    playTokenRef.current += 1
    pendingIdRef.current = null
    autoAdvanceRef.current = null
    void dbDelete(STORE_TRACKS, id).catch(() => warnStorage('Track removed in memory only. It may return after reload.'))
    setTracks(prev => prev.filter(t => t.id !== id))
    tracksRef.current = tracksRef.current.filter(t => t.id !== id)
    setPlaylists(prev => prev.map(p => ({ ...p, trackIds: p.trackIds.filter(x => x !== id) })))
    if (currentId === id || wasPending) {
      stopFade()
      audioRef.current?.pause()
      nextAudioRef.current?.pause()
      setCurrentId(null)
      currentIdRef.current = null
      setPlaying(false)
    }
    revokeTrackUrls(id)
    notify('Track removed from archive.')
  }
  function clearArchive() {
    if (!window.confirm('Clear the entire local archive? This cannot be undone.')) return
    playTokenRef.current += 1
    pendingIdRef.current = null
    autoAdvanceRef.current = null
    void dbClear(STORE_TRACKS).catch(() => warnStorage('Archive cleared in memory only. It may return after reload.'))
    const storedTracks = tracksRef.current
    stopFade()
    audioRef.current?.pause()
    nextAudioRef.current?.pause()
    setTracks([])
    tracksRef.current = []
    setCurrentId(null)
    currentIdRef.current = null
    setPlaying(false)
    setPlaylists([{ id: 'p1', name: 'webcore', trackIds: [] }])
    setSelectedPlaylistId('p1')
    for (const t of storedTracks) revokeTrackUrls(t.id)
    urlsRef.current.clear()
    notify('Archive cleared.')
  }
  function createPlaylist() {
    const name = window.prompt('Playlist name', `playlist_${playlists.length + 1}`)
    if (!name?.trim()) return
    const pl: Playlist = { id: uid(), name: name.trim(), trackIds: [] }
    setPlaylists(prev => [...prev, pl])
    setSelectedPlaylistId(pl.id)
    playUiTokenRef.current += 1
    setSection('playlist')
    notify(`Playlist created: ${pl.name}`)
  }
  function renamePlaylist(id: string) {
    const pl = playlists.find(p => p.id === id)
    if (!pl) return
    const name = window.prompt('Rename playlist', pl.name)
    if (!name?.trim()) return
    setPlaylists(prev => prev.map(p => p.id === id ? { ...p, name: name.trim() } : p))
  }
  function deletePlaylist(id: string) {
    if (!window.confirm('Delete this playlist? Audio files are not removed.')) return
    setPlaylists(prev => prev.filter(p => p.id !== id))
    if (selectedPlaylistId === id) setSelectedPlaylistId(null)
  }
  function addToPlaylist(trackId: string) {
    const pid = selectedPlaylistId || playlists[0]?.id
    if (!pid) { notify('Create a playlist first.'); return }
    setPlaylists(prev => prev.map(p => p.id === pid && !p.trackIds.includes(trackId) ? { ...p, trackIds: [...p.trackIds, trackId] } : p))
    notify('Track added to playlist.')
  }
  function removeFromPlaylist(trackId: string) {
    if (!selectedPlaylistId) return
    setPlaylists(prev => prev.map(p => p.id === selectedPlaylistId ? { ...p, trackIds: p.trackIds.filter(x => x !== trackId) } : p))
    notify('Track removed from playlist.')
  }
  function movePlaylistTrack(trackId: string, delta: number) {
    if (!selectedPlaylistId) return
    setPlaylists(prev => prev.map(p => {
      if (p.id !== selectedPlaylistId) return p
      const ids = [...p.trackIds]
      const index = ids.indexOf(trackId)
      const target = index + delta
      if (index < 0 || target < 0 || target >= ids.length) return p
      ;[ids[index], ids[target]] = [ids[target], ids[index]]
      return { ...p, trackIds: ids }
    }))
  }
  function toggleSort(field: SortField) {
    if (section === 'playlist') {
      setPlaylistSort(prev => ({
        field,
        dir: prev?.field === field && prev.dir === 'asc' ? 'desc' : 'asc',
      }))
      return
    }
    setSort(prev => ({
      field,
      dir: prev.field === field && prev.dir === 'asc' ? 'desc' : 'asc',
    }))
  }
  function exportLibrary() {
    const data = tracks.map(({ blob: _blob, artBlob: _artBlob, url: _url, artUrl: _artUrl, ...rest }) => rest)
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), tracks: data, playlists, settings }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'lost_internet_library.json'
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    notify('Library metadata exported.')
  }
  async function importLibrary(file: File) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      const data = JSON.parse(await file.text()) as {
        tracks?: any[]
        playlists?: Playlist[]
        settings?: Partial<Settings>
      }
      if (!Array.isArray(data.tracks)) throw new Error('invalid backup')
      const existing = tracksRef.current
      const byId = new Set(existing.map(t => t.id))
      const known = new Set(existing.map(t => `${t.name}:${t.size}`))
      const restored: Track[] = []
      for (const raw of data.tracks) {
        if (!raw || typeof raw.id !== 'string' || byId.has(raw.id)) continue
        const name = String(raw.name ?? 'unknown title')
        const size = Number(raw.size ?? 0)
        const key = `${name}:${size}`
        if (known.has(key)) continue
        known.add(key)
        byId.add(raw.id)
        restored.push({
          id: raw.id,
          blob: undefined,
          artBlob: undefined,
          url: '',
          artUrl: undefined,
          name,
          artist: String(raw.artist ?? 'unknown artist'),
          album: String(raw.album ?? 'local archive'),
          genre: String(raw.genre ?? ''),
          duration: Number(raw.duration ?? 0),
          size,
          format: String(raw.format ?? ''),
          bitrate: Number(raw.bitrate ?? 0),
          sampleRate: Number(raw.sampleRate ?? 0),
          favorite: Boolean(raw.favorite),
          plays: Number(raw.plays ?? 0),
          lastPlayed: Number(raw.lastPlayed ?? 0),
          addedAt: Number(raw.addedAt ?? Date.now()),
          links: sanitizeLinks(raw.links),
        })
      }
      const nextTracks = [...restored, ...existing]
      setTracks(nextTracks)
      tracksRef.current = nextTracks
      if (Array.isArray(data.playlists) && data.playlists.length) {
        const validIds = new Set(nextTracks.map(t => t.id))
        setPlaylists(data.playlists
          .filter(p => p && typeof p.id === 'string')
          .map(p => ({
            id: p.id,
            name: String(p.name ?? 'playlist'),
            trackIds: (Array.isArray(p.trackIds) ? p.trackIds : []).filter((id: string) => validIds.has(id)),
          })))
      }
      if (data.settings && typeof data.settings === 'object') {
        const saved = data.settings
        setSettings({
          ...DEFAULT_SETTINGS,
          ...saved,
          eq: { ...DEFAULT_SETTINGS.eq, ...(saved.eq ?? {}) },
          theme: saved.theme === 'light' ? 'light' : 'dark',
          language: saved.language === 'ru' ? 'ru' : 'en',
          defaultProvider: isProviderId(saved.defaultProvider) ? saved.defaultProvider : 'yandex',
        })
      }
      let failed = 0
      await Promise.all(restored.map(track => persistTrack(track).catch(() => { failed += 1 })))
      notify(`Restored ${restored.length} metadata entr${restored.length === 1 ? 'y' : 'ies'}.${failed ? ` ${failed} not saved.` : ''}`)
      if (failed) warnStorage('Some restored entries are in memory only.')
    } catch {
      notify('Import failed. Invalid backup file.')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }
  function exportPlaylist() {
    const pl = playlists.find(p => p.id === selectedPlaylistId)
    if (!pl) { notify('Select a playlist first.'); return }
    const lines = ['#EXTM3U']
    for (const id of pl.trackIds) {
      const t = tracks.find(x => x.id === id)
      if (!t) continue
      const seconds = Math.round((t.duration || 0) / 1000)
      const fileName = (t.blob as File | undefined)?.name || `${t.name}.${(t.format || 'mp3').toLowerCase()}`
      lines.push(`#EXTINF:${seconds},${t.artist} - ${t.name}`, fileName)
    }
    const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${pl.name.replace(/[^a-z0-9_-]+/gi, '_') || 'playlist'}.m3u`
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    notify(`Playlist exported: ${pl.name}`)
  }
  function clampPopupPos(kind: PopupKind, x: number, y: number) {
    const height = Math.min(POPUP_HEIGHT[kind] || 160, window.innerHeight * 0.7)
    return {
      x: clamp(x, 0, Math.max(0, window.innerWidth - Math.min(POPUP_WIDTH[kind], window.innerWidth) - 8)),
      y: clamp(y, 0, Math.max(0, window.innerHeight - height - 8)),
    }
  }
  function openPopup(kind: PopupKind) {
    const rawX = kind === 'ie' ? 520 : kind === 'favorites' ? 560 : 420
    const rawY = kind === 'ie' ? 86 : kind === 'favorites' ? 292 : 180
    const pos = clampPopupPos(kind, rawX, rawY)
    setPopups(prev => {
      const existing = prev.find(p => p.kind === kind)
      if (existing) return prev.map(p => p.id === existing.id ? { ...p, z: ++zRef.current } : p)
      return [...prev, { id: uid(), kind, title: POPUP_TITLE[kind], x: pos.x, y: pos.y, z: ++zRef.current }]
    })
  }
  function startDrag(e: ReactPointerEvent<HTMLDivElement>, popup: Popup) {
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const target = e.currentTarget as HTMLElement
    target.setPointerCapture?.(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const originX = popup.x
    const originY = popup.y
    const onMove = (ev: PointerEvent) => {
      const pos = clampPopupPos(popup.kind, originX + ev.clientX - startX, originY + ev.clientY - startY)
      setPopups(prev => prev.map(p => p.id === popup.id ? { ...p, x: pos.x, y: pos.y } : p))
    }
    const onUp = () => {
      target.releasePointerCapture?.(e.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }
  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDropActive(false)
    if (busyRef.current) return
    void addFiles(e.dataTransfer.files)
  }
  function menuAction(fn: () => void) {
    fn()
    setOpenMenu(null)
  }

  function sortableHeader(field: SortField, label: string) {
    const active = section === 'playlist' ? playlistSort : sort
    return <button className="li-thbtn" onClick={() => toggleSort(field)}>{tr(label)}{active?.field === field ? (active.dir === 'asc' ? ' ↑' : ' ↓') : ''}</button>
  }
  function renderTable() {
    const virtualized = visibleTracks.length > VIRTUALIZE_THRESHOLD
    const { start, end, topSpacer, bottomSpacer } = tableWindow(visibleTracks.length, tableScrollTop, tableViewportHeight)
    const rows = virtualized ? visibleTracks.slice(start, end) : visibleTracks
    return (
      <div
        ref={tableWrapRef}
        className={`li-table-wrap${virtualized ? ' is-virtualized' : ''}`}
        onScroll={virtualized ? (e: ReactUIEvent<HTMLDivElement>) => {
          setTableScrollTop(e.currentTarget.scrollTop)
          setTableViewportHeight(e.currentTarget.clientHeight || 400)
        } : undefined}
      >
        <table className="li-table">
          <thead>
            <tr>
              <th>{section === 'playlist'
                ? <button className="li-thbtn" title="Restore manual playlist order" onClick={() => setPlaylistSort(null)}>#</button>
                : '#'}</th>
              <th>{sortableHeader('name', 'TITLE')}</th>
              <th>{sortableHeader('artist', 'ARTIST')}</th>
              <th>{sortableHeader('album', 'ALBUM')}</th>
              <th>{sortableHeader('duration', 'TIME')}</th>
              <th>{sortableHeader('plays', 'PLAYS')}</th>
              <th>{tr('ACTIONS')}</th>
            </tr>
          </thead>
          <tbody>
            {topSpacer > 0 && (
              <tr className="li-table-spacer" aria-hidden="true" style={{ height: `${topSpacer}px` }}>
                <td colSpan={7} style={{ height: `${topSpacer}px` }} />
              </tr>
            )}
            {rows.map((t, i) => (
              <tr
                key={t.id}
                className={t.id === currentId ? 'is-selected' : ''}
                tabIndex={0}
                aria-label={`Play ${t.artist} - ${t.name}`}
                onDoubleClick={() => playTrack(t.id)}
                onKeyDown={e => {
                  if (e.key !== 'Enter' || e.target !== e.currentTarget) return
                  e.preventDefault()
                  playTrack(t.id)
                }}
                title="Double click or press Enter to play"
              >
                <td>{String((virtualized ? start + i : i) + 1).padStart(2, '0')}</td>
                <td>{t.name}</td>
                <td>{t.artist}</td>
                <td>{t.album}</td>
                <td>{t.duration ? fmt(t.duration) : '--:--'}</td>
                <td>{t.plays ?? 0}</td>
                <td>
                  <button className="li-btn li-btn--tiny" title="Favorite" aria-label={`Favorite ${t.name}`} onClick={() => toggleFavorite(t.id)}>{t.favorite ? '★' : '☆'}</button>
                  <button className="li-btn li-btn--tiny" title="Edit metadata" aria-label={`Edit ${t.name}`} onClick={() => editTrack(t.id)}>EDIT</button>
                  <button className="li-btn li-btn--tiny" title={tr('Service links')} aria-label={`${tr('Service links')}: ${t.name}`} onClick={() => openLinks(t.id)}>WEB</button>
                  <button className="li-btn li-btn--tiny" title="Download original file" aria-label={`Download ${t.name}`} onClick={() => downloadTrack(t.id)}>DL</button>
                  <button className="li-btn li-btn--tiny" title="Publish metadata to public index" aria-label={`Publish ${t.name}`} onClick={() => { void publishTrack(t.id) }}>PUB</button>
                  <button className="li-btn li-btn--tiny" title="Add to playlist" aria-label={`Add ${t.name} to playlist`} onClick={() => addToPlaylist(t.id)}>+PL</button>
                  {section === 'playlist' && (
                    <>
                      <button className="li-btn li-btn--tiny" title={playlistSort ? 'Restore manual order to reorder' : 'Move up'} aria-label={`Move ${t.name} up`} disabled={Boolean(playlistSort)} onClick={() => movePlaylistTrack(t.id, -1)}>↑</button>
                      <button className="li-btn li-btn--tiny" title={playlistSort ? 'Restore manual order to reorder' : 'Move down'} aria-label={`Move ${t.name} down`} disabled={Boolean(playlistSort)} onClick={() => movePlaylistTrack(t.id, 1)}>↓</button>
                      <button className="li-btn li-btn--tiny" title="Remove from playlist" aria-label={`Remove ${t.name} from playlist`} onClick={() => removeFromPlaylist(t.id)}>-PL</button>
                    </>
                  )}
                  <button className="li-btn li-btn--tiny" title="Remove from archive" aria-label={`Remove ${t.name} from archive`} onClick={() => { void removeTrack(t.id) }}>DEL</button>
                </td>
              </tr>
            ))}
            {bottomSpacer > 0 && (
              <tr className="li-table-spacer" aria-hidden="true" style={{ height: `${bottomSpacer}px` }}>
                <td colSpan={7} style={{ height: `${bottomSpacer}px` }} />
              </tr>
            )}
            {visibleTracks.length === 0 && (
              <tr><td colSpan={7} className="li-empty">No tracks. Use ADD FILES / ADD FOLDER or drop audio files here.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    )
  }
  function renderSettings() {
    return (
      <div className="li-panel li-settings">
        <section className="li-settings__group">
          <h3>{tr('// EQUALIZER')}</h3>
          <div className="li-segmented">
            {(['flat', 'bass', 'vocal', 'night'] as EqPreset[]).map(preset => (
              <button key={preset} className={settings.eqPreset === preset ? 'is-active' : ''} aria-pressed={settings.eqPreset === preset} onClick={() => setSettings(s => ({ ...s, eqPreset: preset, eq: { ...EQ_PRESETS[preset] } }))}>{preset.toUpperCase()}</button>
            ))}
          </div>
          {([['bass', 'BASS'], ['mid', 'MID'], ['treble', 'TREBLE']] as Array<[keyof Settings['eq'], string]>).map(([key, label]) => (
            <label className="li-setting-row" key={key}>
              <span>{label}</span>
              <input
                className="li-range"
                type="range"
                min={-12}
                max={12}
                step={1}
                value={settings.eq[key]}
                onChange={e => setSettings(s => ({ ...s, eqPreset: 'custom', eq: { ...s.eq, [key]: Number(e.target.value) } }))}
              />
              <span>{settings.eq[key] > 0 ? '+' : ''}{settings.eq[key]}dB</span>
            </label>
          ))}
        </section>
        <section className="li-settings__group">
          <h3>{tr('// CROSSFADE')}</h3>
          <label className="li-check">
            <input type="checkbox" checked={settings.crossfade} onChange={e => setSettings(s => ({ ...s, crossfade: e.target.checked }))} />
            <span>SEAMLESS TRACK TRANSITIONS</span>
          </label>
          <label className="li-setting-row">
            <span>DURATION</span>
            <input
              className="li-range"
              type="range"
              min={200}
              max={3000}
              step={100}
              value={settings.crossfadeMs}
              onChange={e => setSettings(s => ({ ...s, crossfadeMs: Number(e.target.value) }))}
            />
            <span>{(settings.crossfadeMs / 1000).toFixed(1)}s</span>
          </label>
          <p>Two audio engines overlap the end of one track with the start of the next.</p>
        </section>
        <section className="li-settings__group">
          <h3>{tr('// DYNAMICS')}</h3>
          <label className="li-check">
            <input type="checkbox" checked={settings.compressor} onChange={e => setSettings(s => ({ ...s, compressor: e.target.checked }))} />
            <span>COMPRESSOR / LIMITER</span>
          </label>
          <label className="li-setting-row">
            <span>THRESHOLD</span>
            <input
              className="li-range"
              type="range"
              min={-30}
              max={-6}
              step={1}
              value={settings.compressorThreshold}
              onChange={e => setSettings(s => ({ ...s, compressorThreshold: Number(e.target.value) }))}
            />
            <span>{settings.compressorThreshold}dB</span>
          </label>
          <label className="li-setting-row">
            <span>RATIO</span>
            <input
              className="li-range"
              type="range"
              min={1}
              max={12}
              step={0.5}
              value={settings.compressorRatio}
              onChange={e => setSettings(s => ({ ...s, compressorRatio: Number(e.target.value) }))}
            />
            <span>{settings.compressorRatio}:1</span>
          </label>
          <label className="li-setting-row">
            <span>MAKEUP</span>
            <input
              className="li-range"
              type="range"
              min={0}
              max={6}
              step={0.5}
              value={settings.makeup}
              onChange={e => setSettings(s => ({ ...s, makeup: Number(e.target.value) }))}
            />
            <span>+{settings.makeup.toFixed(1)}</span>
          </label>
        </section>
        <section className="li-settings__group">
          <h3>{tr('// VISUALIZER')}</h3>
          <div className="li-segmented">
            {(['spectrum', 'globe', 'hybrid', 'scope'] as VizMode[]).map(mode => (
              <button key={mode} className={settings.vizMode === mode ? 'is-active' : ''} aria-pressed={settings.vizMode === mode} onClick={() => setSettings(s => ({ ...s, vizMode: mode }))}>{mode.toUpperCase()}</button>
            ))}
          </div>
          <label className="li-setting-row">
            <span>SENSITIVITY</span>
            <input className="li-range" type="range" min={0.4} max={2} step={0.05} value={settings.vizSensitivity} onChange={e => setSettings(s => ({ ...s, vizSensitivity: Number(e.target.value) }))} />
            <span>{settings.vizSensitivity.toFixed(2)}x</span>
          </label>
        </section>
        <section className="li-settings__group">
          <h3>{tr('// THEME')}</h3>
          <div className="li-segmented">
            {(['dark', 'light'] as const).map(theme => (
              <button key={theme} className={settings.theme === theme ? 'is-active' : ''} aria-pressed={settings.theme === theme} onClick={() => setSettings(s => ({ ...s, theme }))}>{tr(theme.toUpperCase())}</button>
            ))}
          </div>
        </section>
        <section className="li-settings__group">
          <h3>{tr('// LANGUAGE')}</h3>
          <div className="li-segmented">
            {(['en', 'ru'] as const).map(language => (
              <button key={language} className={settings.language === language ? 'is-active' : ''} aria-pressed={settings.language === language} onClick={() => setSettings(s => ({ ...s, language }))}>{language.toUpperCase()}</button>
            ))}
          </div>
        </section>
        <section className="li-settings__group">
          <h3>{tr('// INTEGRATIONS')}</h3>
          <label className="li-setting-row">
            <span>{tr('DEFAULT SEARCH')}</span>
            <select className="li-select" value={settings.defaultProvider} onChange={e => setSettings(s => ({ ...s, defaultProvider: e.target.value as ProviderId }))}>
              {PROVIDERS.map(provider => <option key={provider.id} value={provider.id}>{provider.label}</option>)}
            </select>
          </label>
          <p>{tr('Links are stored locally. No audio is uploaded to these services.')}</p>
        </section>
        <section className="li-settings__group">
          <h3>{tr('// ATMOSPHERE')}</h3>
          {([
            ['scanlines', 'CRT SCANLINES'],
            ['grain', 'FILM GRAIN'],
            ['glitch', 'GLITCH ON TRACK CHANGE'],
            ['showPopups', 'SHOW SYSTEM POPUPS'],
            ['calm', 'CALM MODE / REDUCED MOTION'],
          ] as Array<[keyof Settings, string]>).map(([key, label]) => (
            <label className="li-check" key={String(key)}>
              <input type="checkbox" checked={Boolean(settings[key])} onChange={e => setSettings(s => ({ ...s, [key]: e.target.checked }))} />
              <span>{tr(label)}</span>
            </label>
          ))}
        </section>
        <section className="li-settings__group">
          <h3>{tr('// ARCHIVE')}</h3>
          <p>{settings.language === 'ru'
            ? `${tracks.length} треков хранится в этом браузере через IndexedDB. Аудиофайлы никогда не загружаются.`
            : `${tracks.length} tracks stored in this browser via IndexedDB. Audio files are never uploaded.`}</p>
          {storageUsage && storageUsage.quota > 0 && (
            <p>{settings.language === 'ru' ? 'ХРАНИЛИЩЕ' : 'STORAGE'}: {fmtBytes(storageUsage.used)} / {fmtBytes(storageUsage.quota)} ({Math.round((storageUsage.used / storageUsage.quota) * 100)}%)</p>
          )}
          <div className="li-setting-actions">
            <button className="li-btn" onClick={exportLibrary}>{tr('EXPORT METADATA')}</button>
            <button className="li-btn" onClick={() => backupRef.current?.click()}>{tr('IMPORT METADATA')}</button>
            <button className="li-btn li-btn--danger" onClick={() => { void clearArchive() }}>{tr('CLEAR ARCHIVE')}</button>
          </div>
        </section>
      </div>
    )
  }
  function renderRadio() {
    const stations = ['dreams://ambient', 'lost://webcore', 'forever.exe/noise', 'archive://static']
    return (
      <div className="li-panel li-radio">
        <div className="li-radio__head">
          <span className="li-under">UNDER CONSTRUCTION</span>
          <h3>STATION SCANNER</h3>
          <p>Network radio is intentionally offline. This machine only plays local files.</p>
        </div>
        <div className="li-radio__list">
          {stations.map((station, i) => (
            <button key={station} className="li-radio__item" onClick={() => notify(`${station} // NO CARRIER`)}>
              <span>0{i + 1}</span><span>{station}</span><span>OFFLINE</span>
            </button>
          ))}
        </div>
        <div className="li-radio__meter" aria-hidden="true">{Array.from({ length: 24 }, (_, i) => <span key={i} style={{ height: `${8 + ((i * 7) % 21)}px` }} />)}</div>
      </div>
    )
  }
  function renderNowPanel() {
    const upcoming = visibleTracks.slice(0, 6)
    return (
      <div className="li-panel li-nowlist">
        <div className="li-nowlist__head"><span>// QUEUE</span><span>{tracks.length} TRACKS</span></div>
        {upcoming.map((t, i) => (
          <button key={t.id} className={`li-nowlist__item ${t.id === currentId ? 'is-current' : ''}`} onClick={() => playTrack(t.id)}>
            <span>{String(i + 1).padStart(2, '0')}</span><span>{t.name}</span><span>{t.artist}</span><span>{t.duration ? fmt(t.duration) : '--:--'}</span>
          </button>
        ))}
        {!upcoming.length && <div className="li-empty">Queue is empty. Add files to begin.</div>}
      </div>
    )
  }
  function renderNetwork() {
    return (
      <div className="li-panel li-network">
        <div className="li-network__head">
          <span>{tr('// PUBLIC INDEX')}</span>
          <span>{catalogLoading ? tr('SCANNING...') : `${catalog.length} ${tr('ENTRIES')} / ${catalogLikes} ${tr('LIKES')}`}</span>
          <button className="li-btn" onClick={() => { void loadCatalog() }}>{tr('REFRESH')}</button>
        </div>
        <div className="li-network__tools">
          <input
            className="li-network__search"
            placeholder="search public index..."
            aria-label="Search public index"
            value={catalogQuery}
            onChange={e => setCatalogQuery(e.target.value)}
          />
          <div className="li-segmented li-network__sort">
            <button className={catalogSort === 'recent' ? 'is-active' : ''} aria-pressed={catalogSort === 'recent'} onClick={() => setCatalogSort('recent')}>NEW</button>
            <button className={catalogSort === 'likes' ? 'is-active' : ''} aria-pressed={catalogSort === 'likes'} onClick={() => setCatalogSort('likes')}>TOP</button>
          </div>
        </div>
        <section className="li-import">
          <div className="li-import__head">
            <span>{tr('// IMPORT PLAYLIST')}</span>
            <div className="li-segmented">
              <button className={importProvider === 'spotify' ? 'is-active' : ''} aria-pressed={importProvider === 'spotify'} onClick={() => setImportProvider('spotify')}>SPOTIFY</button>
              <button className={importProvider === 'yandex' ? 'is-active' : ''} aria-pressed={importProvider === 'yandex'} onClick={() => setImportProvider('yandex')}>YANDEX</button>
            </div>
          </div>
          <div className="li-import__tools">
            <input
              className="li-input"
              type="url"
              inputMode="url"
              aria-label={tr('Playlist URL')}
              placeholder={importProvider === 'spotify' ? 'https://open.spotify.com/playlist/...' : 'https://music.yandex.ru/users/.../playlists/...'}
              value={importUrl}
              onChange={e => setImportUrl(e.target.value)}
            />
            <button className="li-btn" disabled={importBusy || !importUrl.trim()} onClick={() => { void importPlaylist() }}>{importBusy ? tr('IMPORTING...') : tr('IMPORT')}</button>
            <button className="li-btn" disabled={!importResults.length} onClick={addImportedMatches}>{tr('ADD MATCHED')}</button>
          </div>
          {importError && <p className="li-import__error">{importError}</p>}
          {Boolean(importResults.length) && (
            <div className="li-import__list">
              {importResults.slice(0, 100).map((item, i) => {
                const matched = findLocalMatch(item)
                return (
                  <div className="li-import__row" key={`${item.title}-${i}`}>
                    <span>{String(i + 1).padStart(2, '0')}</span>
                    <span title={item.title}>{item.title}</span>
                    <span title={item.artist}>{item.artist}</span>
                    <span>{item.duration ? fmt(item.duration) : '--:--'}</span>
                    <span className={matched ? 'is-matched' : ''}>{matched ? tr('MATCHED') : tr('NO LOCAL FILE')}</span>
                    {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer">{tr('OPEN')}</a>}
                  </div>
                )
              })}
            </div>
          )}
        </section>
        <p className="li-network__note">{tr("Metadata only. Audio files stay on each user's device. Publish a local track with PUB, then anyone can see it here.")}</p>
        <div className="li-network__list">
          {catalog.map((item, i) => (
            <div className="li-network__row" key={item.id}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <span title={item.title}>{item.title}{Date.now() - Number(item.created_at) < 7 * 86400000 && <span className="li-new" aria-label={tr('New')}>NEW!</span>}</span>
              <span title={item.artist}>{item.artist}</span>
              <span title={item.album}>{item.album || '-'}</span>
              <span>{item.format || '--'}</span>
              <span>{item.likes}</span>
              <span>
                <button className="li-btn li-btn--tiny" title="Play if you have the local file" aria-label={`Play ${item.title} from local archive`} onClick={() => playCatalogTrack(item)}>PLAY</button>
                <button className="li-btn li-btn--tiny" title={tr('Service links')} aria-label={`${tr('Service links')}: ${item.title}`} onClick={() => openLinks(undefined, buildSearchQuery(item.artist, item.title))}>WEB</button>
                <button
                  className="li-btn li-btn--tiny"
                  title="Like"
                  aria-label={`Like ${item.title}`}
                  disabled={pendingLikes.includes(item.id)}
                  onClick={() => { void likeCatalogTrack(item.id) }}
                >+1</button>
              </span>
            </div>
          ))}
          {!catalog.length && !catalogLoading && <div className="li-empty">{tr('Public index is empty. Publish a local track with PUB.')}</div>}
        </div>
      </div>
    )
  }
  function sectionBody() {
    if (section === 'settings') return renderSettings()
    if (section === 'radio') return renderRadio()
    if (section === 'now') return renderNowPanel()
    if (section === 'network') return renderNetwork()
    return renderTable()
  }
  function renderMenu(id: MenuKind) {
    const items: Record<MenuKind, Array<{ label: string; action: () => void; danger?: boolean }>> = {
      file: [
        { label: 'Add Files...', action: () => fileRef.current?.click() },
        { label: 'Add Folder...', action: () => folderRef.current?.click() },
        { label: 'Export Metadata', action: exportLibrary },
        { label: 'Import Metadata...', action: () => backupRef.current?.click() },
        { label: 'Export Playlist (.m3u)', action: exportPlaylist },
        { label: 'Clear Archive', action: () => { void clearArchive() }, danger: true },
      ],
      view: [
        { label: 'Now Playing', action: () => selectSection('now') },
        { label: 'Library', action: () => selectSection('library') },
        { label: 'Playlists', action: () => selectSection('playlist') },
        { label: 'Settings', action: () => selectSection('settings') },
        { label: 'Toggle Popups', action: () => setSettings(s => ({ ...s, showPopups: !s.showPopups })) },
        { label: 'Internet Explorer', action: () => openPopup('ie') },
        { label: 'Favorites', action: () => openPopup('favorites') },
      ],
      playback: [
        { label: 'Play / Pause', action: togglePlay },
        { label: 'Next', action: handleNext },
        { label: 'Previous', action: handlePrev },
        { label: 'Shuffle', action: () => setSettings(s => ({ ...s, shuffle: !s.shuffle })) },
        { label: 'Cycle Repeat', action: cycleRepeat },
        { label: 'Mute', action: () => setSettings(s => ({ ...s, muted: !s.muted })) },
      ],
      help: [
        { label: 'About', action: () => openPopup('about') },
        { label: 'Keyboard Shortcuts', action: () => openPopup('help') },
        { label: 'Fake URLs', action: () => openPopup('favorites') },
        { label: 'Live URL', action: () => notify('lost-internet-web.stepanb249.workers.dev') },
      ],
    }
    return (
      <div className="li-menu-wrap" key={id}>
        <button
          className={`li-menu ${openMenu === id ? 'is-open' : ''}`}
          onClick={() => setOpenMenu(openMenu === id ? null : id)}
        >
          {tr(MENUS.find(m => m.id === id)?.label ?? '')}
        </button>
        {openMenu === id && (
          <div className="li-menu-pop">
            {items[id].map(item => (
              <button key={item.label} className={item.danger ? 'is-danger' : ''} onClick={() => menuAction(item.action)}>{tr(item.label)}</button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const rootClasses = [
    'li-root',
    sidebarCollapsed ? 'is-collapsed' : '',
    settings.scanlines && !settings.calm && !reducedMotion ? 'fx-scanlines' : '',
    settings.grain && !settings.calm && !reducedMotion ? 'fx-grain' : '',
    glitchActive ? 'is-glitch' : '',
    settings.calm || reducedMotion ? 'is-calm' : '',
    dropActive ? 'is-drop' : '',
    busy ? 'is-busy' : '',
  ].filter(Boolean).join(' ')
  const topPopupId = popups.length ? popups.reduce((best, p) => p.z > best.z ? p : best).id : null
  const linkTrack = linksTarget?.id ? tracks.find(t => t.id === linksTarget.id) : undefined
  const marqueeText = `${tr('WELCOME TO LOST INTERNET')} // ${tr('VISITORS: 000001337')} // ${tr('LOCAL FILES')}: ${tracks.length} // ${tr('PUBLIC INDEX')}: ${catalog.length} ${tr('ENTRIES')} // ${tr('MUSIC IS THE ONLY REAL THING')} // `

  return (
    <div
      className={rootClasses}
      data-theme={settings.theme}
      onDragEnter={e => {
        if (busyRef.current || !e.dataTransfer.types.includes('Files')) return
        dragDepthRef.current += 1
        setDropActive(true)
      }}
      onDragOver={e => { if (!busyRef.current && e.dataTransfer.types.includes('Files')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' } }}
      onDragLeave={e => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setDropActive(false)
      }}
      onDrop={e => { dragDepthRef.current = 0; onDrop(e) }}
    >
      <div className="li-window">
        <div className="li-titlebar" onDoubleClick={e => {
          if ((e.target as HTMLElement).closest('button')) return
          void document.documentElement.requestFullscreen?.().catch(() => {})
        }}>
          <span className="li-titlebar__icon">◼</span>
          <span className="li-titlebar__title">lost_internet.exe</span>
          <span className="li-titlebar__tag">v1.0 // LOCAL BUILD</span>
          <div className="li-titlebar__spacer" />
          <button className="li-winbtn" title="Switch language RU / EN" aria-label="Switch language" onClick={e => { if (e.detail > 1) return; setSettings(s => ({ ...s, language: s.language === 'en' ? 'ru' : 'en' })) }}>{settings.language === 'en' ? 'EN' : 'RU'}</button>
          <button className="li-winbtn" title="Keyboard shortcuts (H)" aria-label="Keyboard shortcuts" onClick={e => { if (e.detail > 1) return; openPopup('help') }}>?</button>
          <button className="li-winbtn" title="Toggle theme (T)" aria-label="Toggle theme" onClick={e => { if (e.detail > 1) return; setSettings(s => ({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' })) }}>◐</button>
          <button className="li-winbtn" title="Toggle sidebar" aria-label="Toggle sidebar" onClick={e => { if (e.detail > 1) return; setSidebarCollapsed(v => !v) }}>_</button>
          <button className="li-winbtn" title="Fullscreen" aria-label="Fullscreen" onClick={e => { if (e.detail > 1) return; void document.documentElement.requestFullscreen?.().catch(() => {}) }}>□</button>
          <button className="li-winbtn li-winbtn--close" title="About" aria-label="About or exit" onClick={e => { if (e.detail > 1) return; onExit ? onExit() : openPopup('about') }}>X</button>
        </div>

        <div className="li-menubar">{MENUS.map(m => renderMenu(m.id))}</div>

        <div className="li-toolbar">
          <span className="li-label">ADDR</span>
          <input className="li-address" aria-label="Current address" value={`file://localhost/music/${section}/index.htm`} readOnly />
          <input className="li-search" placeholder="search library..." aria-label="Search library" value={query} onChange={e => setQuery(e.target.value)} />
          <button className="li-btn" onClick={() => fileRef.current?.click()}>{tr('ADD FILES')}</button>
          <button className="li-btn" onClick={() => folderRef.current?.click()}>{tr('ADD FOLDER')}</button>
          <input ref={fileRef} type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac" multiple hidden onChange={e => { void addFiles(e.target.files); e.target.value = '' }} />
          <input ref={folderRef} type="file" accept="audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac" multiple hidden {...({ webkitdirectory: '', directory: '' } as any)} onChange={e => { void addFiles(e.target.files); e.target.value = '' }} />
          <input ref={backupRef} type="file" accept="application/json,.json" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void importLibrary(file); e.target.value = '' }} />
        </div>

        <div className="li-body">
          <aside className="li-sidebar">
            <div className="li-sidebar__head">// INDEX.HTM</div>
            {SECTIONS.map(s => <button key={s.id} className={`li-nav ${section === s.id ? 'is-active' : ''}`} aria-current={section === s.id ? 'page' : undefined} onClick={() => selectSection(s.id)}>{tr(s.label)}</button>)}
            <div className="li-divider" />
            {SECONDARY.map(s => <button key={s.id} className={`li-nav ${section === s.id ? 'is-active' : ''}`} aria-current={section === s.id ? 'page' : undefined} onClick={() => selectSection(s.id)}>{tr(s.label)}</button>)}
            <div className="li-sidebar__head li-sidebar__head--gap">// PLAYLISTS</div>
            <div className="li-playlists">
              {playlists.map(p => (
                <button key={p.id} className={`li-playlist ${selectedPlaylistId === p.id ? 'is-active' : ''}`} aria-pressed={selectedPlaylistId === p.id} onClick={() => { setSelectedPlaylistId(p.id); setPlaylistSort(null); playUiTokenRef.current += 1; setSection('playlist') }}>
                  {p.name} [{p.trackIds.length}]
                </button>
              ))}
            </div>
            <div className="li-sidebar__actions">
              <button className="li-btn" onClick={createPlaylist}>+ NEW</button>
              <button className="li-btn" onClick={() => selectedPlaylistId && renamePlaylist(selectedPlaylistId)}>REN</button>
              <button className="li-btn" onClick={() => selectedPlaylistId && deletePlaylist(selectedPlaylistId)}>DEL</button>
            </div>
            <div className="li-sidebar__quote">music{"\n"}is the only{"\n"}real thing.</div>
          </aside>

          <main className="li-stage">
            <div className="li-top">
              <div className="li-art-wrap">
                <canvas ref={artRef} className="li-art-canvas" />
                <span className="li-art__stamp">NO. {String(tracks.length).padStart(3, '0')}</span>
              </div>
              <div className="li-info">
                <div className="li-now">{playing ? 'NOW PLAYING...' : 'STANDBY...'}</div>
                <h1 className="li-track-title" title={current?.name}>{current?.name || 'dreamscape.exe'}</h1>
                <p className="li-track-artist">{current?.artist || 'unknown artist'}</p>
                <p className="li-track-meta">// {current?.album || 'webcore collection'}</p>
                <div className="li-infogrid">
                  <div className="k">ALBUM</div><div className="v" title={current?.album}>{current?.album || '-'}</div>
                  <div className="k">GENRE</div><div className="v">{current?.genre || '-'}</div>
                  <div className="k">FORMAT</div><div className="v">{current?.format || '-'}</div>
                  <div className="k">BITRATE</div><div className="v">{current?.bitrate ? `${current.bitrate} kbps` : '-'}</div>
                  <div className="k">SAMPLE</div><div className="v">{current?.sampleRate ? `${current.sampleRate} Hz` : '-'}</div>
                  <div className="k">PLAYS</div><div className="v">{current?.plays ?? '-'}</div>
                  <div className="k">PATH</div><div className="v" title={current?.name}>{current ? (current.blob as File | undefined)?.name || current.name : '-'}</div>
                </div>
                <div className="li-info__actions">
                  <button className="li-btn" onClick={() => selectSection('settings')}>CONFIG.SYS</button>
                  <button className="li-btn" onClick={() => openPopup('ie')}>IE POPUP</button>
                  <button className="li-btn" onClick={() => openPopup('favorites')}>FAVORITES</button>
                </div>
                <div className="li-badges">
                  <span className="li-counter">VISITORS: 000001337</span>
                  <span className="li-under">UNDER CONSTRUCTION</span>
                </div>
              </div>
            </div>

            {sectionBody()}

            <div className="li-vis"><canvas ref={visRef} /></div>

            <div className="li-controls">
              <div className="li-progress-row">
                <span className="li-time">{fmt(progress)}</span>
                <input className="li-range" type="range" min={0} max={1000} value={duration ? Math.floor((progress / duration) * 1000) : 0} onChange={e => seek(Number(e.target.value))} aria-label="Seek" />
                <span className="li-time">{fmt(duration)}</span>
              </div>
              <div className="li-buttons-row">
                <button className={`li-ctrl ${settings.shuffle ? 'is-active' : ''}`} title="Shuffle (S)" aria-pressed={settings.shuffle} onClick={() => setSettings(s => ({ ...s, shuffle: !s.shuffle }))}>SHUF</button>
                <button className="li-ctrl" title="Previous (P)" onClick={handlePrev}>PREV</button>
                <button className="li-ctrl li-ctrl--play" title="Play / Pause (Space)" onClick={togglePlay}>{playing ? 'PAUSE' : 'PLAY'}</button>
                <button className="li-ctrl" title="Next (N)" onClick={handleNext}>NEXT</button>
                <button className="li-ctrl" title="Repeat (R)" aria-label={`Repeat: ${settings.repeat}`} onClick={cycleRepeat}>REP:{settings.repeat.toUpperCase()}</button>
                <button className={`li-ctrl ${settings.muted ? 'is-alert' : ''}`} title="Mute (M)" aria-pressed={settings.muted} onClick={() => setSettings(s => ({ ...s, muted: !s.muted }))}>{settings.muted ? 'MUTE' : 'VOL'}</button>
                <div className="li-spacer" />
                <input className="li-range li-vol" type="range" min={0} max={100} value={Math.round(settings.volume * 100)} onChange={e => setSettings(s => ({ ...s, volume: Number(e.target.value) / 100 }))} aria-label="Volume" />
                <span className="li-time">{Math.round(settings.volume * 100)}%</span>
              </div>
            </div>
          </main>
        </div>

        <div className="li-status">
          <span className="li-status__dot" />
          <span>{status}</span>
          <span className="li-status__right">{tr('MODE')}: {settings.vizMode.toUpperCase()} // {ready ? tr('ARCHIVE READY') : tr('LOADING...')}</span>
        </div>

        <div className="li-marquee" aria-hidden="true">
          <div className="li-marquee__track"><span>{marqueeText}</span><span>{marqueeText}</span></div>
        </div>

        {updateReady && (
          <div className="li-update" role="status">
            <span>{tr('NEW BUILD READY // RELOAD TO APPLY')}</span>
            <button className="li-btn" onClick={() => window.location.reload()}>{tr('RELOAD')}</button>
          </div>
        )}
      </div>

      <div className="li-fx li-fx--scan" aria-hidden="true" />
      <div className="li-fx li-fx--grain" aria-hidden="true" />

      {popups.map(p => (
        <div
          key={p.id}
          data-popup-id={p.id}
          className={`li-popup li-popup--${p.kind}`}
          role="dialog"
          aria-modal={p.id === topPopupId}
          aria-label={p.title}
          style={{ left: p.x, top: p.y, width: POPUP_WIDTH[p.kind], zIndex: p.z }}
          onMouseDown={() => setPopups(prev => prev.map(x => x.id === p.id ? { ...x, z: ++zRef.current } : x))}
        >
          <div className="li-popup__title" onPointerDown={e => startDrag(e, p)} onDoubleClick={() => setPopups(prev => prev.filter(x => x.id !== p.id))}>
            <span>{p.title}</span>
            <button className="li-popup__close" aria-label={`Close ${p.title}`} onClick={() => setPopups(prev => prev.filter(x => x.id !== p.id))}>X</button>
          </div>
          <div className="li-popup__body">
            {p.kind === 'ie' && <IePopupBody calm={settings.calm || reducedMotion} onClose={() => setPopups(prev => prev.filter(x => x.id !== p.id))} />}
            {p.kind === 'favorites' && (
              <div className="li-popup__links">
                <button className="li-popup__link" onClick={() => notify('about:blank // nothing here')}>about:blank</button>
                <button className="li-popup__link" onClick={() => notify('dreams:// connection refused')}>dreams://</button>
                <button className="li-popup__link" onClick={() => notify('forever.exe is not responding')}>forever.exe</button>
                <button className="li-popup__link" onClick={() => notify('lost://archive mounted locally')}>lost://archive</button>
              </div>
            )}
            {p.kind === 'about' && (
              <div className="li-popup__about">
                <strong>LOST INTERNET</strong><br /><br />
                Dark Webcore / Y2K local music player.<br />
                React + Web Audio + IndexedDB.<br /><br />
                <span>music is the only real thing.</span>
              </div>
            )}
            {p.kind === 'help' && <HelpPopupBody tr={tr} />}
            {p.kind === 'links' && linksTarget && (
              <LinksPopupBody
                key={linksTarget.id ?? linksTarget.query}
                query={linksTarget.query}
                links={linkTrack?.links ?? EMPTY_LINKS}
                editable={Boolean(linksTarget.id)}
                defaultProvider={settings.defaultProvider}
                tr={tr}
                onSave={saveTrackLink}
              />
            )}
          </div>
        </div>
      ))}

      {toast && <div className="li-toast" role="status">{toast}</div>}
      <audio ref={audioRef} preload="metadata" />
      <audio ref={nextAudioRef} preload="metadata" />
    </div>
  )
}

function IePopupBody({ calm, onClose }: { calm: boolean; onClose: () => void }) {
  const [value, setValue] = useState(calm ? 43 : 0)
  useEffect(() => {
    if (calm) return
    const timer = window.setInterval(() => setValue(v => (v >= 100 ? 100 : v + 7)), 220)
    return () => window.clearInterval(timer)
  }, [calm])
  return (
    <div className="li-ie">
      <div>{value >= 100 ? 'Connection lost. Try again later.' : 'Loading happiness...'}</div>
      <div className="li-popup__bar"><div className="li-popup__fill" style={{ width: `${value}%` }} /></div>
      <button className="li-btn" onClick={() => value >= 100 ? onClose() : setValue(100)}>{value >= 100 ? 'Close' : 'Cancel'}</button>
    </div>
  )
}

function HelpPopupBody({ tr }: { tr: (text: string) => string }) {
  const groups: Array<{ title: string; rows: Array<[string, string]> }> = [
    {
      title: 'PLAYBACK',
      rows: [
        ['SPACE', 'play / pause'],
        ['N / P', 'next / previous track'],
        ['CTRL+← / →', 'previous / next track'],
        ['M', 'mute / unmute'],
        ['[ / ]', 'volume down / up'],
        ['F', 'favorite current track'],
        ['S', 'shuffle on / off'],
        ['R', 'repeat off / all / one'],
      ],
    },
    {
      title: 'INTERFACE',
      rows: [
        ['1 / 2 / 3 / 4', 'spectrum / globe / hybrid / scope'],
        ['T', 'toggle dark / light theme'],
        ['H', 'open keys.txt'],
        ['ESC', 'close menus and popups'],
      ],
    },
    {
      title: 'FILES',
      rows: [
        ['CTRL+O', 'add audio files'],
        ['CTRL+F', 'focus library search'],
        ['DRAG', 'drop audio files anywhere'],
        ['DBLCLICK', 'play a row in the track table'],
      ],
    },
  ]
  return (
    <div className="li-help" aria-label="Keyboard shortcuts">
      <div className="li-help__head">{tr('keys.txt // HOTKEYS')}</div>
      {groups.map(group => (
        <section className="li-help__group" key={group.title}>
          <h4>// {tr(group.title)}</h4>
          {group.rows.map(([key, label]) => (
            <div className="li-help__row" key={key}>
              <span>{key}</span>
              <span>{tr(label)}</span>
            </div>
          ))}
        </section>
      ))}
      <div className="li-help__foot">{tr('TAB // switch inside window  ESC // close')}</div>
    </div>
  )
}

function LinksPopupBody({ query, links, editable, defaultProvider, tr, onSave }: {
  query: string
  links: TrackLinks
  editable: boolean
  defaultProvider: ProviderId
  tr: (text: string) => string
  onSave: (provider: ProviderId, raw: string) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(PROVIDERS.map(provider => [provider.id, links[provider.id] ?? ''])),
  )
  useEffect(() => {
    setDrafts(Object.fromEntries(PROVIDERS.map(provider => [provider.id, links[provider.id] ?? ''])))
  }, [links])
  const defaultUrl = buildSearchUrl(defaultProvider, query)
  return (
    <div className="li-links">
      <div className="li-links__query">{tr('QUERY')}: {query || '-'}</div>
      <a className="li-btn li-links__default" href={defaultUrl} target="_blank" rel="noopener noreferrer">
        {tr('SEARCH IN')} {PROVIDERS.find(provider => provider.id === defaultProvider)?.label ?? ''}
      </a>
      {PROVIDERS.map(provider => {
        const saved = links[provider.id]
        const draft = drafts[provider.id] ?? ''
        return (
          <section className="li-links__row" key={provider.id}>
            <div className="li-links__head">
              <strong>{provider.label}</strong>
              <a href={buildSearchUrl(provider.id, query)} target="_blank" rel="noopener noreferrer">{tr('SEARCH')}</a>
              {saved && <a href={saved} target="_blank" rel="noopener noreferrer">{tr('OPEN')}</a>}
            </div>
            {editable && (
              <div className="li-links__edit">
                <input
                  className="li-input"
                  type="url"
                  inputMode="url"
                  placeholder="https://..."
                  aria-label={`${provider.label} URL`}
                  value={draft}
                  onChange={e => setDrafts(prev => ({ ...prev, [provider.id]: e.target.value }))}
                />
                <button className="li-btn li-btn--tiny" onClick={() => onSave(provider.id, draft)}>{tr('SAVE')}</button>
              </div>
            )}
          </section>
        )
      })}
      {!editable && <p>{tr('Search links only for public entries. Save links on your local tracks in LIBRARY.')}</p>}
    </div>
  )
}
