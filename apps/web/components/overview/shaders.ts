/* GLSL for the Overview operational field. Everything moves on the GPU:
   the CPU only advances a clock and eases a handful of intensity uniforms. */

// Ashima Arts 3D simplex noise (MIT).
const noise = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

/* A system form: a thick, soft sheet (think fabric drifting in water) lying
   in the xz plane, height along y. The body tilts toward the camera so the
   top surface is visible. All motion is a slow undulation of the sheet. */
const surfaceCommon = /* glsl */ `
${noise}

float radiusAt(float th, float t, float s, vec4 lobe){
  // The silhouette itself drifts: lobes travel round the rim and swell/shrink.
  float swell = 0.75 + 0.45 * sin(t * 0.31 + s);
  return 1.0 + lobe.x * swell * sin(2.0 * th + s + t * 0.45)
    + lobe.y * (1.4 - swell) * sin(3.0 * th + s * 1.7 - t * 0.38)
    + lobe.z * snoise(vec3(cos(th) * 0.9, sin(th) * 0.9, t * 0.35 + s));
}
vec3 sheetAt(float r, float th, float t, float seed, float amp, float puff, vec3 scaling, vec4 lobe){
  float s = seed * 9.0;
  vec2 p = vec2(cos(th), sin(th)) * r * radiusAt(th, t, s, lobe);
  vec2 q = p * scaling.xz;
  float big = snoise(vec3(q * 0.6 + vec2(sin(t * 0.2), cos(t * 0.17)) * 0.6, t * 0.5 + s));
  float detail = snoise(vec3(q * 1.5 + big * 0.5, t * 0.7 + s + 3.1));
  float wave = sin(q.x * 1.7 + t * 1.25 + s) * 0.55 + sin(q.y * 2.3 - t * 0.95 + s * 0.6) * 0.3;
  float dome = (1.0 - r * r) * puff;
  // Rims lift and dip like the edge of a manta or a sheet of cloth.
  float curl = r * r * r * (sin(2.0 * th + s + t * 0.5) * 0.8 + sin(th + s * 2.3 - t * 0.35) * 0.5);
  float h = dome + (big * 0.5 + wave * 0.55 + detail * 0.1) * amp * (0.3 + 0.7 * r) + curl * amp;
  return vec3(q.x, h, q.y);
}
`;

const sheetCommon = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uAmp;
uniform float uPuff;
uniform float uThick;
uniform vec3 uScale;
uniform vec4 uLobe;
attribute vec2 aPolar;
${surfaceCommon}
vec3 sheet(float r, float th, float t){
  return sheetAt(r, th, t, uSeed, uAmp, uPuff, uScale, uLobe);
}
float sheetTime(){ return uTime * 0.3 + uSeed * 17.0; }
`;

export const sheetVertex = /* glsl */ `
${sheetCommon}
varying float vH;
varying float vR;
varying float vFres;
varying float vLight;
void main(){
  float t = sheetTime();
  float r = aPolar.x;
  float th = aPolar.y;
  vec3 P = sheet(r, th, t);
  float e = 0.025;
  vec3 Pr = sheet(min(r + e, 1.0), th, t) - sheet(max(r - e, 0.0), th, t);
  vec3 Pt = sheet(r, th + e / max(r, 0.05), t) - P;
  vec3 n = normalize(cross(Pt, Pr));
  n *= sign(n.y + 1e-4);
  vec3 vn = normalize(normalMatrix * n);
  vFres = pow(1.0 - abs(vn.z), 1.5);
  vLight = clamp(0.35 + 0.65 * dot(n, normalize(vec3(-0.35, 1.0, 0.45))), 0.0, 1.0);
  vH = P.y;
  vR = r;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 1.0);
}`;

export const sheetFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRim;
uniform vec3 uDeep;
uniform float uIntensity;
uniform float uContour;
varying float vH;
varying float vR;
varying float vFres;
varying float vLight;
void main(){
  float edge = smoothstep(1.0, 0.9, vR);
  float rimBand = smoothstep(0.72, 0.97, vR) * edge;
  float k = vH * uContour + vR * 1.4;
  float w = fwidth(k);
  float d = 0.5 - abs(fract(k) - 0.5);
  float line = (1.0 - smoothstep(w * 0.4, w * 1.4, d)) * edge;
  vec3 body = mix(uDeep, uColor, vLight);
  float crest = smoothstep(-0.25, 0.55, vH);
  float fill = (0.04 + 0.36 * vFres + 0.08 * vLight) * (0.45 + 0.9 * crest) * edge + rimBand * 0.34;
  vec3 col = body * fill + mix(uColor, uRim, vLight) * line * (0.18 + 0.32 * vLight + 0.25 * vFres) + uRim * rimBand * 0.12;
  vec3 c = col * uIntensity;
  gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
}`;

