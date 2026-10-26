// =========================================================
// 무한모드 (Infinite Mode) - 메이드 인 와리오식 미니게임 연속
// -----------------------------------------------------------
// 필요: Three.js(전역 THREE), template.js (GameUI, GameProgress)
//       + 8개 사고실험 페이지의 JS (도형/색/설정을 그대로 가져다 씀)
//         theseus-galley.js, boltzmann-brain-shape.js, boltzmann-brain-scene.js,
//         chinese-room-shape.js, chinese-room.js, trolley-shape.js, trolley.js, monkey.js,
//         buridan-shape.js, buridan.js, quantum.js, maxwell.js
//
// 규칙
//  - 목숨 3개. 8개 사고실험의 미니게임이 무작위 순서로 끝없이 이어짐 (한 게임 = 1단계)
//  - 제한시간: 1~10단계 10초, 이후 10단계마다 -1.5초 (최소 2.5초)
//  - 단계가 오를수록 각 게임의 난이도(개수, 속도, 보이는 시간 등)도 함께 오름 (51단계에서 최대,
//    그 뒤로는 101단계까지 보이는 시간/속도만 조금씩 더 빡빡해짐)
//  - 목숨을 모두 잃으면 게임 오버: 몇 단계까지 통과했는지 + 최고 기록
//
// 원래 페이지와 같은 모습 (혼란 방지)
//  - 각 미니게임은 원래 페이지의 도형 생성 함수(배, 뇌, 안구, 손, 자판, 당나귀, '나', 방과 분자),
//    색(설정값), 카메라 구도를 그대로 써서 그림
//  - 3D 도형은 원래 페이지의 카메라 구도(InfView)로 투영해 게임 상자 안에 그림
//  - 말풍선/스톱워치/이름표 같은 글자 요소도 원래 페이지와 같은 모양(HTML)으로 띄움
//
// 화면 좌표: 모든 미니게임은 가로 64 x 세로 36 (x: -32~32, y: -18~18) 상자 안에서 그림.
//            맨 아래 줄(y = -17.3)은 제한시간 도화선 자리라 게임 내용은 y > -15.8 에 둠.
//
// 구성
//  1) 공통 도구 (삼각형 묶음 InfBatch, 원래 구도로 투영하는 InfView, 도형 캐시)
//  2) 미니게임 8종 (INF_GAMES)
//  3) 진행 (InfiniteMode): 시작 -> [속도 UP] -> 단계 -> 명령어 -> 게임 -> 성공/실패 -> ... -> 게임 오버
//
// 미니게임 클래스의 약속: static setup(p) -> 이번 판의 설정(명령어 포함),
//   update(t, dt) = 규칙 진행, draw(t) = 그리기, onDown/onMove(상자 좌표), result: null | 'win' | 'fail'
// =========================================================

const INF_CONFIG = {
  lives: 3,
  baseTime: 10,          // 1~10단계 제한시간
  timeStep: 1.5,         // 10단계마다 줄어드는 시간
  tierSize: 10,
  minTime: 2.5,          // 제한시간 하한
  maxDifficultyStage: 51, // 이 단계에서 게임별 난이도가 최대 (제한시간도 이때 2.5초)
  box: { w: 64, h: 36 },
  fuseY: -17.3,
  bestKey: 'tel_infinite_best_v1',
  depthRange: 6,         // 3D 도형의 앞뒤 순서를 담는 깊이 폭 (z = -0.05 ~ -6.05)
};

// 색: 원래 페이지들처럼 THREE.Color로 만든 값(재질 색과 같은 처리)을 꼭짓점 색으로 씀
function infColor(hex) { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; }
function infRGB(c) { return [c.r, c.g, c.b]; }
const INF_BG = [0, 0, 0];                 // 원래 페이지들의 게임 화면 바탕 (렌더러 기본 = 검정)
const INF_BEIGE = infColor(0xf5f5dc);
const INF_GOLD = infColor(0xffd452);
const INF_RED = infColor(0xf2422f);

// 화면(실제 카메라) 정보: 페이지가 InfiniteMode.init({ view })로 넘겨줌
let INF_SCREEN = { dist: 45, camY: 0, halfW: 35, halfH: 20, ppu: 20 };

function infTimeLimit(stage) {
  const C = INF_CONFIG;
  return Math.max(C.minTime, C.baseTime - C.timeStep * Math.floor((stage - 1) / C.tierSize));
}
function infDifficulty(stage) {
  return Math.min(1, Math.max(0, (stage - 1) / (INF_CONFIG.maxDifficultyStage - 1)));
}
// 51단계 이후에도 조금씩 더 어려워지도록 (51 -> 101단계에서 0 -> 1). 몇몇 게임의 속도/보이는 시간에만 씀
function infExtra(stage) {
  return Math.min(1, Math.max(0, (stage - INF_CONFIG.maxDifficultyStage) / 50));
}

// ---------------------------------------------------------
// 작은 도구들
// ---------------------------------------------------------
function infLerp(a, b, t) { return a + (b - a) * t; }
function infClamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
function infClamp01(x) { return Math.min(1, Math.max(0, x)); }
function infSmooth(x) { x = infClamp01(x); return x * x * (3 - 2 * x); }
function infEaseOut(x) { x = infClamp01(x); return 1 - Math.pow(1 - x, 3); }
function infEaseInOut(x) { x = infClamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
function infMix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
function infFade(c, k) { return infMix(INF_BG, c, infClamp01(k)); } // k=0 바탕색, 1 원래 색 (= 원래 페이지의 투명도)
function infScale(c, k) { return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)]; }
function infRand(a, b) { return a + Math.random() * (b - a); }
function infRandInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function infPick(list) { return list[Math.floor(Math.random() * list.length)]; }
function infShuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function infPop(m) { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; }
function infDist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function infNorm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function infCross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function infRandDir() {
  const z = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), r * Math.sin(t), z];
}

// 변환 행렬 (three.js와 같은 XYZ 회전 순서: R = Rx * Ry * Rz) -> [3x4, 행 우선]
function infMat(rx, ry, rz, s, tx, ty, tz, out) {
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const M = out || new Float64Array(12);
  M[0] = cy * cz * s; M[1] = -cy * sz * s; M[2] = sy * s; M[3] = tx;
  M[4] = (cx * sz + sx * sy * cz) * s; M[5] = (cx * cz - sx * sy * sz) * s; M[6] = -sx * cy * s; M[7] = ty;
  M[8] = (sx * sz - cx * sy * cz) * s; M[9] = (sx * cz + cx * sy * sz) * s; M[10] = cx * cy * s; M[11] = tz;
  return M;
}
function infXf(M, x, y, z, out) {
  out[0] = M[0] * x + M[1] * y + M[2] * z + M[3];
  out[1] = M[4] * x + M[5] * y + M[6] * z + M[7];
  out[2] = M[8] * x + M[9] * y + M[10] * z + M[11];
  return out;
}

// 삼각형 묶음: 매 프레임 begin() -> tri()/eq()/tri3() ... -> end() 로 다시 그림 (꼭짓점 색으로 칠함)
class InfBatch {
  constructor(parent, capacity) {
    this.parent = parent;
    this.cap = capacity;
    const g = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(capacity * 9), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(capacity * 9), 3);
    if (this.pos.setUsage) { this.pos.setUsage(THREE.DynamicDrawUsage); this.col.setUsage(THREE.DynamicDrawUsage); }
    g.setAttribute('position', this.pos);
    g.setAttribute('color', this.col);
    g.setDrawRange(0, 0);
    this.geom = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.n = 0;
    this.clipTop = 17.9; // 상자 위쪽 끝 (제목바 선을 넘지 않음)
  }
  begin() { this.n = 0; }
  // 평면 삼각형 (z 고정, 상자 좌표 그대로) - 표시/효과용
  tri(ax, ay, bx, by, cx, cy, z, c) {
    if (this.n >= this.cap) return;
    const P = this.pos.array, C = this.col.array, o = this.n * 9;
    P[o] = ax; P[o + 1] = ay; P[o + 2] = z;
    P[o + 3] = bx; P[o + 4] = by; P[o + 5] = z;
    P[o + 6] = cx; P[o + 7] = cy; P[o + 8] = z;
    for (let k = 0; k < 9; k += 3) { C[o + k] = c[0]; C[o + k + 1] = c[1]; C[o + k + 2] = c[2]; }
    this.n++;
  }
  // 정삼각형 (무게중심 x,y / 한 변 s / rot=0이면 위로 뾰족 / sx,sy: 가로세로 늘림)
  eq(x, y, z, s, rot, c, sx, sy) {
    const r = s / Math.sqrt(3);
    const kx = sx === undefined ? 1 : sx, ky = sy === undefined ? 1 : sy;
    const a0 = rot + Math.PI / 2, a1 = a0 + 2.0943951, a2 = a0 + 4.1887902;
    this.tri(x + Math.cos(a0) * r * kx, y + Math.sin(a0) * r * ky,
      x + Math.cos(a1) * r * kx, y + Math.sin(a1) * r * ky,
      x + Math.cos(a2) * r * kx, y + Math.sin(a2) * r * ky, z, c);
  }
  // 3D 도형의 삼각형: 상자 좌표 (X, Y) + 깊이 d(0 = 가까움 ~ 1 = 멂), 꼭짓점마다 색
  // 깊이를 z로 바꾸면서, 실제 카메라에서 정확히 (X, Y)에 보이도록 원근만큼 키워 둠
  tri3(ax, ay, ad, bx, by, bd, cx, cy, cd, c0, c1, c2) {
    if (this.n >= this.cap) return;
    const top = this.clipTop;
    if (ay > top || by > top || cy > top) return;
    const S = INF_SCREEN, hw = S.halfW + 1.5;
    if (ay < -21 && by < -21 && cy < -21) return;
    if ((ax < -hw && bx < -hw && cx < -hw) || (ax > hw && bx > hw && cx > hw)) return;
    const D = S.dist, Y0 = S.camY, R = INF_CONFIG.depthRange;
    const P = this.pos.array, C = this.col.array, o = this.n * 9;
    let z = -0.05 - R * infClamp01(ad), k = (D - z) / D;
    P[o] = ax * k; P[o + 1] = Y0 + (ay - Y0) * k; P[o + 2] = z;
    z = -0.05 - R * infClamp01(bd); k = (D - z) / D;
    P[o + 3] = bx * k; P[o + 4] = Y0 + (by - Y0) * k; P[o + 5] = z;
    z = -0.05 - R * infClamp01(cd); k = (D - z) / D;
    P[o + 6] = cx * k; P[o + 7] = Y0 + (cy - Y0) * k; P[o + 8] = z;
    C[o] = c0[0]; C[o + 1] = c0[1]; C[o + 2] = c0[2];
    C[o + 3] = c1[0]; C[o + 4] = c1[1]; C[o + 5] = c1[2];
    C[o + 6] = c2[0]; C[o + 7] = c2[1]; C[o + 8] = c2[2];
    this.n++;
  }
  end() {
    this.geom.setDrawRange(0, this.n * 3);
    this.pos.needsUpdate = true;
    this.col.needsUpdate = true;
  }
  dispose() {
    this.parent.remove(this.mesh);
    this.geom.dispose();
    this.mesh.material.dispose();
  }
}

// 원래 페이지의 카메라 구도: 그 카메라로 본 화면 전체(세로)가 상자 세로 36칸에 맞게 들어옴
//  pos/target/up/fov = 원래 카메라, zoom = 확대, ox/oy = 상자 안에서 옮김
class InfView {
  constructor(o) {
    this.fov = o.fov || 55;
    this.zoom = o.zoom || 1;
    this.ox = o.ox || 0;
    this.oy = o.oy || 0;
    this.near = o.near || 1;
    this.far = o.far || 400;
    this.up = o.up || [0, 1, 0];
    this.k = 18 * this.zoom / Math.tan(this.fov * Math.PI / 360);
    this.A = new Float64Array(9);
    this.look(o.pos, o.target);
  }
  look(p, t) {
    this.p = p.slice();
    const f = infNorm3([t[0] - p[0], t[1] - p[1], t[2] - p[2]]);
    const r = infNorm3(infCross3(f, this.up));
    const u = infCross3(r, f);
    this.f = f; this.r = r; this.u = u;
  }
  // 세계 좌표 -> out[off..off+2] = (상자 X, 상자 Y, 깊이 0~1). 카메라 뒤면 false
  pj(x, y, z, out, off) {
    const dx = x - this.p[0], dy = y - this.p[1], dz = z - this.p[2];
    const f = this.f, r = this.r, u = this.u;
    const zc = dx * f[0] + dy * f[1] + dz * f[2];
    if (zc < this.near) return false;
    const inv = this.k / zc;
    out[off] = this.ox + (dx * r[0] + dy * r[1] + dz * r[2]) * inv;
    out[off + 1] = this.oy + (dx * u[0] + dy * u[1] + dz * u[2]) * inv;
    out[off + 2] = (zc - this.near) / (this.far - this.near);
    return true;
  }
  screen(x, y, z) { const o = [0, 0, 0]; this.pj(x, y, z, o, 0); return o; }
  // 세계 좌표의 길이 len(z=zAt 근처)이 상자에서 몇 칸인지
  unitAt(x, y, z) {
    const dx = x - this.p[0], dy = y - this.p[1], dz = z - this.p[2];
    const zc = dx * this.f[0] + dy * this.f[1] + dz * this.f[2];
    return this.k / Math.max(1e-3, zc);
  }
  tri(b, ax, ay, az, bx, by, bz, cx, cy, cz, c0, c1, c2) {
    const A = this.A;
    if (!this.pj(ax, ay, az, A, 0) || !this.pj(bx, by, bz, A, 3) || !this.pj(cx, cy, cz, A, 6)) return;
    b.tri3(A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8], c0, c1 || c0, c2 || c0);
  }
  // 변환 행렬 M(로컬 -> 세계)과 카메라를 합친 행렬 (로컬 -> 카메라 좌표): 꼭짓점마다 곱셈 9번이면 됨
  compose(M) {
    const out = this.C12 || (this.C12 = new Float64Array(12));
    const I = M || INF_IDENTITY, p = this.p, rows = [this.r, this.u, this.f];
    for (let r = 0; r < 3; r++) {
      const R = rows[r];
      for (let j = 0; j < 3; j++) out[r * 4 + j] = R[0] * I[j] + R[1] * I[4 + j] + R[2] * I[8 + j];
      out[r * 4 + 3] = R[0] * (I[3] - p[0]) + R[1] * (I[7] - p[1]) + R[2] * (I[11] - p[2]);
    }
    return out;
  }
  // 합친 행렬 Q로 로컬 좌표를 바로 투영
  pq(Q, x, y, z, out, off) {
    const zc = Q[8] * x + Q[9] * y + Q[10] * z + Q[11];
    if (zc < this.near) return false;
    const inv = this.k / zc;
    out[off] = this.ox + (Q[0] * x + Q[1] * y + Q[2] * z + Q[3]) * inv;
    out[off + 1] = this.oy + (Q[4] * x + Q[5] * y + Q[6] * z + Q[7]) * inv;
    out[off + 2] = (zc - this.near) / (this.far - this.near);
    return true;
  }
  // 삼각형 n개 (P: 꼭짓점 9개씩), M: 변환 행렬 또는 null, col(i): 색 (null이면 그리지 않음)
  mesh(b, P, n, M, col) {
    const A = this.A, Q = this.compose(M);
    for (let i = 0, o = 0; i < n; i++, o += 9) {
      const c = col(i);
      if (!c) continue;
      if (this.pq(Q, P[o], P[o + 1], P[o + 2], A, 0) && this.pq(Q, P[o + 3], P[o + 4], P[o + 5], A, 3) && this.pq(Q, P[o + 6], P[o + 7], P[o + 8], A, 6)) {
        b.tri3(A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8], c, c, c);
      }
    }
  }
}
const INF_IDENTITY = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);

// ---------------------------------------------------------
// 원래 페이지 도형 캐시: 만드는 데 오래 걸리는 것(뇌, 손, 당나귀...)은 한 번만 만들어 둠
// ---------------------------------------------------------
const INF_ASSETS = {};
const INF_ASSET_BUILDERS = {};
function infAsset(name) {
  if (!INF_ASSETS[name]) INF_ASSETS[name] = INF_ASSET_BUILDERS[name]();
  return INF_ASSETS[name];
}
// 시작 화면이 떠 있는 동안 조금씩 미리 만들어 둠 (게임 도중 멈칫하지 않도록)
function infPrecomputeAssets() {
  const names = Object.keys(INF_ASSET_BUILDERS);
  let i = 0;
  (function step() {
    if (i >= names.length) return;
    try { infAsset(names[i]); } catch (e) { /* 다음에 다시 시도 */ }
    i++;
    setTimeout(step, 30);
  })();
}

// 화면 위 글자 요소(원래 페이지의 말풍선/스톱워치/이름표)를 위한 빈 껍데기 (노드 확인용)
function infStubEl() {
  const el = {
    style: {}, className: '', textContent: '', innerHTML: '', offsetWidth: 0, offsetHeight: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, remove() {},
    querySelector() { return infStubEl(); },
  };
  return el;
}
function infBarBottom() {
  if (typeof document === 'undefined') return 80;
  const bar = document.getElementById('topBar');
  return bar ? bar.getBoundingClientRect().bottom : 80;
}

// ---------------------------------------------------------
// 공통 결과 처리용 부모 클래스
// ---------------------------------------------------------
class InfGame {
  constructor(ctx, p) {
    this.ctx = ctx;
    this.p = p;
    this.result = null;   // null | 'win' | 'fail'
    this.resultAt = 0;
    this.t = 0;
  }
  win(t) { if (!this.result) { this.result = 'win'; this.resultAt = t; } }
  fail(t, why) { if (!this.result) { this.result = 'fail'; this.resultAt = t; this.why = why || ''; } }
  timeout(t) { this.fail(t, 'timeout'); }
  onDown() {}
  onMove() {}
}

