// Luminous dust: column, pool, skill spiral and pathways in one Points draw call.
// Column and spiral positions are procedural (from aSeed); pool and pathway
// particles use their baked position. Constants mirror spiral.ts.

attribute vec4 aSeed;  // random 0..1
attribute float aKind; // 0 column, 1 pool, 2 spiral, 3 pathway

uniform float uTime;
uniform float uFlow;      // skill progress (t), moves the ribbon with the labels
uniform float uReveal;    // 0 → 1 as the section enters
uniform float uProjScale; // drawingBufferHeight / (2 tan(fov / 2))
uniform float uSize;
uniform float uTheme;       // 0 = night (original), 1 = dawn
// Dawn DNA palette (config/themes.ts → lightScene).
uniform vec3 uLTerracotta;
uniform vec3 uLMustard;
uniform vec3 uLWarmCream;
uniform vec3 uLTaupe;
uniform vec3 uLBlushPink;
uniform vec3 uLSage;
uniform vec3 uLLavenderSoft;
uniform vec3 uLHelixDeep;
uniform vec3 uLHelixCore;
uniform vec3 uLStrandWarm;
uniform vec3 uLStrandLight;
uniform vec3 uLStrandPink;

varying vec3 vColor;
varying float vAlpha;

const float TAU = 6.2831853;
const float COLUMN_BOTTOM = -2.4;
const float COLUMN_TOP = 3.4;
const float TURNS = 2.2;
const float ACTIVE_S = 0.42;
const float SKILL_GAP = 0.12;
const float PHASE = 1.5707963 - ACTIVE_S * TURNS * TAU;

const vec3 DUST = vec3(0.80, 0.77, 0.96);
const vec3 WHITE = vec3(1.0, 0.98, 1.0);
const vec3 LAVENDER = vec3(0.655, 0.545, 0.980);
const vec3 VIOLET = vec3(0.42, 0.30, 0.78);

vec3 spiralPoint(float s, float phase) {
  float a = s * TURNS * TAU + phase;
  float r = mix(1.75, 0.55, s);
  return vec3(cos(a) * r, mix(COLUMN_BOTTOM + 0.3, COLUMN_TOP - 0.4, s), sin(a) * r);
}

