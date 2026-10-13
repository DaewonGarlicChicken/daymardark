// =========================================================
// 사고실험 003. 중국어 방 - 형태 생성 (순수 JS, Three.js 의존 없음)
// -----------------------------------------------------------
//  1) crGenerateTripodOffsets : 큰 트라이포드(삼각형 12개)의 삼각형 배치
//  2) crGenerateEyeTriangles  : 안구 + 시신경 구조물 (삼각형 정확히 10,000개)
//  3) crGenerateTree          : 시신경 끝에서 자라는 나무 (삼각형 200~500개)
//  4) crBuildTriangleVertices : (중심, 법선, 크기) -> 삼각형 꼭짓점 좌표
//
// 안구 좌표계: 각막이 -x 쪽(트라이포드들을 바라봄), 시신경이 +x 쪽으로 뻗음.
// =========================================================

const CR_SHAPE_CONFIG = {
  eye: {
    R: 11,                 // 공막(안구 바깥 껍질) 반지름
    corneaCenterX: -7.5,   // 각막 구의 중심
    corneaRadius: 6.5,
    junctionX: -9.0,       // 공막과 각막이 만나는 x
    irisX: -8.4,
    pupilR: 2.0,
    irisR: 5.2,
    lensCenterX: -5.4,
    lensSemi: [1.6, 2.8, 2.8],
    retinaR: 9.6,
    retinaX0: -1.0,
    nerveStartX: 10.0,
    nerveLength: 32,
    nerveR0: 2.6,
    nerveR1: 1.5,
    nerveHoleR: 2.4,
    // 합계 = 10,000
    counts: { sclera: 4800, retina: 2270, nerve: 1700, cornea: 670, iris: 220, lens: 340 },
    triangleSize: 0.6,
    frontX: -14,           // 파동(u) 계산 기준점: 각막 맨 앞
    spanLength: 56,        // 앞(−14) ~ 시신경 끝(42)
  },
  tree: {
    minCount: 200,
    maxCount: 500,
    baseRadius: 1.4,
    topRadius: 0.4,
    baseTriangleSize: 1.1,
  },
};

const CR_PART = { SCLERA: 0, CORNEA: 1, IRIS: 2, LENS: 3, RETINA: 4, NERVE: 5 };
const CR_GOLDEN = Math.PI * (3 - Math.sqrt(5));