// =========================================================
// 1. 테세우스의 배 - "고쳐라!"
//    원래 갤리선(큰 트라이포드 2,100개, 판자색 #dd8844)과 사인 바다를 그대로 씀
//    부위가 하나씩 고장(어둡게 변하고 경고색으로 깜빡임) -> 클릭하면 보색 판자로 뒤집히며 교체
//    K개를 고치면 성공(배가 오른쪽으로 떠남), 하나라도 W초 넘게 방치하면 침몰
// =========================================================
INF_ASSET_BUILDERS.galley = function () {
  const cfg = THESEUS_GALLEY_CONFIG;
  const pts = galleySampleBigTripodPositions(cfg.bigTripodCount, cfg.bigTripodSpacing);
  const nb = pts.length, n = nb * 12;
  const P = new Float32Array(n * 9), TC = new Float32Array(n * 3), BC = new Float32Array(nb * 3);
  const loc = THESEUS_GALLEY_TRIANGLE_GEOMETRY.attributes.position.array;
  let o = 0;
  pts.forEach((bt, i) => {
    BC[i * 3] = bt.x; BC[i * 3 + 1] = bt.y; BC[i * 3 + 2] = bt.z;
    BIG_TRIPOD_LOCAL_TRIANGLES.forEach((tri, j) => {
      const cs = Math.cos(tri.rot), sn = Math.sin(tri.rot), ti = i * 12 + j;
      TC[ti * 3] = bt.x + tri.dx; TC[ti * 3 + 1] = bt.y + tri.dy; TC[ti * 3 + 2] = bt.z;
      for (let v = 0; v < 3; v++) {
        const lx = loc[v * 3], ly = loc[v * 3 + 1];
        P[o++] = bt.x + tri.dx + lx * cs - ly * sn;
        P[o++] = bt.y + tri.dy + lx * sn + ly * cs;
        P[o++] = bt.z;
      }
    });
  });
  // 실제 판자 구역처럼 길이 방향(x)으로 정렬한 순서
  const order = pts.map((_, i) => i).sort((a, b) => pts[a].x - pts[b].x);
  const rank = new Uint16Array(nb);
  order.forEach((bi, r) => { rank[bi] = r; });
  return { nb, n, P, TC, BC, rank };
};
// 원래 바다와 같은 삼각형 수면 (galleyBuildSea와 같은 배치)
INF_ASSET_BUILDERS.galleySea = function () {
  const cfg = GALLEY_SEA_CONFIG;
  const xz = [], fades = [];
  let z = cfg.zNear, row = 0;
  while (z > cfg.zFar) {
    const depth = cfg.cameraZ - z;
    const spacing = cfg.spacingNear + depth * cfg.spacingGrow;
    const halfW = cfg.halfFovTan * depth * 1.25 + spacing * 2; // 무한모드 상자 폭만큼만
    const size = spacing * cfg.triScale;
    const r = size / Math.sqrt(3);
    const farFade = Math.max(0, Math.min(1, (cfg.zNear - z) / (cfg.zNear - cfg.zFar)));
    const xShift = (row % 2) * spacing * 0.5;
    for (let x = -halfW + xShift; x <= halfW; x += spacing) {
      const jx = (Math.random() - 0.5) * spacing * 0.25;
      const jz = (Math.random() - 0.5) * spacing * 0.25;
      const rot = Math.random() * Math.PI * 2;
      const edgeFade = Math.max(0, (Math.abs(x) / halfW - 0.8) / 0.2);
      const fade = Math.min(1, farFade * farFade * 0.9 + edgeFade);
      for (let k = 0; k < 3; k++) {
        const ang = rot + k * (Math.PI * 2 / 3);
        xz.push(x + jx + Math.cos(ang) * r, z + jz + Math.sin(ang) * r);
        fades.push(fade);
      }
    }
    z -= spacing * 0.866;
    row++;
  }
  const n = xz.length / 2, W = cfg.waves.length;
  const sinP = new Float32Array(n * W), cosP = new Float32Array(n * W);
  for (let i = 0; i < n; i++) {
    for (let w = 0; w < W; w++) {
      const ph = xz[i * 2] * cfg.waves[w].kx + xz[i * 2 + 1] * cfg.waves[w].kz;
      sinP[i * W + w] = Math.sin(ph);
      cosP[i * W + w] = Math.cos(ph);
    }
  }
  let amp = 0;
  cfg.waves.forEach((wv) => { amp += wv.a; });
  return {
    n, xz: new Float32Array(xz), fade: new Float32Array(fades), sinP, cosP, amp,
    deep: infColor(cfg.deepColor), crest: infColor(cfg.crestColor), bg: infColor(cfg.bgColor),
  };
};

class InfTheseus extends InfGame {
  static setup(p) {
    const d = p.d, T = p.T;
    const I = infLerp(1.0, 0.42, d);          // 고장 간격
    const W = infLerp(2.5, 1.15, d) - 0.2 * p.x; // 고쳐야 하는 시간
    let K = Math.round(infLerp(3, 8, d));     // 고쳐야 하는 개수 (제한시간 안에 다 고칠 수 있는 만큼만)
    K = Math.max(1, Math.min(K, Math.floor((T - 1.0) / I) + 1, Math.floor((T - 0.5) / 0.6)));
    return { command: '고쳐라!', hint: '어둡게 변한 부위를 클릭해 새 판자로 교체하라', I, W, K };
  }
  constructor(ctx, p) {
    super(ctx, p);
    const cfg = THESEUS_GALLEY_CONFIG;
    this.G = infAsset('galley');
    this.S = infAsset('galleySea');
    // 원래 페이지의 카메라 (0, 33, 130) -> (0, 3, 0), 시야 55도. 짧은 게임이라 배를 크게 당겨 봄
    this.view = new InfView({ fov: 55, pos: [0, 33, 130], target: [0, 3, 0], zoom: 1.6, oy: -2.2, near: 2, far: 330 });
    this.seaB = ctx.batch(Math.ceil(this.S.n / 3) + 10);
    this.shipB = ctx.batch(this.G.n + 400);
    this.P = 8; // 부위 수 (원래 70개씩 30부위 -> 짧은 게임용으로 8부위)
    const G = this.G;
    this.partOf = new Uint8Array(G.nb);
    this.members = Array.from({ length: this.P }, () => []);
    for (let i = 0; i < G.nb; i++) {
      const r = Math.min(this.P - 1, Math.floor(G.rank[i] * this.P / G.nb));
      this.partOf[i] = r;
      this.members[r].push(i);
    }
    this.parts = Array.from({ length: this.P }, () => ({ state: 'intact', t: 0, brokenAt: 0, from: null, blink: 0 }));
    const base = new THREE.Color(0xdd8844); // 원래 페이지의 SHIP_COLOR
    this.cBase = infRGB(base);
    this.cBroken = infRGB(galleyGetBrokenColor(base));
    this.cRepaired = infRGB(galleyGetComplementaryColor(base));
    this.cWarn = infColor(cfg.warnColor);
    this.times = Array.from({ length: p.K }, (_, i) => 0.55 + i * p.I);
    this.next = 0;
    this.repaired = 0;
    this.shipX = 0;
    this.seaOff = Math.random() * 100;
    this.M = new Float64Array(12);
    this.wake = [];
    this.wakeAcc = 0;
    this.tmp = [0, 0, 0];
    this.cols = Array.from({ length: this.P }, () => [0, 0, 0]);
    this.pose(0);
  }
  isBroken(q) { return q.state === 'breaking' || q.state === 'broken'; }
  stateColor(state) { return state === 'repaired' ? this.cRepaired : state === 'broken' ? this.cBroken : this.cBase; }
  seaH(x, z, t) {
    const cfg = GALLEY_SEA_CONFIG;
    let h = 0;
    for (const wv of cfg.waves) h += wv.a * Math.sin((x + this.seaOff) * wv.kx + z * wv.kz + t * wv.w);
    return cfg.level + h;
  }
  // 배가 물결을 탐 (galleyShipOnSea와 같은 계산) + 침몰
  pose(t) {
    const cfg = THESEUS_GALLEY_CONFIG, lv = GALLEY_SEA_CONFIG.level;
    const half = cfg.hullLength * 0.35;
    const hc = this.seaH(this.shipX, 0, t) - lv, hb = this.seaH(this.shipX + half, 0, t) - lv, hs = this.seaH(this.shipX - half, 0, t) - lv;
    let y = hc * 0.6 + (hb + hs) * 0.2;
    const pitch = Math.atan2(hb - hs, half * 2) * 0.8;
    let roll = pitch;
    if (this.result === 'fail') {
      const k = infClamp01((t - this.resultAt) / 1.0);
      y -= 55 * k * k;
      roll = pitch * (1 - k) - 0.32 * infEaseOut(k);
    }
    infMat(0, 0, roll, 1, this.shipX, y, 0, this.M);
  }
  update(t, dt) {
    this.t = t;
    const p = this.p, cfg = THESEUS_GALLEY_CONFIG;
    if (!this.result) {
      while (this.next < p.K && t >= this.times[this.next]) {
        // 아직 원래 판자인 부위부터 (원래 페이지와 같은 순서)
        let cand = this.parts.map((q, i) => i).filter((i) => this.parts[i].state === 'intact');
        if (!cand.length) cand = this.parts.map((q, i) => i).filter((i) => this.parts[i].state === 'repaired');
        if (cand.length) {
          const q = this.parts[infPick(cand)];
          q.from = this.stateColor(q.state);
          q.state = 'breaking'; q.t = t; q.brokenAt = t; q.blink = 0;
        }
        this.next++;
      }
      if (this.parts.some((q) => this.isBroken(q) && t - q.brokenAt > p.W)) this.fail(t, 'sink');
    }
    this.parts.forEach((q) => {
      if (q.state === 'breaking' && t - q.t >= cfg.breakTransitionDuration) q.state = 'broken';
      if (q.state === 'broken') q.blink += dt * (2.5 + 14 * infClamp01((t - q.brokenAt) / p.W));
      if (q.state === 'flip' && t - q.t >= 0.45) q.state = 'repaired';
    });
    if (this.result === 'win') this.shipX += dt * cfg.travelSpeed * infClamp01((t - this.resultAt) * 3); // 완주 -> 오른쪽으로 떠남
    this.seaOff += dt * (this.result ? GALLEY_SEA_CONFIG.driftSpeed : GALLEY_SEA_CONFIG.sailSpeed);
    this.pose(t);
    this.updateWake(t, dt);
  }
  // 뱃머리에서 흩뿌려지는 물보라 (원래와 같은 판자색 삼각형)
  updateWake(t, dt) {
    const cfg = THESEUS_GALLEY_CONFIG;
    if (this.result !== 'fail') {
      this.wakeAcc += dt;
      if (this.wakeAcc >= cfg.wakeSpawnInterval * 1.6) {
        this.wakeAcc = 0;
        const halfL = cfg.hullLength / 2, M = this.M;
        const count = 1 + (Math.random() < 0.5 ? 1 : 0);
        for (let i = 0; i < count; i++) {
          const u = 0.72 + Math.random() * 0.26;
          const taper = galleyHullTaperAt(u);
          const th = Math.random() * Math.PI * 2, ny = Math.sin(th), nz = Math.cos(th);
          const w = infXf(M, u * halfL, ny * (cfg.hullHeight / 2) * taper, nz * (cfg.hullWidth / 2) * taper, [0, 0, 0]);
          const speed = infRand(cfg.wakeParticleSpeedMin, cfg.wakeParticleSpeedMax);
          const back = this.result ? 2 + Math.random() * 2 : 10 + Math.random() * 6;
          // 회전은 z축뿐이라 방향 벡터도 같은 회전
          const ox = M[1] * ny, oy = M[5] * ny, oz = nz;
          this.wake.push({
            x: w[0], y: w[1], z: w[2],
            vx: ox * speed - M[0] * back, vy: oy * speed - M[4] * back, vz: oz * speed,
            born: t, life: infRand(cfg.wakeParticleLifeMin, cfg.wakeParticleLifeMax),
            s: infRand(cfg.wakeParticleScaleMin, cfg.wakeParticleScaleMax), rot: Math.random() * 6.28,
          });
        }
      }
    }
    this.wake = this.wake.filter((q) => t - q.born < q.life);
    this.wake.forEach((q) => { q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.rot += dt * 3; });
  }
  // 부위 i의 큰 트라이포드들이 화면에서 (wx, wy)와 가장 가까운 거리
  distToPart(i, wx, wy) {
    const G = this.G, M = this.M, V = this.view, w = this.tmp, s = [0, 0, 0];
    let best = Infinity;
    const list = this.members[i];
    for (let j = 0; j < list.length; j += 2) {
      const bi = list[j];
      infXf(M, G.BC[bi * 3], G.BC[bi * 3 + 1], G.BC[bi * 3 + 2], w);
      if (!V.pj(w[0], w[1], w[2], s, 0)) continue;
      const d = Math.hypot(s[0] - wx, s[1] - wy);
      if (d < best) best = d;
    }
    return best;
  }
  // 확인용: 부위 i의 화면 위치 (가운데)
  partScreen(i) {
    const G = this.G, M = this.M, V = this.view, w = this.tmp, s = [0, 0, 0];
    let x = 0, y = 0, n = 0;
    const list = this.members[i];
    for (let j = 0; j < list.length; j += 6) {
      const bi = list[j];
      infXf(M, G.BC[bi * 3], G.BC[bi * 3 + 1], G.BC[bi * 3 + 2], w);
      if (V.pj(w[0], w[1], w[2], s, 0)) { x += s[0]; y += s[1]; n++; }
    }
    return n ? [x / n, y / n] : [0, 0];
  }
  onDown(wx, wy) {
    if (this.result) return;
    let best = -1, bd = Infinity;
    this.parts.forEach((q, i) => {
      if (!this.isBroken(q)) return;
      const d = this.distToPart(i, wx, wy);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0 && bd <= Math.max(1.7, this.ctx.px(26))) {
      const q = this.parts[best];
      q.state = 'flip'; // 부위 전체를 한꺼번에 새 판자로 (뒤집으며 교체)
      q.t = this.t;
      this.repaired++;
      if (this.repaired >= this.p.K) this.win(this.t);
    }
  }
  draw(t) {
    const V = this.view, S = this.S, cfg = GALLEY_SEA_CONFIG;
    // ----- 바다 (galleyUpdateSea와 같은 높이/색) -----
    const sb = this.seaB;
    sb.begin();
    const W = cfg.waves.length;
    const aS = new Float32Array(W), aC = new Float32Array(W);
    for (let w = 0; w < W; w++) {
      const wv = cfg.waves[w], c = this.seaOff * wv.kx + t * wv.w;
      aS[w] = wv.a * Math.cos(c); aC[w] = wv.a * Math.sin(c);
    }
    const A = V.A, cc = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const deep = S.deep, crest = S.crest, bg = S.bg;
    for (let i0 = 0; i0 < S.n; i0 += 3) {
      let ok = true;
      for (let k = 0; k < 3 && ok; k++) {
        const i = i0 + k;
        let y = cfg.level;
        for (let w = 0, q = i * W; w < W; w++, q++) y += S.sinP[q] * aS[w] + S.cosP[q] * aC[w];
        ok = V.pj(S.xz[i * 2], y, S.xz[i * 2 + 1], A, k * 3);
        const tt0 = infClamp01(((y - cfg.level) / S.amp) * 0.5 + 0.5), tt = tt0 * tt0, f = S.fade[i];
        const c = cc[k];
        for (let ch = 0; ch < 3; ch++) { const v = deep[ch] + (crest[ch] - deep[ch]) * tt; c[ch] = v + (bg[ch] - v) * f; }
      }
      if (ok) sb.tri3(A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8], cc[0], cc[1], cc[2]);
    }
    sb.end();

    // ----- 배 -----
    const G = this.G, b = this.shipB, M = this.M, p = this.p, gcfg = THESEUS_GALLEY_CONFIG;
    this.parts.forEach((q, i) => {
      const c = this.cols[i];
      let src = this.cBase;
      if (q.state === 'repaired') src = this.cRepaired;
      else if (q.state === 'breaking') {
        const k = infEaseOut((t - q.t) / gcfg.breakTransitionDuration);
        for (let ch = 0; ch < 3; ch++) c[ch] = q.from[ch] + (this.cBroken[ch] - q.from[ch]) * k;
        return;
      } else if (q.state === 'broken') {
        // 수리 시한이 다가올수록 경고색으로 점점 빠르게 깜빡임
        const urg = infClamp01((t - q.brokenAt) / p.W);
        const w = this.result ? 0 : (0.5 + 0.5 * Math.sin(q.blink * Math.PI)) * (0.25 + 0.75 * urg);
        for (let ch = 0; ch < 3; ch++) c[ch] = this.cBroken[ch] + (this.cWarn[ch] - this.cBroken[ch]) * w;
        return;
      } else if (q.state === 'flip') src = (t - q.t) / 0.45 < 0.5 ? this.cBroken : this.cRepaired;
      c[0] = src[0]; c[1] = src[1]; c[2] = src[2];
    });
    b.begin();
    const P = G.P, TC = G.TC, Q = V.compose(M);
    for (let ti = 0, o = 0; ti < G.n; ti++, o += 9) {
      const part = this.partOf[(ti / 12) | 0], q = this.parts[part], c = this.cols[part];
      let ok;
      if (q.state === 'flip') {
        // 수리: 삼각형 하나하나가 세로축으로 뒤집히며 새 판자 색으로
        const a = infClamp01((t - q.t) / 0.45) * Math.PI, cs = Math.cos(a), sn = Math.sin(a);
        const cx = TC[ti * 3], cz = TC[ti * 3 + 2];
        ok = true;
        for (let v = 0; v < 3 && ok; v++) {
          const dx = P[o + v * 3] - cx;
          ok = V.pq(Q, cx + dx * cs, P[o + v * 3 + 1], cz - dx * sn, A, v * 3);
        }
      } else {
        ok = V.pq(Q, P[o], P[o + 1], P[o + 2], A, 0) && V.pq(Q, P[o + 3], P[o + 4], P[o + 5], A, 3) && V.pq(Q, P[o + 6], P[o + 7], P[o + 8], A, 6);
      }
      if (ok) b.tri3(A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8], c, c, c);
    }
    // 물보라
    const loc = THESEUS_GALLEY_TRIANGLE_GEOMETRY.attributes.position.array;
    this.wake.forEach((q) => {
      const k = (t - q.born) / q.life;
      const s = q.s * (1 - k * 0.4), cs = Math.cos(q.rot), sn = Math.sin(q.rot);
      const col = infFade(this.cBase, 1 - k);
      const v = [0, 1, 2].map((j) => [q.x + (loc[j * 3] * cs - loc[j * 3 + 1] * sn) * s, q.y + (loc[j * 3] * sn + loc[j * 3 + 1] * cs) * s, q.z]);
      V.tri(b, v[0][0], v[0][1], v[0][2], v[1][0], v[1][1], v[1][2], v[2][0], v[2][1], v[2][2], col);
    });
    b.end();
  }
}

// =========================================================
// 2. 볼츠만 두뇌 - "잡아라!"
//    원래 뇌(신경 회로 구조, 같은 7색)에 진공이 뚫려 있고, 그 안에서 요동(흰 프랙탈 트라이포드
//    1/3/12/48개)이 끝없이 생겼다 사라짐. 아주 잠깐 금색 작은 뇌가 나타남 -> 그때 클릭
//    뇌가 아닌 순간 진공을 누르면 실패
// =========================================================
INF_ASSET_BUILDERS.bbBrain = function () {
  const cfg = BB_SCENE_CONFIG;
  const pts = bbGenerateBrainPoints(cfg.ambientMaxCount, cfg.ambientMinSpacing);
  // 진공(원래 페이지에서 게임 시작 직후 생기는 크기)과 그 앞쪽 창을 미리 걷어냄
  const c = cfg.vacuumCenter, r2 = cfg.vacuumRadius * cfg.vacuumRadius;
  const keep = pts.filter((p) => {
    const dx = p.x - c[0], dy = p.y - c[1], dz = p.z - c[2];
    return !(dx * dx + dy * dy + dz * dz <= r2 || (dz > 0 && dx * dx + dy * dy <= r2 * 0.6));
  });
  const loc = BB_AMBIENT_GEOMETRY.attributes.position.array;
  const n = keep.length, P = new Float32Array(n * 9), C = new Float32Array(n * 3);
  const pal = cfg.ambientPalette.map(infColor);
  keep.forEach((p, i) => {
    for (let v = 0; v < 3; v++) {
      P[i * 9 + v * 3] = loc[v * 3] + p.x; P[i * 9 + v * 3 + 1] = loc[v * 3 + 1] + p.y; P[i * 9 + v * 3 + 2] = loc[v * 3 + 2] + p.z;
    }
    const col = pal[p.g % pal.length];
    for (let ch = 0; ch < 3; ch++) C[i * 3 + ch] = col[ch] * cfg.ambientOpacity; // 반투명(0.85) = 검은 바탕과 섞임
  });
  return { n, P, C, shape: bbBuildBrainShape() };
};

