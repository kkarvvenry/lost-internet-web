export const TABLE_ROW_HEIGHT = 30
export const VIRTUALIZE_THRESHOLD = 60

export type TableWindow = {
  start: number
  end: number
  topSpacer: number
  bottomSpacer: number
}

export function tableWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight = TABLE_ROW_HEIGHT,
  overscan = 8,
): TableWindow {
  if (total <= VIRTUALIZE_THRESHOLD) {
    return { start: 0, end: total, topSpacer: 0, bottomSpacer: 0 }
  }
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const windowSize = Math.ceil(viewportHeight / rowHeight) + overscan * 2 + 2
  const end = Math.min(total, start + windowSize)
  return {
    start,
    end,
    topSpacer: start * rowHeight,
    bottomSpacer: Math.max(0, (total - end) * rowHeight),
  }
}
