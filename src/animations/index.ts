/**
 * Animation Registry — public entry. Importing this module registers every animation.
 * See README.md in this folder for how to add one.
 */
import { BUILTIN_ANIMATIONS } from './builtin'
import { LAYER_ANIMATIONS } from './modules'
import { registerAnimations } from './registry'

registerAnimations([...BUILTIN_ANIMATIONS, ...LAYER_ANIMATIONS])

export { describeAnimations, isConfigurable, parseAnimationConfig, prepareAnimationConfigForSave, DEFAULT_ANIMATION_CONFIG, GLOBAL_LIMITS } from './config'
export type { AnimationConfig, StoredAnimation } from './config'
export { getAnimation, listAnimations, definitionProblems, sanitizeDefinition } from './registry'
export {
  anyLayerEnabled,
  currentDevice,
  getAnimationSettings,
  guardAnimation,
  reportAnimationError,
  setAnimationConfig,
  subscribeAnimationConfig,
  useAnimation,
} from './runtime'
export { default as AnimationBoundary } from './AnimationBoundary'
export type * from './types'