class InfBoltzmann extends InfGame {
  static setup(p) {
    const d = p.d, T = p.T;
    const V = infClamp(infLerp(1.5, 0.88, d) - 0.13 * p.x, 0.72, T * 0.5); // 뇌가 보이는 시간
    const a0 = 0.55, a1 = Math.max(a0 + 0.05, Math.min(T - V - 0.35, a0 + T * 0.45));
    return {
      command: '잡아라!', hint: '진공 속에 뇌가 생겨나는 순간 클릭하라',
      V, appearAt: infRand(a0, a1), decoyRate: infLerp(5, 16, d), size: infLerp(1.0, 0.72, d),
    };
  }
  constructor(ctx, p) {
    super(ctx, p);
    const cfg = BB_SCENE_CONFIG;
    this.A = infAsset('bbBrain');
    // 원래 페이지의 카메라 (0, 0, 95) -> 원점, 시야 55도
    this.view = new InfView({ fov: 55, pos: [0, 0, 95], target: [0, 0, 0], zoom: 1.42, oy: -1.2, near: 20, far: 180 });
    this.b = ctx.batch(this.A.n + 2000);
    this.center = cfg.vacuumCenter;
    this.R = cfg.vacuumRadius;
    this.sway0 = Math.random() * 30;
    this.structs = [];
    this.accum = 0;
    const pos = bbRandomPointInSphere(new THREE.Vector3(this.center[0], this.center[1], this.center[2]), this.R * 0.6);
    this.brainPos = [pos.x, pos.y, pos.z];
    this.spin = Math.random() * Math.PI * 2;
    this.white = infColor(cfg.normalStructColor);
    this.gold = infColor(cfg.brainColor);
    this.M = new Float64Array(12);
    this.tmp = [0, 0, 0];
    this.tc = [0, 0, 0];
    this.mark = null;
    this.rootAt(0);
  }
  rootAt(t) { infMat(0, Math.sin((t + this.sway0) * 0.2) * BB_SCENE_CONFIG.sway, 0, 1, 0, 0, 0, this.M); }
  brainVisible(t) { return t >= this.p.appearAt && (t < this.p.appearAt + this.p.V || this.result === 'win'); }
  rootScreen(x, y, z) { const w = infXf(this.M, x, y, z, [0, 0, 0]); return this.view.screen(w[0], w[1], w[2]); }
  vacScreen() {
    const c = this.rootScreen(this.center[0], this.center[1], this.center[2]);
    const e = this.rootScreen(this.center[0] + this.R, this.center[1], this.center[2]);
    return { x: c[0], y: c[1], r: Math.hypot(e[0] - c[0], e[1] - c[1]) };
  }
  brainScreen() {
    const c = this.rootScreen(this.brainPos[0], this.brainPos[1], this.brainPos[2]);
    const e = this.rootScreen(this.brainPos[0] + BB_SCENE_CONFIG.brainWidth * this.p.size / 2, this.brainPos[1], this.brainPos[2]);
    return { x: c[0], y: c[1], r: Math.hypot(e[0] - c[0], e[1] - c[1]) };
  }
  update(t, dt) {
    this.t = t;
    this.rootAt(t);
    const cfg = BB_SCENE_CONFIG;
    if (!this.result) {
      this.accum += dt * this.p.decoyRate;
      while (this.accum >= 1) {
        this.accum -= 1;
        // 쌍생성: 에너지는 지수분포, 수명은 불확정성 원리 (원래 시뮬레이터와 같은 식)
        const energy = -Math.log(Math.random());
        const life = Math.max(cfg.minDisplayLifetime, (1 / (2 * energy)) * cfg.lifetimeDisplayScale);
        const pos = bbRandomPointInSphere(new THREE.Vector3(this.center[0], this.center[1], this.center[2]), this.R);
        this.structs.push({ unit: bbPickFractalUnit(energy), x: pos.x, y: pos.y, z: pos.z, rot: Math.random() * Math.PI * 2, born: t, life });
      }
    }
    this.structs = this.structs.filter((s) => t - s.born < s.life);
    this.spin += dt * 0.6;
  }
  onDown(wx, wy) {
    if (this.result) return;
    const vac = this.vacScreen();
    if (infDist(wx, wy, vac.x, vac.y) > vac.r + 0.8) return; // 진공 밖은 무시
    if (this.brainVisible(this.t)) {
      const br = this.brainScreen();
      if (infDist(wx, wy, br.x, br.y) <= Math.max(br.r * 1.25, this.ctx.px(34))) { this.win(this.t); return; }
    }
    this.mark = { x: wx, y: wy, t: this.t };
    this.fail(this.t, 'fluctuation');
  }
  draw(t) {
    const b = this.b, V = this.view, A = this.A, M = this.M, cfg = BB_SCENE_CONFIG;
    b.begin();
    // 뇌 (신경 회로) - 목표 완료 후에는 살짝 어두워짐
    const dim = this.result === 'win' ? 0.75 : 1, tc = this.tc;
    V.mesh(b, A.P, A.n, M, (i) => { tc[0] = A.C[i * 3] * dim; tc[1] = A.C[i * 3 + 1] * dim; tc[2] = A.C[i * 3 + 2] * dim; return tc; });
    // 요동: 흰 프랙탈 트라이포드 (나타났다 사라짐, 삼각형마다 천천히 돔)
    const loc = BB_FRACTAL_GEOMETRY.attributes.position.array, w = this.tmp, AA = V.A;
    const endK = this.result === 'win' ? Math.max(0, 1 - (t - this.resultAt) * 2) : 1;
    this.structs.forEach((s) => {
      const k = (t - s.born) / s.life;
      const op = (k < 0.15 ? k / 0.15 : k > 0.85 ? (1 - k) / 0.15 : 1) * endK;
      if (op <= 0.01) return;
      const col = infScale(this.white, op);
      const cs = Math.cos(s.rot), sn = Math.sin(s.rot);
      s.unit.offsets.forEach((off) => {
        const cx = s.x + off.dx * cs - off.dy * sn, cy = s.y + off.dx * sn + off.dy * cs;
        const a = off.rot + s.rot + (t - s.born) * 0.6, ca = Math.cos(a), sa = Math.sin(a);
        let ok = true;
        for (let v = 0; v < 3 && ok; v++) {
          const lx = loc[v * 3], ly = loc[v * 3 + 1];
          infXf(M, cx + lx * ca - ly * sa, cy + lx * sa + ly * ca, s.z, w);
          ok = V.pj(w[0], w[1], w[2], AA, v * 3);
        }
        if (ok) b.tri3(AA[0], AA[1], AA[2], AA[3], AA[4], AA[5], AA[6], AA[7], AA[8], col, col, col);
      });
    });
    // 작은 뇌 (금색, 볼츠만 두뇌와 같은 모양) - 순식간에 나타났다 사라짐
    if (this.brainVisible(t)) {
      const shape = A.shape, sz = this.p.size;
      const pulse = (this.result === 'win' ? 1 + 0.06 * Math.sin(t * 5) : 1) * sz;
      const r = cfg.brainTriSize / Math.sqrt(3) * Math.max(0.8, sz);
      const cs = Math.cos(this.spin), sn = Math.sin(this.spin);
      shape.forEach((q) => {
        let x = q.x * pulse; const y = q.y * pulse; let z = q.z * pulse;
        const rx = x * cs + z * sn; z = -x * sn + z * cs; x = rx;
        let ok = true;
        for (let k = 0; k < 3 && ok; k++) {
          const a = q.rot + k * (Math.PI * 2 / 3);
          infXf(M, this.brainPos[0] + x + Math.cos(a) * r, this.brainPos[1] + y + Math.sin(a) * r, this.brainPos[2] + z + Math.sin(a) * r * q.tilt, w);
          ok = V.pj(w[0], w[1], w[2], AA, k * 3);
        }
        if (ok) b.tri3(AA[0], AA[1], AA[2], AA[3], AA[4], AA[5], AA[6], AA[7], AA[8], this.gold, this.gold, this.gold);
      });
    }
    // 잘못 누른 자리 (붉은 삼각형이 퍼짐)
    if (this.mark) {
      const k = infClamp01((t - this.mark.t) / 0.6);
      for (let i = 0; i < 6; i++) { const a = i * 1.047 + k; b.eq(this.mark.x + Math.cos(a) * (0.6 + k * 1.8), this.mark.y + Math.sin(a) * (0.6 + k * 1.8), 0.3, 0.6, a, infFade(INF_RED, 1 - k * 0.6)); }
    }
    b.end();
  }
}

// =========================================================
// 3. 중국어 방 - "골라라!"
//    원래 구성 그대로: 왼쪽 세로 열의 색색 큰 트라이포드(12칸 중 일부만 채워진 모양),
//    오른쪽 안구 + 시신경(삼각형 10,000개), 안구 위 심사관 말풍선
//    말풍선의 모양이 잠깐 보였다가 "?"로 바뀜 -> 같은 모양의 트라이포드를 클릭
//    고르면 트라이포드가 안구로 날아가 빨려 들고, 안구가 그 색(틀리면 붉게)으로 물듦
// =========================================================
INF_ASSET_BUILDERS.crEye = function () {
  const E = CR_SHAPE_CONFIG.eye;
  const data = crGenerateEyeTriangles();
  const P = crBuildTriangleVertices(data.centers, data.normals, E.triangleSize, null, 4242);
  const n = data.count;
  const base = new Float32Array(n * 3), shade = new Float32Array(n);
  const L = crNorm([-0.45, 0.55, 0.7]);
  for (let i = 0; i < n; i++) {
    const pc = CR_EYE_PART_COLORS[data.part[i]];
    const v = 0.9 + Math.random() * 0.2;
    for (let ch = 0; ch < 3; ch++) base[i * 3 + ch] = Math.min(1, pc[ch] * v);
    const d = data.normals[i * 3] * L[0] + data.normals[i * 3 + 1] * L[1] + data.normals[i * 3 + 2] * L[2];
    shade[i] = 0.5 + 0.5 * (0.5 + 0.5 * d);
  }
  return { n, P, base, shade, u: data.u };
};

// 말풍선 속 모양 (원래 페이지의 patternSvg와 같음)
const INF_CR_LAYOUT = crGenerateTripodOffsets(1);
const INF_CR_VIEWBOX = (function () {
  const r1 = 1 / Math.sqrt(3);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  INF_CR_LAYOUT.forEach((o) => {
    const d = o.flip ? -1 : 1;
    [[o.x, o.y + d * r1], [o.x - 0.5, o.y - d * r1 / 2], [o.x + 0.5, o.y - d * r1 / 2]].forEach((p) => {
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, -p[1]); y1 = Math.max(y1, -p[1]);
    });
  });
  const size = Math.max(x1 - x0, y1 - y0) * 1.12;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return `${(cx - size / 2).toFixed(3)} ${(cy - size / 2).toFixed(3)} ${size.toFixed(3)} ${size.toFixed(3)}`;
})();
function infPatternSvg(mask) {
  const r1 = 1 / Math.sqrt(3);
  let polys = '';
  INF_CR_LAYOUT.forEach((o, i) => {
    const d = o.flip ? -1 : 1;
    const pts = [[o.x, o.y + d * r1], [o.x - 0.5, o.y - d * r1 / 2], [o.x + 0.5, o.y - d * r1 / 2]]
      .map((p) => `${p[0].toFixed(3)},${(-p[1]).toFixed(3)}`).join(' ');
    polys += (mask >> i) & 1 ? `<polygon points="${pts}" fill="#f2efe2"/>` : `<polygon points="${pts}" fill="rgba(245,245,220,0.08)"/>`;
  });
  return `<svg viewBox="${INF_CR_VIEWBOX}">${polys}</svg>`;
}

