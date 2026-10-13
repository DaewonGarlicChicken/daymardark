// =========================================================
// 사고실험 004. 트롤리 딜레마 - 형태 생성 (순수 JS, Three.js 의존 없음)
// -----------------------------------------------------------
//  1) tdGenerateHandTriangles  : 🫵 모양 손 (삼각형 정확히 7,000개, 검지 관절 정보 포함)
//  2) tdGenerateTrainTriangles : 위에서 본 기차 (손과 같은 개수, 손이 이 모양으로 변신)
//  3) tdTripodOffsets          : 트라이포드(삼각형 3개) 배치
//  4) tdBuildTriangleVertices  : (중심, 법선, 크기) -> 삼각형 꼭짓점
//  5) tdBendPoint              : 검지 관절을 굽혔을 때 점의 위치
//
// 손 좌표계: 손등이 +y, 손바닥이 -y, 검지가 +z(화면 밖, 보는 사람 쪽)를 가리킴.
// =========================================================

const TD_SHAPE_CONFIG = {
  hand: {
    count: 7000,
    triangleSize: 0.4,
    smoothK: 0.55,                 // 손가락과 손등이 부드럽게 이어지는 정도
    joints: {                      // 검지 관절 위치 (x축을 기준으로 아래로 굽음)
      mcp: [2.5, 0.4, 0.8],
      pip: [2.5, 0.4, 4.4],
      dip: [2.5, 0.4, 6.9],
    },
    bendAngles: [50, 65, 35],      // 완전히 눌렀을 때 각 관절 각도(도)
  },
  train: {
    // 위에서 본 기차: 기관차 + 객차 2량 (길이 방향 = +y, 지붕 = +z)
    boxes: [
      { c: [0, 11.0, 0], s: [4.6, 12.0, 4.2] },   // 기관차
      { c: [0, 13.4, 2.9], s: [3.4, 4.0, 1.6] },  // 기관실 지붕 돌출부
      { c: [0, -0.6, 0], s: [4.4, 10.0, 3.6] },   // 객차 1
      { c: [0, 5.0, 0], s: [1.2, 1.2, 1.2] },     // 연결기
      { c: [0, -11.8, 0], s: [4.4, 10.0, 3.6] },  // 객차 2
      { c: [0, -6.2, 0], s: [1.2, 1.2, 1.2] },    // 연결기
    ],
  },
  tripod: { triangleSize: 1.8 },
  particle: { count: 400, triangleSize: 0.5 },
};

// ---------- 작은 유틸 ----------
function tdMakeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function tdAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function tdSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function tdScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function tdDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function tdCross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function tdLen(a) { return Math.sqrt(tdDot(a, a)); }
function tdNorm(a) { const l = tdLen(a); return l < 1e-9 ? [0, 0, 1] : [a[0] / l, a[1] / l, a[2] / l]; }
function tdRandUnit(rng) {
  const z = rng() * 2 - 1, t = rng() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), r * Math.sin(t), z];
}

// ---------------------------------------------------------
// 1) 손: 캡슐/타원체를 부드럽게 합친 SDF 표면에서 샘플링
// ---------------------------------------------------------
function tdHandPrimitives() {
  const J = TD_SHAPE_CONFIG.hand.joints;
  const ix = J.mcp[0], iy = J.mcp[1];
  const P = [];
  // 손등/손바닥 덩어리
  P.push({ type: 'ell', c: [0.3, 0.0, -2.6], r: [4.4, 2.3, 3.9] });
  // 손목 ~ 팔 (뒤쪽으로 뻗음)
  P.push({ type: 'cap', a: [0.2, -0.2, -5.0], b: [0.0, -0.6, -9.5], r: 2.4 });
  // 검지 (펴져서 +z를 가리킴) - 마디마다 bone 번호
  P.push({ type: 'cap', a: [ix, iy, 0.2], b: [ix, iy, J.pip[2]], r: 1.0, finger: true });
  P.push({ type: 'cap', a: [ix, iy, J.pip[2]], b: [ix, iy, J.dip[2]], r: 0.92, finger: true });
  P.push({ type: 'cap', a: [ix, iy, J.dip[2]], b: [ix, iy, 8.9], r: 0.82, finger: true });
  // 중지/약지/새끼 (주먹 쥔 채 아래로 말려 있음)
  [[0.85, 0.98], [-0.85, 0.93], [-2.4, 0.82]].forEach(([x, r]) => {
    P.push({ type: 'cap', a: [x, 0.3, 0.2], b: [x, -0.2, 3.3], r });
    P.push({ type: 'cap', a: [x, -0.2, 3.3], b: [x, -2.5, 3.0], r: r * 0.95 });
    P.push({ type: 'cap', a: [x, -2.5, 3.0], b: [x, -2.8, 1.0], r: r * 0.9 });
  });
  // 엄지 (옆에서 말린 손가락들 아래로 감쌈)
  P.push({ type: 'cap', a: [3.4, -1.0, -2.6], b: [4.2, -1.7, 0.4], r: 1.2 });
  P.push({ type: 'cap', a: [4.2, -1.7, 0.4], b: [2.6, -2.8, 2.0], r: 1.0 });
  return P;
}