// ---------- 작은 유틸 ----------
function crMakeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function crAdd(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function crSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function crScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function crDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function crCross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function crLen(a) { return Math.sqrt(crDot(a, a)); }
function crNorm(a) {
  const l = crLen(a);
  return l < 1e-9 ? [1, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
}

// ---------------------------------------------------------
// 1) 큰 트라이포드 = 트라이포드(삼각형 3개) 4개 = 삼각형 12개
//    xy 평면 위에 놓이며, 각 항목은 {x, y, flip}.
//    flip=false: 꼭짓점이 위(+y), flip=true: 꼭짓점이 아래(-y)
// ---------------------------------------------------------
function crGenerateTripodOffsets(triangleSize) {
  const s = triangleSize;
  const r1 = s / Math.sqrt(3); // 작은 삼각형의 외접원 반지름
  const angles = [90, 210, 330].map((d) => (d * Math.PI) / 180);
  const out = [];
  const slots = [
    { cx: 2 * r1 * Math.cos(angles[0]), cy: 2 * r1 * Math.sin(angles[0]), flip: false },
    { cx: 2 * r1 * Math.cos(angles[1]), cy: 2 * r1 * Math.sin(angles[1]), flip: false },
    { cx: 2 * r1 * Math.cos(angles[2]), cy: 2 * r1 * Math.sin(angles[2]), flip: false },
    { cx: 0, cy: 0, flip: true }, // 가운데 칸: 180도 뒤집힌 트라이포드
  ];
  slots.forEach((slot) => {
    angles.forEach((a) => {
      const sign = slot.flip ? -1 : 1;
      out.push({
        x: slot.cx + sign * r1 * Math.cos(a),
        y: slot.cy + sign * r1 * Math.sin(a),
        flip: slot.flip,
      });
    });
  });
  return out; // 12개
}

// ---------------------------------------------------------
// 2) 안구 + 시신경
// ---------------------------------------------------------

// 타원체 위의 구역을 x방향 균등(구면에서는 면적 균등) + 황금각으로 정확히 N개 샘플링
function crEllipsoidZone(cx, semi, xMin, xMax, N, partId, sink) {
  const a = semi[0], b = semi[1], c = semi[2];
  const w0 = Math.max(-1, (xMin - cx) / a);
  const w1 = Math.min(1, (xMax - cx) / a);
  for (let i = 0; i < N; i++) {
    const w = w0 + (w1 - w0) * ((i + 0.5) / N);
    const rho = Math.sqrt(Math.max(0, 1 - w * w));
    const phi = i * CR_GOLDEN;
    const lx = a * w, ly = b * rho * Math.cos(phi), lz = c * rho * Math.sin(phi);
    const n = crNorm([lx / (a * a), ly / (b * b), lz / (c * c)]);
    sink(cx + lx, ly, lz, n[0], n[1], n[2], partId);
  }
}

// 누적 면적이 f(0~1)가 되는 지점 t (반지름이 r0->r1로 선형 변하는 원뿔대 옆면)
function crTaperT(f, r0, r1) {
  const a = (r1 - r0) / 2;
  const target = f * (r0 + r1) / 2;
  if (Math.abs(a) < 1e-6) return target / r0;
  const t = (-r0 + Math.sqrt(Math.max(0, r0 * r0 + 4 * a * target))) / (2 * a);
  return Math.min(1, Math.max(0, t));
}

function crGenerateEyeTriangles() {
  const E = CR_SHAPE_CONFIG.eye;
  const rng = crMakeRng(20240603);
  const total = Object.values(E.counts).reduce((s, v) => s + v, 0);

  const centers = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const part = new Uint8Array(total);
  const u = new Float32Array(total);
  let n = 0;

  function push(px, py, pz, nx, ny, nz, partId) {
    centers[n * 3] = px; centers[n * 3 + 1] = py; centers[n * 3 + 2] = pz;
    normals[n * 3] = nx; normals[n * 3 + 1] = ny; normals[n * 3 + 2] = nz;
    part[n] = partId;
    // 파동 위치 u: 각막 맨 앞에서의 거리 (0 = 앞, 1 = 시신경 끝) + 약간의 흔들림
    const dx = px - E.frontX;
    const d = Math.sqrt(dx * dx + py * py + pz * pz);
    u[n] = Math.min(1, Math.max(0, d / E.spanLength + (rng() - 0.5) * 0.04));
    n++;
  }

  const holeX = (r, holeR) => Math.sqrt(Math.max(0, r * r - holeR * holeR)); // 시신경이 붙는 구멍의 x

  // 공막: 각막 접합부 ~ 시신경 구멍
  crEllipsoidZone(0, [E.R, E.R, E.R], E.junctionX, holeX(E.R, E.nerveHoleR) + 0.1,
    E.counts.sclera, CR_PART.SCLERA, push);
  // 각막: 앞쪽으로 볼록한 돔
  crEllipsoidZone(E.corneaCenterX, [E.corneaRadius, E.corneaRadius, E.corneaRadius],
    E.corneaCenterX - E.corneaRadius, E.junctionX, E.counts.cornea, CR_PART.CORNEA, push);
  // 망막: 안쪽 구 (뒤쪽 반구)
  crEllipsoidZone(0, [E.retinaR, E.retinaR, E.retinaR], E.retinaX0, holeX(E.retinaR, E.nerveHoleR),
    E.counts.retina, CR_PART.RETINA, push);
  // 수정체: 볼록렌즈 모양 타원체
  crEllipsoidZone(E.lensCenterX, E.lensSemi, E.lensCenterX - E.lensSemi[0],
    E.lensCenterX + E.lensSemi[0], E.counts.lens, CR_PART.LENS, push);

  // 홍채: 동공 구멍이 뚫린 원판 (바깥쪽이 살짝 뒤로 휘어짐)
  for (let i = 0; i < E.counts.iris; i++) {
    const t = (i + 0.5) / E.counts.iris;
    const r = Math.sqrt(E.pupilR * E.pupilR + (E.irisR * E.irisR - E.pupilR * E.pupilR) * t);
    const phi = i * CR_GOLDEN;
    const x = E.irisX + 0.7 * (r - E.pupilR) / (E.irisR - E.pupilR);
    push(x, r * Math.cos(phi), r * Math.sin(phi), -1, 0, 0, CR_PART.IRIS);
  }

  // 시신경: 안구 뒤에서 +x로 뻗는 가늘어지는 관
  for (let i = 0; i < E.counts.nerve; i++) {
    const f = (i + 0.5) / E.counts.nerve;
    const t = crTaperT(f, E.nerveR0, E.nerveR1);
    const r = E.nerveR0 + (E.nerveR1 - E.nerveR0) * t;
    const phi = i * CR_GOLDEN;
    const cy = Math.cos(phi), cz = Math.sin(phi);
    push(E.nerveStartX + E.nerveLength * t, r * cy, r * cz, 0, cy, cz, CR_PART.NERVE);
  }

  if (n !== total) throw new Error('eye triangle count mismatch: ' + n + ' / ' + total);
  return { count: total, centers, normals, part, u };
}

// ---------------------------------------------------------
// 3) 삼각형 꼭짓점 생성
//    sizes: 숫자 또는 삼각형별 Float32Array / dirs: null(무작위 회전) 또는 꼭짓점 방향 벡터들
// ---------------------------------------------------------
function crBuildTriangleVertices(centers, normals, sizes, dirs, seed) {
  const rng = crMakeRng(seed || 777);
  const n = centers.length / 3;
  const out = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const c = [centers[i * 3], centers[i * 3 + 1], centers[i * 3 + 2]];
    const nn = crNorm([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]);
    const ref = Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = crNorm(crCross(nn, ref));
    const e2 = crCross(nn, e1);

    let d;
    if (dirs) {
      let v = [dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]];
      v = crSub(v, crScale(nn, crDot(v, nn)));
      d = crLen(v) < 1e-4 ? e1 : crNorm(v);
    } else {
      const a = rng() * Math.PI * 2;
      d = crAdd(crScale(e1, Math.cos(a)), crScale(e2, Math.sin(a)));
    }
    const q = crCross(nn, d);
    const s = typeof sizes === 'number' ? sizes : sizes[i];
    const r = s / Math.sqrt(3);
    const v0 = crAdd(c, crScale(d, r));
    const v1 = crAdd(c, crAdd(crScale(d, -0.5 * r), crScale(q, 0.8660254 * r)));
    const v2 = crAdd(c, crAdd(crScale(d, -0.5 * r), crScale(q, -0.8660254 * r)));
    out.set([v0[0], v0[1], v0[2], v1[0], v1[1], v1[2], v2[0], v2[1], v2[2]], i * 9);
  }
  return out;
}

