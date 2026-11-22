// React Bits — SplitFlapText (JS + CSS variant), ported to TypeScript.
// https://reactbits.dev
// Local change: an `active` prop holds the board on its first phrase until it is set,
// so a reveal can start when it scrolls into view instead of on page load.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes } from 'react'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import './SplitFlapText.css'

const DEFAULT_WORDS = ['LAUNCH READY', 'SYNC ONLINE', 'SIGNAL LIVE']

const CHARSETS: Record<string, string> = {
  alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  numeric: '0123456789',
}

const toCssUnit = (value: number | string) => (typeof value === 'number' ? `${value}px` : value)

const resolveCharset = (charset: string) => {
  if (CHARSETS[charset]) return CHARSETS[charset]
  return charset.length > 0 ? charset : CHARSETS.alphanumeric
}

const normalizePhrase = (phrase: string, width: number) => String(phrase ?? '').padEnd(width, ' ').slice(0, width)

interface Tile {
  current: string
  next: string
  flipping: boolean
  tick: number
}

const createTiles = (phrase: string): Tile[] =>
  phrase.split('').map((char) => ({ current: char, next: char, flipping: false, tick: 0 }))

const sampleChar = (charset: string) => charset.charAt(Math.floor(Math.random() * charset.length)) || ' '

const buildSequence = (target: string, flips: number, charset: string) => {
  const steps: string[] = []
  for (let i = 0; i < flips; i += 1) steps.push(sampleChar(charset))
  steps.push(target)
  return steps
}

interface Plan {
  index: number
  from: string
  target: string
  sequence: string[]
  start: number
  step: number
  done: boolean
}

interface SplitFlapTextProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style'> {
  words?: string[]
  text?: string
  flipDuration?: number
  stagger?: number
  cycleDelay?: number
  charset?: 'alpha' | 'alphanumeric' | 'numeric' | (string & {})
  flipsPerChar?: number
  tileColor?: string
  textColor?: string
  tileRadius?: number | string
  gap?: number | string
  fontSize?: number | string
  loop?: boolean
  padTo?: number
  /** Hold on the first phrase until true. */
  active?: boolean
  className?: string
  style?: CSSProperties
}