function tdClosestOnSeg(p, a, b) {
  const ab = tdSub(b, a);
  const t = Math.max(0, Math.min(1, tdDot(tdSub(p, a), ab) / tdDot(ab, ab)));
  return tdAdd(a, tdScale(ab, t));
}
function tdPrimSdf(pr, p) {
  if (pr.type === 'cap') return tdLen(tdSub(p, tdClosestOnSeg(p, pr.a, pr.b))) - pr.r;
  const q = [(p[0] - pr.c[0]) / pr.r[0], (p[1] - pr.c[1]) / pr.r[1], (p[2] - pr.c[2]) / pr.r[2]];
  return (tdLen(q) - 1) * Math.min(pr.r[0], pr.r[1], pr.r[2]);
}
function tdSmin(a, b, k) {
  const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (b - a) / k));
  return b + (a - b) * h - k * h * (1 - h);
}
function tdUnionSdf(prims, p, k) {
  let d = tdPrimSdf(prims[0], p);
  for (let i = 1; i < prims.length; i++) d = tdSmin(d, tdPrimSdf(prims[i], p), k);
  return d;
}
function tdGrad(prims, p, k) {
  const e = 0.01;
  return tdNorm([
    tdUnionSdf(prims, [p[0] + e, p[1], p[2]], k) - tdUnionSdf(prims, [p[0] - e, p[1], p[2]], k),
    tdUnionSdf(prims, [p[0], p[1] + e, p[2]], k) - tdUnionSdf(prims, [p[0], p[1] - e, p[2]], k),
    tdUnionSdf(prims, [p[0], p[1], p[2] + e], k) - tdUnionSdf(prims, [p[0], p[1], p[2] - e], k),
  ]);
}
function tdPrimArea(pr) {
  if (pr.type === 'cap') return 2 * Math.PI * pr.r * tdLen(tdSub(pr.b, pr.a)) + 4 * Math.PI * pr.r * pr.r;
  const [a, b, c] = pr.r, p = 1.6;
  return 4 * Math.PI * Math.pow((Math.pow(a * b, p) + Math.pow(a * c, p) + Math.pow(b * c, p)) / 3, 1 / p);
}
function tdPrimSample(pr, rng) {
  const u = tdRandUnit(rng);
  if (pr.type === 'ell') return tdAdd(pr.c, [pr.r[0] * u[0], pr.r[1] * u[1], pr.r[2] * u[2]]);
  const p0 = tdAdd(tdAdd(pr.a, tdScale(tdSub(pr.b, pr.a), rng())), tdScale(u, pr.r));
  const c = tdClosestOnSeg(p0, pr.a, pr.b);
  return tdAdd(c, tdScale(tdNorm(tdSub(p0, c)), pr.r));
}

// 검지 마디 번호: 0 = 손(고정), 1 = 첫째 마디, 2 = 둘째 마디, 3 = 끝 마디
function tdFingerBone(p) {
  const J = TD_SHAPE_CONFIG.hand.joints;
  if (Math.abs(p[0] - J.mcp[0]) > 1.6 || p[1] < J.mcp[1] - 1.6) return 0;
  if (p[2] < J.mcp[2] + 0.3) return 0;
  if (p[2] < J.pip[2]) return 1;
  if (p[2] < J.dip[2]) return 2;
  return 3;
}

