# Animation Registry

Every animation the CMS can manage is **registered in code**. Supabase only stores
*settings* for registered ids (`site_settings.animation`) — numbers, booleans and option
names. No JavaScript, shaders or CSS ever go into the database.

```
src/animations/
  types.ts          definition, parameter and props types
  registry.ts       registerAnimations / getAnimation / listAnimations + definition checks
  config.ts         parse + validate CMS settings, resolve per device / reduced motion
  runtime.ts        useAnimation(id), guardAnimation, failure tracking
  AnimationBoundary.tsx  error boundary: a crashing animation disappears alone
  AnimationLayers.tsx  mounts pluggable "layer" animations in their placement
  builtin.ts        the portfolio's existing effects
  modules/          pluggable animations (one folder each) + modules/index.ts list
  modules/_template a copyable starting point (not registered)
```

## Two kinds

| kind | where the code lives | how settings reach it |
|---|---|---|
| `builtin` | inside an existing section component | the component calls `useAnimation(id)` |
| `layer` | its own folder in `modules/` | `AnimationLayers` mounts it with validated `params` |

A builtin with `managed: false` is listed but not yet reading settings (shown as
"always on"). Making it manageable = call `useAnimation(id)` in its component and give
the definition its params.

## Adding a new animation (layer)

1. Copy `modules/_template/` to `modules/<yourId>/`, rename the id, name, params.
2. Build the effect in `Component.tsx`. It receives `{ params, device, reducedMotion,
   placement, section }`, draws inside a click-through layer, and must clean up on
   unmount.
3. Add the definition to `LAYER_ANIMATIONS` in `modules/index.ts`.

It is now in the admin catalogue (`describeAnimations()`), **off by default**, and every
parameter is editable within its declared min/max/options.

## Guarantees

- **Safe defaults:** with no CMS settings every animation runs exactly as coded.
- **Validation:** unknown ids/params are ignored, numbers are clamped and rounded to the
  step, options must be from the list. Parsing never throws.
- **Reduced motion is always honoured:** each definition allows only `off`, `static` or
  `reduced`; there is no "ignore the preference" option.
- **Desktop / mobile:** per-device on/off and per-device parameter values (breakpoint 767px).
- **Isolation:** each layer has its own lazy chunk, Suspense, error boundary and
  click-through layer. A crash (`AnimationBoundary`, or `guardAnimation` around imperative
  setup) switches off only that animation for the visit and logs `[animations] … failed`.
- **Global controls:** `global.enabled`, `speed`, `intensity`, `density`, `duration`
  multiply the params that opt in via `scale`, then clamp to their range.