// ---------------------------------------------------------
// 4) 나무 줄기 (삼각형 count개, 시신경 끝이 원점)
// ---------------------------------------------------------
function crBezier3(P0, P1, P2, P3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [
    a * P0[0] + b * P1[0] + c * P2[0] + d * P3[0],
    a * P0[1] + b * P1[1] + c * P2[1] + d * P3[1],
    a * P0[2] + b * P1[2] + c * P2[2] + d * P3[2],
  ];
}
function crBezier3Tangent(P0, P1, P2, P3, t) {
  const u = 1 - t;
  const A = crScale(crSub(P1, P0), 3 * u * u);
  const B = crScale(crSub(P2, P1), 6 * u * t);
  const C = crScale(crSub(P3, P2), 3 * t * t);
  return crNorm(crAdd(crAdd(A, B), C));
}
function crFrameFromTangent(T) {
  const ref = Math.abs(T[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = crNorm(crCross(T, ref));
  const e2 = crCross(T, e1);
  return [e1, e2];
}
function crApproxLength(P0, P1, P2, P3) {
  let len = 0, prev = P0;
  for (let i = 1; i <= 16; i++) {
    const p = crBezier3(P0, P1, P2, P3, i / 16);
    len += crLen(crSub(p, prev));
    prev = p;
  }
  return len;
}

function crGenerateTree(count) {
  const T = CR_SHAPE_CONFIG.tree;
  count = Math.max(T.minCount, Math.min(T.maxCount, Math.round(count)));
  const rng = crMakeRng((Math.random() * 4294967295) >>> 0);

  const k = (count - T.minCount) / (T.maxCount - T.minCount);
  const H = 20 + k * 12; // 삼각형이 많을수록 더 높이 자람
  // 시작 중심축 D: 시신경 끝에서 사방 어느 방향으로든 (뒤쪽으로 파고드는 방향만 제외)
  const theta = (25 + rng() * 85) * Math.PI / 180;   // +x(시신경 방향)에서 벌어진 각도 25~110도
  const phi = rng() * Math.PI * 2;                   // x축 둘레 방위각 0~360도
  const D = [Math.cos(theta), Math.sin(theta) * Math.cos(phi), Math.sin(theta) * Math.sin(phi)];
  const [Dp, Dq] = crFrameFromTangent(D);            // D에 수직인 두 축 (줄기가 휘는 방향)
  const bend1 = crAdd(crScale(Dp, 2.5 * (rng() * 2 - 1)), crScale(Dq, 2.5 * (rng() * 2 - 1)));
  const bend2 = crAdd(crScale(Dp, 2.5 * (rng() * 2 - 1)), crScale(Dq, 2.5 * (rng() * 2 - 1)));

  const trunk = {
    P: [[0, 0, 0], [4.5, 0, 0], crAdd(crScale(D, H * 0.42), bend1), crAdd(crScale(D, H), bend2)],
    r0: T.baseRadius, r1: T.topRadius, birth0: 0, birth1: 0.6, isBranch: false,
  };
  trunk.len = crApproxLength(...trunk.P);

  // 가지 3~5개
  const segs = [trunk];
  const nb = 3 + Math.floor(rng() * 3);
  for (let j = 0; j < nb; j++) {
    const ta = 0.38 + (0.5 * (j + rng() * 0.6)) / nb;
    const origin = crBezier3(...trunk.P, ta);
    const tan = crBezier3Tangent(...trunk.P, ta);
    const [e1, e2] = crFrameFromTangent(tan);
    const az = j * CR_GOLDEN + rng();
    const side = crAdd(crScale(e1, Math.cos(az)), crScale(e2, Math.sin(az)));
    const dir = crNorm(crAdd(crScale(tan, 0.8), crScale(side, 0.45))); // 줄기 방향에서 크게 벗어나지 않게
    const Lb = H * 0.45 * (1 - ta * 0.55);
    const up = D; // 가지도 줄기의 중심축 방향으로 휘어 올라감
    const B0 = origin;
    const B1 = crAdd(origin, crScale(dir, Lb * 0.4));
    const B2 = crAdd(crAdd(origin, crScale(dir, Lb * 0.75)), crScale(up, Lb * 0.2));
    const B3 = crAdd(crAdd(origin, crScale(dir, Lb)), crScale(up, Lb * 0.3));
    const trunkR = T.baseRadius + (T.topRadius - T.baseRadius) * ta;
    const b0 = ta * 0.6 + 0.05;
    const seg = { P: [B0, B1, B2, B3], r0: trunkR * 0.6, r1: 0.12, birth0: b0, birth1: 0.95, isBranch: true };
    seg.len = crApproxLength(...seg.P);
    segs.push(seg);
  }

  // 표면적에 비례해 삼각형 개수 배분 (가지는 최소 6개)
  const area = (s) => s.len * (s.r0 + s.r1) / 2;
  const totalArea = segs.reduce((sum, s) => sum + area(s), 0);
  let used = 0;
  for (let i = 1; i < segs.length; i++) {
    segs[i].n = Math.max(6, Math.round(count * area(segs[i]) / totalArea));
    used += segs[i].n;
  }
  segs[0].n = count - used;
  if (segs[0].n < 20) { // 극단적인 경우 가지를 줄여서 줄기 몫 확보
    let deficit = 20 - segs[0].n;
    for (let i = segs.length - 1; i >= 1 && deficit > 0; i--) {
      const cut = Math.min(deficit, segs[i].n - 6);
      segs[i].n -= cut; deficit -= cut;
    }
    segs[0].n = count - segs.slice(1).reduce((s, g) => s + g.n, 0);
  }

  const centers = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const dirs = new Float32Array(count * 3);
  const birth = new Float32Array(count);
  const size = new Float32Array(count);
  let idx = 0;

  segs.forEach((seg) => {
    for (let i = 0; i < seg.n; i++) {
      const f = (i + 0.5) / seg.n;
      const t = crTaperT(f, seg.r0, seg.r1);
      const C = crBezier3(...seg.P, t);
      const tan = crBezier3Tangent(...seg.P, t);
      const [e1, e2] = crFrameFromTangent(tan);
      const th = i * CR_GOLDEN + rng() * 0.5;
      const radial = crAdd(crScale(e1, Math.cos(th)), crScale(e2, Math.sin(th)));
      const r = seg.r0 + (seg.r1 - seg.r0) * t;
      const p = crAdd(C, crScale(radial, r + (rng() - 0.5) * 0.15));
      centers.set(p, idx * 3);
      normals.set(radial, idx * 3);
      dirs.set(tan, idx * 3);
      birth[idx] = seg.birth0 + (seg.birth1 - seg.birth0) * t + (rng() - 0.5) * 0.03;
      size[idx] = T.baseTriangleSize * (0.4 + 0.6 * Math.min(1, r / T.baseRadius));
      idx++;
    }
  });

  return { count, height: H, branchCount: nb, centers, normals, dirs, birth, size };
}