class InfChinese extends InfGame {
  static setup(p) {
    const d = p.d, T = p.T;
    const N = infClamp(Math.round(infLerp(3, 6, d)), 3, 6);
    const showTime = Math.min(infLerp(1.8, 0.75, d) - 0.15 * p.x, T * 0.4);
    const dmin = Math.round(infLerp(5, 2, d));
    // 정답과 오답들: 오답은 정답에서 dmin~dmin+1칸만 바꾼 비슷한 모양 (난이도가 오를수록 더 비슷)
    let target = 0;
    while (infPop(target) < 6 || infPop(target) > 9) target = Math.floor(Math.random() * 4096);
    const opts = [target];
    for (let tries = 0; opts.length < N && tries < 4000; tries++) {
      const flips = infRandInt(dmin, dmin + 1);
      let m = target;
      infShuffle([...Array(12).keys()]).slice(0, flips).forEach((i) => { m ^= 1 << i; });
      if (infPop(m) < 5 || infPop(m) > 10) continue;
      if (opts.every((q) => infPop(q ^ m) >= 2)) opts.push(m);
    }
    while (opts.length < N) {
      const m = Math.floor(Math.random() * 4096);
      if (infPop(m) >= 6 && infPop(m) <= 9 && opts.every((q) => infPop(q ^ m) >= 2)) opts.push(m);
    }
    const order = infShuffle(opts);
    return { command: '골라라!', hint: '심사관이 보여준 모양과 같은 기호를 클릭하라', N, showTime, options: order, answer: order.indexOf(target), target };
  }
  constructor(ctx, p) {
    super(ctx, p);
    const L = CR_LAYOUT, E = CR_SHAPE_CONFIG.eye;
    this.E = infAsset('crEye');
    // 원래 페이지의 카메라 구도(시야 55도, z=0 평면을 정면으로)에서 트라이포드 열 ~ 시신경까지만 당겨 봄
    this.view = new InfView({ fov: 55, pos: [-11, 2, 82], target: [-11, 2, 0], zoom: 1.4, oy: -2.6, near: 20, far: 160 });
    this.b = ctx.batch(this.E.n + 1400);
    this.s = L.tripodTriangleSize;
    this.offs = crGenerateTripodOffsets(this.s);
    this.opts = p.options.map((m, i) => ({
      mask: m,
      color: infRGB(new THREE.Color().setHSL(i / L.tripodCount, 0.85, 0.56)), // 원래 6색
      shade: Array.from({ length: 12 }, (_, k) => ((m >> k) & 1 ? 0.8 + Math.random() * 0.2 : 0.1)),
      x: L.columnX, y: ((p.N - 1) / 2 - i) * L.columnSpacing, hoverS: 1,
    }));
    this.hover = -1;
    this.picked = -1;
    this.fly = null;      // 고른 트라이포드가 날아가는 중
    this.parts = null;    // 12조각이 안구로 빨려 드는 중
    this.tint = [1, 1, 1];
    this.tintStart = Infinity;
    this.drainStart = Infinity;
    this.tree = null;
    this.eyeM = new Float64Array(12);
    this.tmp = [0, 0, 0];
    this.tc = [0, 0, 0];
    this.eyeAt(0);
    // 심사관 말풍선 (원래 페이지와 같은 모양)
    this.ex = ctx.el('infExaminer', '<div class="ex-name">심사관</div><div class="ex-bubble"><div class="ex-content"></div></div><div class="ex-bar"><div></div></div>');
    this.exContent = this.ex.querySelector('.ex-content');
    this.exBar = this.ex.querySelector('.ex-bar');
    this.exKey = '';
  }
  eyeAt(t) {
    // 눈은 아주 천천히 숨 쉬듯 흔들림 (원래와 같음)
    infMat(Math.sin(t * 0.27) * 0.03, CR_LAYOUT.eyeRotY + Math.sin(t * 0.35) * 0.05, 0, 1, CR_LAYOUT.eyeX, 0, 0, this.eyeM);
  }
  eyeWorld(x, y, z) { return infXf(this.eyeM, x, y, z, [0, 0, 0]); }
  optionAt(wx, wy) {
    let best = -1, bd = Infinity;
    this.opts.forEach((o, i) => {
      const s = this.view.screen(o.x, o.y, 0);
      const d = infDist(wx, wy, s[0], s[1]);
      if (d < bd) { bd = d; best = i; }
    });
    return bd <= 2.9 ? best : -1;
  }
  optScreen(i) { const o = this.opts[i]; return this.view.screen(o.x, o.y, 0); }
  onMove(wx, wy) { this.hover = this.result ? -1 : this.optionAt(wx, wy); }
  onDown(wx, wy) {
    if (this.result) return;
    const i = this.optionAt(wx, wy);
    if (i < 0) return;
    this.picked = i;
    this.hover = -1;
    const ok = i === this.p.answer;
    this.tint = ok ? this.opts[i].color : CR_GAME.wrongTint;
    this.fly = { t0: this.t, from: [this.opts[i].x, this.opts[i].y, 0], s: this.opts[i].hoverS };
    if (ok) this.win(this.t); else this.fail(this.t, 'wrong');
  }
  update(t, dt) {
    this.t = t;
    this.eyeAt(t);
    this.opts.forEach((o, i) => {
      const target = i === this.hover && !this.result ? 1.18 : 1;
      o.hoverS += (target - o.hoverS) * Math.min(1, dt * 10);
    });
    // 날아감 -> 12조각으로 흩어져 안구로 빨려 듦 (원래보다 빠르게)
    if (this.fly && !this.parts && t - this.fly.t0 >= 0.45) {
      const f = this.fly, end = this.flyPos(1);
      this.parts = this.offs.map((o, k) => ({
        start: [end[0] + o.x * f.s, end[1] + o.y * f.s, end[2]],
        target: [-7 + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3],
        axis: infNorm3([Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]), delay: k * 0.03, flip: o.flip,
      }));
      this.tintStart = t + 0.12;
      this.drainStart = this.tintStart + 0.6 + 0.12;
    }
    // 맞혔을 때만 시신경 끝에서 나무가 자라남
    if (this.result === 'win' && !this.tree && t >= this.drainStart + 0.1) this.makeTree(t);
  }
  makeTree(t) {
    const T = CR_SHAPE_CONFIG.tree;
    const count = T.minCount + Math.floor(Math.random() * (T.maxCount - T.minCount + 1));
    const tree = crGenerateTree(count);
    const verts = crBuildTriangleVertices(tree.centers, tree.normals, tree.size, tree.dirs, 99);
    const col = new Float32Array(count * 3), c = this.tint;
    for (let i = 0; i < count; i++) {
      const f = (0.6 + 0.4 * infClamp01(tree.birth[i] / 0.95)) * (0.92 + Math.random() * 0.16);
      for (let ch = 0; ch < 3; ch++) col[i * 3 + ch] = Math.min(1, c[ch] * f);
    }
    this.tree = { count, centers: tree.centers, verts, birth: tree.birth, col, t0: t };
  }
  flyPos(e) {
    const f = this.fly;
    const to = this.eyeWorld(-17, 0, 0); // 각막 바로 앞
    const mid = [(f.from[0] + to[0]) / 2, (f.from[1] + to[1]) / 2 + 7, (f.from[2] + to[2]) / 2 + 14];
    const u = 1 - e;
    return [0, 1, 2].map((k) => u * u * f.from[k] + 2 * u * e * mid[k] + e * e * to[k]);
  }
  tripod(b, cx, cy, cz, s, rot, colFn) {
    const V = this.view, r1 = this.s / Math.sqrt(3), half = this.s / 2;
    const cs = Math.cos(rot), sn = Math.sin(rot);
    this.offs.forEach((o, i) => {
      const dir = o.flip ? -1 : 1;
      const v = [[o.x, o.y + dir * r1], [o.x - half, o.y - dir * r1 / 2], [o.x + half, o.y - dir * r1 / 2]]
        .map(([x, y]) => [cx + (x * cs - y * sn) * s, cy + (x * sn + y * cs) * s, cz]);
      const c = colFn(i);
      V.tri(b, v[0][0], v[0][1], v[0][2], v[1][0], v[1][1], v[1][2], v[2][0], v[2][1], v[2][2], c);
    });
  }
  draw(t) {
    const b = this.b, V = this.view, E = this.E, p = this.p;
    b.begin();
    // ----- 왼쪽 트라이포드 열 (움직이지 않음, 고른 것만 날아감) -----
    this.opts.forEach((o, i) => {
      if (i === this.picked) return;
      let s = o.hoverS;
      if (this.result === 'fail' && i === p.answer) s *= 1.05 + 0.08 * Math.sin(t * 12); // 정답 알려 줌
      const k = s > 1.001 ? (s - 1) / 0.18 * 0.35 : 0;
      const base = infMix(o.color, [1, 1, 1], k);
      this.tripod(b, o.x, o.y, 0, s, 0, (j) => infScale(base, o.shade[j]));
    });
    if (this.fly && !this.parts) {
      const o = this.opts[this.picked];
      const e = infEaseInOut((t - this.fly.t0) / 0.45);
      const q = this.flyPos(e);
      this.tripod(b, q[0], q[1], q[2], this.fly.s * (1 + 0.25 * Math.sin(e * Math.PI)), e * Math.PI * 2, (j) => infScale(o.color, o.shade[j]));
    }
    if (this.parts) {
      const o = this.opts[this.picked], r1 = this.s / Math.sqrt(3), half = this.s / 2, rot = new Float32Array(9);
      this.parts.forEach((q) => {
        const pr = infClamp01((t - this.tintStart + 0.12 - q.delay) / 0.45);
        if (pr >= 1) return;
        const e = pr * pr;
        const to = this.eyeWorld(q.target[0], q.target[1], q.target[2]);
        const c = [0, 1, 2].map((k) => q.start[k] + (to[k] - q.start[k]) * e);
        const sc = Math.max(0.0001, (1 - infSmooth((pr - 0.5) / 0.5)) * 1.1);
        mxRotMatrix(q.axis, e * 7, rot);
        const dir = q.flip ? -1 : 1;
        const v = [[0, dir * r1], [-half, -dir * r1 / 2], [half, -dir * r1 / 2]].map(([x, y]) => [
          c[0] + (rot[0] * x + rot[1] * y) * sc, c[1] + (rot[3] * x + rot[4] * y) * sc, c[2] + (rot[6] * x + rot[7] * y) * sc]);
        V.tri(b, v[0][0], v[0][1], v[0][2], v[1][0], v[1][1], v[1][2], v[2][0], v[2][1], v[2][2], o.color);
      });
    }
    // ----- 안구: 앞(각막)에서 뒤(시신경 끝)로 물들었다가 빠져나감 -----
    const soft = CR_TIMING.soft;
    const wIn = infSmooth((t - this.tintStart) / 0.6), wOut = infSmooth((t - this.drainStart) / 0.6);
    const aIn = wIn * (1 + soft), aOut = wOut * (1 + soft), tint = this.tint, tc = this.tc;
    V.mesh(b, E.P, E.n, this.eyeM, (i) => {
      const u = E.u[i];
      const xi = infClamp01((aIn - u) / soft), xo = infClamp01((aOut - u) / soft);
      const tw = xi * (1 - xo), glow = Math.max(xi * (1 - xi), xo * (1 - xo)) * 4 * 0.35, sh = E.shade[i];
      tc[0] = ((1 - tw) * E.base[i * 3] + tw * tint[0]) * sh + glow;
      tc[1] = ((1 - tw) * E.base[i * 3 + 1] + tw * tint[1]) * sh + glow;
      tc[2] = ((1 - tw) * E.base[i * 3 + 2] + tw * tint[2]) * sh + glow;
      return tc;
    });
    // ----- 나무 -----
    if (this.tree) {
      const tr = this.tree, g = infClamp01((t - tr.t0) / 0.9) * 1.2, A = V.A, w = this.tmp, E2 = CR_SHAPE_CONFIG.eye;
      const ox = E2.nerveStartX + E2.nerveLength;
      for (let i = 0; i < tr.count; i++) {
        const k = infSmooth((g - tr.birth[i]) / 0.12);
        if (k <= 0.001) continue;
        const cx = tr.centers[i * 3], cy = tr.centers[i * 3 + 1], cz = tr.centers[i * 3 + 2];
        let ok = true;
        for (let v = 0; v < 3 && ok; v++) {
          const o = i * 9 + v * 3;
          this.eyeWorldInto(ox + cx + (tr.verts[o] - cx) * k, cy + (tr.verts[o + 1] - cy) * k, cz + (tr.verts[o + 2] - cz) * k, w);
          ok = V.pj(w[0], w[1], w[2], A, v * 3);
        }
        const wh = 0.55 * (1 - k);
        const c = [tr.col[i * 3] * (1 - wh) + wh, tr.col[i * 3 + 1] * (1 - wh) + wh, tr.col[i * 3 + 2] * (1 - wh) + wh];
        if (ok) b.tri3(A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8], c, c, c);
      }
    }
    b.end();
    this.drawExaminer(t);
  }
  eyeWorldInto(x, y, z, out) { return infXf(this.eyeM, x, y, z, out); }
  // 심사관 말풍선: 안구 꼭대기 바로 위
  drawExaminer(t) {
    const p = this.p;
    let key, html;
    if (!this.result) {
      if (t < p.showTime) { key = 'show'; html = infPatternSvg(p.target); }
      else { key = 'ask'; html = '<div class="ex-text">?</div>'; }
    } else if (this.result === 'win') { key = 'ok'; html = '<div class="ex-text ok">맞았다</div>'; }
    else { key = 'no'; html = infPatternSvg(p.target); } // 틀리면 정답 모양을 다시 보여줌
    if (key !== this.exKey) { this.exKey = key; this.exContent.innerHTML = html; }
    let frac = 0, warn = false;
    if (!this.result) {
      if (t < p.showTime) frac = 1 - t / p.showTime;
      else { frac = (p.T - t) / Math.max(0.1, p.T - p.showTime); warn = frac < 0.3; }
    }
    this.exBar.classList.toggle('warn', warn);
    if (this.exBar.firstElementChild) this.exBar.firstElementChild.style.width = (infClamp01(frac) * 100).toFixed(1) + '%';
    const a = this.eyeWorld(-3, CR_SHAPE_CONFIG.eye.R + 1, 0);
    const s = this.view.screen(a[0], a[1], a[2]);
    const px = this.ctx.toScreen(s[0], s[1]);
    const el = this.ex;
    el.style.left = (px[0] - el.offsetWidth / 2) + 'px';
    el.style.top = Math.max(infBarBottom() + 58, px[1] - el.offsetHeight - 10) + 'px';
  }
}

// =========================================================
// 4. 트롤리 딜레마 - "다수를 살려라!" / "소수를 살려라!"
//    원래 구성 그대로: 가운데 🫵 손(삼각형 7,000개, 검지가 커서를 가리킴), 손 위 스톱워치,
//    양옆의 트라이포드 무리(사람). 화면 왼쪽/오른쪽을 눌러 살릴 쪽을 고름
//    -> 검지가 굽으며 손이 내려가고, 살리지 않은 쪽 트라이포드가 붉은 삼각형으로 폭발
// =========================================================
INF_ASSET_BUILDERS.tdHand = function () {
  const H = TD_SHAPE_CONFIG.hand;
  const hand = tdGenerateHandTriangles();
  const n = hand.count;
  const rest = tdBuildTriangleVertices(hand.centers, hand.normals, H.triangleSize, null, 11);
  const Lt = tdNorm([-0.45, 0.55, 0.7]);
  const C = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const v = 0.92 + Math.random() * 0.16;
    const dh = hand.normals[i * 3] * Lt[0] + hand.normals[i * 3 + 1] * Lt[1] + hand.normals[i * 3 + 2] * Lt[2];
    const sh = (0.45 + 0.55 * (0.5 + 0.5 * dh)) * v;
    for (let ch = 0; ch < 3; ch++) C[i * 3 + ch] = TD_COLORS.skin[ch] * sh;
  }
  // 스톱워치 자리: 휴지 상태 손의 위쪽 끝 (원래와 같은 계산)
  const cx = Math.cos(TD_LAYOUT.handRotX), sx = Math.sin(TD_LAYOUT.handRotX);
  const cy = Math.cos(TD_LAYOUT.handRotY), sy = Math.sin(TD_LAYOUT.handRotY);
  let topY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = hand.centers[i * 3], y = hand.centers[i * 3 + 1], z = hand.centers[i * 3 + 2];
    topY = Math.max(topY, cx * y - sx * (-sy * x + cy * z));
  }
  return { n, rest, bone: hand.bone, C, topY };
};

class InfTrolley extends InfGame {
  static setup(p) {
    const d = p.d;
    const rule = d < 0.22 || Math.random() < 0.5 ? 'more' : 'less';
    const diff = Math.max(1, Math.round(infLerp(4, 1, d)));
    // 세는 데 시간이 걸리므로, 제한시간이 짧으면 전체 인원도 줄임 (2.5초면 최대 6명)
    const arrive = p.T * (infLerp(0.92, 0.84, d) - 0.05 * p.x);
    const totalCap = Math.max(diff + 2, Math.floor((arrive - 0.8) / 0.22));
    const maxN = Math.min(Math.round(infLerp(5, 9, d)), Math.floor((totalCap + diff) / 2));
    const small = infRandInt(1, Math.max(1, Math.min(maxN - diff, totalCap - diff - 1 + 1)));
    const big = small + diff;
    const leftBig = Math.random() < 0.5;
    return {
      command: rule === 'more' ? '다수를 살려라!' : '소수를 살려라!',
      hint: '화면 왼쪽 / 오른쪽을 눌러 살릴 쪽을 골라라',
      rule, left: leftBig ? big : small, right: leftBig ? small : big, jitter: infLerp(0.15, 1, d),
    };
  }
  constructor(ctx, p) {
    super(ctx, p);
    this.H = infAsset('tdHand');
    // 원래 페이지의 카메라 (0, 0, 60) -> 원점, 시야 55도 (화면 전체 = 상자)
    this.view = new InfView({ fov: 55, pos: [0, 0, 60], target: [0, 0, 0], zoom: 1, near: 10, far: 120 });
    this.unit = this.view.unitAt(0, 0, 0);              // 원래 단위 1 = 상자 몇 칸
    this.halfW = 32 / this.unit;                        // 상자 가로 절반 (원래 단위)
    this.floorY = -15.4 / this.unit;                    // 도화선 바로 위가 바닥
    this.b = ctx.batch(this.H.n + 1400);
    this.s = TD_SHAPE_CONFIG.tripod.triangleSize;
    this.toffs = tdTripodOffsets(this.s);
    const cx = this.halfW * TD_LAYOUT.tripodXFrac * 0.98;
    this.groupX = { left: -cx, right: cx };
    this.people = { left: this.makeGroup(p.left, -cx, p.jitter), right: this.makeGroup(p.right, cx, p.jitter) };
    this.tripodCol = infColor(TD_COLORS.tripod);
    this.aim = { x: 0, y: 0, yaw: 0, pitch: 0 };
    this.bend = 0;
    this.choice = null;      // 살린 쪽
    this.hover = null;
    this.pressAt = -1;
    this.explodeAt = Infinity;
    this.particles = null;
    this.M = new Float64Array(12);
    this.tp = [0, 0, 0];
    this.tmp = [0, 0, 0];
    this.handAt(0);
    // 손 위 스톱워치 / 무리 아래 이름표 (원래 페이지와 같은 모양)
    this.sw = ctx.el('infStopwatch', '');
    this.labels = {
      left: ctx.el('infGroupLabel', '<span class="gl-sub">왼쪽을 누르면 살림</span>'),
      right: ctx.el('infGroupLabel', '<span class="gl-sub">오른쪽을 누르면 살림</span>'),
    };
  }
  // 사람 배치: 원래처럼 가로 줄(간격 4.6), 많으면 두 줄. 난이도가 높을수록 흩어짐 (겹치지는 않음)
  makeGroup(n, cx, jitter) {
    const pts = [], sp = TD_LAYOUT.fiveSpacing;
    const rows = n > 5 ? 2 : 1, per = Math.ceil(n / rows);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / per), col = i % per;
      const inRow = Math.min(per, n - row * per);
      const gx = cx + (col - (inRow - 1) / 2) * sp, gy = (rows - 1) / 2 * sp - row * sp;
      let best = null;
      for (let tries = 0; tries < 40; tries++) {
        const x = gx + (Math.random() - 0.5) * 5.2 * jitter, y = gy + (Math.random() - 0.5) * 4.4 * jitter;
        if (pts.every((q) => infDist(q.x, q.y, x, y) >= 4.0)) { best = { x, y }; break; }
      }
      if (!best) best = { x: gx, y: gy };
      pts.push({ x: best.x, y: best.y, ph: i * 0.9 + (cx > 0 ? 1 : 0), hoverS: 1 });
    }
    return pts;
  }
  handAt(t) {
    const drop = TD_LAYOUT.handDrop * this.bend;
    infMat(TD_LAYOUT.handRotX - this.aim.pitch, TD_LAYOUT.handRotY + this.aim.yaw, 0, TD_LAYOUT.handScale, 0, -drop, 0, this.M);
  }
  onMove(wx, wy) {
    this.aim.x = infClamp(wx / 32, -1, 1);
    this.aim.y = infClamp(wy / 18, -1, 1);
    this.hover = this.choice || this.result ? null : (wx < 0 ? 'left' : 'right');
  }
  onDown(wx, wy) {
    if (this.result || this.choice) return;
    if (wy !== undefined) this.onMove(wx, wy);
    this.choose(wx < 0 ? 'left' : 'right', this.t);
    const L = this.p.left, R = this.p.right;
    const savedN = this.choice === 'left' ? L : R, otherN = this.choice === 'left' ? R : L;
    const ok = this.p.rule === 'more' ? savedN > otherN : savedN < otherN;
    if (ok) this.win(this.t); else this.fail(this.t, 'wrong');
  }
  choose(side, t) {
    this.choice = side;
    this.hover = null;
    this.pressAt = t;
    this.frozen = Math.max(0, this.p.T - t);
    this.explodeAt = t + 0.45;
  }
  timeout(t) {
    // 아무것도 고르지 않으면 원래 선로(오른쪽)로 (원래와 같음)
    if (!this.choice) { this.choice = 'left'; this.frozen = 0; this.explodeAt = t; this.pressAt = -1; }
    this.fail(t, 'timeout');
  }
  victimSide() { return this.choice === 'left' ? 'right' : 'left'; }
  explode(t) {
    const src = this.people[this.victimSide()];
    const n = Math.min(TD_SHAPE_CONFIG.particle.count, 70 * src.length);
    const r = this.s / Math.sqrt(3);
    this.particles = [];
    for (let i = 0; i < n; i++) {
      const q = src[i % src.length];
      const o = this.toffs[Math.floor(Math.random() * 3)];
      let a = Math.random(), bb = Math.random();
      if (a + bb > 1) { a = 1 - a; bb = 1 - bb; }
      const lx = o.x + (-this.s / 2) * a + (this.s / 2) * bb, ly = o.y + r * (1 - a - bb) + (-r / 2) * a + (-r / 2) * bb;
      let dx = lx + (Math.random() - 0.5) * 1.2, dy = ly + (Math.random() - 0.5) * 1.2;
      const dl = Math.hypot(dx, dy) || 1, speed = 12 + Math.random() * 22;
      this.particles.push({
        x: q.x + lx, y: q.y + ly, vx: dx / dl * speed, vy: dy / dl * speed + 10,
        ang: Math.random() * 6.28, av: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 7),
        sh: 0.8 + Math.random() * 0.2, stopped: false,
      });
    }
    this.exploded = t;
  }
  update(t, dt) {
    this.t = t;
    if (!this.choice) {
      const k = Math.min(1, dt * TD_LAYOUT.aimFollow);
      this.aim.yaw += (this.aim.x * TD_LAYOUT.aimYaw - this.aim.yaw) * k;
      this.aim.pitch += (this.aim.y * TD_LAYOUT.aimPitch - this.aim.pitch) * k;
    }
    if (this.pressAt >= 0) this.bend = infEaseInOut((t - this.pressAt) / 0.3);
    this.handAt(t);
    if (!this.particles && t >= this.explodeAt) this.explode(t);
    if (this.particles) {
      const W = this.halfW - 0.3, floor = this.floorY, g = TD_LAYOUT.gravity, e = TD_LAYOUT.restitution;
      this.particles.forEach((q) => {
        if (q.stopped) return;
        q.vy -= g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.ang += q.av * dt;
        if (q.x < -W) { q.x = -W; q.vx = Math.abs(q.vx) * e; }
        if (q.x > W) { q.x = W; q.vx = -Math.abs(q.vx) * e; }
        if (q.y <= floor) { q.y = floor; q.stopped = true; }
      });
    }
    ['left', 'right'].forEach((side) => this.people[side].forEach((q) => {
      const target = !this.choice && this.hover === side ? 1.15 : 1;
      q.hoverS += (target - q.hoverS) * Math.min(1, dt * 10);
    }));
  }
  draw(t) {
    const b = this.b, V = this.view, H = this.H;
    b.begin();
    // ----- 트라이포드 무리 (살짝 떠 있는 듯 흔들림 / 폭발 / 살린 쪽은 사라짐) -----
    const r = this.s / Math.sqrt(3), half = this.s / 2;
    ['left', 'right'].forEach((side) => {
      if (this.particles && side === this.victimSide()) return;
      let vk = 1;
      if (this.particles) vk = 1 - infSmooth((t - this.exploded) / TD_TIMING.vanish);
      if (vk <= 0) return;
      this.people[side].forEach((q) => {
        const s = q.hoverS * vk, y = q.y + Math.sin(t * 1.1 + q.ph) * 0.15;
        this.toffs.forEach((o) => {
          V.tri(b, q.x + o.x * s, y + (o.y + r) * s, 0, q.x + (o.x - half) * s, y + (o.y - r / 2) * s, 0, q.x + (o.x + half) * s, y + (o.y - r / 2) * s, 0, this.tripodCol);
        });
      });
    });
    // ----- 폭발한 붉은 삼각형 -----
    if (this.particles) {
      const rr = TD_SHAPE_CONFIG.particle.triangleSize / Math.sqrt(3), E = TD_COLORS.explode;
      this.particles.forEach((q) => {
        const c = infScale(E, q.sh), st = Math.PI * 2 / 3;
        V.tri(b, q.x + rr * Math.cos(q.ang), q.y + rr * Math.sin(q.ang), 0.2,
          q.x + rr * Math.cos(q.ang + st), q.y + rr * Math.sin(q.ang + st), 0.2,
          q.x + rr * Math.cos(q.ang + 2 * st), q.y + rr * Math.sin(q.ang + 2 * st), 0.2, c);
      });
    }
    // ----- 손: 검지가 커서를 가리키고, 고르면 검지가 굽으며 내려감 -----
    const A = V.A, Q = V.compose(this.M), tp = this.tp, R = H.rest, bend = this.bend, c = [0, 0, 0];
    for (let i = 0, o = 0; i < H.n; i++, o += 9) {
      const bo = H.bone[i];
      let ok = true;
      for (let v = 0; v < 3 && ok; v++) {
        let x = R[o + v * 3], y = R[o + v * 3 + 1], z = R[o + v * 3 + 2];
        if (bo !== 0 && bend > 0) { tdBendPoint(x, y, z, bo, bend, tp); x = tp[0]; y = tp[1]; z = tp[2]; }
        ok = V.pq(Q, x, y, z, A, v * 3);
      }
      if (ok) { c[0] = H.C[i * 3]; c[1] = H.C[i * 3 + 1]; c[2] = H.C[i * 3 + 2]; b.tri3(A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8], c, c, c); }
    }
    b.end();
    // ----- 스톱워치 / 이름표 -----
    const value = this.choice ? this.frozen : Math.max(0, this.p.T - t);
    this.sw.textContent = tdFormatTime(value);
    const top = V.screen(0, H.topY * TD_LAYOUT.handScale + TD_LAYOUT.stopwatchGap - TD_LAYOUT.handDrop * bend, 0);
    const sp = this.ctx.toScreen(top[0], top[1]);
    this.sw.style.left = sp[0] + 'px';
    this.sw.style.top = Math.max(infBarBottom() + 70, sp[1]) + 'px';
    ['left', 'right'].forEach((side) => {
      const el = this.labels[side];
      const lowest = Math.min(...this.people[side].map((q) => q.y));
      const s = V.screen(this.groupX[side], lowest - 3.0, 0);
      const pp = this.ctx.toScreen(s[0], s[1]);
      el.style.left = pp[0] + 'px';
      el.style.top = pp[1] + 'px';
      el.className = 'infGroupLabel' + (this.choice ? (this.choice === side ? ' saved' : ' lost') : (this.hover === side ? ' hover' : ''));
    });
  }
}

