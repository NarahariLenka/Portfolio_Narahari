/**
 * Pluggable (layer) animations. To add one — see src/animations/README.md:
 *
 *   1. Create src/animations/modules/<yourId>/definition.ts (copy _template/definition.ts)
 *      and Component.tsx next to it.
 *   2. Import the definition here and add it to LAYER_ANIMATIONS.
 *
 * That's all: it is then listed in the admin, off by default, and configurable.
 */
import type { AnyAnimationDefinition } from '../types'

export const LAYER_ANIMATIONS: readonly AnyAnimationDefinition[] = []
