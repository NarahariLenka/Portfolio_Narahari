varying vec3 vColor;
varying float vAlpha;

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0 || vAlpha < 0.004) discard;
  float a = exp(-d * 3.2) * vAlpha; // soft disc, no hard sprite edge
  gl_FragColor = vec4(vColor * a, a);
}
