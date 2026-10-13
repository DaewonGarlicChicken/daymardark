// =========================================================
// 사고실험 02. 볼츠만 두뇌 - 공간 형태 생성 (뇌 모양 + 신경 회로 구조)
// -----------------------------------------------------------
// 앰비언트 삼각형들이 놓일 "위치"를 만들어낸다 (Three.js 의존 없는 순수 JS).
//
// 구조:
//   1) 뇌 볼륨: 타원체 여러 개의 합집합(대뇌 + 전두엽 + 측두엽 + 소뇌 + 뇌간)
//      - 대뇌/전두엽/측두엽 표면에는 주름(뇌회) 굴곡을 줌
//      - 윗면 정중앙에 대뇌 종렬(좌우 반구 사이 홈)을 둠
//   2) 피질 껍질: 뇌 표면 근처 얇은 층에 점을 깔아 뇌의 윤곽을 드러냄
//   3) 신경 다발: 뇌간/중심부에서 피질로 방사형으로 퍼지는 곡선 다발(부채꼴로 벌어짐)
//      + 소뇌로 가는 다발 + 좌우 반구를 잇는 뇌량(아치형) 다발
//   4) 가지 구조: 피질 쪽 끝에서 재귀적으로 갈라지는 수상돌기 모양 가지
//   5) 잔 섬유: 부피 안을 부드럽게 휘어 다니는 가는 섬유들로 빈 공간을 채움
//
// 방향: 전두엽이 -x(왼쪽), 소뇌/뇌간이 +x쪽 아래. (참고 사진처럼 왼쪽을 바라봄)
//
// 반환되는 각 점: { x, y, z, alive: true, g: 색상 그룹 번호 }
//   g = 0: 피질 껍질 / 1: 잔 섬유 / 2~6: 신경 다발(+가지)별 색상
// =========================================================

const BB_BRAIN_CONFIG = {
  // 타원체 부위 (c: 중심, s: 반축 길이, gyri: 뇌회 굴곡, ridge: 소뇌 능선)
  parts: [
    { name: 'cerebrum',   c: [0, 7.5, 0],     s: [31, 17, 17],   gyri: true },
    { name: 'frontal',    c: [-16, 6.5, 0],   s: [17, 14.5, 15.5], gyri: true },
    { name: 'temporal',   c: [-7, -3.5, 0],   s: [17, 7.5, 14],  gyri: true },
    { name: 'cerebellum', c: [18, -9.5, 0],   s: [11, 7, 11.5],  ridge: true },
    { name: 'stem',       c: [5, -16.5, 0],   s: [3.6, 8.5, 3.6] },
  ],
  cerebralPartCount: 3, // parts[0..2]가 대뇌 계열
  cerebellumPartIndex: 3,

  bounds: { x: [-38, 36], y: [-30, 28], z: [-21, 21] },

  gyri: { amp: 0.035, fx: 0.55, fy: 0.6, fz: 0.5 },
  ridge: { amp: 0.035, freq: 2.4 },
  fissure: { halfWidth: 0.9, minY: 10.5 }, // 대뇌 종렬

  clickTolerance: 1.25, // 뇌 볼륨 판정 허용치(필드값). 클릭 유효 범위 판정용

  // 피질 껍질
  shellSpacing: 1.35,
  shellInnerField: 0.86,
  shellMaxAttempts: 55000,
  shellTargetCount: 4200,
  shellSaturationFails: 2500, // 연속 이만큼 실패하면 껍질이 가득 찬 것으로 보고 종료

  // 신경 다발
  coreHub: [0, 5, 0],
  stemHub: [5, -23.5, 0],
  cortexAnchorCount: 30,
  cerebellumAnchorCount: 4,
  fibersPerBundleMin: 6,
  fibersPerBundleMax: 10,
  fiberSpread: 3.0,   // 피질 쪽에서 다발이 부채꼴로 벌어지는 정도
  fiberStep: 1.05,    // 섬유를 따라 점을 놓는 간격
  insideMargin: 0.97, // 이 필드값 이하(볼륨 안쪽)에서만 섬유 점을 놓음

  // 가지(수상돌기)
  treeDepth: 5,
  treeBaseLength: 6.5,

  // 뇌량(좌우 반구 연결 아치)
  callosalArcs: 3,
  callosalFibers: 6,

  // 잔 섬유
  fillerFilaments: 110,
  fillerSteps: 28,

  groupShell: 0,
  groupFiller: 1,
  bundleGroups: [2, 3, 4, 5, 6],
};

