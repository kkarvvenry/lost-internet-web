export function normalizeMatch(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9а-яё]/gi, '')
    .trim()
}

export function matchScore(
  a: { title: string; artist: string },
  b: { title: string; artist: string },
): number {
  const titleA = normalizeMatch(a.title)
  const titleB = normalizeMatch(b.title)
  if (!titleA || !titleB) return 0
  let score = titleA === titleB ? 3 : (titleA.includes(titleB) || titleB.includes(titleA) ? 2 : 0)
  const artistA = normalizeMatch(a.artist)
  const artistB = normalizeMatch(b.artist)
  if (artistA && artistB && (artistA === artistB || artistA.includes(artistB) || artistB.includes(artistA))) score += 1
  return score
}
