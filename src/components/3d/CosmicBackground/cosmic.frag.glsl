// Cosmic sky + reflective water in one fullscreen pass.
//
// Sky is procedural (gradient atmosphere, hashed star layers, SDF planets) so each
// layer can parallax independently. Water is adapted from the previous portfolio:
// waves live on a virtual ground plane reconstructed from the horizon, so they
// foreshorten naturally, and interactive ripples are expanding wave packets on it.
//
// Injected defines: MAX_RIPPLES, PLANET_COUNT, STAR_LAYERS, RIPPLE_SCALE, QUALITY (0 = low, 1 = high)

precision highp float;

uniform float uTime;
uniform vec2 uRes;                  // CSS px
uniform float uHorizon;             // screen v of the horizon
uniform vec2 uParallax;             // lagged pointer offset, -0.5..0.5
uniform vec4 uRipples[MAX_RIPPLES]; // xy = origin (screen uv), z = start time, w = strength
uniform vec3 uPointer;              // xy = lagged pointer (screen uv), z = energy
uniform vec4 uPlanets[PLANET_COUNT];       // x, y (screen uv at rest), radius px, kind
uniform vec4 uPlanetMotion[PLANET_COUNT];  // rise per viewport, ring tilt, cool tint, seed
uniform float uDescent;                    // viewports scrolled since About entered
uniform float uIntro;
uniform float uTheme;                      // 0 = night (original), 1 = dawn
// Light theme backdrop image (sky + ocean). uDawnReady = 0 until it has loaded.
uniform sampler2D uDawnTex;
uniform float uDawnReady;
const float DAWN_ASPECT = 1905.0 / 825.0;
const float DAWN_HORIZON = 0.2836;          // image v of its horizon (from the bottom)
const vec3 DAWN_ZENITH = vec3(0.122, 0.31, 0.66); // image's top colour, extends the sky upward
// Dawn palette (config/themes.ts → lightScene).
uniform vec3 uLSkyTop;
uniform vec3 uLSkyHigh;
uniform vec3 uLSkyPale;
uniform vec3 uLPlanetRim;
uniform vec3 uLLavender;
uniform vec3 uLCream;
uniform vec3 uLBlush;
uniform vec3 uLGlow;
uniform vec3 uLBg;
uniform vec3 uLCloudShade;
uniform vec3 uLCloudBody;
uniform vec3 uLCloudLit;
uniform vec3 uLCloudWarm;
uniform vec3 uLPlanetDark;
uniform vec3 uLPlanetLit;
uniform vec3 uLPlanetRing;
uniform vec3 uLWaterNear;
uniform vec3 uLWaterMid;
uniform vec3 uLWaterFar;
uniform vec3 uLWaterGlint;

varying vec2 vUv;

const vec3 BG0 = vec3(0.020, 0.020, 0.043); // #05050B
const vec3 BG1 = vec3(0.027, 0.027, 0.067); // #070711
const vec3 BG2 = vec3(0.039, 0.035, 0.082); // #0A0915
const vec3 NAVY = vec3(0.067, 0.063, 0.145); // #111025
const vec3 P1 = vec3(0.141, 0.102, 0.271);   // #241A45
const vec3 P2 = vec3(0.208, 0.129, 0.373);   // #35215F
const vec3 P3 = vec3(0.294, 0.165, 0.451);   // #4B2A73
const vec3 LAV = vec3(0.655, 0.545, 0.980);  // #A78BFA

const float LIGHT_X = 0.86;     // faint light on the horizon, right of centre
const float PLANE_SCALE = 0.09;
const float WAVE_SPEED = 0.16;

