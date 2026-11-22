export const animationDefaults = {
  duration: {
    fast: 0.2,
    standard: 0.4,
    slow: 0.7,
  },
  ease: 'power2.out',
} as const

export interface HeroMotion {
  /** Portrait travel from its start (left) position, as a fraction of viewport width. */
  toCenter: number
  toRight: number
  /** Copy travel (negative = leftward), fraction of viewport width. */
  copyShift: number
  scale: { rest: number; climax: number; exit: number }
}

/** Scroll-scrubbed Hero: LEFT → CENTER → RIGHT. Timeline runs 0 → 1 over the section. */
export const heroMotion = {
  scrub: 1.4,
  desktop: {
    toCenter: 0.3,
    toRight: 0.6,
    copyShift: -0.46,
    scale: { rest: 0.92, climax: 1.1, exit: 0.84 },
  } satisfies HeroMotion,
  mobile: {
    toCenter: 0.12,
    toRight: 0.24,
    copyShift: 0,
    scale: { rest: 0.96, climax: 1.04, exit: 0.9 },
  } satisfies HeroMotion,
} as const

export interface RevealSettings {
  baseOpacity: number
  baseRotation: number
  blurStrength: number
  /** ScrollTrigger end; React Bits' 'bottom bottom' default is near-instant for short text. */
  wordAnimationEnd: string
  rotationEnd: string
}

/** Props for the React Bits ScrollReveal in About. Mobile is gentler for legibility. */
export const revealMotion = {
  statement: {
    desktop: { baseOpacity: 0, baseRotation: 5, blurStrength: 10, wordAnimationEnd: 'bottom 80%', rotationEnd: 'bottom 80%' },
    mobile: { baseOpacity: 0, baseRotation: 3, blurStrength: 6, wordAnimationEnd: 'bottom 82%', rotationEnd: 'bottom 82%' },
  },
  /** Project title / technologies / description in the Projects section. */
  project: {
    desktop: { baseOpacity: 0, baseRotation: 3, blurStrength: 8, wordAnimationEnd: 'bottom 85%', rotationEnd: 'bottom 85%' },
    mobile: { baseOpacity: 0, baseRotation: 2, blurStrength: 5, wordAnimationEnd: 'bottom 85%', rotationEnd: 'bottom 85%' },
  },
  details: {
    desktop: { baseOpacity: 0, baseRotation: 2, blurStrength: 6, wordAnimationEnd: 'bottom 79%', rotationEnd: 'bottom 79%' },
    mobile: { baseOpacity: 0, baseRotation: 1, blurStrength: 4, wordAnimationEnd: 'bottom 80%', rotationEnd: 'bottom 80%' },
  },
} as const satisfies Record<string, Record<'desktop' | 'mobile', RevealSettings>>
