/**
 * Mounts every registered, enabled LAYER animation in its placement. Renders nothing
 * while no layer animation is registered/enabled, so today's page is untouched.
 *
 * Isolation: each animation gets its own click-through layer, its own lazy chunk,
 * its own Suspense and its own error boundary. Layers never change layout.
 */
import { lazy, Suspense, type ReactNode, useMemo, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { createPortal } from 'react-dom'
import type { SectionSlug } from '../data/remote'
import { listAnimations } from './registry'
import AnimationBoundary from './AnimationBoundary'
import { useAnimation } from './runtime'
import type { AnyAnimationDefinition, AnimationProps } from './types'
import './animations.css'

// One lazy component per definition, created once.
const lazyCache = new Map<string, LazyExoticComponent<ComponentType<AnimationProps>>>()
const lazyFor = (def: AnyAnimationDefinition) => {
  let c = lazyCache.get(def.id)
  if (!c) lazyCache.set(def.id, (c = lazy(def.load as () => Promise<{ default: ComponentType<AnimationProps> }>)))
  return c
}

// AnimationLayers is lazy-loaded after the first render, so section elements exist by
// the time it looks them up. A hidden section has no element and gets no layer.
function SectionPortal({ slug, children }: { slug: SectionSlug; children: ReactNode }) {
  const [el] = useState(() => document.getElementById(slug))
  return el ? createPortal(children, el) : null
}

function Layer({ def }: { def: AnyAnimationDefinition }) {
  const anim = useAnimation(def.id)
  const Comp = useMemo(() => lazyFor(def), [def])
  if (!anim.active || !anim.placement) return null

  const render = (section: SectionSlug | null) => (
    <div key={section ?? 'page'} className={`anim-layer anim-layer--${anim.placement}`} data-animation={def.id} aria-hidden="true">
      <AnimationBoundary id={def.id}>
        <Suspense fallback={null}>
          <Comp params={anim.params} device={anim.device} reducedMotion={anim.reducedMotion} placement={anim.placement!} section={section} />
        </Suspense>
      </AnimationBoundary>
    </div>
  )

  if (anim.placement.startsWith('page-')) return render(null)
  return (
    <>
      {anim.sections.map((slug) => (
        <SectionPortal key={slug} slug={slug}>
          {render(slug)}
        </SectionPortal>
      ))}
    </>
  )
}

export default function AnimationLayers() {
  const layers = useMemo(() => listAnimations().filter((d) => d.kind === 'layer' && d.load), [])
  return (
    <>
      {layers.map((def) => (
        <Layer key={def.id} def={def} />
      ))}
    </>
  )
}