// =========================================================
// 5. 무한 원숭이 정리 - "쳐라!"
//    원래 구성 그대로: 위에는 빈 칸 문장(큰 삼각형 9칸 글자판), 왼쪽엔 원숭이(작은 삼각형 7개),
//    아래에는 책상 위에 눕힌 입체 자판(키마다 그 키가 치는 글자). 빈칸에 들어갈 글자의 키를 누름
//    원숭이도 옆에서 무작위로 침 (맞으면 노랗게, 틀리면 붉게 점등)
// =========================================================
class InfMonkey extends InfGame {
  static setup(p) {
    const d = p.d, T = p.T;
    const m = infClamp(Math.round(infLerp(4, 8, d)), 4, 8);
    // 첫 글자는 찾는 데 약 1.9초, 다음 글자부터는 약 1.25초 걸린다고 보고 제한시간에 맞춤
    const k = infClamp(Math.round(infLerp(2, 6, d)), 1, 1 + Math.max(0, Math.floor((T - 1.9) / 1.25)));
    // 자판 글자: 원래와 같이 3~6칸 도형 중 서로 3칸 이상 다른 것
    const alphabet = imBuildAlphabet(m);
    const targets = [];
    for (let i = 0; i < k; i++) { let g; do { g = infRandInt(0, m - 1); } while (targets.length && g === targets[targets.length - 1] && m > 1); targets.push(g); }
    return { command: '쳐라!', hint: '빈 칸에 들어갈 모양의 키를 눌러라', m, k, alphabet, targets, monkeyRate: 0.5 };
  }
  constructor(ctx, p) {
    super(ctx, p);
    const C = IM_CONFIG;
    // 원래 페이지의 카메라 (z = 57.6, 화면 높이 60)
    this.view = new InfView({ fov: 55, pos: [0, 0, 30 / Math.tan(55 * Math.PI / 360)], target: [0, 0, 0], zoom: 1.12, oy: 2.0, near: 10, far: 120 });
    this.b = ctx.batch(3000);
    this.cells = imBuildCellGeometry(C.glyphSize);
    const width = p.k * C.glyphSize + (p.k - 1) * C.glyphGap;
    this.slots = p.targets.map((g, i) => ({
      cx: -width / 2 + C.glyphSize / 2 + i * (C.glyphSize + C.glyphGap), cy: C.sentenceY,
      glyph: g, mask: 0, t0: -100, ok: false, user: false, flash: 0.3,
    }));
    this.cur = 0;
    this.monkey = { x: -width / 2 - C.monkeyOffset, y: C.sentenceY - 0.4, press: -100 };
    this.monkeyPts = [[0, 1.1], [-1.0, 0.4], [1.0, 0.4], [0, 0], [-0.7, -0.8], [0.7, -0.8], [0, -1.4]];
    // 자판 (두 줄, 원래와 같은 키 크기/간격/기울기)
    this.cols = Math.ceil(p.m / 2);
    const bw = this.cols * C.keySize + (this.cols - 1) * C.keyGap + 2.4;
    const bh = 2 * C.keySize + C.keyGap + 2.4;
    this.board = this.boxTris(bw, bh, 1.5);
    this.keyBox = this.boxTris(C.keySize, C.keySize, 1.2);
    this.keys = p.alphabet.map((mask, i) => {
      const r = Math.floor(i / this.cols), c = i % this.cols;
      const inRow = Math.min(this.cols, p.m - r * this.cols);
      return {
        x: (c - (inRow - 1) / 2) * (C.keySize + C.keyGap), y: (0.5 - r) * (C.keySize + C.keyGap),
        glyph: imGlyphVertices(mask, C.keyGlyphSize, 0.62, 0.86), press: -100, user: false,
      };
    });
    this.kbM = infMat(C.keyboardTilt, 0, 0, 1, 0, C.keyboardY, 0);
    this.hover = -1;
    this.accum = Math.random() * 0.5;
    this.tmp = [0, 0, 0];
  }
  // 원래 imBoxGeometry 그대로 (면마다 밝기)
  boxTris(w, h, d) {
    const g = imBoxGeometry(w, h, d);
    const P = Float32Array.from(g.attributes.position.array), C = g.attributes.color.array;
    const n = P.length / 9, sh = new Float32Array(n);
    for (let i = 0; i < n; i++) sh[i] = C[i * 9];
    if (g.dispose) g.dispose();
    return { P, sh, n };
  }
  keyWorld(k, z) { return infXf(this.kbM, k.x, k.y, z, [0, 0, 0]); }
  keyScreen(i) { const w = this.keyWorld(this.keys[i], 1.2); return this.view.screen(w[0], w[1], w[2]); }
  keyAt(wx, wy) {
    const C = IM_CONFIG;
    let best = -1, bd = Infinity;
    this.keys.forEach((k, i) => {
      const s = this.keyScreen(i);
      const dx = Math.abs(wx - s[0]), dy = Math.abs(wy - s[1]);
      const hw = (C.keySize + C.keyGap) / 2 * this.view.unitAt(0, C.keyboardY, 1) * 1.02;
      if (dx <= hw && dy <= hw * 0.95 && dx + dy < bd) { bd = dx + dy; best = i; }
    });
    return best;
  }
  onMove(wx, wy) { this.hover = this.result ? -1 : this.keyAt(wx, wy); }
  type(i, t, user) {
    const key = this.keys[i];
    key.press = t; key.user = user;
    const slot = this.slots[this.cur];
    if (!slot) return;
    // imPut과 같음: 지금 칸에 그 글자를 넣어 봄 (맞으면 고정, 아니면 붉게 점등 후 사라짐)
    slot.mask = this.p.alphabet[i];
    slot.t0 = t;
    slot.ok = i === slot.glyph;
    slot.user = user;
    slot.flash = user ? 0.45 : Math.min(0.3, 0.9 / IM_CONFIG.monkeySpeed);
    if (slot.ok) {
      this.cur++;
      if (this.cur >= this.slots.length) this.win(t);
    }
  }
  onDown(wx, wy) {
    if (this.result) return;
    const i = this.keyAt(wx, wy);
    if (i >= 0) this.type(i, this.t, true);
  }
  update(t, dt) {
    this.t = t;
    if (!this.result) {
      this.accum += dt * this.p.monkeyRate;
      while (this.accum >= 1 && !this.result) { this.accum -= 1; this.monkey.press = t; this.type(infRandInt(0, this.p.m - 1), t, false); }
    }
  }
  draw(t) {
    const b = this.b, V = this.view, C = IM_CONFIG, COL = IM_COLORS, p = this.p;
    b.begin();
    const completeGlow = this.result === 'win' ? 0.5 + 0.5 * Math.sin((t - this.resultAt) * 8) : 0;
    // ----- 문장: 빈 칸 판 + 채워지는 글자 (imWriteFill과 같은 색/점등) -----
    this.slots.forEach((s) => {
      this.cells.forEach((cell) => {
        const gx = (cell[0][0] + cell[1][0] + cell[2][0]) / 3, gy = (cell[0][1] + cell[1][1] + cell[2][1]) / 3, k = C.cellInset;
        const v = cell.map(([vx, vy]) => [s.cx + gx + (vx - gx) * k, s.cy + gy + (vy - gy) * k]);
        V.tri(b, v[0][0], v[0][1], -0.05, v[1][0], v[1][1], -0.05, v[2][0], v[2][1], -0.05, COL.template);
      });
      if (!s.mask) return;
      const after = t - s.t0;
      let scale = 1, color = COL.landing, glow = 0;
      if (s.ok) { color = s.user ? COL.userCorrect : COL.correct; glow = Math.max(0, 0.5 - after * 1.5) + completeGlow * 0.3; }
      else {
        color = COL.wrong;
        const f = infClamp01(after / s.flash);
        scale = 1 - infSmooth((f - 0.4) / 0.6);
        glow = Math.max(0, 0.35 - f);
      }
      if (scale <= 0.001) return;
      const c = [Math.min(1, color[0] + glow), Math.min(1, color[1] + glow), Math.min(1, color[2] + glow)];
      this.cells.forEach((cell, ci) => {
        if (!((s.mask >> ci) & 1)) return;
        const gx = (cell[0][0] + cell[1][0] + cell[2][0]) / 3, gy = (cell[0][1] + cell[1][1] + cell[2][1]) / 3, k = C.cellInset * scale;
        const v = cell.map(([vx, vy]) => [s.cx + gx + (vx - gx) * k, s.cy + gy + (vy - gy) * k]);
        V.tri(b, v[0][0], v[0][1], 0.05, v[1][0], v[1][1], 0.05, v[2][0], v[2][1], 0.05, c);
      });
    });
    // ----- 원숭이 (누를 때 통통 튐, 살랑살랑 흔들림) -----
    const mp = 1 - infSmooth((t - this.monkey.press) / 0.18);
    const ms = 1 + 0.25 * mp, mr = Math.sin(t * 3) * 0.12, cs = Math.cos(mr), sn = Math.sin(mr);
    const s0 = 0.95, r0 = s0 / Math.sqrt(3);
    this.monkeyPts.forEach(([x, y], i) => {
      const dd = i % 2 === 0 ? 1 : -1;
      const v = [[x, y + dd * r0], [x - s0 / 2, y - dd * r0 / 2], [x + s0 / 2, y - dd * r0 / 2]]
        .map(([vx, vy]) => [this.monkey.x + (vx * cs - vy * sn) * ms, this.monkey.y + (vx * sn + vy * cs) * ms]);
      V.tri(b, v[0][0], v[0][1], 0, v[1][0], v[1][1], 0, v[2][0], v[2][1], 0, COL.monkey);
    });
    // ----- 자판 (책상 위에 눕힌 입체) -----
    const A = V.A, w = this.tmp, M = this.kbM;
    const box = (bx, cx, cy, cz, sx, sy, col) => {
      for (let i = 0, o = 0; i < bx.n; i++, o += 9) {
        let ok = true;
        for (let v = 0; v < 3 && ok; v++) {
          infXf(M, cx + bx.P[o + v * 3] * sx, cy + bx.P[o + v * 3 + 1] * sy, cz + bx.P[o + v * 3 + 2], w);
          ok = V.pj(w[0], w[1], w[2], A, v * 3);
        }
        const c = infScale(col, bx.sh[i]);
        if (ok) b.tri3(A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8], c, c, c);
      }
    };
    box(this.board, 0, 0, -0.75, 1, 1, COL.board);
    this.keys.forEach((k, i) => {
      const pr = 1 - infSmooth((t - k.press) / 0.22);
      const base = i === this.hover ? COL.keyHover : COL.key;
      const lit = k.user ? COL.keyUser : COL.keyLit;
      const col = infMix(base, lit, pr);
      const sc = i === this.hover ? 1.06 : 1, kz = 0.6 - 0.55 * pr;
      box(this.keyBox, k.x, k.y, kz, sc, sc, col);
      const G = k.glyph;
      for (let j = 0; j < G.length; j += 9) {
        let ok = true;
        for (let v = 0; v < 3 && ok; v++) {
          infXf(M, k.x + G[j + v * 3] * sc, k.y - 0.15 + G[j + v * 3 + 1] * sc, kz + G[j + v * 3 + 2], w);
          ok = V.pj(w[0], w[1], w[2], A, v * 3);
        }
        if (ok) b.tri3(A[0], A[1], A[2] - 0.002, A[3], A[4], A[5] - 0.002, A[6], A[7], A[8] - 0.002, COL.keyGlyph, COL.keyGlyph, COL.keyGlyph);
      }
    });
    b.end();
  }
}

// =========================================================
// 6. 뷔리당의 당나귀 - "연타하라!" (원래와 같은 탑뷰)
//    원래 당나귀(삼각형 300개), 건초(왼쪽)/물(오른쪽) 삼각뿔 더미, 땅 위에 남는 동선
//    화면 왼쪽/오른쪽을 누르면 그쪽 더미에 삼각뿔이 붙음(0.5초 뒤 다시 평형) -> 많은 쪽으로 끌려감
//    평형이면 망설이며 가운데로 돌아옴 -> 한쪽을 연타해 더미에 닿게 하면 성공 (못 하면 바스러짐)
// =========================================================
INF_ASSET_BUILDERS.bdDonkey = function () {
  const D = BD_SHAPE_CONFIG.donkey;
  const shape = bdGenerateDonkeyTriangles();
  const n = shape.count;
  const rest = bdBuildTriangleVertices(shape.centers, shape.normals, D.triangleSize, 5);
  const L = bdNorm([-0.4, 0.7, 0.6]);
  const C = new Float32Array(n * 3), centers = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const d = shape.normals[i * 3] * L[0] + shape.normals[i * 3 + 1] * L[1] + shape.normals[i * 3 + 2] * L[2];
    const sh = (0.45 + 0.55 * (0.5 + 0.5 * d)) * (0.9 + Math.random() * 0.2);
    for (let ch = 0; ch < 3; ch++) {
      C[i * 3 + ch] = BD_COLORS.donkey[ch] * sh;
      centers[i * 3 + ch] = (rest[i * 9 + ch] + rest[i * 9 + 3 + ch] + rest[i * 9 + 6 + ch]) / 3;
    }
  }
  // 건초/물 삼각뿔 (bdBuildPiles와 같음): 옆면 3개 + 밑면, 면마다 밝기
  const s = BD_SHAPE_CONFIG.tripod.triangleSize, r = s / Math.sqrt(3), h = s * Math.sqrt(2 / 3);
  const bb = [90, 210, 330].map((dg) => [r * Math.cos(dg * Math.PI / 180), 0, r * Math.sin(dg * Math.PI / 180)]);
  const apex = [0, h, 0];
  const tetra = [[bb[0], bb[1], apex, 1.0], [bb[1], bb[2], apex, 0.78], [bb[2], bb[0], apex, 0.62], [bb[0], bb[2], bb[1], 0.45]];
  return { n, rest, C, centers, leg: shape.leg, tetra };
};

