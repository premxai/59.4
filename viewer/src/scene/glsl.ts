// Shared GLSL snippets.
export const GLSL_COMMON = /* glsl */ `
#define MAX_REGIONS 8
uniform vec2 uRegionXZ[MAX_REGIONS];
uniform float uRegionT[MAX_REGIONS];
uniform float uRegionSnow[MAX_REGIONS];
uniform float uRegionSnowing[MAX_REGIONS];
uniform int uRegionCount;

vec3 idw3(vec2 p) {
  // x = temp, y = snow depth, z = snowfall rate
  float ws = 0.0; vec3 acc = vec3(0.0);
  for (int i = 0; i < MAX_REGIONS; i++) {
    if (i >= uRegionCount) break;
    vec2 d = p - uRegionXZ[i];
    float w = 1.0 / (dot(d, d) + 25.0);
    ws += w;
    acc += w * vec3(uRegionT[i], uRegionSnow[i], uRegionSnowing[i]);
  }
  return ws > 0.0 ? acc / ws : vec3(10.0, 0.0, 0.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
// Nearest jittered cell id (organic "neighborhood" patches).
vec2 worleyCell(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float best = 1e9; vec2 cell = i;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(i + g) * 0.85 + 0.075;
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < best) { best = d; cell = i + g; }
  }
  return cell;
}
`;
