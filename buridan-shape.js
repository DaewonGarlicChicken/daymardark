// =========================================================
// 사고실험 006. 뷔리당의 당나귀 - 형태 생성 (순수 JS, Three.js 의존 없음)
// -----------------------------------------------------------
//  bdGenerateDonkeyTriangles : 당나귀 (삼각형 정확히 300개, 다리 번호 포함)
//  bdTripodOffsets           : 트라이포드(삼각형 3개) 배치
//  bdBuildTriangleVertices   : (중심, 법선, 크기) -> 삼각형 꼭짓점
//
// 당나귀 좌표계: 머리가 +x, 위가 +y, 몸 폭이 z. 발바닥이 y = 0.
// =========================================================

const BD_SHAPE_CONFIG = {
  donkey: {
    count: 300,
    triangleSize: 0.6,   // 당나귀 삼각형 크기 (축소)
    smoothK: 0.45,
    // 다리 4개: [엉덩이(관절) 위치, 발 위치] - 걸을 때 엉덩이를 축으로 흔들림
    legs: [
      [[2.3, 3.3, 0.75], [2.45, 0.25, 0.8]],
      [[2.3, 3.3, -0.75], [2.45, 0.25, -0.8]],
      [[-2.3, 3.3, 0.75], [-2.4, 0.25, 0.8]],
      [[-2.3, 3.3, -0.75], [-2.4, 0.25, -0.8]],
    ],
  },
  tripod: { triangleSize: 1.4 },   // 건초/물 삼각뿔(트라이포드를 접어 올린 모양)의 한 변
};

function bdMakeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function bdSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function bdAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function bdScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function bdDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function bdCross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function bdLen(a) { return Math.sqrt(bdDot(a, a)); }
function bdNorm(a) { const l = bdLen(a); return l < 1e-9 ? [0, 1, 0] : bdScale(a, 1 / l); }

// ---------- 당나귀를 이루는 기본 도형 ----------
function bdDonkeyPrimitives() {
  const P = [];
  P.push({ type: 'ell', c: [0, 4.3, 0], r: [3.5, 1.65, 1.35] });                  // 몸통
  P.push({ type: 'cap', a: [2.5, 4.8, 0], b: [3.9, 6.6, 0], r: 0.78 });           // 목
  P.push({ type: 'cap', a: [3.9, 6.9, 0], b: [5.5, 5.7, 0], r: 0.72 });           // 머리(주둥이가 앞아래로)
  P.push({ type: 'cap', a: [3.85, 7.4, 0.35], b: [3.45, 9.3, 0.65], r: 0.26 });   // 귀
  P.push({ type: 'cap', a: [3.85, 7.4, -0.35], b: [3.45, 9.3, -0.65], r: 0.26 });
  P.push({ type: 'cap', a: [-3.4, 4.8, 0], b: [-4.2, 2.8, 0], r: 0.2 });          // 꼬리
  BD_SHAPE_CONFIG.donkey.legs.forEach(([hip, foot], i) => {
    P.push({ type: 'cap', a: hip, b: foot, r: 0.38, leg: i + 1 });                // 다리
  });
  return P;
}

function bdClosestOnSeg(p, a, b) {
  const ab = bdSub(b, a);
  const t = Math.max(0, Math.min(1, bdDot(bdSub(p, a), ab) / bdDot(ab, ab)));
  return bdAdd(a, bdScale(ab, t));
}
function bdPrimSdf(pr, p) {
  if (pr.type === 'cap') return bdLen(bdSub(p, bdClosestOnSeg(p, pr.a, pr.b))) - pr.r;
  const q = [(p[0] - pr.c[0]) / pr.r[0], (p[1] - pr.c[1]) / pr.r[1], (p[2] - pr.c[2]) / pr.r[2]];
  return (bdLen(q) - 1) * Math.min(pr.r[0], pr.r[1], pr.r[2]);
}
function bdUnionSdf(prims, p, k) {
  let d = bdPrimSdf(prims[0], p);
  for (let i = 1; i < prims.length; i++) {
    const di = bdPrimSdf(prims[i], p);
    const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (di - d) / k));
    d = di + (d - di) * h - k * h * (1 - h);
  }
  return d;
}
function bdGrad(prims, p, k) {
  const e = 0.01;
  return bdNorm([
    bdUnionSdf(prims, [p[0] + e, p[1], p[2]], k) - bdUnionSdf(prims, [p[0] - e, p[1], p[2]], k),
    bdUnionSdf(prims, [p[0], p[1] + e, p[2]], k) - bdUnionSdf(prims, [p[0], p[1] - e, p[2]], k),
    bdUnionSdf(prims, [p[0], p[1], p[2] + e], k) - bdUnionSdf(prims, [p[0], p[1], p[2] - e], k),
  ]);
}
function bdPrimArea(pr) {
  if (pr.type === 'cap') return 2 * Math.PI * pr.r * bdLen(bdSub(pr.b, pr.a)) + 4 * Math.PI * pr.r * pr.r;
  const [a, b, c] = pr.r, p = 1.6;
  return 4 * Math.PI * Math.pow((Math.pow(a * b, p) + Math.pow(a * c, p) + Math.pow(b * c, p)) / 3, 1 / p);
}
function bdRandUnit(rng) {
  const z = rng() * 2 - 1, t = rng() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), r * Math.sin(t), z];
}
function bdPrimSample(pr, rng) {
  const u = bdRandUnit(rng);
  if (pr.type === 'ell') return bdAdd(pr.c, [pr.r[0] * u[0], pr.r[1] * u[1], pr.r[2] * u[2]]);
  const p0 = bdAdd(bdAdd(pr.a, bdScale(bdSub(pr.b, pr.a), rng())), bdScale(u, pr.r));
  const c = bdClosestOnSeg(p0, pr.a, pr.b);
  return bdAdd(c, bdScale(bdNorm(bdSub(p0, c)), pr.r));
}