// ---------------------------------------------------------------- noise
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Value noise with analytic derivatives: x = value, yz = gradient.
vec3 noised(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  vec2 du = 6.0 * f * (1.0 - f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  float k1 = b - a;
  float k2 = c - a;
  float k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y,
              du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}

// ---------------------------------------------------------------- sky
// Atmosphere only (no stars): also what the water reflects.
vec3 atmosphereNight(vec2 uv, float aspect, float t) {
  float h = uv.y - uHorizon;
  vec3 col = mix(BG2, BG0, smoothstep(0.0, 0.55, h));

  // Faint purple wash bleeding in from the left edge.
  col += P1 * 0.28 * exp(-uv.x / 0.16) * smoothstep(-0.05, 0.25, h) * smoothstep(0.75, 0.2, h);
  // Cool, barely-there blue pocket in the middle sky.
  vec2 c = (uv - vec2(0.43, uHorizon + 0.24)) * vec2(aspect, 1.0);
  col += vec3(0.004, 0.014, 0.020) * exp(-dot(c, c) / 0.04);
  // Purple light pooling above the horizon on the right.
  vec2 l = (uv - vec2(LIGHT_X, uHorizon)) * vec2(aspect * 0.55, 1.4);
  col += P3 * 0.22 * exp(-length(l) / 0.16);
  // Horizon haze.
  col += P1 * 0.22 * exp(-abs(h) / 0.028);
  col += LAV * 0.05 * exp(-abs(h) / 0.004) * exp(-pow((uv.x - LIGHT_X) * aspect / 0.22, 2.0));

  // Very slow drifting veil so the sky breathes.
  float veil = noised(uv * vec2(aspect * 2.2, 3.0) + vec2(t * 0.012, 0.0)).x;
  col += P1 * 0.05 * veil * smoothstep(0.6, 0.0, h);
  return col;
}

// Dawn: cream and blush at the horizon, lavender through the middle, soft blue above;
// calmer and paler further down the page.
const float SUN_X = 0.42;
// Screen uv → image uv. The image covers the screen and its horizon follows uHorizon
// while the water drains, then rests at the bottom edge: the dawn sky (sunrise glow
// along the bottom, blue above) stays as the backdrop for the rest of the page.
vec3 dawnImage(vec2 uv, float aspect) {
  float imgH = max(1.12, aspect / DAWN_ASPECT);       // image height in screen heights
  float imgW = imgH * DAWN_ASPECT / aspect;           // image width in screen widths
  float hs = max(uHorizon, -0.02);
  vec2 iuv = vec2(0.5 + (uv.x - 0.5) / imgW, DAWN_HORIZON + (uv.y - hs) / imgH);
  iuv.x = clamp(iuv.x, 0.001, 0.999);
  vec3 c = texture2D(uDawnTex, vec2(iuv.x, clamp(iuv.y, 0.001, 0.995))).rgb;
  // Above the image: continue its zenith blue (no stretched streaks).
  c = mix(c, DAWN_ZENITH, smoothstep(0.93, 1.02, iuv.y));
  // Past the Hero the sky is lifted only very slightly; it should stay clear, not foggy.
  return mix(c, vec3(0.84, 0.86, 0.95), 0.1 * smoothstep(0.8, 2.0, uDescent));
}

vec3 atmosphereDawnProcedural(vec2 uv, float aspect, float t) {
  float h = uv.y - uHorizon;
  float hero = 1.0 - smoothstep(0.6, 2.2, uDescent);
  // Defined vertical grade: horizon cream → lavender → soft blue → cool blue top.
  float y = clamp(h / max(1.0 - uHorizon, 0.45), 0.0, 1.0);
  vec3 col = mix(mix(uLCream, uLBlush, 0.15), uLLavender, smoothstep(0.0, 0.16, y));
  col = mix(col, uLSkyPale, smoothstep(0.08, 0.3, y));
  col = mix(col, uLSkyHigh, smoothstep(0.25, 0.55, y));
  col = mix(col, uLSkyTop, smoothstep(0.5, 0.9, y));
  // Darker, cooler top corners vignette the frame (photographic grade).
  vec2 vq = (uv - vec2(0.5, 0.35)) * vec2(1.0, 1.25);
  col *= 1.0 - 0.1 * smoothstep(0.35, 0.9, length(vq));
  // Blush only as a thin band on the horizon.
  col = mix(col, uLBlush, exp(-abs(h) / 0.035) * 0.28);
  // The brightest area: a warm sunrise bloom low on the horizon.
  vec2 sg = (uv - vec2(SUN_X, uHorizon)) * vec2(aspect * 0.42, 1.6);
  col = mix(col, uLGlow, exp(-length(sg) / 0.1) * 0.6 * hero);
  col = mix(col, uLCream, exp(-length(sg) / 0.32) * 0.25 * hero);
  // Below the Hero the sky settles to a calm, even blue-lavender.
  float lowY = clamp(uv.y, 0.0, 1.0);
  vec3 calm = mix(mix(uLLavender, uLSkyPale, 0.55), uLSkyHigh, smoothstep(0.0, 1.0, lowY) * 0.6);
  calm = mix(calm, uLCream, exp(-lowY / 0.18) * 0.18);
  col = mix(calm, col, hero);
  float veil = noised(uv * vec2(aspect * 2.2, 3.0) + vec2(t * 0.012, 0.0)).x;
  return col + (veil - 0.5) * 0.012;
}

vec3 atmosphereDawn(vec2 uv, float aspect, float t) {
  // The image is the environment for the whole page (planets move over it).
  float img = uDawnReady;
  vec3 c = vec3(0.0);
  vec3 p = vec3(0.0);
  if (img > 0.001) c = dawnImage(uv, aspect);
  if (img < 0.999) p = atmosphereDawnProcedural(uv, aspect, t);
  return mix(p, c, img);
}

vec3 atmosphere(vec2 uv, float aspect, float t) {
  // Only the active palette is evaluated (both during a crossfade).
  vec3 night = vec3(0.0);
  vec3 dawn = vec3(0.0);
  if (uTheme < 0.999) night = atmosphereNight(uv, aspect, t);
  if (uTheme > 0.001) dawn = atmosphereDawn(uv, aspect, t);
  return mix(night, dawn, uTheme);
}

float starLayer(vec2 px, float cell, float density, float seed, float maxSize, float t) {
  vec2 g = px / cell;
  vec2 id = floor(g);
  float h = hash12(id + seed);
  if (h > density) return 0.0;
  vec2 pos = vec2(hash12(id + seed + 3.1), hash12(id + seed + 7.7)) * 0.8 + 0.1;
  vec2 d = (fract(g) - pos) * cell;
  float size = mix(0.35, maxSize, pow(hash12(id + seed + 11.0), 3.0));
  float bright = mix(0.12, 0.9, pow(hash12(id + seed + 5.0), 2.6));
  float twinkle = 0.78 + 0.22 * sin(t * mix(0.25, 0.9, h / density) + h * 61.0);
  return bright * twinkle * exp(-dot(d, d) / (size * size));
}

vec3 stars(vec2 px, float h, float t, float safe) {
  vec3 tint = vec3(0.86, 0.84, 1.0);
  float s = starLayer(px + uParallax * 4.0 - vec2(0.0, uDescent * 18.0), 31.0, 0.42, 1.0, 1.0, t) * 0.75;
  s += starLayer(px + uParallax * 9.0 - vec2(0.0, uDescent * 34.0), 74.0, 0.42, 17.0, 1.3, t) * safe;
#if STAR_LAYERS > 2
  s += starLayer(px + uParallax * 16.0 - vec2(0.0, uDescent * 60.0), 173.0, 0.32, 41.0, 1.6, t) * safe;
#endif
  return tint * s * 1.7 * smoothstep(0.0, 0.14, h) * (1.0 - mix(0.65, 0.85, uDawnReady) * uTheme);
}

// Distant bodies. Each rises at its own speed as the page descends (depth parallax),
// so planets leave at the top and new ones drift in from below.
vec3 planets(vec3 col, vec2 px) {
  for (int i = 0; i < PLANET_COUNT; i++) {
    vec4 pl = uPlanets[i];        // x, y at rest, radius px, kind
    vec4 mo = uPlanetMotion[i];   // rise per viewport, ring tilt, cool tint, band seed
    float r = pl.z;
    vec2 centre = vec2(pl.x, pl.y + uDescent * mo.x) * uRes - uParallax * (14.0 + r * 0.6);
    vec2 q = px - centre;
    float d = length(q);
    if (d > r * 3.2) continue;

    float kind = pl.w;
    float disc = smoothstep(r + 0.7, r - 0.7, d);
    vec3 n = vec3(q / r, sqrt(max(0.0, 1.0 - dot(q, q) / (r * r))));
    vec3 lightDir = kind > 2.5 ? normalize(vec3(-0.35, 0.3, -0.88)) : normalize(vec3(0.75, -0.25, 0.45));
    float lit = max(dot(n, lightDir), 0.0);
    vec3 litColor = mix(vec3(0.25, 0.22, 0.48), vec3(0.17, 0.27, 0.44), mo.z);
    vec3 body = mix(mix(BG0, P1, 0.45), litColor, pow(lit, 1.3)); // night side stays just readable

    // Gas giant: soft, slightly warped latitude bands.
    if (kind > 1.5 && kind < 2.5) {
      float band = sin(q.y / r * 13.0 + sin(q.x / r * 2.5 + mo.w) * 0.9 + mo.w * 3.0);
      body *= 0.82 + 0.22 * band;
    }

    float limb = exp(-abs(d - r) / 1.1) * (0.35 + 0.65 * lit);
    // Back-lit crescent: only a thin edge of light on the far side.
    if (kind > 2.5) {
      float side = max(dot(normalize(q), normalize(vec2(-0.35, 0.3))), 0.0);
      limb = exp(-abs(d - r) / 0.9) * pow(side, 2.5) * 1.6;
    }

    // Thin tilted ring: the near half is drawn over the body, the far half behind it.
    float ring = 0.0;
    if (kind > 0.5 && kind < 1.5) {
      float a = mo.y;
      vec2 rq = mat2(cos(a), sin(a), -sin(a), cos(a)) * q;
      float e = length(rq * vec2(1.0, 4.5)) - r * 2.1;
      ring = exp(-e * e / 0.6) * 0.55;
      ring *= rq.y < 0.0 ? 1.0 : (1.0 - disc);
    }
    vec3 night = mix(col, body, disc) + P3 * 0.85 * limb + vec3(0.38, 0.33, 0.62) * ring;
    vec3 litDawn = mix(uLPlanetDark, uLPlanetLit, pow(lit, 0.9));
    if (kind > 1.5 && kind < 2.5) {
      litDawn *= 0.9 + 0.12 * sin(q.y / r * 13.0 + sin(q.x / r * 2.5 + mo.w) * 0.9 + mo.w * 3.0);
    }
    vec3 dawn = mix(mix(col, litDawn, disc), uLPlanetRing, ring * 0.85);
    dawn = mix(dawn, uLPlanetRim, clamp(limb * (0.35 + 0.65 * lit), 0.0, 1.0) * 0.8);
    dawn = mix(col, dawn, 0.88); // atmospheric: a little sky shows through
    // A negative seed marks a night-only planet: it fades out at dawn.
    float vis = mo.w < 0.0 ? 1.0 - uTheme : 1.0;
    col = mix(col, mix(night, dawn, uTheme), vis);
  }
  return col;
}

// ---------------------------------------------------------------- clouds
// Shinkai-style night cumulus: fbm with analytic gradients gives both the shape and
// its lighting in one pass — tops facing the light (upper right) catch a cool
// blue-white glow, undersides sink into deep blue-violet.
const vec3 CLOUD_SHADOW = vec3(0.03, 0.03, 0.08);
const vec3 CLOUD_MID = vec3(0.11, 0.11, 0.24);
const vec3 CLOUD_LIT = vec3(0.42, 0.42, 0.68);
const vec2 CLOUD_LIGHT = vec2(0.42, 0.91);

// x = value, yz = gradient w.r.t. p — from the broad octaves only, so lighting reads as
// soft rounded volumes while the fine octaves just break up the silhouette.
vec3 fbmd(vec2 p, int octaves) {
  float v = 0.0;
  vec2 d = vec2(0.0);
  float a = 0.5;
  mat2 J = mat2(1.0);
  const mat2 M = mat2(1.6, 1.2, -1.2, 1.6); // rotate + scale ×2 between octaves
  vec2 q = p;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    vec3 n = noised(q);
    v += a * n.x;
    if (i < 2) d += a * (transpose(J) * n.yz);
    q = M * q + vec2(1.7, 9.2);
    J = M * J;
    a *= 0.45;
  }
  return vec3(v, d);
}