// 속도를 위해 기본 도형들을 평평한 숫자 배열로 바꿔 할당 없이 계산
function tdCompilePrims(prims) {
  const n = prims.length;
  const D = new Float64Array(n * 10);
  prims.forEach((p, i) => {
    const o = i * 10;
    if (p.type === 'cap') {
      D[o] = 0; D.set(p.a, o + 1); D.set(p.b, o + 4); D[o + 7] = p.r;
      const ab = tdSub(p.b, p.a); D[o + 8] = 1 / tdDot(ab, ab);
    } else {
      D[o] = 1; D.set(p.c, o + 1); D.set(p.r, o + 4); D[o + 7] = Math.min(p.r[0], p.r[1], p.r[2]);
    }
  });
  return { D, n };
}
function tdFastSdf(C, x, y, z, k) {
  const D = C.D;
  let d = 0;
  for (let i = 0; i < C.n; i++) {
    const o = i * 10;
    let di;
    if (D[o] === 0) {
      const ax = D[o + 1], ay = D[o + 2], az = D[o + 3];
      const bx = D[o + 4] - ax, by = D[o + 5] - ay, bz = D[o + 6] - az;
      let t = ((x - ax) * bx + (y - ay) * by + (z - az) * bz) * D[o + 8];
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = x - ax - bx * t, dy = y - ay - by * t, dz = z - az - bz * t;
      di = Math.sqrt(dx * dx + dy * dy + dz * dz) - D[o + 7];
    } else {
      const qx = (x - D[o + 1]) / D[o + 4], qy = (y - D[o + 2]) / D[o + 5], qz = (z - D[o + 3]) / D[o + 6];
      di = (Math.sqrt(qx * qx + qy * qy + qz * qz) - 1) * D[o + 7];
    }
    if (i === 0) d = di;
    else {
      const h = Math.max(0, Math.min(1, 0.5 + 0.5 * (di - d) / k));
      d = di + (d - di) * h - k * h * (1 - h);
    }
  }
  return d;
}
function tdFastGrad(C, x, y, z, k, out) {
  const e = 0.01; // 사면체 4점 기울기
  const a = tdFastSdf(C, x + e, y - e, z - e, k), b = tdFastSdf(C, x - e, y - e, z + e, k);
  const c = tdFastSdf(C, x - e, y + e, z - e, k), d = tdFastSdf(C, x + e, y + e, z + e, k);
  let gx = a - b - c + d, gy = -a - b + c + d, gz = -a + b - c + d;
  const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  out[0] = gx / l; out[1] = gy / l; out[2] = gz / l;
  return out;
}

function tdGenerateHandTriangles() {
  const H = TD_SHAPE_CONFIG.hand;
  const prims = tdHandPrimitives();
  const k = H.smoothK;
  const C = tdCompilePrims(prims);
  const g = [0, 0, 1];
  const rng = tdMakeRng(31337);
  const areas = prims.map(tdPrimArea);
  const totalArea = areas.reduce((s, a) => s + a, 0);

  const n = H.count;
  const centers = new Float32Array(n * 3);
  const normals = new Float32Array(n * 3);
  const bone = new Uint8Array(n);
  let got = 0, guard = 0;

  while (got < n && guard < n * 40) {
    guard++;
    let r = rng() * totalArea, pi = 0;
    while (pi < prims.length - 1 && r > areas[pi]) { r -= areas[pi]; pi++; }
    const p = tdPrimSample(prims[pi], rng);
    let d = tdFastSdf(C, p[0], p[1], p[2], k);
    if (d < -0.12) continue; // 다른 부위 속에 파묻힌 점은 버림
    for (let it = 0; it < 3; it++) {
      tdFastGrad(C, p[0], p[1], p[2], k, g);
      p[0] -= g[0] * d; p[1] -= g[1] * d; p[2] -= g[2] * d;
      d = tdFastSdf(C, p[0], p[1], p[2], k);
    }
    if (Math.abs(d) > 0.05) continue;
    tdFastGrad(C, p[0], p[1], p[2], k, g);
    centers.set(p, got * 3);
    normals.set(g, got * 3);
    bone[got] = prims[pi].finger ? tdFingerBone(p) : 0;
    got++;
  }
  if (got !== n) throw new Error('hand triangle count mismatch: ' + got);
  return { count: n, centers, normals, bone };
}

// 검지를 bend(0~1)만큼 굽혔을 때 점 p(bone 번호 b)의 위치
// 먼 관절부터 차례로 회전 (각 회전은 휴지 상태의 관절 위치 기준이라 순서대로 적용하면 정확함)
function tdBendPoint(x, y, z, b, bend, out) {
  out[0] = x; out[1] = y; out[2] = z;
  if (b === 0 || bend <= 0) return out;
  const H = TD_SHAPE_CONFIG.hand;
  const J = [H.joints.mcp, H.joints.pip, H.joints.dip];
  for (let j = b - 1; j >= 0; j--) {
    const a = (H.bendAngles[j] * Math.PI / 180) * bend;
    const c = Math.cos(a), s = Math.sin(a);
    const py = out[1] - J[j][1], pz = out[2] - J[j][2];
    out[1] = J[j][1] + py * c - pz * s;
    out[2] = J[j][2] + py * s + pz * c;
  }
  return out;
}