// 당나귀 표면에 삼각형 count개 (겹쳐 파묻힌 점은 버리고, 부드러운 표면으로 끌어당김)
function bdGenerateDonkeyTriangles() {
  const D = BD_SHAPE_CONFIG.donkey;
  const prims = bdDonkeyPrimitives();
  const k = D.smoothK;
  const rng = bdMakeRng(2024);
  const areas = prims.map(bdPrimArea);
  const total = areas.reduce((s, a) => s + a, 0);

  function candidate() {
    for (let tries = 0; tries < 200; tries++) {
      let r = rng() * total, pi = 0;
      while (pi < prims.length - 1 && r > areas[pi]) { r -= areas[pi]; pi++; }
      let p = bdPrimSample(prims[pi], rng);
      let d = bdUnionSdf(prims, p, k);
      if (d < -0.1) continue;
      for (let it = 0; it < 3; it++) {
        p = bdSub(p, bdScale(bdGrad(prims, p, k), d));
        d = bdUnionSdf(prims, p, k);
      }
      if (Math.abs(d) > 0.04) continue;
      return { p, n: bdGrad(prims, p, k), leg: prims[pi].leg || 0 };
    }
    return null;
  }

  // 후보를 넉넉히 미리 뽑아 둔 뒤, 그중에서 서로 가장 멀리 떨어진 점들을 차례로 고름 (고른 분포)
  const n = D.count;
  const pool = [];
  for (let i = 0; i < n * 3.5; i++) { const c = candidate(); if (c) pool.push(c); }
  const centers = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const leg = new Uint8Array(n);
  const minD = new Float64Array(pool.length).fill(Infinity);
  let cur = 0;
  for (let i = 0; i < n; i++) {
    const best = pool[cur];
    centers.set(best.p, i * 3);
    normals.set(best.n, i * 3);
    // 다리 번호: 다리에서 뽑았고 엉덩이보다 아래쪽인 점만
    leg[i] = best.leg && best.p[1] < D.legs[best.leg - 1][0][1] - 0.2 ? best.leg : 0;
    let far = -1, farIdx = 0;
    for (let j = 0; j < pool.length; j++) {
      const q = pool[j].p;
      const dx = q[0] - best.p[0], dy = q[1] - best.p[1], dz = q[2] - best.p[2];
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd < minD[j]) minD[j] = dd;
      if (minD[j] > far) { far = minD[j]; farIdx = j; }
    }
    cur = farIdx;
  }
  return { count: n, centers, normals, leg };
}

// 트라이포드: 삼각형 3개가 꼭짓점끼리 맞닿은 모양 (모두 꼭짓점이 위)
function bdTripodOffsets(triangleSize) {
  const r1 = triangleSize / Math.sqrt(3);
  return [90, 210, 330].map((d) => {
    const a = d * Math.PI / 180;
    return { x: r1 * Math.cos(a), y: r1 * Math.sin(a) };
  });
}

// 삼각형 꼭짓점 (평면 안에서 무작위 회전)
function bdBuildTriangleVertices(centers, normals, size, seed) {
  const rng = bdMakeRng(seed || 3);
  const n = centers.length / 3;
  const out = new Float32Array(n * 9);
  const r = size / Math.sqrt(3);
  for (let i = 0; i < n; i++) {
    const c = [centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]];
    const nn = bdNorm([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]);
    const ref = Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = bdNorm(bdCross(nn, ref));
    const e2 = bdCross(nn, e1);
    const a = rng() * Math.PI * 2;
    const d = bdAdd(bdScale(e1, Math.cos(a)), bdScale(e2, Math.sin(a)));
    const q = bdCross(nn, d);
    const v0 = bdAdd(c, bdScale(d, r));
    const v1 = bdAdd(c, bdAdd(bdScale(d, -0.5 * r), bdScale(q, 0.8660254 * r)));
    const v2 = bdAdd(c, bdAdd(bdScale(d, -0.5 * r), bdScale(q, -0.8660254 * r)));
    out.set([v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]], i * 9);
  }
  return out;
}