// Two scales: broad smooth clusters decide where a formation is; warped finer noise
// gives it diffused, wispy, uneven density. Soft alpha everywhere — no hard outlines.
vec3 cloudLayer(vec3 col, vec2 p, float alpha, int octaves, float bank) {
  if (alpha < 0.002) return col;
  vec3 cl = fbmd(p, 2);                        // where formations sit (smooth)
  float th = 0.57 - 0.05 * bank;               // sparse: most of the sky stays empty
  if (cl.x * 0.8 + 0.44 < th) return col;      // clear sky: skip the detailed pass
  vec2 w = vec2(noised(p * 1.3 + 11.0).x, noised(p * 1.3 - 5.0).x) - 0.5;
  vec3 lp = fbmd(p * 3.0 + w * 1.2 + vec2(5.2, 1.3), octaves);
  float f = cl.x * 0.8 + lp.x * 0.5;
  // Wide, diffused falloff instead of a painted edge.
  float dens = smoothstep(th, th + 0.16, f);
  // Internal variation: wisps, thin patches and gaps.
  dens *= 0.5 + 0.5 * noised(p * 8.0 + w * 3.0).x;
  if (dens < 0.003) return col;
  vec2 g = cl.yz * 0.8 + lp.yz * 1.5;
  float lit = clamp(dot(-normalize(g + 1e-4), CLOUD_LIGHT) * 0.5 + 0.5, 0.0, 1.0);
  float core = smoothstep(th + 0.1, th + 0.36, f);
  vec3 c = mix(CLOUD_SHADOW, CLOUD_MID, 0.3 + 0.7 * lit);
  c = mix(c, CLOUD_SHADOW * 0.6, core * 0.55);  // darker, denser cores
  // Soft lavender light on the side facing the light, fading into the body.
  c += CLOUD_LIT * pow(lit, 2.5) * (1.0 - core) * 0.42;
  return mix(col, c, dens * alpha);
}

