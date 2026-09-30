// Screen-space paths retain a Gaussian anchor and its existing sorted draw order.
// Six segments are enough for readable curvature without tessellating every splat.
export const ribbonVaryings = `
varying vec4 ribbonLeft;
varying vec4 ribbonRight;
varying vec4 ribbonEnds;
varying vec4 ribbonInfo;
varying vec2 ribbonAnchor;
varying vec2 ribbonPixel;
`;

export const ribbonTraceGLSL = `
uniform sampler2D guideMap;
uniform sampler2D guideReference;
uniform sampler2D guideColor;
uniform vec2 ribbonViewport;
vec4 ribbonReference(vec2 uv) {
  vec4 p = texture2D(guideReference, uv);
  return vec4(p.rgb / max(p.a, 0.001), p.a);
}
vec3 ribbonColor(vec2 uv) {
  vec4 p = texture2D(guideColor, uv);
  return p.rgb / max(p.a, 0.001);
}
vec2 advanceRibbon(vec2 anchor, vec2 offset, inout vec2 direction,
                   float stride, vec4 source, vec3 sourceColor, inout bool alive) {
  if (!alive) return offset;
  vec2 uv = anchor + offset / ribbonViewport;
  vec4 flow = texture2D(guideMap, uv);
  vec2 doubled = flow.rg * 2.0 - 1.0;
  if (flow.b < 0.1 || length(doubled) < 0.01) { alive = false; return offset; }
  float angle = 0.5 * atan(doubled.y, doubled.x);
  vec2 tangent = vec2(cos(angle), sin(angle));
  if (dot(tangent, direction) < 0.0) tangent = -tangent;
  if (dot(tangent, direction) < 0.55) { alive = false; return offset; }
  vec2 nextDirection = normalize(mix(direction, tangent, 0.7));
  vec2 next = offset + nextDirection * stride;
  vec2 nextUV = anchor + next / ribbonViewport;
  if (any(lessThan(nextUV, vec2(0.002))) || any(greaterThan(nextUV, vec2(0.998)))) {
    alive = false; return offset;
  }
  // Check the midpoint too: short gaps must not be jumped by one long segment.
  vec2 midUV = anchor + (offset + next) * 0.5 / ribbonViewport;
  vec4 endRef = ribbonReference(nextUV), midRef = ribbonReference(midUV);
  float depthBreak = max(abs(endRef.g-source.g), abs(midRef.g-source.g));
  float colorBreak = max(distance(ribbonColor(nextUV), sourceColor), distance(ribbonColor(midUV), sourceColor));
  if (min(endRef.a, midRef.a) < 0.25 || depthBreak > 0.004 || colorBreak > 0.28) {
    alive = false; return offset;
  }
  direction = nextDirection;
  return next;
}
`;

export const ribbonFragmentGLSL = `
uniform sampler2D guideReference;
uniform vec2 ribbonViewport;
// Closest-point distance plus arc-length parameter gives a continuous textured ribbon.
void ribbonSegment(vec2 point, vec2 a, vec2 b, inout float distanceToPath,
                   inout float closestLength, inout float accumulated) {
  vec2 ab = b-a;
  float segmentLength = length(ab);
  float t = clamp(dot(point-a, ab) / max(dot(ab,ab), 0.0001), 0.0, 1.0);
  float d = length(point - (a + t*ab));
  if (segmentLength > 0.01 && d < distanceToPath) {
    distanceToPath = d;
    closestLength = accumulated + t*segmentLength;
  }
  accumulated += segmentLength;
}
vec3 ribbonCoordinates(vec2 point) {
  float distanceToPath = 1e5, closestLength = 0.0, accumulated = 0.0;
  ribbonSegment(point, ribbonEnds.xy, ribbonLeft.zw, distanceToPath, closestLength, accumulated);
  ribbonSegment(point, ribbonLeft.zw, ribbonLeft.xy, distanceToPath, closestLength, accumulated);
  ribbonSegment(point, ribbonLeft.xy, vec2(0.0), distanceToPath, closestLength, accumulated);
  ribbonSegment(point, vec2(0.0), ribbonRight.xy, distanceToPath, closestLength, accumulated);
  ribbonSegment(point, ribbonRight.xy, ribbonRight.zw, distanceToPath, closestLength, accumulated);
  ribbonSegment(point, ribbonRight.zw, ribbonEnds.zw, distanceToPath, closestLength, accumulated);
  return vec3(closestLength / max(accumulated, 0.001), distanceToPath, accumulated);
}
`;