class InfBuridan extends InfGame {
  static setup(p) {
    const d = p.d, T = p.T;
    const rRef = infLerp(4.2, 6.4, d) + 0.6 * p.x; // 이 연타 속도(초당 횟수)면 제한시간의 약 60%에 도착
    const restore = infLerp(0.5, 0.42, d);
    const D = BD_LAYOUT.maxReach;                // 여기까지 오면 코끝이 더미에 닿음 (원래 단위)
    const H = infLerp(3, 5.5, d) * (D / 15.6);   // 평형일 때 가운데로 되돌아가는 빠르기
    const vRef = D / (0.6 * T - 0.2);
    const A = (vRef + H) / (rRef * restore);
    return { command: '연타하라!', hint: '건초(왼쪽)나 물(오른쪽) 한쪽을 마구 눌러라', rRef, restore, H, A, D };
  }
  constructor(ctx, p) {
    super(ctx, p);
    this.Dk = infAsset('bdDonkey');
    // 원래 탑뷰 카메라: 바로 위에서 내려다봄, 화면 위쪽 = 땅의 안쪽(-z)
    const tanH = Math.tan(55 * Math.PI / 360);
    const dist = Math.max(19 / tanH, 36 / (tanH * 16 / 9)) * 1.08;
    this.view = new InfView({ fov: 55, pos: [0, dist, -2], target: [0, 0, -2], up: [0, 0, -1], zoom: 1, near: 10, far: dist + 20 });
    this.b = ctx.batch(2200);
    this.piles = {
      hay: { side: -1, color: infColor(BD_COLORS.hay), items: [] },
      water: { side: 1, color: infColor(BD_COLORS.water), items: [] },
    };
    // 처음엔 1개씩 = 평형
    this.addTripod(this.piles.hay, -100, true);
    this.addTripod(this.piles.water, -100, true);
    this.x = 0; this.z = 0; this.targetZ = 0; this.yaw = Math.PI / 2; this.walk = 0; this.walkPhase = 0; this.facing = 0;
    this.trail = []; this.trailIdx = new Set();
    this.trailMark(0, 0, 1, 0);
    this.reached = 0;
    this.crumble = null;
    this.trailCol = BD_COLORS.trail;
    this.M = new Float64Array(12);
    this.tmp = [0, 0, 0];
    this.tc = [0, 0, 0];
    this.donkeyAt(0);
    this.labels = { '-1': ctx.el('infSideLabel left', '← 건초'), '1': ctx.el('infSideLabel right', '물 →') };
  }
  addTripod(pile, t, instant) {
    const used = new Set(pile.items.filter((it) => it.removeStart < 0).map((it) => it.slotIndex));
    let si = 0;
    while (used.has(si)) si++;
    pile.items.push({ slot: bdSlotPosition(pile, si), slotIndex: si, born: instant ? -100 : t, removeStart: -1, rot: Math.random() * Math.PI * 2, restoreAt: instant ? undefined : t + this.p.restore });
  }
  counts() {
    const alive = (pl) => pl.items.filter((it) => it.removeStart < 0).length;
    return { hay: alive(this.piles.hay), water: alive(this.piles.water) };
  }
  imbalance() { const c = this.counts(); return c.water - c.hay; }
  trailMark(x, z, dx, dz) {
    const sp = BD_LAYOUT.trailSpacing;
    const key = Math.round(x / sp) + ':' + Math.round(z / sp);
    if (this.trailIdx.has(key) || this.trail.length >= 600) return;
    this.trailIdx.add(key);
    const l = Math.hypot(dx, dz) || 1;
    this.trail.push({ x, z, dx: dx / l, dz: dz / l });
  }
  onDown(wx) {
    if (this.result) return;
    const side = wx < 0 ? -1 : 1;
    this.addTripod(side < 0 ? this.piles.hay : this.piles.water, this.t, false);
    // 앞뒤(깊이)로 살짝 비틀거림
    this.targetZ = infClamp(this.z + (Math.random() * 2 - 1) * BD_LAYOUT.zig, BD_LAYOUT.zMin, BD_LAYOUT.zMax);
    const el = this.labels[String(side)];
    el.classList.add('hit');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('hit'), 120);
  }
  timeout(t) {
    this.fail(t, 'timeout');
    this.startCrumble(t);
  }
  startCrumble(t) {
    const n = this.Dk.n;
    const C = { vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n), delay: new Float32Array(n), ox: new Float32Array(n), oy: new Float32Array(n), oz: new Float32Array(n), spin: new Float32Array(n), t0: t };
    for (let i = 0; i < n; i++) {
      C.vx[i] = (Math.random() - 0.5) * 5; C.vy[i] = 1 + Math.random() * 4; C.vz[i] = (Math.random() - 0.5) * 5;
      C.delay[i] = (Math.max(0, (9.5 - this.Dk.centers[i * 3 + 1]) / 9.5) * 0.7 + Math.random() * 0.25) * 0.4; // 위쪽(귀, 머리)부터
      C.spin[i] = (Math.random() - 0.5) * 10;
    }
    this.crumble = C;
  }
  update(t, dt) {
    this.t = t;
    dt = Math.min(1 / 30, dt);
    const L = BD_LAYOUT, p = this.p;
    // 더미: 0.5초 뒤 다시 평형 (줄어들며 사라짐)
    Object.values(this.piles).forEach((pile) => {
      pile.items.forEach((it) => { if (it.restoreAt !== undefined && it.removeStart < 0 && t >= it.restoreAt) it.removeStart = t; it.rot += 0.004; });
      pile.items = pile.items.filter((it) => it.removeStart < 0 || t - it.removeStart < 0.8);
    });
    let walking = false;
    if (!this.result) {
      const imb = this.imbalance();
      let v = imb * p.A;
      if (Math.abs(this.x) > 0.05) v -= Math.sign(this.x) * p.H; // 망설임: 가운데로 되돌아감
      else if (imb === 0) { v = 0; this.x = 0; }
      this.x = infClamp(this.x + v * dt, -p.D, p.D);
      const dz = this.targetZ - this.z;
      this.z += Math.sign(dz) * Math.min(Math.abs(dz), 7 * dt);
      if (Math.abs(v) > 0.4) {
        walking = true;
        this.trailMark(this.x, this.z, Math.sign(v), dz);
        this.facing = Math.atan2(-dz * 0.3, Math.sign(v));
      } else this.targetZ += (0 - this.targetZ) * Math.min(1, dt);
      if (Math.abs(this.x) >= p.D) { this.reached = Math.sign(this.x); this.win(t); }
    }
    // 바라보는 방향: 걷는 중이면 가는 쪽, 멈춰 있으면 건초와 물을 번갈아 봄 (망설임)
    let yawT;
    if (this.result === 'win') yawT = this.reached > 0 ? 0 : Math.PI;
    else if (walking) yawT = this.facing;
    else yawT = Math.PI / 2 + Math.sin(t * 2.2) * 0.65;
    let dy = yawT - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += dy * Math.min(1, dt * 5);
    this.walk += ((walking ? 1 : 0) - this.walk) * Math.min(1, dt * 8);
    this.walkPhase += dt * 14 * this.walk;
    if (this.crumble) {
      const C = this.crumble, n = this.Dk.n;
      for (let i = 0; i < n; i++) {
        if (t - C.t0 - C.delay[i] <= 0) continue;
        C.vy[i] -= 14 * dt;
        C.ox[i] += C.vx[i] * dt; C.oy[i] += C.vy[i] * dt; C.oz[i] += C.vz[i] * dt;
        if (this.Dk.centers[i * 3 + 1] + C.oy[i] < 0.05) { C.oy[i] = 0.05 - this.Dk.centers[i * 3 + 1]; C.vx[i] *= 0.8; C.vz[i] *= 0.8; C.vy[i] = 0; }
      }
    }
    this.donkeyAt(t);
  }
  donkeyAt(t) {
    let bob = Math.abs(Math.sin(this.walkPhase)) * 0.18 * this.walk;
    if (this.result === 'win') bob = -0.25 + 0.25 * Math.sin((t - this.resultAt) * 5); // 먹고 마시는 끄덕임
    infMat(0, this.yaw, 0, BD_LAYOUT.donkeyScale, this.x, bob, this.z, this.M);
  }
  draw(t) {
    const b = this.b, V = this.view, Dk = this.Dk, A = V.A, w = this.tmp;
    b.begin();
    // ----- 걸은 길 (땅에 눕힌 삼각형) -----
    const tr = (BD_LAYOUT.trailSize / Math.sqrt(3)) * (this.crumble ? 1 - infSmooth((t - this.crumble.t0) / 1.0) : 1);
    if (tr > 0.01) this.trail.forEach((it) => {
      const fx = it.dx, fz = it.dz, sx = -it.dz, sz = it.dx;
      V.tri(b, it.x + fx * tr, 0.03, it.z + fz * tr,
        it.x - fx * tr / 2 + sx * tr * 0.866, 0.03, it.z - fz * tr / 2 + sz * tr * 0.866,
        it.x - fx * tr / 2 - sx * tr * 0.866, 0.03, it.z - fz * tr / 2 - sz * tr * 0.866, this.trailCol);
    });
    // ----- 건초 / 물 더미 (위에서 떨어져 붙고, 다시 평형이 되면 줄어들며 사라짐) -----
    Object.values(this.piles).forEach((pile) => {
      const eat = this.result === 'win' && this.reached === pile.side ? 0.25 + 0.25 * Math.sin(t * 6) : 0;
      pile.items.forEach((it) => {
        let sc, y = it.slot.y, k = 0;
        if (it.removeStart >= 0) sc = 1 - infSmooth((t - it.removeStart) / 0.8);
        else {
          const pr = infClamp01((t - it.born) / BD_TIMING.tripodDrop), e = infEaseOut(pr);
          y += (1 - e) * 6;
          sc = 0.6 + 0.4 * e;
          const flash = pr >= 1 ? Math.max(0, 1 - (t - it.born - BD_TIMING.tripodDrop) / 0.5) : 0;
          k = Math.max(flash * 0.5, eat);
        }
        if (sc <= 0.001) return;
        const col = infMix(pile.color, [1, 1, 1], k);
        const cs = Math.cos(it.rot), sn = Math.sin(it.rot);
        Dk.tetra.forEach(([pa, pb, pc, sh]) => {
          const v = [pa, pb, pc].map((q) => [it.slot.x + (q[0] * cs + q[2] * sn) * sc, y + q[1] * sc, it.slot.z + (-q[0] * sn + q[2] * cs) * sc]);
          V.tri(b, v[0][0], v[0][1], v[0][2], v[1][0], v[1][1], v[1][2], v[2][0], v[2][1], v[2][2], infScale(col, sh));
        });
      });
    });
    // ----- 당나귀 (다리를 흔들며 걷고, 실패하면 바스러짐) -----
    const legs = BD_SHAPE_CONFIG.donkey.legs, R = Dk.rest, M = this.M, swing = this.walk * 0.45, C = this.crumble;
    for (let i = 0, o = 0; i < Dk.n; i++, o += 9) {
      const lg = Dk.leg[i];
      let ok = true, a = 0, hx = 0, hy = 0, sc = 1, cx = 0, cy = 0, cz = 0, ca = 1, sa = 0;
      if (C) {
        const lt = t - C.t0 - C.delay[i];
        if (lt > 0) sc = 1 - infSmooth(lt / 0.6);
        cx = Dk.centers[i * 3]; cy = Dk.centers[i * 3 + 1]; cz = Dk.centers[i * 3 + 2];
        const ang = Math.max(0, lt) * C.spin[i];
        ca = Math.cos(ang); sa = Math.sin(ang);
        if (sc <= 0.001) continue;
      } else if (lg !== 0 && swing > 0.001) {
        a = Math.sin(this.walkPhase + ((lg === 1 || lg === 4) ? 0 : Math.PI)) * swing;
        hx = legs[lg - 1][0][0]; hy = legs[lg - 1][0][1];
      }
      const cs = Math.cos(a), sn = Math.sin(a);
      for (let v = 0; v < 3 && ok; v++) {
        let x = R[o + v * 3], y = R[o + v * 3 + 1], z = R[o + v * 3 + 2];
        if (C) {
          const dx = (x - cx) * sc, dy = (y - cy) * sc, dz = (z - cz) * sc;
          x = cx + C.ox[i] + dx * ca - dy * sa; y = cy + C.oy[i] + dx * sa + dy * ca; z = cz + C.oz[i] + dz;
        } else if (a !== 0) {
          const dx = x - hx, dy = y - hy;
          x = hx + dx * cs - dy * sn; y = hy + dx * sn + dy * cs;
        }
        infXf(M, x, y, z, w);
        ok = V.pj(w[0], w[1], w[2], A, v * 3);
      }
      if (ok) { const c = [Dk.C[i * 3], Dk.C[i * 3 + 1], Dk.C[i * 3 + 2]]; b.tri3(A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8], c, c, c); }
    }
    b.end();
  }
}

// =========================================================
// 7. 양자 자살과 불멸 - "따라가라!" (원래 3인칭 "모든 분기" 구도)
//    '나'들(트라이포드로 면이 이루어진 삼각뿔)이 나란히 서 있고, 오른쪽에 빨간 삼각형이 나타나 점등
//    -> 대부분 왼쪽으로 바스러져 시체로 남고 하나만 살아남음(살아남은 이유가 뜸)
//    살아남은 '나'를 재빨리 클릭 -> 그 '나'가 위로 올라가고 다시 갈라짐 (R번 반복)
// =========================================================
INF_ASSET_BUILDERS.qsFig = function () {
  const C = QS_CONFIG;
  const shape = qsTetraTriangles(C.figureEdge, 2);
  const L = [-0.45, 0.7, 0.55], ll = Math.hypot(...L);
  const n = shape.length;
  const rest = new Float32Array(n * 9), centers = new Float32Array(n * 3), colors = new Float32Array(n * 3);
  shape.forEach((tq, i) => {
    tq.p.forEach((v, k) => rest.set(v, i * 9 + k * 3));
    for (let k = 0; k < 3; k++) centers[i * 3 + k] = (tq.p[0][k] + tq.p[1][k] + tq.p[2][k]) / 3;
    const d = (tq.n[0] * L[0] + tq.n[1] * L[1] + tq.n[2] * L[2]) / ll;
    const sh = 0.5 + 0.5 * (0.5 + 0.5 * d);
    colors.set([0.93 * sh, 0.91 * sh, 0.86 * sh], i * 3);
  });
  return { n, rest, centers, colors };
};

class InfQuantum extends InfGame {
  static setup(p) {
    const d = p.d, T = p.T;
    const N = infClamp(Math.round(infLerp(3, 8, d)), 3, 8);
    const ramp = infLerp(0.75, 0.45, d);
    const windowT = infLerp(1.6, 1.0, d) - 0.15 * p.x;
    const R = infClamp(1 + Math.floor(d * 2.5), 1, Math.max(1, Math.floor((T - 0.3) / (ramp + 1.05))));
    return { command: '따라가라!', hint: '바스러지지 않고 살아남은 나를 클릭하라', N, ramp, windowT, R, decoy: d > 0.35 };
  }
  constructor(ctx, p) {
    super(ctx, p);
    this.S = infAsset('qsFig');
    this.camY = 0;
    this.view = new InfView({ fov: 55, pos: QS_CONFIG.thirdCam, target: QS_CONFIG.thirdLook, zoom: 1.25, oy: 1.0, near: 5, far: 120 });
    this.b = ctx.batch(this.S.n * p.N * (p.R + 1) + 400);
    this.gap = Math.min(QS_CONFIG.figureGap, 46 / p.N);
    this.redX = Math.min(3.2, this.gap * 0.48);
    this.level = 0;
    this.round = 0;
    this.remains = [];
    this.litTimes = [];
    this.labelEls = [];
    this.tmp = [0, 0, 0];
    this.startRound(0, true);
  }
  slotX(i) { return (i - (this.p.N - 1) / 2) * this.gap; }
  makeFig(x, y, born) {
    return { x, y, born, state: 'alive', reason: null, deathAt: Infinity, P: null };
  }
  startRound(t, first) {
    const p = this.p, y = this.level * QS_CONFIG.levelHeight;
    this.figs = Array.from({ length: p.N }, (_, i) => this.makeFig(this.slotX(i), y, first ? -10 : t));
    this.survivor = infRandInt(0, p.N - 1);
    this.lateDecoy = -1;
    if (p.decoy && p.N >= 3) { do { this.lateDecoy = infRandInt(0, p.N - 1); } while (this.lateDecoy === this.survivor); }
    this.roundStart = t + (first ? 0 : 0.25);
    this.resolved = false;
    this.cleared = -1;
  }
  resolve(t) {
    const C = QS_CONFIG, S = this.S;
    this.resolved = true;
    this.resolveAt = t;
    this.figs.forEach((f, i) => {
      if (i === this.survivor) { f.state = 'survived'; f.reason = infPick(QS_REASONS); return; }
      // 빨간 삼각형 반대쪽(왼쪽)으로 바스러짐 (qsResolve와 같은 식)
      f.state = 'dying';
      f.deathAt = t + (i === this.lateDecoy ? 0.32 : 0);
      const n = S.n;
      f.vx = new Float32Array(n); f.vy = new Float32Array(n); f.vz = new Float32Array(n); f.spin = new Float32Array(n);
      f.ox = new Float32Array(n); f.oy = new Float32Array(n); f.oz = new Float32Array(n); f.delay = new Float32Array(n); f.settled = new Uint8Array(n);
      for (let j = 0; j < n; j++) {
        f.vx[j] = -(3 + Math.random() * 7); f.vy[j] = -1 + Math.random() * 4; f.vz[j] = (Math.random() - 0.5) * 4;
        f.spin[j] = (Math.random() - 0.5) * 10;
        f.delay[j] = (S.centers[j * 3] + C.figureEdge / 2) / C.figureEdge * 0.35 * Math.random();
      }
    });
  }
  figScreen(i) { const f = this.figs[i]; return this.view.screen(f.x, f.y + 1.3, 0); }
  figAt(wx, wy) {
    let best = -1, bd = Infinity;
    this.figs.forEach((f, i) => { const s = this.figScreen(i); const d = infDist(wx, wy, s[0], s[1]); if (d < bd) { bd = d; best = i; } });
    return bd <= Math.min(4.2, this.gap * 0.55) ? best : -1;
  }
  onDown(wx, wy) {
    if (this.result || this.cleared >= 0) return;
    const i = this.figAt(wx, wy);
    if (i < 0) return;
    if (i === this.survivor && this.resolved) {
      this.cleared = this.t;
      this.round++;
      this.litTimes.push(this.t);
      this.riseFrom = this.figs[i].y;
      if (this.round >= this.p.R) this.win(this.t);
    } else {
      this.badPick = i;
      this.fail(this.t, 'wrong');
    }
  }
  update(t, dt) {
    this.t = t;
    dt = Math.min(1 / 30, dt);
    const p = this.p, C = QS_CONFIG;
    if (!this.result) {
      if (this.cleared >= 0) {
        // 살아남은 '나'가 그 자리에서 위로 올라감 (카메라도 함께) -> 다시 갈라짐
        const k = infEaseInOut((t - this.cleared) / 0.35);
        const ch = this.figs[this.survivor];
        ch.y = this.riseFrom + C.levelHeight * k;
        this.camY = ch.y;
        if (k >= 1) {
          this.figs.forEach((f) => { if (f.state !== 'survived') this.remains.push(f); });
          this.level++;
          this.startRound(t, false);
        }
      } else if (!this.resolved && t - this.roundStart >= p.ramp) this.resolve(t);
      else if (this.resolved && t - this.resolveAt > p.windowT) this.fail(t, 'missed');
    }
    if (this.result === 'win' && this.cleared >= 0) {
      const k = infEaseInOut((t - this.cleared) / 0.35), ch = this.figs[this.survivor];
      ch.y = this.riseFrom + C.levelHeight * k;
      this.camY = ch.y;
    }
    this.view.look([C.thirdCam[0], C.thirdCam[1] + this.camY, C.thirdCam[2]], [C.thirdLook[0], C.thirdLook[1] + this.camY, C.thirdLook[2]]);
    this.figs.concat(this.remains).forEach((f) => { if (f.state === 'dying' || f.state === 'dead') this.crumbleStep(f, t, dt); });
  }
  crumbleStep(f, t, dt) {
    const S = this.S;
    const lt0 = t - f.deathAt;
    if (lt0 <= 0) return;
    for (let j = 0; j < S.n; j++) {
      if (lt0 - f.delay[j] <= 0 || f.settled[j]) continue;
      f.vy[j] -= 9 * dt;
      f.ox[j] += f.vx[j] * dt; f.oy[j] += f.vy[j] * dt; f.oz[j] += f.vz[j] * dt;
      f.vx[j] *= 0.985;
      if (S.centers[j * 3 + 1] + f.oy[j] <= 0.05) { f.oy[j] = 0.05 - S.centers[j * 3 + 1]; f.settled[j] = 1; }
    }
  }
  draw(t) {
    const b = this.b, V = this.view, S = this.S, C = QS_CONFIG, A = V.A, p = this.p;
    b.begin();
    const drawFig = (f, isCur, idx) => {
      const born = infSmooth((t - f.born) / 0.3);
      if (born <= 0.001) return;
      const lt0 = t - f.deathAt;
      const bad = this.result === 'fail' && isCur && idx === this.badPick;
      for (let j = 0, o = 0; j < S.n; j++, o += 9) {
        let sc = born, cx = S.centers[j * 3], cy = S.centers[j * 3 + 1], cz = S.centers[j * 3 + 2], ox = 0, oy = 0, oz = 0, ca = 1, sa = 0, dim = 1;
        if (lt0 > 0) {
          const lt = lt0 - f.delay[j];
          if (lt > 0) {
            sc = 1 - 0.45 * infSmooth(lt / 1.4);
            dim = 1 - 0.55 * infSmooth(lt / 1.4); // 시체는 어둡게
            const a = Math.max(0, lt) * f.spin[j] * (f.settled[j] ? 0 : 1);
            ca = Math.cos(a); sa = Math.sin(a);
          }
          ox = f.ox[j]; oy = f.oy[j]; oz = f.oz[j];
        }
        let ok = true;
        for (let v = 0; v < 3 && ok; v++) {
          const dx = (S.rest[o + v * 3] - cx) * sc, dy = (S.rest[o + v * 3 + 1] - cy) * sc, dz = (S.rest[o + v * 3 + 2] - cz) * sc;
          ok = V.pj(f.x + (cx * born) + ox + dx * ca - dy * sa, f.y + cy * born + oy + dx * sa + dy * ca, cz * born + oz + dz, A, v * 3);
        }
        let c = [S.colors[j * 3] * dim, S.colors[j * 3 + 1] * dim, S.colors[j * 3 + 2] * dim];
        if (bad) c = infMix(c, INF_RED, 0.7);
        if (ok) b.tri3(A[0], A[1], A[2], A[3], A[4], A[5], A[6], A[7], A[8], c, c, c);
      }
      if (!isCur) return;
      // 빨간 삼각형: 서서히 나타남 -> 점등 -> 사라짐
      let ro = 0, rc = [0.45, 0.04, 0.04], rs = 1;
      if (this.cleared < 0) {
        const k = (t - this.roundStart) / p.ramp;
        if (!this.resolved) {
          if (k < 0.7) ro = infSmooth(k / 0.7);
          else { ro = 1; rc = [1, 0.12 + 0.2 * Math.sin((t - this.roundStart) * 30) ** 2, 0.08]; rs = 1.25; }
        } else { ro = 1 - infSmooth((t - this.resolveAt) / 0.8); rc = [0.95, 0.1, 0.08]; }
      }
      ro *= born;
      if (ro > 0.01) {
        const s = 1.5 * rs, rr = s / Math.sqrt(3), cxr = f.x + this.redX, cyr = f.y + 1.7, c = infScale(rc, ro);
        V.tri(b, cxr, cyr + rr, 0, cxr - s / 2, cyr - rr / 2, 0, cxr + s / 2, cyr - rr / 2, 0, c);
      }
    };
    this.remains.forEach((f) => drawFig(f, false, -1));
    this.figs.forEach((f, i) => drawFig(f, true, i));
    // 아래 선: 흐린 삼각형 줄 + 살아남을 때마다 하나씩 빛나는 삼각형 (화면 아래에 고정)
    const span = (C.figures - 1) * C.figureGap + 8, nl = C.lineSlots, gap = span / (nl - 1), s = 0.6, r = s / Math.sqrt(3);
    const by = this.camY + C.lineOffsetY;
    for (let i = 0; i < nl; i++) {
      const x = -span / 2 + i * gap, lit = i < this.litTimes.length;
      let k = 1, c = [0.22, 0.22, 0.25];
      if (lit) {
        const age = t - this.litTimes[i];
        k = 1.15 + 0.6 * Math.max(0, 1 - age / 0.5);
        const g = Math.max(0, 1 - age / 0.8);
        c = [1, 0.86 + 0.14 * g, 0.45 + 0.55 * g];
      }
      V.tri(b, x, by + r * k, 0, x - s / 2 * k, by - r / 2 * k, 0, x + s / 2 * k, by - r / 2 * k, 0, c);
    }
    b.end();
    // 살아남은 이유 (원래 페이지의 figLabel)
    while (this.labelEls.length < this.figs.length) this.labelEls.push(this.ctx.el('infFigLabel', ''));
    this.labelEls.forEach((el, i) => {
      const f = this.figs[i];
      const show = f && f.reason && this.resolved ? infSmooth((t - this.resolveAt - 0.35) / 0.3) * (this.cleared >= 0 ? 1 - infSmooth((t - this.cleared) / 0.25) : 1) : 0;
      el.style.opacity = String(show);
      if (!f || show <= 0) return;
      el.textContent = f.reason;
      const sc = V.screen(f.x, f.y + C.figureEdge * 0.82 + 1.6, 0);
      const px = this.ctx.toScreen(sc[0], sc[1]);
      el.style.left = px[0] + 'px';
      el.style.top = px[1] + 'px';
    });
  }
}

