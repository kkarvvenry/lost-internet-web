export const SPOTIFY_SCOPES = 'playlist-read-private playlist-read-collaborative'

export function randomVerifier(size = 32): string {
  const bytes = new Uint8Array(size)
  crypto.getRandomValues(bytes)
  return bytesToUrlSafe(bytes)
}

export function bytesToUrlSafe(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return bytesToUrlSafe(new Uint8Array(digest))
}

export function spotifyAuthorizeUrl(params: {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
}): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    response_type: 'code',
    redirect_uri: params.redirectUri,
    scope: SPOTIFY_SCOPES,
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    show_dialog: 'true',
  })
  return `https://accounts.spotify.com/authorize?${query.toString()}`
}
