import { useState, useEffect } from 'react'

// Returns a Date that updates every second so any component using it
// re-renders and shows the current time live (no more frozen open-time clock).
export function useClock(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