// =========================================================
// 8. 맥스웰의 악마 - "분리하라!"
//    원래 구성 그대로: 모서리를 작은 삼각형으로 나열한 방, 가운데 구멍(문)이 있는 칸막이,
//    빨강(빠름)/파랑(느림) 삼각뿔 분자, 방 위의 뇌(기억 칸)
//    잘못된 방의 분자를 클릭 -> 구멍 앞으로 데려와 관찰(기억 한 칸) -> 문을 열고 옳은 방으로
//    제자리 분자를 잘못 누르면 돌려보내고, (난이도가 오르면) 다른 분자 하나가 다시 섞임
// =========================================================
INF_ASSET_BUILDERS.mxRoom = function () {
  const C = MX_CONFIG, hx = C.room.hx, hy = C.room.hy, hz = C.room.hz, h = C.holeHalf;
  const segs = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    segs.push([[-hx, a * hy, b * hz], [hx, a * hy, b * hz]]);
    segs.push([[a * hx, -hy, b * hz], [a * hx, hy, b * hz]]);
    segs.push([[a * hx, b * hy, -hz], [a * hx, b * hy, hz]]);
  }
  const rect = (y0, y1, z0, z1) => [[[0, y0, z0], [0, y0, z1]], [[0, y1, z0], [0, y1, z1]], [[0, y0, z0], [0, y1, z0]], [[0, y0, z1], [0, y1, z1]]];
  segs.push(...rect(-hy, hy, -hz, hz), ...rect(-h, h, -h, h));
  const tris = [];
  const r = C.edgeTriSize / Math.sqrt(3);
  segs.forEach(([a, b]) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d);
    const n = Math.max(2, Math.round(len / C.edgeTriGap));
    let fx = d[0], fy = d[1];
    const fl = Math.hypot(fx, fy);
    if (fl < 1e-6) { fx = 0; fy = 1; } else { fx /= fl; fy /= fl; }
    const sx = -fy, sy = fx;
    for (let i = 0; i <= n; i++) {
      const t = i / n, cx = a[0] + d[0] * t, cy = a[1] + d[1] * t, cz = a[2] + d[2] * t;
      tris.push(cx + fx * r, cy + fy * r, cz,
        cx - fx * r / 2 + sx * r * 0.866, cy - fy * r / 2 + sy * r * 0.866, cz,
        cx - fx * r / 2 - sx * r * 0.866, cy - fy * r / 2 - sy * r * 0.866, cz);
    }
  });
  const pt = [];
  const quad = (y0, y1, z0, z1) => { pt.push(0, y0, z0, 0, y1, z0, 0, y1, z1, 0, y0, z0, 0, y1, z1, 0, y0, z1); };
  quad(h, hy, -hz, hz); quad(-hy, -h, -hz, hz); quad(-h, h, -hz, -h); quad(-h, h, h, hz);
  return { edge: new Float32Array(tris), nEdge: tris.length / 9, part: new Float32Array(pt), nPart: pt.length / 9 };
};
// 방 위의 뇌 (mxBuildBrain과 같은 방법: 볼츠만 두뇌 모양을 작게, 겉면 + 안쪽 기억 칸)
INF_ASSET_BUILDERS.mxBrain = function () {
  const B = MX_CONFIG.brain, cfg = BB_BRAIN_CONFIG, s = B.scale;
  const shell = [];
  const weights = cfg.parts.map((p) => p.s[0] * p.s[1] + p.s[1] * p.s[2] + p.s[0] * p.s[2]);
  const wsum = weights.reduce((a, w) => a + w, 0);
  const minD2 = Math.pow(2.6, 2);
  for (let tries = 0; tries < 60000 && shell.length < B.shellCount; tries++) {
    let pick = Math.random() * wsum, pi = 0;
    while (pi < weights.length - 1 && pick > weights[pi]) { pick -= weights[pi]; pi++; }
    const part = cfg.parts[pi];
    const u = infRandDir();
    const k = 0.95 + Math.random() * 0.1;
    const x = part.c[0] + part.s[0] * u[0] * k, y = part.c[1] + part.s[1] * u[1] * k, z = part.c[2] + part.s[2] * u[2] * k;
    const f = bbBrainField(x, y, z);
    if (f > 1 || f < 0.86) continue;
    if (shell.some((q) => (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2 < minD2)) continue;
    const e = 0.5;
    shell.push([x, y, z, [
      bbBrainFieldRaw(x + e, y, z) - bbBrainFieldRaw(x - e, y, z),
      bbBrainFieldRaw(x, y + e, z) - bbBrainFieldRaw(x, y - e, z),
      bbBrainFieldRaw(x, y, z + e) - bbBrainFieldRaw(x, y, z - e)]]);
  }
  const mn = [Infinity, Infinity, Infinity], mxv = [-Infinity, -Infinity, -Infinity];
  shell.forEach((p) => { for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mxv[k] = Math.max(mxv[k], p[k]); } });
  const center = [(mn[0] + mxv[0]) / 2, (mn[1] + mxv[1]) / 2, (mn[2] + mxv[2]) / 2];
  const n = shell.length, P = new Float32Array(n * 9), Cc = new Float32Array(n * 3);
  const r = B.shellTriSize / Math.sqrt(3), L = [-0.4, 0.7, 0.6], ll = Math.hypot(...L);
  shell.forEach((p, i) => {
    const c = [(p[0] - center[0]) * s, (p[1] - center[1]) * s, (p[2] - center[2]) * s];
    const nn = infNorm3(p[3]);
    const ref = Math.abs(nn[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = infNorm3(infCross3(nn, ref)), e2 = infCross3(nn, e1);
    const a0 = Math.random() * Math.PI * 2;
    const sh = (0.55 + 0.45 * (0.5 + 0.5 * (nn[0] * L[0] + nn[1] * L[1] + nn[2] * L[2]) / ll)) * (0.9 + Math.random() * 0.2);
    for (let k = 0; k < 3; k++) {
      const a = a0 + k * 2.0944;
      for (let ch = 0; ch < 3; ch++) P[i * 9 + k * 3 + ch] = c[ch] + (e1[ch] * Math.cos(a) + e2[ch] * Math.sin(a)) * r;
    }
    for (let ch = 0; ch < 3; ch++) Cc[i * 3 + ch] = MX_COLORS.shell[ch] * sh * 0.55; // 반투명(0.55)
  });
  const cand = [];
  for (let x = mn[0]; x <= mxv[0]; x += 3.2) for (let y = mn[1]; y <= mxv[1]; y += 3.2) for (let z = mn[2]; z <= mxv[2]; z += 3.2) if (bbBrainField(x, y, z) < 0.62) cand.push([x, y, z]);
  const cells = [];
  const minDist = new Float64Array(cand.length).fill(Infinity);
  let cur = Math.floor(cand.length / 2);
  for (let i = 0; i < B.cells && cand.length; i++) {
    const p = cand[cur];
    cells.push({ x: (p[0] - center[0]) * s, y: (p[1] - center[1]) * s, z: (p[2] - center[2]) * s, axis: infRandDir(), ang: Math.random() * 6.28, spin: 0.3 + Math.random() * 0.5 });
    let far = -1, fi = 0;
    cand.forEach((q, j) => {
      const dd = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
      if (dd < minDist[j]) minDist[j] = dd;
      if (minDist[j] > far) { far = minDist[j]; fi = j; }
    });
    cur = fi;
  }
  cells.sort((a, b) => a.x - b.x || b.y - a.y);
  const half = [(mxv[0] - mn[0]) / 2 * s, (mxv[1] - mn[1]) / 2 * s, (mxv[2] - mn[2]) / 2 * s];
  return { n, P, C: Cc, cells, topExtent: half[1], bottomExtent: half[1], frontZ: half[2] };
};

class InfMaxwell extends InfGame {
  static setup(p) {
    const d = p.d, T = p.T;
    const k = infClamp(Math.round(infLerp(2, 5, d)), 1, Math.max(1, Math.floor((T - 0.6) / 0.9)));
    return { command: '분리하라!', hint: '잘못된 방의 분자를 클릭하라 (빨강은 오른쪽, 파랑은 왼쪽)', k, M: Math.round(infLerp(10, 16, d)), vf: infLerp(5, 10, d) + 3 * p.x, penalty: d >= 0.2 };
  }
  constructor(ctx, p) {
    super(ctx, p);
    const C = MX_CONFIG, R = C.room;
    this.room = infAsset('mxRoom');
    this.brain = infAsset('mxBrain');
    // 원래 fitCamera와 같은 방법으로 방 + 뇌가 상자에 들어오는 거리 (짧은 게임이라 조금 더 크게)
    const tanH = Math.tan(55 * Math.PI / 360), aspect = 16 / 9, FW = 0.74, FH = 0.9;
    const top = R.hy + C.brain.gap + this.brain.bottomExtent + this.brain.topExtent;
    const contentH = top + R.hy, mid = (top - R.hy) / 2;
    let hh = 4, dist = 1;
    for (; hh < 120; hh += 0.05) {
      dist = hh / tanH;
      const k = dist / (dist - R.hz);
      if (R.hx * k <= hh * aspect * FW && contentH * k <= 2 * hh * FH) break;
    }
    this.cy = mid - 0.6;
    this.view = new InfView({ fov: 55, pos: [0, this.cy, dist], target: [0, this.cy, 0], zoom: 1, oy: 0.7, near: 3, far: dist + 30 });
    // 뇌는 방 바로 위 (상자 위쪽 끝은 넘지 않게)
    const topY = this.cy + hh, D = dist, B = this.brain;
    const screenTop = (y, z) => this.cy + (y - this.cy) * D / (D - z);
    let by = R.hy + C.brain.gap + B.bottomExtent;
    for (let i = 0; i < 60 && screenTop(by + B.topExtent, B.frontZ) > topY - C.brain.topMargin; i++) by -= 0.1;
    this.brainY = by;
    this.b = ctx.batch(this.room.nEdge + this.room.nPart + B.n + B.cells.length * 4 + p.M * 4 + 60);
    this.unit = this.view.unitAt(0, 0, 0);
    const fast = p.vf / this.unit, slow = fast * 0.45;
    this.faces = mxTetraFaces(C.molEdge);
    this.cellFaces = mxTetraFaces(C.brain.cellEdge);
    this.mols = [];
    const wrongIdx = new Set(infShuffle([...Array(p.M).keys()]).slice(0, p.k));
    for (let i = 0; i < p.M; i++) {
      const isFast = i % 2 === 0;
      const right = isFast !== wrongIdx.has(i); // 빨강은 오른쪽이 제자리
      const side = right ? 1 : -1;
      const dir = infRandDir(), speed = isFast ? fast : slow;
      this.mols.push({
        fast: isFast, speed, side,
        x: side * (1.2 + Math.random() * (R.hx - 2.4)), y: (Math.random() * 2 - 1) * (R.hy - 1), z: (Math.random() * 2 - 1) * (R.hz - 1),
        vx: dir[0] * speed, vy: dir[1] * speed, vz: dir[2] * speed,
        axis: infRandDir(), ang: Math.random() * 6.28, spin: (isFast ? 3 : 1.2) * (0.6 + Math.random() * 0.8),
        act: null, remix: null, flash: -9,
      });
    }
    this.memory = 0;
    this.lit = new Float32Array(B.cells.length).fill(-100);
    this.door = { open: 0, flash: -100 };
    this.beam = { t: -100, mol: null };
    this.hover = -1;
    this.rot = new Float32Array(9);
    this.brainM = new Float64Array(12);
    this.tmp = [0, 0, 0];
  }
  guided(m) { return !!(m.act || (m.remix && this.t >= m.remix.t0)); }
  wrongOf(m) { return m.fast ? m.x < 0 : m.x > 0; }
  wrongCount() { return this.mols.filter((m) => this.wrongOf(m) || m.act || m.remix).length; }
  molScreen(m) { return this.view.screen(m.x, m.y, m.z); }
  molAt(wx, wy) {
    let best = -1, bd = Infinity;
    this.mols.forEach((m, i) => {
      if (m.act || m.remix) return;
      const s = this.molScreen(m), d = infDist(wx, wy, s[0], s[1]);
      if (d < bd) { bd = d; best = i; }
    });
    return bd <= Math.max(1.5, this.ctx.px(26)) ? best : -1;
  }
  onMove(wx, wy) { this.hover = this.result ? -1 : this.molAt(wx, wy); }
  onDown(wx, wy) {
    if (this.result) return;
    const i = this.molAt(wx, wy);
    if (i < 0) return;
    const m = this.mols[i], t = this.t;
    const side = m.x < 0 ? -1 : 1;
    // 낚아서 구멍 앞으로 데려와 관찰 (mxStartAction과 같은 경로)
    m.act = { t0: t, from: [m.x, m.y, m.z], gate: [side * 2.2, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6], through: [-side * 2.4, 0, 0], side, pass: this.wrongOf(m), stage: 'approach' };
    if (!m.act.pass) {
      m.flash = t;
      if (this.p.penalty) {
        // 관측 낭비 -> 옳은 방의 분자 하나가 다시 잘못된 방으로 섞임 (기억을 내보낸 대가와 같은 경로)
        const others = this.mols.filter((q) => q !== m && !q.act && !q.remix && !this.wrongOf(q));
        if (others.length) { const q = infPick(others); q.remix = { t0: t + 0.25, from: null, side: q.x < 0 ? -1 : 1 }; }
      }
    }
  }
  release(m, side) {
    const d = infRandDir();
    d[0] = Math.abs(d[0]) * side + side * 0.6;
    const l = Math.hypot(...d);
    m.vx = d[0] / l * m.speed; m.vy = d[1] / l * m.speed; m.vz = d[2] / l * m.speed;
    m.side = side;
  }
  update(t, dt) {
    this.t = t;
    dt = Math.min(1 / 30, dt);
    const C = MX_CONFIG, R = C.room, pad = C.molEdge * 0.6;
    let doorOpen = false;
    this.mols.forEach((m) => {
      m.ang += m.spin * dt;
      const a = m.act;
      if (a) {
        if (a.stage === 'approach') {
          const pr = infEaseInOut((t - a.t0) / 0.3);
          for (let k = 0; k < 3; k++) (k === 0 ? (m.x = a.from[0] + (a.gate[0] - a.from[0]) * pr) : k === 1 ? (m.y = a.from[1] + (a.gate[1] - a.from[1]) * pr) : (m.z = a.from[2] + (a.gate[2] - a.from[2]) * pr));
          if (pr >= 1) {
            // 관찰: 판단 하나 = 기억 한 칸
            if (this.memory < this.lit.length) { this.lit[this.memory] = t; this.memory++; }
            this.beam = { t, mol: m };
            a.stage = a.pass ? 'pass' : 'reject';
            a.t1 = t;
            if (!a.pass) this.door.flash = t;
          }
        } else if (a.stage === 'pass') {
          doorOpen = true;
          const pr = infEaseInOut((t - a.t1 - 0.08) / 0.22);
          m.x = a.gate[0] + (a.through[0] - a.gate[0]) * pr;
          if (pr >= 1) { this.release(m, -a.side); m.act = null; }
        } else if (a.stage === 'reject' && t - a.t1 > 0.25) { this.release(m, a.side); m.act = null; }
        return;
      }
      const r = m.remix;
      if (r && t >= r.t0) {
        if (!r.from) r.from = [m.x, m.y, m.z];
        const tt = t - r.t0, g = [r.side * 2.2, 0, 0], th = [-r.side * 2.4, 0, 0];
        if (tt < 0.35) { const e = infEaseInOut(tt / 0.35); m.x = r.from[0] + (g[0] - r.from[0]) * e; m.y = r.from[1] + (g[1] - r.from[1]) * e; m.z = r.from[2] + (g[2] - r.from[2]) * e; }
        else if (tt < 0.6) { doorOpen = true; m.x = g[0] + (th[0] - g[0]) * infEaseInOut((tt - 0.35) / 0.25); m.y = 0; m.z = 0; }
        else { this.release(m, -r.side); m.remix = null; }
        return;
      }
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
      if (m.x < -R.hx + pad) { m.x = -R.hx + pad; m.vx = Math.abs(m.vx); }
      if (m.x > R.hx - pad) { m.x = R.hx - pad; m.vx = -Math.abs(m.vx); }
      if (m.y < -R.hy + pad) { m.y = -R.hy + pad; m.vy = Math.abs(m.vy); }
      if (m.y > R.hy - pad) { m.y = R.hy - pad; m.vy = -Math.abs(m.vy); }
      if (m.z < -R.hz + pad) { m.z = -R.hz + pad; m.vz = Math.abs(m.vz); }
      if (m.z > R.hz - pad) { m.z = R.hz - pad; m.vz = -Math.abs(m.vz); }
      // 칸막이 (문이 닫혀 있으면 구멍도 벽)
      if (m.side < 0 && m.x > -pad) { m.x = -pad; m.vx = -Math.abs(m.vx); }
      if (m.side > 0 && m.x < pad) { m.x = pad; m.vx = Math.abs(m.vx); }
    });
    this.door.open += ((doorOpen ? 1 : 0) - this.door.open) * Math.min(1, dt * 10);
    if (!this.result && this.wrongCount() === 0) this.win(t);
    this.brain.cells.forEach((c) => { c.ang += c.spin * dt; });
    infMat(0.12, Math.sin(t * 0.25) * C.brain.sway, 0, 1, 0, this.brainY, 0, this.brainM);
  }
  draw(t) {
    const b = this.b, V = this.view, C = MX_CONFIG, COL = MX_COLORS, room = this.room, A = V.A, w = this.tmp, rot = this.rot;
    b.begin();
    // ----- 방 모서리 / 칸막이(아주 옅게) / 문 -----
    const edge = COL.edge;
    V.mesh(b, room.edge, room.nEdge, null, () => edge);
    const part = infScale(COL.partition, 0.06);
    V.mesh(b, room.part, room.nPart, null, () => part);
    const h = C.holeHalf, fl = Math.max(0, 1 - (t - this.door.flash) / 0.35);
    const dc = infScale([COL.partition[0] + (1 - COL.partition[0]) * fl, COL.partition[1] * (1 - fl * 0.6), COL.partition[2] * (1 - fl * 0.6)], 0.3 + fl * 0.45);
    const dy = this.door.open * h * 0.9, sy = Math.max(0.0001, 1 - this.door.open * 0.9);
    V.tri(b, 0, dy - h * sy, -h, 0, dy + h * sy, -h, 0, dy + h * sy, h, dc);
    V.tri(b, 0, dy - h * sy, -h, 0, dy + h * sy, h, 0, dy - h * sy, h, dc);
    // ----- 분자 (돌아가는 삼각뿔, 마우스를 올리면 크게) -----
    const shade = [1.0, 0.8, 0.65, 0.5];
    this.mols.forEach((m, i) => {
      mxRotMatrix(m.axis, m.ang, rot);
      const k2 = i === this.hover ? 1.7 : 1;
      let base = m.fast ? COL.red : COL.blue;
      const fk = Math.max(0, 1 - (t - m.flash) / 0.4);
      if (fk > 0) base = infMix(base, [1, 1, 1], fk * 0.6);
      this.faces.forEach((f, fi) => {
        const v = f.map((q) => [m.x + (rot[0] * q[0] + rot[1] * q[1] + rot[2] * q[2]) * k2, m.y + (rot[3] * q[0] + rot[4] * q[1] + rot[5] * q[2]) * k2, m.z + (rot[6] * q[0] + rot[7] * q[1] + rot[8] * q[2]) * k2]);
        V.tri(b, v[0][0], v[0][1], v[0][2], v[1][0], v[1][1], v[1][2], v[2][0], v[2][1], v[2][2], infScale(base, shade[fi]));
      });
    });
    // ----- 뇌 (반투명 겉면 + 안쪽 기억 칸: 관찰할 때마다 한 칸씩 노랗게) -----
    const B = this.brain, BM = this.brainM;
    V.mesh(b, B.P, B.n, BM, (i) => [B.C[i * 3], B.C[i * 3 + 1], B.C[i * 3 + 2]]);
    B.cells.forEach((c, i) => {
      mxRotMatrix(c.axis, c.ang, rot);
      const on = i < this.memory, age = t - this.lit[i];
      const k = on ? 1 + 0.5 * Math.max(0, 1 - age / 0.35) : 1;
      const col = on ? COL.yellow : COL.white, glow = on ? Math.max(0, 0.45 - age) : 0;
      this.cellFaces.forEach((f, fi) => {
        const v = f.map((q) => infXf(BM, c.x + (rot[0] * q[0] + rot[1] * q[1] + rot[2] * q[2]) * k, c.y + (rot[3] * q[0] + rot[4] * q[1] + rot[5] * q[2]) * k, c.z + (rot[6] * q[0] + rot[7] * q[1] + rot[8] * q[2]) * k, [0, 0, 0]));
        const cc = [Math.min(1, col[0] * shade[fi] + glow), Math.min(1, col[1] * shade[fi] + glow), Math.min(1, col[2] * shade[fi] + glow)];
        V.tri(b, v[0][0], v[0][1], v[0][2], v[1][0], v[1][1], v[1][2], v[2][0], v[2][1], v[2][2], cc);
      });
    });
    // ----- 관찰 순간 뇌 -> 분자를 잇는 선 -----
    const ba = 0.8 * (1 - (t - this.beam.t) / 0.6);
    if (ba > 0 && this.beam.mol) {
      const s0 = V.screen(0, this.brainY - B.bottomExtent * 0.7, 0), s1 = this.molScreen(this.beam.mol);
      const dx = s1[0] - s0[0], dy2 = s1[1] - s0[1], l = Math.hypot(dx, dy2) || 1, nx = -dy2 / l * 0.06, ny = dx / l * 0.06;
      const c = infScale(infColor(0xfff1b0), ba);
      b.tri3(s0[0] + nx, s0[1] + ny, 0, s1[0] + nx, s1[1] + ny, 0, s1[0] - nx, s1[1] - ny, 0, c, c, c);
      b.tri3(s0[0] + nx, s0[1] + ny, 0, s1[0] - nx, s1[1] - ny, 0, s0[0] - nx, s0[1] - ny, 0, c, c, c);
    }
    b.end();
  }
}

// ---------------------------------------------------------
// 실패했을 때 짧은 이유 (성공/실패 글자 아래)
// ---------------------------------------------------------
const INF_FAIL_TEXT = {
  1: { sink: '배가 가라앉았다', timeout: '배가 가라앉았다' },
  2: { fluctuation: '그건 잠깐의 요동일 뿐, 뇌가 아니다', timeout: '뇌를 놓쳤다' },
  3: { wrong: '심사관이 원한 모양이 아니다', timeout: '시간 초과' },
  4: { wrong: '규칙과 반대쪽이다', timeout: '고르지 못했다' },
  5: { timeout: '문장을 다 치지 못했다' },
  6: { timeout: '당나귀는 끝내 고르지 못했다' },
  7: { wrong: '그 갈래의 나는 죽었다', missed: '살아남은 나를 놓쳤다', timeout: '살아남은 나를 놓쳤다' },
  8: { timeout: '분리하지 못했다' },
};

// ---------------------------------------------------------
// 미니게임 목록
// ---------------------------------------------------------
const INF_GAMES = [
  { id: 1, name: '테세우스의 배', cls: InfTheseus },
  { id: 2, name: '볼츠만 두뇌', cls: InfBoltzmann },
  { id: 3, name: '중국어 방', cls: InfChinese },
  { id: 4, name: '트롤리 딜레마', cls: InfTrolley },
  { id: 5, name: '무한 원숭이 정리', cls: InfMonkey },
  { id: 6, name: '뷔리당의 당나귀', cls: InfBuridan },
  { id: 7, name: '양자 자살과 불멸', cls: InfQuantum },
  { id: 8, name: '맥스웰의 악마', cls: InfMaxwell },
];

// =========================================================
// 진행 (InfiniteMode)
// ---------------------------------------------------------
//  InfiniteMode.init({ scene, dom, px, view })
//    dom: { hud, stage, lives, inter, interStage, interLives, interNext, interSpeed, command, cmdWord, cmdHint, flash }
//    px(n): 화면 n픽셀이 상자 좌표로 얼마인지 / view: { dist, camY, halfW, halfH, ppu } (실제 카메라)
//  InfiniteMode.start(time, { only, stage }) / update(time, dt) / pointerDown(wx, wy) / pointerMove(wx, wy)
//    only: 그 번호의 게임만 반복 (확인용), stage: 시작 단계 (확인용)
//  InfiniteMode.onGameOver = (record) => {}
// =========================================================
const InfiniteMode = (function () {
  const C = INF_CONFIG;
  let scene = null, dom = null, pxFn = null;
  let root = null, fuse = null, layer = null;
  let st = { phase: 'idle' };
  let startOpts = {};
  let inst = null, instGroup = null, instEls = [];
  let bag = [], lastId = 0, onlyId = 0;
  let lastPointer = null;

  function init(o) {
    scene = o.scene; dom = o.dom; pxFn = o.px;
    if (o.view) INF_SCREEN = o.view;
    root = new THREE.Group();
    scene.add(root);
    const fg = new THREE.Group();
    scene.add(fg);
    fuse = new InfBatch(fg, 200);
    if (typeof document !== 'undefined') {
      layer = document.createElement('div');
      layer.id = 'infLayer';
      document.body.appendChild(layer);
      setTimeout(infPrecomputeAssets, 400);
    }
  }

  function nextDef() {
    if (onlyId) return INF_GAMES.find((g) => g.id === onlyId) || INF_GAMES[0];
    if (!bag.length) {
      bag = infShuffle(INF_GAMES);
      if (bag[0].id === lastId) bag.push(bag.shift()); // 같은 게임이 연달아 나오지 않게
    }
    const def = bag.shift();
    lastId = def.id;
    return def;
  }

  function disposeInst() {
    instEls.forEach((el) => { if (el.remove) el.remove(); });
    instEls = [];
    if (!instGroup) return;
    instGroup.userData.batches.forEach((b) => b.dispose());
    root.remove(instGroup);
    instGroup = null;
    inst = null;
  }

  function toScreen(X, Y) {
    if (typeof window === 'undefined') return [0, 0];
    const S = INF_SCREEN;
    return [(X / S.halfW + 1) / 2 * window.innerWidth, (1 - (Y - S.camY) / S.halfH) / 2 * window.innerHeight];
  }

  function makeInst(def, params) {
    disposeInst();
    instGroup = new THREE.Group();
    instGroup.userData.batches = [];
    root.add(instGroup);
    const ctx = {
      group: instGroup,
      batch: (cap) => { const b = new InfBatch(instGroup, cap); instGroup.userData.batches.push(b); return b; },
      px: (n) => (pxFn ? pxFn(n) : n * 0.05),
      // 원래 페이지의 글자 요소 (말풍선, 스톱워치, 이름표 ...) - 게임이 끝나면 함께 지워짐
      el: (cls, html) => {
        if (!layer) return infStubEl();
        const d = document.createElement('div');
        d.className = cls;
        if (html) d.innerHTML = html;
        layer.appendChild(d);
        instEls.push(d);
        return d;
      },
      toScreen,
    };
    inst = new def.cls(ctx, params);
    if (lastPointer) inst.onMove(lastPointer[0], lastPointer[1]); // 손가락 등이 처음부터 커서를 향하게
    inst.update(0, 0); // 첫 화면 (명령어가 뜨는 동안 멈춰 있음)
    inst.draw(0);
  }

  function livesHtml(lives, lostNow) {
    let h = '';
    for (let i = 0; i < C.lives; i++) {
      const cls = i < lives ? 'life' : (lostNow && i === lives ? 'life lost breaking' : 'life lost');
      h += `<span class="${cls}"></span>`;
    }
    return h;
  }

  function start(time, opts) {
    const o = opts || {};
    st = { phase: 'idle', stage: Math.max(1, o.stage || 1), startStage: Math.max(1, o.stage || 1), lives: C.lives, wins: 0, lastFail: false };
    bag = []; lastId = 0; onlyId = o.only || 0;
    startOpts = o;
    dom.hud.classList.add('show');
    beginStage(time);
  }

  // 단계 시작: [속도 UP] -> 단계 표시 -> 명령어 -> 게임
  function beginStage(time) {
    const stage = st.stage;
    const d = infDifficulty(stage), T = infTimeLimit(stage), x = infExtra(stage);
    const def = nextDef();
    const params = def.cls.setup({ stage, d, T, x });
    params.stage = stage; params.d = d; params.T = T; params.x = x;
    st.def = def; st.params = params; st.d = d; st.T = T;
    st.speedUp = stage > st.startStage && (stage - 1) % C.tierSize === 0 && T < infTimeLimit(stage - 1);
    st.tSpeed = st.speedUp ? 1.5 : 0;
    st.tStage = infLerp(1.15, 0.75, d);
    st.tCmd = infLerp(1.0, 0.65, d);
    st.phase = 'inter';
    st.t0 = time;
    disposeInst();
    // 막간 화면 내용
    dom.interStage.textContent = String(stage).padStart(2, '0');
    dom.interLives.innerHTML = livesHtml(st.lives, st.lastFail);
    dom.interNext.innerHTML = `<span class="in-num">0 0 ${def.id}</span> ${def.name}`;
    dom.interSpeed.innerHTML = `속도 UP!<div class="is-sub">제한시간 ${T}초</div>`;
    dom.inter.classList.add('show');
    dom.inter.classList.toggle('speed', st.speedUp);
    dom.stage.textContent = String(stage);
    dom.lives.innerHTML = livesHtml(st.lives, false);
    dom.command.classList.remove('show', 'top');
    dom.flash.className = '';
  }

  function update(time, dt) {
    if (st.phase === 'idle' || st.phase === 'over') { drawFuse(0, false); return; }
    const t = time - st.t0;

    if (st.phase === 'inter') {
      dom.inter.classList.toggle('speedOn', st.speedUp && t < st.tSpeed);
      if (t >= st.tSpeed + st.tStage) {
        // 명령어: 게임 화면 위에 크게
        makeInst(st.def, st.params);
        dom.cmdWord.textContent = st.params.command;
        dom.cmdHint.textContent = st.params.hint;
        dom.command.classList.add('show');
        dom.command.classList.remove('top');
        dom.inter.classList.remove('show');
        st.phase = 'cmd';
        st.t0 = time;
      }
      drawFuse(0, false);
      return;
    }
    if (st.phase === 'cmd') {
      drawFuse(1, true);
      if (t >= st.tCmd) {
        dom.command.classList.add('top');
        st.phase = 'play';
        st.t0 = time;
      }
      return;
    }
    if (st.phase === 'play') {
      const gt = Math.min(t, st.T);
      inst.update(gt, dt);
      if (!inst.result && t >= st.T) inst.timeout(st.T);
      inst.draw(gt);
      drawFuse(1 - gt / st.T, true);
      if (inst.result) {
        st.phase = 'result';
        st.t0 = time;
        st.gameT = gt;
        const ok = inst.result === 'win';
        if (ok) st.wins++; else st.lives--;
        st.lastFail = !ok;
        const why = !ok && INF_FAIL_TEXT[st.def.id] ? (INF_FAIL_TEXT[st.def.id][inst.why] || '') : '';
        dom.flash.innerHTML = (ok ? '성공!' : '실패…') + (why ? `<div class="if-why">${why}</div>` : '');
        dom.flash.className = ok ? 'show win' : 'show fail';
        dom.lives.innerHTML = livesHtml(st.lives, !ok);
        st.tResult = infLerp(1.05, 0.75, st.d);
      }
      return;
    }
    if (st.phase === 'result') {
      inst.update(st.gameT + t, dt); // 결과 연출은 계속 움직임
      inst.draw(st.gameT + t);
      drawFuse(1 - Math.min(1, st.gameT / st.T), false);
      if (t >= st.tResult) {
        if (st.lives <= 0) {
          st.phase = 'over';
          dom.command.classList.remove('show', 'top');
          dom.flash.className = '';
          disposeInst();
          gameOver();
        } else {
          st.stage++;
          beginStage(time);
        }
      }
    }
  }

  function gameOver() {
    const passed = st.stage - 1;                // 마지막으로 실패한 단계 바로 전까지 통과
    const test = st.startStage > 1 || !!onlyId; // 확인용 주소 옵션으로 시작했으면 최고 기록에 넣지 않음
    let best = 0;
    try { best = Number(localStorage.getItem(C.bestKey) || 0); } catch (e) { /* */ }
    const newBest = !test && passed > best;
    if (newBest) { try { localStorage.setItem(C.bestKey, String(passed)); } catch (e) { /* */ } best = passed; }
    if (InfiniteMode.onGameOver) InfiniteMode.onGameOver({ passed, reached: st.stage, wins: st.wins, best, newBest, test });
  }

  // 제한시간 도화선: 맨 아래 줄 삼각형이 오른쪽부터 타들어감
  const FUSE = { base: infColor(0xdbd6c2), warn: infColor(0xf28c66), warnHi: infColor(0xffcc99), spark1: infColor(0xffd959), spark2: infColor(0xff8033) };
  function drawFuse(frac, visible) {
    const b = fuse, n = 56;
    b.begin();
    if (visible) {
      const left = Math.ceil(frac * n);
      const warn = frac < 0.3;
      for (let i = 0; i < left; i++) {
        const x = -30 + i * (60 / (n - 1));
        let col = warn ? FUSE.warn : FUSE.base;
        if (warn && Math.sin(performance.now() / 70) > 0.3) col = FUSE.warnHi;
        if (i === left - 1) col = Math.random() < 0.5 ? FUSE.spark1 : FUSE.spark2; // 불꽃
        b.eq(x, C.fuseY, 0.5, i === left - 1 ? 1.1 : 0.8, i % 2 ? Math.PI : 0, col);
      }
    }
    b.end();
  }

  function pointerDown(wx, wy) { if (st.phase === 'play' && inst && !inst.result) inst.onDown(wx, wy); }
  function pointerMove(wx, wy) {
    lastPointer = [wx, wy];
    if ((st.phase === 'play' || st.phase === 'cmd') && inst) inst.onMove(wx, wy);
  }
  function isPlaying() { return st.phase !== 'idle' && st.phase !== 'over'; }
  function getState() { return st; }
  function getInstance() { return inst; }
  function restart(time) { start(time, startOpts); }
  // 숨은 커맨드(↑ ↑ ↓ ↓ A): 지금 하고 있는 미니게임을 바로 성공
  function cheatWin() {
    if (st.phase !== 'play' || !inst || inst.result) return false;
    inst.win(inst.t);
    return true;
  }

  return { init, start, restart, update, pointerDown, pointerMove, isPlaying, getState, getInstance, cheatWin, onGameOver: null };
})();
