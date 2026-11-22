import { useEffect, useState } from 'react'

export const MOBILE_QUERY = '(max-width: 767px)'

export function useResponsive() {
  const [isMobile, setIsMobile] = useState(
    () => window.matchMedia(MOBILE_QUERY).matches,
  )

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_QUERY)
    const updateIsMobile = () => setIsMobile(mediaQuery.matches)

    mediaQuery.addEventListener('change', updateIsMobile)
    return () => mediaQuery.removeEventListener('change', updateIsMobile)
  }, [])

  return { isMobile }
}
