export type PageAction = 'rotateLeft' | 'rotateRight' | 'remove'

const titles: Record<PageAction, { one: string; many: string }> = {
  rotateLeft: { one: 'Nach links drehen', many: 'nach links drehen' },
  rotateRight: { one: 'Nach rechts drehen', many: 'nach rechts drehen' },
  remove: { one: 'Seite löschen', many: 'löschen' },
}

/** Names the pages an action covers: one page, or "3 Seiten" for a selection. */
export function actionTitle(action: PageAction, count: number): string {
  const t = titles[action]
  return count === 1 ? t.one : `${count} Seiten ${t.many}`
}

export interface Span {
  top: number
  bottom: number
}

/**
 * The gap a pointer at `y` rests in, judged by the page `index` it is next to:
 * before the page when above its frame, after it when below, none when level with it.
 */
export function gapNear(index: number, frame: Span, y: number): number | null {
  if (y < frame.top) return index
  if (y > frame.bottom) return index + 1
  return null
}
