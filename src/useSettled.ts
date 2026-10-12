import { useEffect, useState } from 'react'

/** The value once it has stopped changing for `ms`, so expensive work does not run on every keystroke. */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return settled
}