// ---------------------------------------------------------
// 작은 벡터 유틸 (배열 기반, Three.js 비의존)
// ---------------------------------------------------------

function bbNorm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function bbRandUnit() {
  const u = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return [s * Math.cos(t), u, s * Math.sin(t)];
}

function bbRandInBall(r) {
  const d = bbRandUnit();
  const k = r * Math.cbrt(Math.random());
  return [d[0] * k, d[1] * k, d[2] * k];
}

function bbRandPerp(d) {
  const r = bbRandUnit();
  return bbNorm([
    d[1] * r[2] - d[2] * r[1],
    d[2] * r[0] - d[0] * r[2],
    d[0] * r[1] - d[1] * r[0],
  ]);
}

// 로드리게스 회전: v를 axis(단위벡터) 둘레로 angle만큼 회전
function bbRotateAroundAxis(v, axis, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const dot = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2];
  const cx = axis[1] * v[2] - axis[2] * v[1];
  const cy = axis[2] * v[0] - axis[0] * v[2];
  const cz = axis[0] * v[1] - axis[1] * v[0];
  return [
    v[0] * c + cx * s + axis[0] * dot * (1 - c),
    v[1] * c + cy * s + axis[1] * dot * (1 - c),
    v[2] * c + cz * s + axis[2] * dot * (1 - c),
  ];
}

function bbCubicBezier(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2],
  ];
}

function bbDist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ---------------------------------------------------------
// 뇌 볼륨 판정 (필드값 <= 1 이면 내부)
// ---------------------------------------------------------

function bbGyriBump(x, y, z) {
  const g = BB_BRAIN_CONFIG.gyri;
  return g.amp * (
    Math.sin(g.fx * x + 0.9 * Math.sin(0.33 * y + 0.5 * z)) +
    Math.sin(g.fy * y + 0.8 * z + 1.3) +
    Math.sin(g.fz * z - 0.45 * x + 0.6 * Math.sin(0.4 * y))
  );
}

// 부위 하나에 대한 정규화된 필드값 (뇌회/능선 굴곡 반영)
// gyriBump: 대뇌 계열 부위들이 공유하는 굴곡값(점당 한 번만 계산해서 넘겨줌, 필요할 때만 계산)
function bbPartField(part, x, y, z, ctx) {
  const dx = (x - part.c[0]) / part.s[0];
  const dy = (y - part.c[1]) / part.s[1];
  const dz = (z - part.c[2]) / part.s[2];
  let q = dx * dx + dy * dy + dz * dz;
  if (q > 1.4) return q; // 굴곡(최대 약 ±9%)으로도 내부가 될 수 없는 거리 -> 굴곡 계산 생략
  let bump = 0;
  if (part.gyri) {
    if (ctx.gyri === null) ctx.gyri = bbGyriBump(x, y, z);
    bump = ctx.gyri;
  } else if (part.ridge) {
    bump = BB_BRAIN_CONFIG.ridge.amp * Math.sin(BB_BRAIN_CONFIG.ridge.freq * y);
  }
  if (bump !== 0) q = q / ((1 + bump) * (1 + bump));
  return q;
}

// 대뇌 종렬을 무시한 순수 볼륨 필드 (클릭 유효 범위 판정에 사용)
function bbBrainFieldRaw(x, y, z) {
  let best = Infinity;
  const parts = BB_BRAIN_CONFIG.parts;
  const ctx = { gyri: null };
  for (let i = 0; i < parts.length; i++) {
    const q = bbPartField(parts[i], x, y, z, ctx);
    if (q < best) best = q;
  }
  return best;
}

// 대뇌 종렬(윗면 정중앙의 얇은 홈)을 반영한 필드 (점 생성에 사용)
function bbBrainField(x, y, z) {
  const f = BB_BRAIN_CONFIG.fissure;
  if (Math.abs(z) < f.halfWidth && y > f.minY) return Infinity;
  return bbBrainFieldRaw(x, y, z);
}

// 클릭 지점이 뇌 볼륨 안(허용 오차 포함)인지
function bbIsInsideBrainVolume(x, y, z) {
  return bbBrainFieldRaw(x, y, z) <= BB_BRAIN_CONFIG.clickTolerance;
}