// Dawn cumulus: billowy outlines from strong lumps, each puff shaded from its own
// normal; lit from the low sun so edges facing it glow peach and cream, with
// blue-violet shadows — the sunset clouds of the reference.
vec3 cumulusDawn(vec3 col, vec2 p, float alpha, int octaves, float bias, vec2 L, float warm) {
  if (alpha < 0.002) return col;
  vec3 cl = fbmd(p, 2);
  // High threshold: only the strongest clusters become cloud — most of the sky stays clear.
  float th = 0.685 - bias;
  if (cl.x * 0.62 + 0.6 < th) return col;
  vec3 lp = fbmd(p * 4.2 + vec2(5.2, 1.3), octaves);
  float f = cl.x * 0.62 + lp.x * 0.6;
  float dens = smoothstep(th, th + 0.07, f);
  dens *= 0.7 + 0.3 * noised(p * 8.0 + 3.7).x;   // thin patches inside each formation
  if (dens < 0.003) return col;
  vec2 g = cl.yz * 0.62 + lp.yz * 4.2 * 0.6;
  float lit = clamp(dot(-normalize(g + 1e-4), L) * 0.5 + 0.5, 0.0, 1.0);
  float depth = smoothstep(th, th + 0.32, f);
  // Near-white body with cool lavender-blue shadowing; a faint warm edge toward the sun.
  vec3 c = mix(uLCloudShade, uLCloudBody, smoothstep(0.15, 0.7, lit));
  c = mix(c, uLCloudLit, smoothstep(0.6, 0.95, lit) * (1.0 - 0.4 * depth));
  c = mix(c, uLCloudWarm, warm * smoothstep(0.4, 0.9, lit)); // faint warmth near the sunrise
  c = mix(c, uLCream, (1.0 - smoothstep(th + 0.01, th + 0.07, f)) * smoothstep(0.6, 0.95, lit) * 0.35);
  return mix(col, c, dens * alpha);
}