// ---------------------------------------------------------
// 2) 위에서 본 기차 (상자들의 바닥면을 제외한 겉면)
// ---------------------------------------------------------
function tdGenerateTrainTriangles(count) {
  const rng = tdMakeRng(4242);
  const faces = [];
  TD_SHAPE_CONFIG.train.boxes.forEach((bx) => {
    const [cx, cy, cz] = bx.c, [sx, sy, sz] = bx.s;
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    // [고정 축, 부호, 면적, 나머지 두 축 반길이]
    faces.push({ o: [cx, cy, cz + hz], n: [0, 0, 1], u: [hx, 0, 0], v: [0, hy, 0], area: sx * sy });
    faces.push({ o: [cx + hx, cy, cz], n: [1, 0, 0], u: [0, hy, 0], v: [0, 0, hz], area: sy * sz });
    faces.push({ o: [cx - hx, cy, cz], n: [-1, 0, 0], u: [0, hy, 0], v: [0, 0, hz], area: sy * sz });
    faces.push({ o: [cx, cy + hy, cz], n: [0, 1, 0], u: [hx, 0, 0], v: [0, 0, hz], area: sx * sz });
    faces.push({ o: [cx, cy - hy, cz], n: [0, -1, 0], u: [hx, 0, 0], v: [0, 0, hz], area: sx * sz });
  });
  const total = faces.reduce((s, f) => s + f.area, 0);

  // 면적에 비례해 개수 배분 (반올림 오차는 마지막에 보정)
  let assigned = 0;
  faces.forEach((f) => { f.n_ = Math.floor(count * f.area / total); assigned += f.n_; });
  for (let i = 0; assigned < count; i = (i + 1) % faces.length) { faces[i].n_++; assigned++; }

  const centers = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  let idx = 0;
  faces.forEach((f) => {
    // 면 위에 흔들린 격자로 고르게 배치
    const aspect = tdLen(f.u) / Math.max(1e-6, tdLen(f.v));
    const cols = Math.max(1, Math.round(Math.sqrt(f.n_ * aspect)));
    const rows = Math.max(1, Math.ceil(f.n_ / cols));
    for (let i = 0; i < f.n_; i++) {
      const gi = i % cols, gj = Math.floor(i / cols);
      const a = ((gi + 0.5 + (rng() - 0.5) * 0.6) / cols) * 2 - 1;
      const b = ((gj + 0.5 + (rng() - 0.5) * 0.6) / rows) * 2 - 1;
      const p = tdAdd(tdAdd(f.o, tdScale(f.u, a)), tdScale(f.v, b));
      centers.set(p, idx * 3);
      normals.set(f.n, idx * 3);
      idx++;
    }
  });
  return { count, centers, normals };
}

// ---------------------------------------------------------
// 3) 트라이포드: 삼각형 3개가 꼭짓점끼리 맞닿은 모양 (모두 꼭짓점이 위)
// ---------------------------------------------------------
function tdTripodOffsets(triangleSize) {
  const r1 = triangleSize / Math.sqrt(3);
  return [90, 210, 330].map((d) => {
    const a = d * Math.PI / 180;
    return { x: r1 * Math.cos(a), y: r1 * Math.sin(a) };
  });
}

// ---------------------------------------------------------
// 4) 삼각형 꼭짓점 (dirs가 없으면 평면 안에서 무작위 회전)
// ---------------------------------------------------------
function tdBuildTriangleVertices(centers, normals, size, dirs, seed) {
  const rng = tdMakeRng(seed || 7);
  const n = centers.length / 3;
  const out = new Float32Array(n * 9);
  const r = size / Math.sqrt(3);
  for (let i = 0; i < n; i++) {
    const c = [centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]];
    const nn = tdNorm([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]);
    const ref = Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = tdNorm(tdCross(nn, ref));
    const e2 = tdCross(nn, e1);
    let d;
    if (dirs) {
      let v = [dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]];
      v = tdSub(v, tdScale(nn, tdDot(v, nn)));
      d = tdLen(v) < 1e-4 ? e1 : tdNorm(v);
    } else {
      const a = rng() * Math.PI * 2;
      d = tdAdd(tdScale(e1, Math.cos(a)), tdScale(e2, Math.sin(a)));
    }
    const q = tdCross(nn, d);
    const v0 = tdAdd(c, tdScale(d, r));
    const v1 = tdAdd(c, tdAdd(tdScale(d, -0.5 * r), tdScale(q, 0.8660254 * r)));
    const v2 = tdAdd(c, tdAdd(tdScale(d, -0.5 * r), tdScale(q, -0.8660254 * r)));
    out.set([v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]], i * 9);
  }
  return out;
}