// 어느 부위에 가장 가까운지(굴곡 무시한 순수 타원체 기준)
function bbNearestPartIndex(x, y, z) {
  const parts = BB_BRAIN_CONFIG.parts;
  let bestIdx = 0, best = Infinity;
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    const dx = (x - p.c[0]) / p.s[0], dy = (y - p.c[1]) / p.s[1], dz = (z - p.c[2]) / p.s[2];
    const q = dx * dx + dy * dy + dz * dz;
    if (q < best) { best = q; bestIdx = i; }
  }
  return bestIdx;
}

// center에서 dir 방향으로 나아가 뇌 표면에 닿는 점(조금 안쪽)
function bbSurfacePointAlong(center, dir, insideDepth) {
  let r = 2;
  while (r < 70) {
    if (bbBrainField(center[0] + dir[0] * r, center[1] + dir[1] * r, center[2] + dir[2] * r) > 1) break;
    r += 0.4;
  }
  r = Math.max(0, r - 0.4 - insideDepth);
  return [center[0] + dir[0] * r, center[1] + dir[1] * r, center[2] + dir[2] * r];
}

// ---------------------------------------------------------
// 공간 해시 (최소 간격 검사를 빠르게)
// ---------------------------------------------------------

function bbHashKey(ix, iy, iz) {
  return ((ix + 256) * 512 + (iy + 256)) * 512 + (iz + 256);
}

function bbHashNear(hash, pts, x, y, z, minDist) {
  const cell = hash.cell;
  const range = Math.ceil(minDist / cell);
  const ix = Math.floor(x / cell), iy = Math.floor(y / cell), iz = Math.floor(z / cell);
  const md2 = minDist * minDist;
  for (let a = -range; a <= range; a++) {
    for (let b = -range; b <= range; b++) {
      for (let c = -range; c <= range; c++) {
        const list = hash.map.get(bbHashKey(ix + a, iy + b, iz + c));
        if (!list) continue;
        for (let k = 0; k < list.length; k++) {
          const p = pts[list[k]];
          const dx = p.x - x, dy = p.y - y, dz = p.z - z;
          if (dx * dx + dy * dy + dz * dz < md2) return true;
        }
      }
    }
  }
  return false;
}

function bbHashInsert(hash, x, y, z, idx) {
  const cell = hash.cell;
  const key = bbHashKey(Math.floor(x / cell), Math.floor(y / cell), Math.floor(z / cell));
  let list = hash.map.get(key);
  if (!list) { list = []; hash.map.set(key, list); }
  list.push(idx);
}

// ---------------------------------------------------------
// 메인: 뇌 모양 + 신경 회로 구조의 점 생성
// ---------------------------------------------------------