vec3 clouds(vec3 col, vec2 uv, float aspect, float t, float safe) {
  // Wider than tall, so formations read as drifting banks.
  vec2 base = vec2(uv.x * aspect * 0.7, uv.y * 1.15);
  // A faint bank resting just above the horizon; it sinks away with the water.
  float hb = (uv.y - uHorizon - 0.08) / 0.07;
  float bank = exp(-hb * hb);

  // Keep content clear: the Hero name/portrait, then the content column further down,
  // and let the whole environment grow calmer as the page descends.
  float hero = 1.0 - smoothstep(0.5, 1.2, uDescent);
  vec2 pq = (uv - vec2(0.22, 0.55)) / vec2(0.16, 0.3);
  float portrait = 1.0 - 0.75 * exp(-dot(pq, pq)) * hero;
  vec2 cq = (uv - 0.5) / vec2(0.38, 0.42);
  float content = 1.0 - 0.6 * exp(-dot(cq, cq)) * smoothstep(0.6, 1.4, uDescent);
  float calm = mix(1.0, 0.45, smoothstep(1.5, 7.0, uDescent));

  vec3 night = col;
  vec3 dawn = col;
  if (uTheme < 0.999) {
    float k = safe * safe * portrait * content * calm;
#if QUALITY > 0
    // Background: tiny, almost lost in the dark.
    night = cloudLayer(night, base * 2.6 + vec2(t * 0.004 + 40.0, uDescent * 0.5), 0.1 * k, 3, bank);
    // Midground: smaller, lower opacity.
    night = cloudLayer(night, base * 1.6 + vec2(t * 0.006 + 17.0, uDescent * 0.58), 0.22 * k, 3, bank);
    const int NEAR_OCTAVES = 4;
    const float NEAR_ALPHA = 0.46;
#else
    const int NEAR_OCTAVES = 3; // mobile: one soft layer only
    const float NEAR_ALPHA = 0.32;
#endif
    // Foreground: larger, softest, slightly more visible, very slow.
    night = cloudLayer(night, base * 0.95 + vec2(t * 0.008 - 9.0, uDescent * 0.66), NEAR_ALPHA * k, NEAR_OCTAVES, bank);
  }
  if (uTheme > 0.001) {
    // Dawn: fuller cumulus massed toward the sides of the Hero, clear sky between,
    // easing off the name and growing sparser further down the page.
    float kd = mix(1.0, safe, 0.6) * mix(1.0, portrait, 0.5) * content * mix(1.0, 0.55, smoothstep(1.5, 7.0, uDescent));
    float sides = pow(clamp(abs(uv.x - 0.5) * 2.0, 0.0, 1.0), 2.0);
    // Full sky in the Hero; noticeably sparser once the content sections begin.
    // A few large formations toward the sides of the Hero, clear sky through the middle;
    // sparser still once the content sections begin.
    // Formations sit toward the upper corners and edges; the middle and the name stay clear.
    vec2 nq = (uv - vec2(0.7, 0.55)) / vec2(0.3, 0.2);
    float nameClear = exp(-dot(nq, nq)) * hero;
    float bias = 0.06 * sides * hero + 0.04 * smoothstep(0.5, 1.0, uv.y) * hero
               - 0.12 * nameClear - 0.06 * (1.0 - hero);
    vec2 L = normalize(vec2(SUN_X, uHorizon) - uv + vec2(0.0, 1e-3));
    float warm = 0.0;
    if (uDawnReady > 0.5) {
      // Over the dawn image: one atmosphere for the whole page, a little lighter once
      // the content sections begin (the centre column is also eased by 'content').
      kd *= mix(1.0, 0.8, smoothstep(0.4, 1.5, uDescent));
      // Uneven coverage: a slow regional field — drifting with scroll, so each part of
      // the page has its own clear and clustered areas — plus a band above the horizon.
      // Coverage field travels with the clouds (same scroll rate as the near layer).
      float region = noised(uv * vec2(aspect * 0.9, 1.4) + vec2(7.3, 2.1 + uDescent * 0.85)).x;
      float hz = (uv.y - uHorizon - 0.07) / 0.06;
      bias = 0.085 + 0.13 * (region - 0.5) + 0.09 * exp(-hz * hz) - 0.12 * nameClear;
      warm = 0.35 * exp(-max(uv.y - uHorizon, 0.0) / 0.18);
    }
    if (kd > 0.002) {
      // Continuous morphing: a slow warp field evolving with time and scroll, so shapes
      // swell, thin and re-form instead of sliding past unchanged.
      // Gentle shape evolution over time only; scroll motion matches the dark clouds exactly.
      float ev = t * 0.012;
      vec2 morph = vec2(noised(base * 0.7 + vec2(ev, 3.1)).x, noised(base * 0.7 + vec2(-ev, 8.4)).x) - 0.5;
#if QUALITY > 0
      dawn = cumulusDawn(dawn, base * 2.6 + morph * 0.2 + vec2(t * 0.004 + 40.0, uDescent * 0.5), 0.28 * kd, 3, bias + 0.03, L, warm);
      dawn = cumulusDawn(dawn, base * 1.6 + morph * 0.25 + vec2(t * 0.006 + 17.0, uDescent * 0.58), 0.62 * kd, 4, bias, L, warm);
      const int DAWN_OCTAVES = 5;
#else
      const int DAWN_OCTAVES = 3; // mobile: one layer
#endif
      dawn = cumulusDawn(dawn, base * 0.95 + morph * 0.3 + vec2(t * 0.008 - 9.0, uDescent * 0.66), min(0.92, 1.0 * kd), DAWN_OCTAVES, bias - 0.02, L, warm);
    }
  }
  return mix(night, dawn, uTheme);
}