void main() {
  float t = uTime;
  vec3 p = position;
  float size = mix(0.55, 1.9, pow(aSeed.w, 3.0));
  float alpha;
  vec3 color;

  if (aKind < 0.5) {
    // -------- column: wide and diffuse at the base, a thin wavering thread above
    float h = fract(aSeed.x + t * 0.006);
    float spread = mix(1.25, 0.04, pow(h, 0.42)) * pow(aSeed.y, 0.8);
    spread *= 1.0 + 0.07 * sin(t * 0.6 + h * 4.0);                     // breathing
    float a = aSeed.z * TAU + h * 9.0 - t * 0.35;
    vec2 centre = vec2(sin(h * 7.0 + t * 0.5) * 0.22 + sin(h * 13.0 - t * 0.8) * 0.06,
                       cos(h * 6.0 + t * 0.4) * 0.18) * h;
    p = vec3(centre.x + cos(a) * spread, mix(COLUMN_BOTTOM, COLUMN_TOP, h), centre.y + sin(a) * spread);
    float hot = smoothstep(0.55, 1.0, h);
    color = mix(DUST, WHITE, hot);
    alpha = mix(0.1, 0.8, pow(h, 2.2));
    alpha *= 1.0 + hot * 0.3 * sin(t * 9.0 + aSeed.w * 40.0);              // white-hot flicker
    alpha *= smoothstep(0.0, 0.04, h) * smoothstep(1.0, 0.93, h);
    alpha *= smoothstep(h - 0.08, h, uReveal * 1.12);                   // rises as it emerges
    size *= mix(1.0, 0.7, h);
    // Dawn: muted lavender dust rising through blush into a soft cream tip (never a white core).
    // Dawn: warm cream dust column, taupe in its lower body — soft, no white core.
    vec3 dawn = mix(mix(uLTaupe, uLWarmCream, 0.35), uLWarmCream, smoothstep(0.3, 0.9, h));
    color = mix(color, dawn, uTheme);
    alpha *= mix(1.0, 1.05, uTheme);
  } else if (aKind < 1.5) {
    // -------- pool: dust settling around the base, drifting slowly
    float r = length(p.xz);
    float a = atan(p.z, p.x) + t * 0.03 / (0.4 + r);
    p.xz = vec2(cos(a), sin(a)) * r;
    p.y += sin(t * 0.4 + aSeed.x * TAU) * 0.03;
    color = mix(DUST, VIOLET, aSeed.y * 0.6);
    alpha = 0.32 * exp(-r * 0.7) * smoothstep(0.0, 0.3, uReveal);
    size *= 0.8;
    color = mix(color, mix(uLTaupe, uLSage, aSeed.y), uTheme);
  } else if (aKind < 2.5) {
    // -------- spiral ribbon: flows upward with the skills, a fainter second strand
    float s = fract(aSeed.x + uFlow * SKILL_GAP + t * 0.004);
    bool second = aSeed.w > 0.72;
    vec3 c = spiralPoint(s, PHASE + (second ? 2.6 + sin(s * 5.0 + t * 0.2) * 0.6 : 0.0));
    vec3 radial = normalize(vec3(c.x, 0.0, c.z));
    // Breathing, irregular radius so it reads as a stream of energy, not a helix model.
    float swell = 0.16 * sin(s * 7.0 + t * 0.3) + 0.07 * sin(s * 17.0 - t * 0.5 + 1.3);
    float width = mix(0.55, 0.16, s) * (0.6 + 0.4 * sin(s * 11.0 + 2.0));
    float wave = sin(s * 22.0 + t * 0.9 + aSeed.y * 3.0) * 0.06;
    vec3 scatter = vec3(aSeed.y - 0.5, (aSeed.z - 0.5) * 0.7, fract(aSeed.y * 7.31) - 0.5) * width;
    p = c + radial * (swell * length(c.xz) + wave) + scatter;
    color = mix(DUST, LAVENDER, 0.35 + aSeed.z * 0.3);
    float density = 0.55 + 0.45 * sin(s * 9.0 - t * 0.25 + aSeed.w);
    alpha = 0.5 * density * smoothstep(0.0, 0.1, s) * smoothstep(1.0, 0.82, s);
    float alphaNight = alpha * (second ? 0.3 * smoothstep(0.2, 0.6, sin(s * 6.0 + 1.0) * 0.5 + 0.5) : 1.0);
    // Dawn: two continuous intertwined strands — a DNA-like helix.
    // Primary: muted terracotta strand and soft mustard strand, each easing into cream.
    vec3 a0 = mix(second ? uLMustard : uLTerracotta, uLWarmCream, 0.18); // muted
    vec3 dawn = mix(a0, uLWarmCream, smoothstep(0.15, 0.95, s) * (0.5 + 0.5 * aSeed.z));
    // Secondary accents, used sparingly: blush, sage, taupe.
    float pick = fract(aSeed.y * 13.7);
    dawn = mix(dawn, uLBlushPink, step(0.94, pick));
    dawn = mix(dawn, uLSage, step(0.9, pick) * step(pick, 0.94));
    dawn = mix(dawn, uLTaupe, step(0.86, pick) * step(pick, 0.9));
    float highlight = step(0.88, fract(aSeed.z * 7.3));       // ~12% bright highlights
    color = mix(color, dawn, uTheme);
    alpha = mix(alphaNight, alpha * (second ? 0.85 : 1.0) * mix(1.05, 1.7, highlight), uTheme);
    size *= mix(1.0, mix(0.95, 1.3, highlight), uTheme);
    alpha *= uReveal;
  } else {
    // -------- pathways: faint lavender roots with a slow travelling pulse
    color = LAVENDER;
    alpha = 0.16 * (0.55 + 0.45 * sin(aSeed.x * 18.0 - t * 0.8)) * aSeed.y;
    alpha *= smoothstep(0.2, 0.7, uReveal);
    size *= 0.7;
    color = mix(color, uLLavenderSoft, uTheme);
    alpha *= mix(1.0, 1.4, uTheme);
  }

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * size * uProjScale / -mv.z;
  vColor = color;
  vAlpha = alpha * mix(0.45, 1.0, aSeed.z);
}