function bbGenerateBrainPoints(maxCount, minSpacing) {
  const cfg = BB_BRAIN_CONFIG;
  const pts = [];
  // 셀 크기를 가장 큰 최소간격 이상으로 잡으면 이웃 검사가 주변 27칸으로 고정되어 빠름
  const hash = { cell: Math.max(minSpacing, cfg.shellSpacing), map: new Map() };

  function tryAdd(x, y, z, g, minDist) {
    if (pts.length >= maxCount) return false;
    if (bbHashNear(hash, pts, x, y, z, minDist)) return false;
    const idx = pts.length;
    pts.push({ x, y, z, alive: true, g });
    bbHashInsert(hash, x, y, z, idx);
    return true;
  }

  // ---- 1) 피질 껍질: 뇌 표면 근처 얇은 층 ----
  // 부피 전체에서 무작위로 찍으면 대부분 허공/내부라 낭비가 크므로,
  // 각 타원체 표면 근처에서 후보를 뽑고(표면적 비례), 합집합 필드로 최종 판정한다.
  const b = cfg.bounds;
  const partWeights = cfg.parts.map((p) => p.s[0] * p.s[1] + p.s[1] * p.s[2] + p.s[0] * p.s[2]);
  const weightSum = partWeights.reduce((a, w) => a + w, 0);
  let shellCount = 0;
  let consecutiveFails = 0; // 연속 실패가 많으면 껍질이 포화된 것이므로 일찍 종료
  for (let a = 0; a < cfg.shellMaxAttempts && shellCount < cfg.shellTargetCount && consecutiveFails < cfg.shellSaturationFails; a++) {
    let pick = Math.random() * weightSum;
    let pi = 0;
    while (pi < partWeights.length - 1 && pick > partWeights[pi]) { pick -= partWeights[pi]; pi++; }
    const part = cfg.parts[pi];
    const u = bbRandUnit();
    const k = 0.93 + Math.random() * 0.14; // 표면(1.0) 근처의 반경 비율
    const x = part.c[0] + part.s[0] * u[0] * k;
    const y = part.c[1] + part.s[1] * u[1] * k;
    const z = part.c[2] + part.s[2] * u[2] * k;
    const f = bbBrainField(x, y, z);
    if (f > 1 || f < cfg.shellInnerField) { consecutiveFails++; continue; }
    if (tryAdd(x, y, z, cfg.groupShell, cfg.shellSpacing)) { shellCount++; consecutiveFails = 0; }
    else consecutiveFails++;
  }

  // ---- 2) 신경 다발: 곡선을 따라 점을 놓음 ----
  function addFiber(p0, p1, p2, p3, off, jitter0, group) {
    const S = 170;
    let last = null;
    for (let s = 0; s <= S; s++) {
      const t = s / S;
      const bz = bbCubicBezier(p0, p1, p2, p3, t);
      const w = Math.pow(t, 1.6); // 피질 쪽으로 갈수록 부채꼴로 벌어짐
      const x = bz[0] + jitter0[0] * (1 - t) + off[0] * w;
      const y = bz[1] + jitter0[1] * (1 - t) + off[1] * w;
      const z = bz[2] + jitter0[2] * (1 - t) + off[2] * w;
      if (bbBrainField(x, y, z) > cfg.insideMargin) continue;
      const cur = [x, y, z];
      if (last && bbDist(last, cur) < cfg.fiberStep) continue;
      tryAdd(x, y, z, group, minSpacing);
      last = cur;
    }
  }

  function addBundle(p0, p1, p2, p3, fiberCount, group, spread) {
    for (let f = 0; f < fiberCount; f++) {
      addFiber(p0, p1, p2, p3, bbRandInBall(spread), bbRandInBall(0.6), group);
    }
  }

  // ---- 3) 가지(수상돌기): 재귀적으로 갈라지며 퍼짐 ----
  function growTree(origin, dir, depth, length, group) {
    const stack = [{ p: origin.slice(), d: dir.slice(), depth, len: length }];
    const step = cfg.fiberStep;
    while (stack.length) {
      const s = stack.pop();
      const steps = Math.max(1, Math.round(s.len / step));
      let p = s.p.slice();
      let d = s.d.slice();
      let aborted = false;
      for (let i = 0; i < steps; i++) {
        const j = bbRandInBall(0.14);
        d = bbNorm([d[0] + j[0], d[1] + j[1], d[2] + j[2]]);
        p = [p[0] + d[0] * step, p[1] + d[1] * step, p[2] + d[2] * step];
        if (bbBrainField(p[0], p[1], p[2]) > cfg.insideMargin) { aborted = true; break; }
        tryAdd(p[0], p[1], p[2], group, minSpacing);
      }
      if (!aborted && s.depth > 1) {
        const n = Math.random() < 0.3 ? 3 : 2;
        for (let c = 0; c < n; c++) {
          const ang = (0.45 + Math.random() * 0.5) * (c % 2 ? 1 : -1);
          const nd = bbNorm(bbRotateAroundAxis(d, bbRandPerp(d), ang));
          stack.push({ p: p.slice(), d: nd, depth: s.depth - 1, len: s.len * 0.78 });
        }
      }
    }
  }

  const core = cfg.coreHub;
  const stemHub = cfg.stemHub;
  let groupCursor = 0;
  function nextBundleGroup() {
    const g = cfg.bundleGroups[groupCursor % cfg.bundleGroups.length];
    groupCursor++;
    return g;
  }

  // 피질 앵커: 대뇌 표면 위 점들 (피보나치 구면으로 고르게 분포)
  const anchors = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  const oversample = cfg.cortexAnchorCount * 4;
  for (let i = 0; i < oversample && anchors.length < cfg.cortexAnchorCount; i++) {
    const yy = 1 - (i / (oversample - 1)) * 2;
    const rr = Math.sqrt(Math.max(0, 1 - yy * yy));
    const th = golden * i + Math.random() * 0.3;
    const dir = [Math.cos(th) * rr, yy, Math.sin(th) * rr];
    const anchor = bbSurfacePointAlong(core, dir, 1.0);
    if (bbNearestPartIndex(anchor[0], anchor[1], anchor[2]) >= cfg.cerebralPartCount) continue;
    anchors.push({ anchor, dir });
  }

  // 3-a) 뇌간/중심부 -> 피질로 방사형으로 퍼지는 다발 + 끝의 가지
  anchors.forEach((a, idx) => {
    const group = nextBundleGroup();
    const fromStem = idx % 5 < 2; // 약 40%는 뇌간에서, 나머지는 중심부에서 출발
    const p0 = fromStem ? stemHub.slice() : [core[0] + (Math.random() - 0.5) * 6, core[1] + (Math.random() - 0.5) * 4, core[2] + (Math.random() - 0.5) * 6];
    const p1 = fromStem
      ? [p0[0] + (Math.random() - 0.5) * 3, p0[1] + 14, p0[2] + (Math.random() - 0.5) * 3]
      : (() => { const r = bbRandUnit(); return [p0[0] + r[0] * 6, p0[1] + r[1] * 6, p0[2] + r[2] * 6]; })();
    const inward = bbNorm([core[0] - a.anchor[0], core[1] - a.anchor[1], core[2] - a.anchor[2]]);
    const p2 = [a.anchor[0] + inward[0] * 9, a.anchor[1] + inward[1] * 9, a.anchor[2] + inward[2] * 9];
    const fibers = cfg.fibersPerBundleMin + Math.floor(Math.random() * (cfg.fibersPerBundleMax - cfg.fibersPerBundleMin + 1));
    addBundle(p0, p1, p2, a.anchor, fibers, group, cfg.fiberSpread);

    // 피질 끝에서 퍼지는 가지 (안쪽 + 옆으로)
    const tan = bbRandUnit();
    const td = bbNorm([inward[0] * 0.6 + tan[0] * 0.8, inward[1] * 0.6 + tan[1] * 0.8, inward[2] * 0.6 + tan[2] * 0.8]);
    growTree(a.anchor, td, cfg.treeDepth, cfg.treeBaseLength, group);
  });

  // 3-b) 소뇌로 가는 다발
  const cb = cfg.parts[cfg.cerebellumPartIndex];
  for (let i = 0; i < cfg.cerebellumAnchorCount; i++) {
    const u = bbRandUnit();
    const anchor = [cb.c[0] + cb.s[0] * u[0] * 0.9, cb.c[1] + cb.s[1] * u[1] * 0.9, cb.c[2] + cb.s[2] * u[2] * 0.9];
    const p0 = stemHub.slice();
    const p1 = [p0[0], p0[1] + 9, p0[2]];
    const p2 = [anchor[0] + (cb.c[0] - anchor[0]) * 0.3, anchor[1] + (cb.c[1] - anchor[1]) * 0.3, anchor[2] + (cb.c[2] - anchor[2]) * 0.3];
    const group = nextBundleGroup();
    addBundle(p0, p1, p2, anchor, 5, group, 1.6);
    const inward = bbNorm([cb.c[0] - anchor[0], cb.c[1] - anchor[1], cb.c[2] - anchor[2]]);
    growTree(anchor, inward, 3, 4.5, group);
  }

  // 3-c) 뇌량: 좌우 반구를 잇는 아치형 다발
  const arcXs = [-12, 0, 12];
  for (let i = 0; i < cfg.callosalArcs; i++) {
    const x0 = arcXs[i % arcXs.length];
    const group = nextBundleGroup();
    const p0 = [x0, 8, -13.5];
    const p1 = [x0, 10, -6];
    const p2 = [x0, 10, 6];
    const p3 = [x0 + 1, 8, 13.5];
    addBundle(p0, p1, p2, p3, cfg.callosalFibers, group, 1.2);
  }

  // ---- 4) 잔 섬유: 부피 안을 부드럽게 휘어 다니는 가는 선들 ----
  for (let f = 0; f < cfg.fillerFilaments; f++) {
    let p = null;
    for (let a = 0; a < 40; a++) {
      const x = b.x[0] + Math.random() * (b.x[1] - b.x[0]);
      const y = b.y[0] + Math.random() * (b.y[1] - b.y[0]);
      const z = b.z[0] + Math.random() * (b.z[1] - b.z[0]);
      if (bbBrainField(x, y, z) < 0.88) { p = [x, y, z]; break; }
    }
    if (!p) continue;
    let d = bbRandUnit();
    for (let s = 0; s < cfg.fillerSteps; s++) {
      const j = bbRandInBall(0.35);
      d = bbNorm([d[0] + j[0], d[1] + j[1], d[2] + j[2]]);
      p = [p[0] + d[0] * 1.1, p[1] + d[1] * 1.1, p[2] + d[2] * 1.1];
      if (bbBrainField(p[0], p[1], p[2]) > 0.95) break;
      tryAdd(p[0], p[1], p[2], cfg.groupFiller, minSpacing);
    }
  }

  return pts;
}