// ---------------------------------------------------------------- water plane
vec2 toPlane(vec2 uv, float aspect) {
  float d = max(uHorizon - uv.y, 0.004);
  return vec2((uv.x - 0.5) * aspect, 1.0) * (PLANE_SCALE / d);
}

void addWave(inout vec2 g, vec2 p, vec2 dir, float k, float slope, float phase, float t) {
  dir = normalize(dir);
  float omega = sqrt(9.8 * k) * WAVE_SPEED; // deep-water dispersion
  g += dir * slope * cos(dot(dir, p) * k - omega * t + phase);
}

// Surface slope (gradient of the height field) at plane position p.
vec2 waveSlope(vec2 p, float t, float lod) {
  vec2 w = p + 0.10 * vec2(sin(p.y * 1.7 + t * 0.21), sin(p.x * 1.3 - t * 0.17));
  vec2 g = vec2(0.0);
  addWave(g, w, vec2(0.12, 1.0), 17.0, 0.30, 0.0, t);
  addWave(g, w, vec2(-0.35, 1.0), 26.0, 0.24, 1.7, t);
  addWave(g, w, vec2(0.55, 1.0), 39.0, 0.19, 4.1, t);
  addWave(g, w, vec2(-0.9, 0.55), 58.0, 0.13 * lod, 2.3, t);
#if QUALITY > 0
  addWave(g, w, vec2(1.0, 0.3), 87.0, 0.10 * lod, 5.2, t);
  addWave(g, w, vec2(0.05, 1.0), 131.0, 0.07 * lod, 0.9, t);
#endif
  g += noised(w * vec2(9.0, 15.0) + vec2(t * 0.13, t * 0.45)).yz * 0.12;
#if QUALITY > 0
  g += noised(w * vec2(23.0, 37.0) - vec2(t * 0.3, t * 0.8)).yz * 0.06 * lod;
#endif
  return g;
}

