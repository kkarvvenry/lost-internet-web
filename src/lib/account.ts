import { PROVIDERS, sanitizeLinks } from './links'

export type Account = {
  id: string
  email: string
  displayName: string
  createdAt: number
}

export type AccountTrackRef = {
  id: string
  title: string
  artist: string
  album: string
  duration: number
}

export type AccountPlaylist = {
  id: string
  name: string
  tracks: AccountTrackRef[]
}

export type AccountData = {
  settings: Record<string, unknown>
  playlists: AccountPlaylist[]
  favorites: AccountTrackRef[]
  links: Record<string, Record<string, string>>
}

export const ACCOUNT_COOKIE = 'li_session'
export const ACCOUNT_DATA_LIMIT = 64_000
export const SESSION_TTL_SECONDS = 30 * 86400
const PBKDF2_ITERATIONS = 20_000

const BOOL_KEYS = ['muted', 'shuffle', 'crossfade', 'compressor', 'scanlines', 'grain', 'glitch', 'calm', 'showPopups'] as const
const NUM_KEYS = ['volume', 'vizSensitivity', 'crossfadeMs', 'compressorThreshold', 'compressorRatio', 'makeup'] as const
const ENUM_KEYS: Record<string, string[]> = {
  repeat: ['off', 'all', 'one'],
  vizMode: ['spectrum', 'globe', 'hybrid', 'scope'],
  eqPreset: ['flat', 'bass', 'vocal', 'night', 'custom'],
  theme: ['dark', 'light'],
  language: ['en', 'ru'],
  defaultProvider: PROVIDERS.map(provider => provider.id),
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function text(value: unknown, max: number): string {
  return String(value ?? '').trim().slice(0, max)
}

export function isValidEmail(value: string): boolean {
  return value.length <= 200 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)
}

export function isValidPassword(value: string): boolean {
  return value.length >= 8 && value.length <= 200
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

export function randomToken(bytes = 32): string {
  const data = new Uint8Array(bytes)
  crypto.getRandomValues(data)
  return toBase64(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const hash = await derive(password, salt)
  return `${PBKDF2_ITERATIONS}:${toBase64(salt)}:${toBase64(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [iterations, saltPart, hashPart] = stored.split(':')
  if (!saltPart || !hashPart || Number(iterations) !== PBKDF2_ITERATIONS) return false
  let salt: Uint8Array
  let expected: Uint8Array
  try {
    salt = fromBase64(saltPart)
    expected = fromBase64(hashPart)
  } catch {
    return false
  }
  const actual = await derive(password, salt)
  if (actual.length !== expected.length) return false
  let diff = 0
  for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ expected[i]
  return diff === 0
}

export function sanitizeSettings(value: unknown): Record<string, unknown> {
  const source = record(value)
  const result: Record<string, unknown> = {}
  if (!source) return result
  for (const key of BOOL_KEYS) {
    if (typeof source[key] === 'boolean') result[key] = source[key]
  }
  for (const key of NUM_KEYS) {
    if (typeof source[key] === 'number' && Number.isFinite(source[key])) result[key] = source[key]
  }
  for (const [key, allowed] of Object.entries(ENUM_KEYS)) {
    if (typeof source[key] === 'string' && allowed.includes(source[key])) result[key] = source[key]
  }
  const eq = record(source.eq)
  if (eq) {
    const bands: Record<string, number> = {}
    for (const band of ['bass', 'mid', 'treble']) {
      const raw = eq[band]
      if (typeof raw === 'number' && Number.isFinite(raw) && raw >= -20 && raw <= 20) bands[band] = raw
    }
    if (Object.keys(bands).length) result.eq = bands
  }
  return result
}

function sanitizeTrackRef(value: unknown): AccountTrackRef | null {
  const raw = record(value)
  if (!raw) return null
  const id = text(raw.id, 80)
  const title = text(raw.title, 180)
  if (!id || !title) return null
  return {
    id,
    title,
    artist: text(raw.artist, 120),
    album: text(raw.album, 120),
    duration: Math.max(0, Math.min(86400, Math.round(Number(raw.duration) || 0))),
  }
}

export function sanitizeAccountData(value: unknown): AccountData {
  const source = record(value)
  const empty: AccountData = { settings: {}, playlists: [], favorites: [], links: {} }
  if (!source) return empty

  const playlists: AccountPlaylist[] = []
  const rawPlaylists = Array.isArray(source.playlists) ? source.playlists.slice(0, 200) : []
  for (const item of rawPlaylists) {
    const raw = record(item)
    if (!raw) continue
    const id = text(raw.id, 80)
    const name = text(raw.name, 120)
    if (!id || !name) continue
    const rawTracks = Array.isArray(raw.tracks) ? raw.tracks.slice(0, 2000) : []
    const tracks: AccountTrackRef[] = []
    for (const entry of rawTracks) {
      const ref = sanitizeTrackRef(entry)
      if (ref) tracks.push(ref)
    }
    playlists.push({ id, name, tracks })
  }

  const favorites: AccountTrackRef[] = []
  const rawFavorites = Array.isArray(source.favorites) ? source.favorites.slice(0, 2000) : []
  for (const item of rawFavorites) {
    const ref = sanitizeTrackRef(item)
    if (ref) favorites.push(ref)
  }

  const links: Record<string, Record<string, string>> = {}
  const rawLinks = record(source.links)
  if (rawLinks) {
    for (const [id, value] of Object.entries(rawLinks).slice(0, 2000)) {
      const clean = sanitizeLinks(value)
      if (clean && id.length <= 80) links[id] = clean as Record<string, string>
    }
  }

  return { settings: sanitizeSettings(source.settings), playlists, favorites, links }
}
