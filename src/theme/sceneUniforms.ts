import { Vector3 } from 'three'
import { hexToRgb, lightScene } from '../config/themes'

/** Dawn palette as shader uniforms: lightScene.skyTop → uLSkyTop, etc. */
export function lightSceneUniforms() {
  return Object.fromEntries(
    Object.entries(lightScene).map(([key, hex]) => [
      `uL${key[0].toUpperCase()}${key.slice(1)}`,
      { value: new Vector3(...hexToRgb(hex)) },
    ]),
  )
}