// Interactive ripples: soft expanding wave packets on the water plane.
vec2 rippleSlope(vec2 p, float t, float aspect) {
  vec2 g = vec2(0.0);
  for (int i = 0; i < MAX_RIPPLES; i++) {
    vec4 r = uRipples[i];
    float age = t - r.z;
    if (r.w <= 0.0 || age < 0.0 || age > 5.0) continue;
    vec2 delta = p - toPlane(r.xy, aspect);
    float dist = length(delta);
    float front = age * 0.11 * RIPPLE_SCALE;
    float width = (0.03 + age * 0.035) * RIPPLE_SCALE;
    float x = (dist - front) / width;
    float env = exp(-x * x) * exp(-age * 0.8) * r.w * smoothstep(0.0, 0.12, age);
    g += (delta / max(dist, 1e-4)) * sin((dist - front) * 80.0 / RIPPLE_SCALE) * env * 2.0;
  }
  return g;
}

// Lagging cursor: a soft dimple that pushes the surface around, no visible ring.
vec2 pointerSlope(vec2 p, float t, float aspect) {
  if (uPointer.z < 0.002) return vec2(0.0);
  vec2 delta = p - toPlane(uPointer.xy, aspect);
  float r2 = dot(delta, delta);
  float fall = exp(-r2 / (0.012 * RIPPLE_SCALE * RIPPLE_SCALE));
  float wobble = sin(sqrt(r2) * 55.0 / RIPPLE_SCALE - t * 3.0);
  return delta * fall * (6.0 + 3.0 * wobble) * uPointer.z;
}