/* Sparkle dust living on and just under the sheet surface. */
export const sheetPointsVertex = /* glsl */ `
${sheetCommon}
uniform float uSize;
uniform float uPixel;
uniform float uIntensity;
uniform vec3 uColor;
uniform vec3 uRim;
attribute float aRand;
attribute float aDepth;
varying vec3 vColor;
varying float vAlpha;
void main(){
  float t = sheetTime();
  float r = 0.04 + 0.94 * fract(aPolar.x + uTime * (0.018 + aRand * 0.018));
  float th = aPolar.y + uTime * (0.025 + aRand * 0.035);
  vec3 P = sheet(r, th, t);
  P.y -= aDepth * uThick * (1.0 - r * r * 0.7);
  vec4 mv = modelViewMatrix * vec4(P, 1.0);
  float top = 1.0 - aDepth;
  float rim = smoothstep(0.8, 1.0, r);
  float sparkle = pow(max(0.0, sin(uTime * 0.4 + aRand * 61.0)), 40.0) * 0.7;
  float bright = clamp(top * 0.6 + rim * 0.5 + smoothstep(-0.1, 0.35, P.y) * 0.3, 0.0, 1.0);
  vColor = mix(uColor, uRim, bright) + sparkle * 0.5;
  vAlpha = ((0.08 + 0.45 * bright) * (0.5 + 0.5 * aRand) + sparkle * 0.7) * uIntensity
    * smoothstep(1.0, 0.94, r) * smoothstep(0.04, 0.18, r);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPixel * (0.55 + 0.6 * bright + sparkle * 1.4) * (14.0 / -mv.z);
}`;

export const pointFragment = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main(){
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.0, r);
  vec3 c = vColor * vAlpha * a * a;
  gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
}`;

const bezier = /* glsl */ `
${surfaceCommon}
uniform vec3 uP0;
uniform vec3 uP1;
uniform vec3 uP2;
uniform vec3 uPerp;
uniform float uWidth;
uniform float uSeed;
uniform float uSway;
uniform mat4 uStartMatrix;
uniform mat4 uEndMatrix;
uniform vec2 uStartPolar;
uniform vec2 uEndPolar;
uniform float uStartSeed;
uniform float uEndSeed;
uniform float uStartAmp;
uniform float uEndAmp;
uniform float uStartPuff;
uniform float uEndPuff;
uniform vec3 uStartScale;
uniform vec3 uEndScale;
uniform vec4 uStartLobe;
uniform vec4 uEndLobe;
vec3 startPoint(){
  float t = uTime * 0.3 + uStartSeed * 17.0;
  vec3 p = sheetAt(uStartPolar.x, uStartPolar.y, t, uStartSeed, uStartAmp, uStartPuff, uStartScale, uStartLobe);
  return (uStartMatrix * vec4(p, 1.0)).xyz;
}
vec3 endPoint(){
  float t = uTime * 0.3 + uEndSeed * 17.0;
  vec3 p = sheetAt(uEndPolar.x, uEndPolar.y, t, uEndSeed, uEndAmp, uEndPuff, uEndScale, uEndLobe);
  return (uEndMatrix * vec4(p, 1.0)).xyz;
}
/* The middle of each route drifts, so connections hang loose and move
   rather than being pinned in place. Needs uTime declared beforehand. */
vec3 ctrl(){
  float s = uSeed * 6.283;
  return uP1
    + uPerp * (sin(uTime * 0.21 + s) * 0.65 + sin(uTime * 0.13 + s * 1.9) * 0.35) * uSway
    + vec3(0.0, 0.0, sin(uTime * 0.17 + s * 0.7) * uSway);
}
vec3 bez(float t){
  vec3 c = ctrl();
  float u = 1.0 - t;
  return u * u * startPoint() + 2.0 * u * t * c + t * t * endPoint();
}`;

/* Handoff bundles: many glowing fibres per route. Each fibre is a thin
   ribbon that twists around the bundle axis and meanders over time, and
   bands of light travel along it from source to target. */
export const strandVertex = /* glsl */ `
uniform float uTime;
uniform float uIntensity;
uniform float uThick;
uniform float uFlow;
uniform vec3 uCA;
uniform vec3 uCB;
attribute float aT;
attribute float aSide;
attribute float aRand;
attribute vec2 aOff;
varying vec3 vColor;
varying float vAlpha;
varying float vSide;
${bezier}
void main(){
  float t = aT;
  vec3 p = bez(t);
  vec3 tg = bez(min(t + 0.01, 1.0)) - bez(max(t - 0.01, 0.0));
  vec2 nrm = normalize(vec2(-tg.y, tg.x) + 1e-5);
  float env = 0.3 + 0.7 * sin(t * 3.14159265);
  // Every fibre converges to one point on each surface. No endpoint offset,
  // ribbon thickness or sway can detach it as the form changes shape.
  float join = smoothstep(0.0, 0.1, t) * smoothstep(1.0, 0.9, t);
  float ang = aOff.y + t * (2.2 + aRand * 2.4) + uTime * (0.12 + aRand * 0.12);
  float rad = aOff.x * (0.6 + 0.4 * sin(t * 5.0 + aRand * 6.283 + uTime * 0.27));
  float wob = sin(t * 6.0 - uTime * 0.45 + aRand * 6.283) * 0.25 + sin(t * 11.0 + uTime * 0.33 + aRand * 3.0) * 0.1;
  p.xy += nrm * (cos(ang) * rad + wob) * uWidth * env * join;
  p.z += sin(ang) * rad * uWidth * env * 1.4 * join;
  p.xy += nrm * aSide * uThick * (0.6 + 0.4 * aRand) * join;
  float phase = t * 2.5 - uTime * uFlow * (0.8 + 0.4 * aRand) + aRand * 7.0;
  float band = pow(0.5 + 0.5 * cos(phase * 6.283), 10.0);
  vSide = aSide;
  vColor = mix(uCA, uCB, smoothstep(0.15, 0.85, t)) + band * 0.35;
  vAlpha = pow(env, 0.6) * uIntensity * (0.16 + 0.16 * aRand) * (0.45 + 2.2 * band)
    * smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.94, t);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