const SplitFlapText = ({
  words = DEFAULT_WORDS,
  text,
  flipDuration = 0.12,
  stagger = 0.06,
  cycleDelay = 2400,
  charset = 'alphanumeric',
  flipsPerChar = 8,
  tileColor = '#111827',
  textColor = '#f8fafc',
  tileRadius = 8,
  gap = 6,
  fontSize = 52,
  loop = true,
  padTo = 12,
  active = true,
  className = '',
  style = {},
  ...props
}: SplitFlapTextProps) => {
  const prefersReducedMotion = useReducedMotion()
  const rafRef = useRef<number | null>(null)
  const cycleTimerRef = useRef<number | null>(null)
  const currentTextRef = useRef('')

  const sourceWords = Array.isArray(words) && words.length > 0 ? words : DEFAULT_WORDS
  const phrasesKey = typeof text === 'string' ? text : sourceWords.map((word) => String(word ?? '')).join('\u001f')
  const phrases = useMemo(() => phrasesKey.split('\u001f'), [phrasesKey])

  const width = useMemo(() => {
    const longest = phrases.reduce((max, phrase) => Math.max(max, phrase.length), 1)
    return Math.max(1, Math.ceil(Number(padTo) || 0), longest)
  }, [padTo, phrases])

  const normalizedPhrases = useMemo(() => phrases.map((phrase) => normalizePhrase(phrase, width)), [phrases, width])

  const [tiles, setTiles] = useState<Tile[]>(() => createTiles(normalizedPhrases[0] || ''))

  useEffect(() => {
    const clearAnimation = () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (cycleTimerRef.current) {
        clearTimeout(cycleTimerRef.current)
        cycleTimerRef.current = null
      }
    }

    clearAnimation()

    const firstPhrase = normalizedPhrases[0] || ''
    currentTextRef.current = firstPhrase
    // Upstream behaviour: reset the board whenever the phrases or timing change.
    // oxlint-disable-next-line react/set-state-in-effect
    setTiles(createTiles(firstPhrase))

    if (!active || normalizedPhrases.length <= 1) return clearAnimation

    let phraseIndex = 0
    let cancelled = false

    const safeFlipMs = Math.max(40, (Number(flipDuration) || 0.12) * 1000)
    const safeStaggerMs = Math.max(0, (Number(stagger) || 0) * 1000)
    const safeCycleDelay = Math.max(400, Number(cycleDelay) || 2400)
    const safeFlips = Math.max(0, Math.floor(Number(flipsPerChar) || 0))
    const activeCharset = resolveCharset(charset)

    const animateTo = (targetPhrase: string) => {
      if (prefersReducedMotion) {
        currentTextRef.current = targetPhrase
        setTiles(createTiles(targetPhrase))
        return 0
      }

      const fromPhrase = normalizePhrase(currentTextRef.current, width)
      const plans = targetPhrase
        .split('')
        .map((targetChar, index): Plan | null => {
          const fromChar = fromPhrase[index] || ' '
          if (fromChar === targetChar) return null
          return {
            index,
            from: fromChar,
            target: targetChar,
            sequence: buildSequence(targetChar, safeFlips, activeCharset),
            start: index * safeStaggerMs,
            step: -1,
            done: false,
          }
        })
        .filter((plan): plan is Plan => plan !== null)

      if (!plans.length) {
        currentTextRef.current = targetPhrase
        setTiles(createTiles(targetPhrase))
        return 0
      }

      const totalDuration = plans.reduce((max, plan) => Math.max(max, plan.start + plan.sequence.length * safeFlipMs), 0)
      const startedAt = performance.now()

      const updateTiles = (updates: { index: number; current: string; next: string; done: boolean }[]) => {
        setTiles((previous) => {
          const nextTiles = [...previous]
          updates.forEach((update) => {
            const tile = nextTiles[update.index]
            if (!tile) return
            nextTiles[update.index] = {
              current: update.current,
              next: update.next,
              flipping: !update.done,
              tick: tile.tick + 1,
            }
          })
          return nextTiles
        })
      }

      const tick = (now: number) => {
        if (cancelled) return
        const elapsed = now - startedAt
        const updates: { index: number; current: string; next: string; done: boolean }[] = []
        let shouldContinue = false

        plans.forEach((plan) => {
          const localElapsed = elapsed - plan.start
          if (localElapsed < 0) {
            shouldContinue = true
            return
          }
          const step = Math.floor(localElapsed / safeFlipMs)
          if (step < plan.sequence.length) {
            shouldContinue = true
            if (step !== plan.step) {
              plan.step = step
              updates.push({
                index: plan.index,
                current: step === 0 ? plan.from : plan.sequence[step - 1],
                next: plan.sequence[step],
                done: false,
              })
            }
          } else if (!plan.done) {
            plan.done = true
            updates.push({ index: plan.index, current: plan.target, next: plan.target, done: true })
          }
        })

        if (updates.length > 0) updateTiles(updates)

        if (shouldContinue) {
          rafRef.current = requestAnimationFrame(tick)
        } else {
          currentTextRef.current = targetPhrase
          rafRef.current = null
        }
      }

      rafRef.current = requestAnimationFrame(tick)
      return totalDuration
    }

    const scheduleNext = (delay: number) => {
      cycleTimerRef.current = window.setTimeout(() => {
        if (cancelled) return
        const nextIndex = phraseIndex + 1
        if (nextIndex >= normalizedPhrases.length && !loop) return
        phraseIndex = nextIndex % normalizedPhrases.length
        const animationDuration = animateTo(normalizedPhrases[phraseIndex])
        scheduleNext(safeCycleDelay + animationDuration)
      }, delay)
    }

    scheduleNext(safeCycleDelay)

    return () => {
      cancelled = true
      clearAnimation()
    }
  }, [normalizedPhrases, width, loop, cycleDelay, flipDuration, stagger, flipsPerChar, charset, prefersReducedMotion, active])

  const settledText = tiles
    .map((tile) => tile.current)
    .join('')
    .trimEnd()

  const componentStyle = {
    '--split-flap-tile-color': tileColor,
    '--split-flap-text-color': textColor,
    '--split-flap-radius': toCssUnit(tileRadius),
    '--split-flap-gap': toCssUnit(gap),
    '--split-flap-font-size': toCssUnit(fontSize),
    '--split-flap-flip-duration': `${Math.max(0.04, Number(flipDuration) || 0.12)}s`,
    ...style,
  } as CSSProperties

  return (
    <div
      className={`split-flap-text ${className}`.trim()}
      style={componentStyle}
      role="text"
      aria-label={settledText || undefined}
      {...props}
    >
      {tiles.map((tile, index) => (
        <span
          className="split-flap-text__tile"
          aria-hidden="true"
          key={`${index}-${tiles.length}`}
          data-char={normalizedPhrases[normalizedPhrases.length - 1]?.[index]}
        >
          <span className="split-flap-text__half split-flap-text__half--top">
            <span className="split-flap-text__char">{tile.current === ' ' ? ' ' : tile.current}</span>
          </span>
          <span className="split-flap-text__half split-flap-text__half--bottom">
            <span className="split-flap-text__char">{tile.flipping ? tile.next : tile.current}</span>
          </span>

          {tile.flipping && (
            <>
              <span className="split-flap-text__flap split-flap-text__flap--front" key={`front-${index}-${tile.tick}`}>
                <span className="split-flap-text__char">{tile.current === ' ' ? ' ' : tile.current}</span>
              </span>
              <span className="split-flap-text__flap split-flap-text__flap--back" key={`back-${index}-${tile.tick}`}>
                <span className="split-flap-text__char">{tile.next === ' ' ? ' ' : tile.next}</span>
              </span>
            </>
          )}
        </span>
      ))}
    </div>
  )
}

export default SplitFlapText