// ---------------------------------------------------------------- main
void main() {
  float t = uTime;
  float aspect = uRes.x / uRes.y;
  vec2 uv = vUv;
  vec2 px = uv * uRes;
  float d = uHorizon - uv.y;            // > 0 below the horizon

  vec3 col = vec3(0.0);
  if (d < 0.006) {
    // -------- sky
    // Keep the future heading area calm: dim the brighter star layers there.
    vec2 sq = (uv - vec2(0.38, uHorizon + 0.12)) / vec2(0.36, 0.2);
    float safe = mix(1.0, 0.45, exp(-dot(sq, sq)));
    col = atmosphere(uv, aspect, t);
    col += stars(px, -d, t, safe);
    col = planets(col, px);
    col = clouds(col, uv, aspect, t, mix(1.0, safe, 0.8));
  }

  if (d > -0.006) {
    // -------- water
    vec2 p = toPlane(uv, aspect);
    float lod = smoothstep(0.0, 0.07, d);
    vec2 rg = rippleSlope(p, t, aspect) + pointerSlope(p, t, aspect);
    vec2 g = waveSlope(p, t, lod) + rg;
    float dd = max(d, 0.0);
    float near = smoothstep(0.0, 0.05, dd);
    float depth01 = clamp(dd / uHorizon, 0.0, 1.0);

    // Mirror of the sky: squeezed vertically (rough water stretches reflections)
    // and pushed sideways by the waves.
    float meander = noised(vec2(dd * 22.0, t * 0.2)).x - 0.5;
    vec2 m = vec2(uv.x + g.x * dd * 0.22 + meander * dd * 0.04,
                  uHorizon + 0.002 + dd * 0.32 + g.y * dd * 0.05);
    vec3 refl = atmosphere(m, aspect, t);
    float fresnel = mix(0.7, 0.22, depth01);
    vec3 water = mix(BG1, BG0 * 0.6, smoothstep(0.0, 1.0, depth01)) + (refl - BG1) * fresnel;

    // Thin horizontal sheen: facets tilted toward the viewer catch the sky light.
    float facing = dot(g, vec2(0.18, -1.0));
    float dx = (uv.x - LIGHT_X) * aspect;
    float columnW = 0.06 + dd * 0.9;
    float column = exp(-dx * dx / (columnW * columnW));
    float sheen = smoothstep(0.2, 0.85, facing);
    water += P2 * sheen * (0.16 + 0.12 * column) * near * mix(1.0, 0.6, depth01);
    water += mix(NAVY, P1, 0.5) * max(facing, 0.0) * 0.3 * near;
    water *= 1.0 - 0.35 * smoothstep(0.0, -0.6, facing) * near; // troughs fall into shadow
    // Sparse lavender glints in the light's column.
    float glint = smoothstep(0.55, 1.0, facing) * near;
    water += LAV * glint * column * 0.16 * mix(1.0, 0.4, depth01);
    // Disturbed water catches a little more light, without changing its hue.
    water += P2 * smoothstep(0.1, 1.2, dot(rg, vec2(0.25, -1.0))) * 0.06 * near;

    // Foreground falls off into darkness.
    water *= mix(1.0, 0.55, smoothstep(0.4, 1.0, depth01));

    if (uTheme > 0.001) {
      // Dawn water: pale at the horizon, deepening to cool blue toward the viewer, with
      // horizontal ripple bands; cream/blush reflections only near the horizon.
      float wd = smoothstep(0.0, 1.0, depth01);
      vec3 dawn = mix(uLWaterFar, uLWaterMid, smoothstep(0.0, 0.35, wd));
      dawn = mix(dawn, uLWaterNear, smoothstep(0.3, 1.0, wd));
      dawn *= mix(1.0, 0.9, smoothstep(0.5, 1.0, wd));                 // foreground falls off
      // Mirrored sky glow, strongest just below the horizon.
      float nearH = exp(-dd / 0.05);
      dawn = mix(dawn, refl, 0.28 * nearH);
      dawn = mix(dawn, uLBlush, nearH * 0.12);
      // Ripple structure: facets toward the light lift, troughs sink.
      dawn *= 1.0 + 0.07 * clamp(facing, -1.0, 1.0) * near;
      dawn += (uLLavender - dawn) * sheen * 0.18 * near;
      float sx = (uv.x - SUN_X) * aspect;
      float sunCol = exp(-sx * sx / pow(0.06 + dd * 0.7, 2.0));
      dawn = mix(dawn, uLWaterGlint, glint * sunCol * 0.7 * mix(1.0, 0.2, wd));
      dawn += (uLLavender - dawn) * smoothstep(0.1, 1.2, dot(rg, vec2(0.25, -1.0))) * 0.12 * near;
      if (uDawnReady > 0.5) {
        // The image's ocean, moved exactly like the dark water: the same wave field
        // displaces it with the dark mirror's strengths (sideways sway + depth meander),
        // and wave facets lift/darken it into the same slow travelling bands.
        vec2 disp = vec2(g.x * dd * 0.22 + meander * dd * 0.04, g.y * dd * 0.05) * near;
        dawn = dawnImage(uv + disp, aspect);
        dawn *= 1.0 + 0.1 * clamp(facing, -1.0, 1.0) * near;
        dawn *= 1.0 - 0.18 * smoothstep(0.0, -0.6, facing) * near;   // troughs, as in dark
        dawn = mix(dawn, uLLavender, sheen * 0.14 * near);
        float sx2 = (uv.x - 0.5) * aspect;
        dawn = mix(dawn, uLWaterGlint, glint * 0.25 * exp(-sx2 * sx2 / pow(0.25 + dd, 2.0)) * mix(1.0, 0.3, depth01));
        dawn += (vec3(1.0, 0.97, 0.92) - dawn) * smoothstep(0.1, 1.2, dot(rg, vec2(0.25, -1.0))) * 0.08 * near;
      }
      water = mix(water, dawn, uTheme);
    }

    float wm = smoothstep(-0.006, 0.006, d);
    col = d < 0.006 ? mix(col, water, wm) : water;
  }

  // Shared haze softens the seam so the horizon reads as atmosphere, not a line.
  col += mix(P1 * 0.07, uLBlush * 0.04, uTheme) * exp(-abs(d) / 0.012);

  col = mix(uLBg * uTheme, col, smoothstep(0.0, 1.0, uIntro));
  col += (hash12(gl_FragCoord.xy + fract(t) * 91.0) - 0.5) / 255.0; // dither: no banding
  gl_FragColor = vec4(col, 1.0);
}
