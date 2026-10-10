import type { Page, PageSize, Rotation } from './types'

export function insertPages(pages: Page[], added: Page[], at: number): Page[] {
  const i = clamp(at, 0, pages.length)
  return [...pages.slice(0, i), ...added, ...pages.slice(i)]
}

export function removePages(pages: Page[], ids: ReadonlySet<string>): Page[] {
  return pages.filter((p) => !ids.has(p.id))
}

/** Moves the given pages, in document order, into the gap before index `gap` of the current list. */
export function movePages(pages: Page[], ids: ReadonlySet<string>, gap: number): Page[] {
  const moving = pages.filter((p) => ids.has(p.id))
  if (moving.length === 0) return pages
  const before = pages.slice(0, clamp(gap, 0, pages.length)).filter((p) => ids.has(p.id)).length
  const rest = pages.filter((p) => !ids.has(p.id))
  const next = insertPages(rest, moving, gap - before)
  return next.every((p, i) => p === pages[i]) ? pages : next
}

export function rotatePages(pages: Page[], ids: ReadonlySet<string>, delta: number): Page[] {
  return pages.map((p) =>
    ids.has(p.id) ? { ...p, rotation: normalizeRotation(p.rotation + delta) } : p,
  )
}

/** Inserts each copy directly after its original. Returns the new list and the ids of the copies. */
export function duplicatePages(
  pages: Page[],
  ids: ReadonlySet<string>,
  newId: () => string,
): { pages: Page[]; copies: string[] } {
  const copies: string[] = []
  const next = pages.flatMap((p) => {
    if (!ids.has(p.id)) return [p]
    const copy = { ...p, id: newId() }
    copies.push(copy.id)
    return [p, copy]
  })
  return { pages: next, copies }
}

export function normalizeRotation(deg: number): Rotation {
  return ((((Math.round(deg / 90) * 90) % 360) + 360) % 360) as Rotation
}

export function rotatedSize(size: PageSize, rotation: Rotation): PageSize {
  return rotation % 180 === 0 ? size : { width: size.height, height: size.width }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
