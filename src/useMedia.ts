import { useEffect, useState } from 'react'

export function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const list = matchMedia(query)
    const update = () => setMatches(list.matches)
    update()
    list.addEventListener('change', update)
    return () => list.removeEventListener('change', update)
  }, [query])
  return matches
}

/** Phones and narrow tablet windows get the touch layout with top and bottom bars. */
export const COMPACT = '(max-width: 820px)'
/** Devices without hover, where "drag files here" makes no sense. */
export const TOUCH = '(hover: none)'