export const strandFragment = /* glsl */ `
uniform float uLineGain;
varying vec3 vColor;
varying float vAlpha;
varying float vSide;
void main(){
  float k = 1.0 - abs(vSide);
  float glow = k * k + pow(k, 10.0) * 0.9;
  vec3 c = vColor * vAlpha * glow * uLineGain;
  gl_FragColor = vec4(c, max(c.r, max(c.g, c.b)));
}`;

/* Pulses: bright heads with fading trails travelling source -> target. */
export const pulseVertex = /* glsl */ `
uniform float uTime;
uniform float uSpeed;
uniform float uIntensity;
uniform float uSize;
uniform float uPixel;
uniform vec3 uCA;
uniform vec3 uCB;
attribute float aPhase;
attribute float aTrail;
attribute float aOff;
varying vec3 vColor;
varying float vAlpha;
${bezier}
void main(){
  float s = fract(uTime * uSpeed + aPhase) - aTrail * 0.075;
  float vis = step(0.0, s);
  s = clamp(s, 0.0, 1.0);
  vec3 p = bez(s);
  float env = sin(s * 3.14159265);
  float join = smoothstep(0.0, 0.07, s) * smoothstep(1.0, 0.93, s);
  p += uPerp * aOff * uWidth * env * 0.7 * join;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float head = pow(1.0 - aTrail, 2.2);
  vColor = mix(mix(uCA, uCB, s), vec3(1.0), head * 0.55);
  vAlpha = vis * head * uIntensity * smoothstep(0.02, 0.12, s) * smoothstep(1.0, 0.86, s);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uSize * uPixel * (0.3 + 0.95 * head) * (14.0 / -mv.z);
}`;

/* Ambient motes give the volume depth; deliberately faint. */
export const dustVertex = /* glsl */ `
uniform float uTime;
uniform float uPixel;
uniform vec2 uBox;
attribute float aRand;
varying vec3 vColor;
varying float vAlpha;
void main(){
  vec3 p = position;
  p.x = mod(p.x + uTime * (0.012 + aRand * 0.02) + uBox.x, uBox.x * 2.0) - uBox.x;
  p.y += sin(uTime * 0.09 + aRand * 20.0) * 0.12;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float twinkle = 0.5 + 0.5 * sin(uTime * (0.6 + aRand) + aRand * 40.0);
  vColor = mix(vec3(0.25, 0.75, 0.62), vec3(0.55, 0.95, 0.85), aRand);
  vAlpha = 0.16 * twinkle;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPixel * (1.0 + aRand * 2.2) * (14.0 / -mv.z);
}`;

export const backdropVertex = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.999, 1.0); }`;

export const backdropFragment = /* glsl */ `
uniform float uTime;
uniform vec2 uAspect;
varying vec2 vUv;
void main(){
  vec2 p = (vUv - 0.5) * uAspect;
  float r = length(p * vec2(0.8, 1.15));
  vec3 core = vec3(0.035, 0.105, 0.098);
  vec3 edge = vec3(0.012, 0.03, 0.032);
  vec3 col = mix(core, edge, smoothstep(0.0, 0.95, r));
  float band = sin(vUv.x * 7.0 + vUv.y * 3.0 + uTime * 0.05) * 0.5 + 0.5;
  col += vec3(0.01, 0.03, 0.026) * band * (1.0 - smoothstep(0.2, 1.0, r));
  float grain = fract(sin(dot(vUv * 913.0, vec2(12.9898, 78.233))) * 43758.5453);
  col += (grain - 0.5) * 0.008;
  gl_FragColor = vec4(col, 1.0);
}`;
