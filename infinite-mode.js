// =========================================================
// 무한모드 (Infinite Mode) - 메이드 인 와리오식 미니게임 연속
// -----------------------------------------------------------
// 필요: Three.js(전역 THREE), template.js (GameUI, GameProgress)
//
// 규칙
//  - 목숨 3개. 8개 사고실험의 미니게임이 무작위 순서로 끝없이 이어짐 (한 게임 = 1단계)
//  - 제한시간: 1~10단계 10초, 이후 10단계마다 -1.5초 (최소 2.5초)
//  - 단계가 오를수록 각 게임의 난이도(개수, 속도, 보이는 시간 등)도 함께 오름 (51단계에서 최대,
//    그 뒤로는 101단계까지 보이는 시간/속도만 조금씩 더 빡빡해짐)
//  - 목숨을 모두 잃으면 게임 오버: 몇 단계까지 통과했는지 + 최고 기록
//
// 화면 좌표: 모든 미니게임은 가로 64 x 세로 36 (x: -32~32, y: -18~18) 상자 안에서 그림.
//            맨 아래 줄(y = -17.3)은 제한시간 도화선 자리라 게임 내용은 y > -15.8 에 둠.
//
// 구성
//  1) 공통 도구 (삼각형 묶음 InfBatch, 정삼각형 격자, 글자 모양 등)
//  2) 미니게임 8종 (INF_GAMES)
//  3) 진행 (InfiniteMode): 시작 -> [속도 UP] -> 단계 -> 명령어 -> 게임 -> 성공/실패 -> ... -> 게임 오버
//
// 미니게임 클래스의 약속: static setup(p) -> 이번 판의 설정(명령어 포함),
//   update(t, dt) = 규칙 진행, draw(t) = 그리기, onDown/onMove(월드 좌표), result: null | 'win' | 'fail'
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
};

const INF_BG = [0.063, 0.075, 0.102];          // #10131a
const INF_BEIGE = [0.96, 0.96, 0.86];
const INF_GOLD = [1.0, 0.83, 0.32];
const INF_RED = [0.95, 0.26, 0.2];

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
function infMix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }
function infFade(c, k) { return infMix(INF_BG, c, infClamp01(k)); } // k=0 배경색, 1 원래 색
function infScale(c, k) { return [Math.min(1, c[0] * k), Math.min(1, c[1] * k), Math.min(1, c[2] * k)]; }
function infRand(a, b) { return a + Math.random() * (b - a); }
function infRandInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function infPick(list) { return list[Math.floor(Math.random() * list.length)]; }
function infShuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function infHex(h) { return [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255]; }
function infPop(m) { let c = 0; while (m) { c += m & 1; m >>>= 1; } return c; }
function infDist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }

// 삼각형 묶음: 매 프레임 begin() -> tri()/eq() ... -> end() 로 다시 그림 (꼭짓점 색으로 칠함)
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
  }
  begin() { this.n = 0; }
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

// 정삼각형 격자로 영역 채우기: inside(x, y)가 참인 칸만. 반환 [{x, y, up}] (x, y = 칸의 무게중심)
function infLattice(inside, x0, x1, y0, y1, s) {
  const h = s * Math.sqrt(3) / 2;
  const out = [];
  for (let j = 0; y0 + j * h <= y1; j++) {
    const yb = y0 + j * h;
    for (let i = 0; x0 + i * s / 2 <= x1; i++) {
      const up = (i + j) % 2 === 0;
      const cx = x0 + i * s / 2 + s / 2;
      const cy = up ? yb + h / 3 : yb + 2 * h / 3;
      if (inside(cx, cy)) out.push({ x: cx, y: cy, up });
    }
  }
  return out;
}

// 큰 트라이포드(삼각형 12칸) 배치: [{x, y, flip}] (작은 삼각형 한 변 s, 전체는 한 변 4s의 큰 삼각형)
function infTripod12(s) {
  const r1 = s / Math.sqrt(3);
  const A = [90, 210, 330].map((d) => d * Math.PI / 180);
  const slots = A.map((a) => ({ cx: 2 * r1 * Math.cos(a), cy: 2 * r1 * Math.sin(a), flip: false }));
  slots.push({ cx: 0, cy: 0, flip: true });
  const out = [];
  slots.forEach((sl) => A.forEach((a) => {
    const sg = sl.flip ? -1 : 1;
    out.push({ x: sl.cx + sg * r1 * Math.cos(a), y: sl.cy + sg * r1 * Math.sin(a), flip: sl.flip });
  }));
  return out;
}

// 9칸 글자판(큰 삼각형 한 변 S): 칸마다 [무게중심 x, y, 위로 뾰족?]
function infCells9(S) {
  const c = S / 3, h = c * Math.sqrt(3) / 2;
  const top = (S * Math.sqrt(3) / 2) * 2 / 3;
  const cells = [];
  for (let r = 0; r < 3; r++) {
    const yt = top - r * h, yb = top - (r + 1) * h;
    for (let j = 0; j < 2 * r + 1; j++) {
      const up = j % 2 === 0;
      const x = -r * c / 2 + j * c / 2;
      cells.push({ x, y: up ? yb + h / 3 : yb + 2 * h / 3, up });
    }
  }
  return cells;
}

// 비트 수가 range 안에 있는 무작위 패턴들 (서로 minDist 이상 다름)
function infPatterns(bits, count, minPop, maxPop, minDist, mustInclude) {
  const out = mustInclude ? mustInclude.slice() : [];
  for (let tries = 0; out.length < count && tries < 6000; tries++) {
    let m = 0;
    const want = infRandInt(minPop, maxPop);
    const idx = infShuffle([...Array(bits).keys()]).slice(0, want);
    idx.forEach((i) => { m |= 1 << i; });
    if (out.every((q) => infPop(q ^ m) >= minDist)) out.push(m);
  }
  return out;
}

// 출렁이는 바다 (테세우스) - 삼각형 줄 여러 개, x 오프셋을 계속 늘려 물결이 뒤로 흐름
function infDrawSea(b, t, off, yTop, rows, z) {
  const s = 1.8;
  const deep = [0.09, 0.19, 0.31], crest = [0.5, 0.66, 0.78];
  for (let j = 0; j < rows; j++) {
    const yb = yTop - j * 1.95;
    for (let i = 0; i < 46; i++) {
      const x = -37 + i * s / 2 * 1.75;
      const w = 0.55 * Math.sin(0.3 * (x + off) + j * 0.9 + t * 1.3) + 0.28 * Math.sin(0.74 * (x + off * 0.8) - t * 0.8 + j);
      const k = infClamp01(0.5 + w * 0.6);
      const c = infFade(infMix(deep, crest, k * k), 1 - j * 0.14);
      b.eq(x, yb + w, z + j * 0.01, s, (i + j) % 2 ? Math.PI : 0, c);
    }
  }
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
//    부위가 하나씩 부서짐(어둡게 깜빡임) -> 정해진 시간 안에 클릭해 새 판자로 교체
//    K개를 고치면 성공, 하나라도 W초 넘게 방치하면 침몰
// =========================================================
class InfTheseus extends InfGame {
  static setup(p) {
    const d = p.d, T = p.T;
    const I = infLerp(1.0, 0.42, d);          // 고장 간격
    const W = infLerp(2.5, 1.15, d) - 0.2 * p.x; // 고쳐야 하는 시간
    let K = Math.round(infLerp(3, 8, d));     // 고쳐야 하는 개수 (제한시간 안에 다 고칠 수 있는 만큼만)
    K = Math.max(1, Math.min(K, Math.floor((T - 1.0) / I) + 1, Math.floor((T - 0.5) / 0.6)));
    return { command: '고쳐라!', hint: '부서진(어둡게 깜빡이는) 판자를 눌러라', I, W, K };
  }
  constructor(ctx, p) {
    super(ctx, p);
    this.sea = ctx.batch(800);
    this.ship = ctx.batch(1200);
    const L = 18, depth = 5.6, P = 8;
    this.L = L; this.P = P;
    const hull = (x, y) => {
      const u = x / L;
      if (Math.abs(u) >= 1) return false;
      const deck = 2.4 * Math.pow(Math.max(0, (Math.abs(u) - 0.62) / 0.38), 2);
      return y <= deck && y >= -depth * Math.sqrt(1 - u * u);
    };
    this.hull = infLattice(hull, -L, L, -depth - 0.6, 3, 1.3).map((c) => ({
      ...c, part: infClamp(Math.floor((c.x + L) / (2 * L / P)), 0, P - 1), sh: 0.82 + Math.random() * 0.18,
    }));
    this.mast = infLattice((x, y) => x > 0.3 && x < 1.6 && y > 0 && y < 14.5, 0, 2, 0, 15, 0.95);
    this.sail = infLattice((x, y) => x >= 2.2 && y >= 3.6 && (x - 2.2) / 8.2 + (y - 3.6) / 10.4 <= 1, 2, 11, 3.5, 14.5, 1.15);
    this.parts = Array.from({ length: P }, () => ({ state: 'intact', t: 0 }));
    this.times = Array.from({ length: p.K }, (_, i) => 0.55 + i * p.I);
    this.next = 0;
    this.repaired = 0;
    this.shipX = 0;
    this.baseY = -3.2;
    this.seaOff = 0;
  }
  get brokenCount() { return this.parts.filter((q) => q.state === 'broken').length; }
  update(t, dt) {
    this.t = t;
    const p = this.p;
    if (!this.result) {
      while (this.next < p.K && t >= this.times[this.next]) {
        let cand = this.parts.map((q, i) => i).filter((i) => this.parts[i].state === 'intact');
        if (!cand.length) cand = this.parts.map((q, i) => i).filter((i) => this.parts[i].state === 'repaired');
        if (cand.length) { const i = infPick(cand); this.parts[i].state = 'broken'; this.parts[i].t = t; }
        this.next++;
      }
      if (this.parts.some((q) => q.state === 'broken' && t - q.t > p.W)) this.fail(t, 'sink');
    }
    this.parts.forEach((q) => { if (q.state === 'flip' && t - q.t > 0.32) q.state = 'repaired'; });
    if (this.result === 'win') this.shipX += dt * infClamp((t - this.resultAt) * 40, 0, 26);
    this.seaOff += dt * (this.result === 'win' ? 4 : 9);
  }
  shipPose(t) {
    let y = this.baseY + 0.45 * Math.sin(t * 1.5), rot = 0.025 * Math.sin(t * 1.1);
    if (this.result === 'fail') {
      const k = infClamp01((t - this.resultAt) / 1.2);
      y -= 14 * k * k; rot -= 0.35 * infEaseOut(k);
    }
    return { x: this.shipX, y, rot };
  }
  onDown(wx, wy) {
    if (this.result) return;
    const pose = this.shipPose(this.t);
    const lx = wx - pose.x, ly = wy - pose.y;
    if (Math.abs(lx) > this.L + 1.5 || ly < -7.5 || ly > 4.5) return;
    // 누른 곳에서 가장 가까운 부서진 부위 (한 칸 정도는 빗나가도 인정)
    const w = 2 * this.L / this.P;
    let best = -1, bd = Infinity;
    this.parts.forEach((q, i) => {
      if (q.state !== 'broken') return;
      const cx = -this.L + (i + 0.5) * w, dist = Math.abs(lx - cx);
      if (dist < bd) { bd = dist; best = i; }
    });
    if (best >= 0 && bd <= w * 0.75) {
      this.parts[best].state = 'flip';
      this.parts[best].t = this.t;
      this.repaired++;
      if (this.repaired >= this.p.K) this.win(this.t);
    }
  }
  draw(t) {
    const b = this.ship, pose = this.shipPose(t);
    const cs = Math.cos(pose.rot), sn = Math.sin(pose.rot);
    const P = (x, y) => [pose.x + x * cs - y * sn, pose.y + x * sn + y * cs];
    const orange = [0.87, 0.53, 0.27], blue = [0.27, 0.6, 0.87], dark = [0.27, 0.17, 0.12];
    b.begin();
    this.mast.forEach((c) => { const q = P(c.x, c.y); b.eq(q[0], q[1], 0, 0.95 * 0.86, (c.up ? 0 : Math.PI) + pose.rot, [0.55, 0.38, 0.24]); });
    this.sail.forEach((c) => { const q = P(c.x, c.y); b.eq(q[0], q[1], 0.01, 1.15 * 0.86, (c.up ? 0 : Math.PI) + pose.rot, infScale([0.93, 0.9, 0.8], 0.85 + 0.15 * Math.sin(c.x * 3 + c.y))); });
    this.hull.forEach((c) => {
      const part = this.parts[c.part];
      let col = orange, sx = 1;
      if (part.state === 'repaired') col = blue;
      else if (part.state === 'broken') {
        const u = infClamp01((t - part.t) / this.p.W);
        const blink = 0.5 + 0.5 * Math.sin((t - part.t) * (6 + 22 * u));
        col = infMix(dark, INF_RED, blink * (0.25 + 0.75 * u));
      } else if (part.state === 'flip') {
        const k = infClamp01((t - part.t) / 0.32);
        sx = Math.abs(Math.cos(k * Math.PI));
        col = k < 0.5 ? dark : blue;
      }
      const q = P(c.x, c.y);
      b.eq(q[0], q[1], 0.02, 1.3 * 0.86, (c.up ? 0 : Math.PI) + pose.rot, infScale(col, c.sh), sx, 1);
    });
    b.end();
    this.sea.begin();
    infDrawSea(this.sea, t, this.seaOff, -6.6, 5, 0.5);
    this.sea.end();
  }
}

// =========================================================
// 2. 볼츠만 두뇌 - "잡아라!"
//    뇌 한가운데 진공에서 요동(흰 삼각형)이 끝없이 생겼다 사라짐
//    아주 잠깐 금빛 작은 뇌가 나타남 -> 그때 클릭. 뇌가 아닌 순간 진공을 누르면 실패
// =========================================================
function infBrainInside(x, y) {
  const parts = [[1, 5, 17, 9.5], [-11, 3, 10, 9], [-4, -3, 10, 5], [11, -6, 6, 4.2], [5, -11, 2.2, 4.5]];
  const wob = 1 + 0.06 * Math.sin(0.9 * x) * Math.sin(1.1 * y);
  return parts.some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= wob * wob);
}
class InfBoltzmann extends InfGame {
  static setup(p) {
    const d = p.d, T = p.T;
    const V = infClamp(infLerp(1.5, 0.88, d) - 0.13 * p.x, 0.72, T * 0.5); // 뇌가 보이는 시간
    const a0 = 0.55, a1 = Math.max(a0 + 0.05, Math.min(T - V - 0.35, a0 + T * 0.45));
    return {
      command: '잡아라!', hint: '진공 속에 금빛 뇌가 나타나는 순간 눌러라',
      V, appearAt: infRand(a0, a1), decoyRate: infLerp(5, 16, d), size: infLerp(1.0, 0.72, d),
    };
  }
  constructor(ctx, p) {
    super(ctx, p);
    this.b = ctx.batch(3200);
    this.cx = 0; this.cy = 3; this.R = 8;
    const pal = [0x2a5aa0, 0x2a5aa0, 0x3b4d6b, 0x3b4d6b, 0x4c8dff, 0x2fc4d8, 0x7a6bff, 0x3fd1a0, 0xd06ad0].map(infHex);
    this.cells = infLattice((x, y) => infBrainInside(x, y) && infDist(x, y, this.cx, this.cy) > this.R + 0.6, -22, 24, -16, 15.5, 1.05)
      .map((c) => ({ ...c, col: infScale(infPick(pal), 0.75 + Math.random() * 0.3) }));
    const k = 6.2 * p.size / 46;
    this.mini = infLattice((x, y) => infBrainInside(x / k, y / k), -22 * k, 24 * k, -16 * k, 15.5 * k, 0.4);
    this.miniK = k;
    const r = Math.random() * (this.R - 3.2), a = Math.random() * Math.PI * 2;
    this.bx = this.cx + Math.cos(a) * r; this.by = this.cy + Math.sin(a) * r;
    this.flucts = [];
    this.accum = 0;
    this.tri12 = infTripod12(0.42);
    this.mark = null;
  }
  brainVisible(t) { return t >= this.p.appearAt && (t < this.p.appearAt + this.p.V || this.result === 'win'); }
  update(t, dt) {
    this.t = t;
    if (!this.result) {
      this.accum += dt * this.p.decoyRate;
      while (this.accum >= 1) {
        this.accum -= 1;
        const r = Math.sqrt(Math.random()) * (this.R - 1), a = Math.random() * Math.PI * 2;
        const e = -Math.log(Math.random());
        this.flucts.push({ x: this.cx + Math.cos(a) * r, y: this.cy + Math.sin(a) * r, type: e > 2.6 ? 2 : e > 1.3 ? 1 : 0, born: t, life: infRand(0.3, 0.6), rot: Math.random() * 6.28 });
      }
    }
    this.flucts = this.flucts.filter((f) => t - f.born < f.life);
  }
  onDown(wx, wy) {
    if (this.result) return;
    if (infDist(wx, wy, this.cx, this.cy) > this.R + 0.8) return; // 진공 밖은 무시
    const hitR = Math.max(3.4 * this.p.size, this.ctx.px(30));
    if (this.brainVisible(this.t) && infDist(wx, wy, this.bx, this.by) <= hitR) this.win(this.t);
    else { this.mark = { x: wx, y: wy, t: this.t }; this.fail(this.t, 'fluctuation'); }
  }
  draw(t) {
    const b = this.b;
    b.begin();
    const pulse = 1 + 0.012 * Math.sin(t * 2.2);
    this.cells.forEach((c) => b.eq(c.x * pulse, c.y * pulse, 0, 1.05 * 0.82, c.up ? 0 : Math.PI, this.result === 'win' ? infScale(c.col, 0.75) : c.col));
    // 진공 경계: 흐린 점선
    for (let i = 0; i < 64; i++) {
      const a = i / 64 * Math.PI * 2;
      b.eq(this.cx + Math.cos(a) * (this.R + 0.3), this.cy + Math.sin(a) * (this.R + 0.3), 0, 0.35, a, [0.32, 0.33, 0.36]);
    }
    const end = this.result ? 1 - infClamp01((t - this.resultAt) * 3) : 1;
    this.flucts.forEach((f) => {
      const k = (t - f.born) / f.life;
      const c = infFade([0.92, 0.92, 0.9], Math.sin(Math.PI * k) * end);
      if (f.type === 0) b.eq(f.x, f.y, 0.1, 0.75, f.rot, c);
      else if (f.type === 1) [0, 1, 2].forEach((i) => { const a = f.rot + i * 2.094 + 1.5708; b.eq(f.x + Math.cos(a) * 0.36, f.y + Math.sin(a) * 0.36, 0.1, 0.62, f.rot, c); });
      else this.tri12.forEach((o) => b.eq(f.x + o.x, f.y + o.y, 0.1, 0.42 * 0.9, o.flip ? Math.PI : 0, c));
    });
    if (this.brainVisible(t)) {
      const win = this.result === 'win';
      const s = win ? 1 + 0.15 * infEaseOut((t - this.resultAt) * 2) + 0.04 * Math.sin(t * 7) : 1;
      this.mini.forEach((c) => b.eq(this.bx + c.x * s, this.by + c.y * s, 0.2, 0.4 * 0.88 * s, c.up ? 0 : Math.PI, win ? INF_GOLD : infScale(INF_GOLD, 0.92 + 0.08 * Math.sin(t * 20))));
    }
    if (this.mark) {
      const k = infClamp01((t - this.mark.t) / 0.6);
      for (let i = 0; i < 6; i++) { const a = i * 1.047 + k; b.eq(this.mark.x + Math.cos(a) * (0.6 + k * 1.8), this.mark.y + Math.sin(a) * (0.6 + k * 1.8), 0.3, 0.6, a, infFade(INF_RED, 1 - k * 0.6)); }
    }
    b.end();
  }
}

// =========================================================
// 3. 중국어 방 - "골라라!"
//    심사관 말풍선에 트라이포드 모양이 잠깐 보였다가 사라짐 -> 아래 보기 중 같은 모양을 클릭
// =========================================================
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
    while (opts.length < N) opts.push(infPatterns(12, 1, 6, 9, 2, null)[0]);
    const order = infShuffle(opts);
    return { command: '골라라!', hint: '말풍선에 보였던 모양과 같은 것을 눌러라', N, showTime, options: order, answer: order.indexOf(target), target };
  }
  constructor(ctx, p) {
    super(ctx, p);
    this.b = ctx.batch(900);
    this.big = infTripod12(1.9);
    this.small = infTripod12(1.45);
    const sp = Math.min(11, 58 / p.N);
    this.ox = p.options.map((_, i) => (i - (p.N - 1) / 2) * sp);
    this.oy = -8.6;
    this.hues = infShuffle([0, 1, 2, 3, 4, 5, 6, 7]).map((h) => { const a = h / 8 * Math.PI * 2; return [0.6 + 0.35 * Math.cos(a), 0.6 + 0.35 * Math.cos(a - 2.1), 0.6 + 0.35 * Math.cos(a + 2.1)]; });
    this.hover = -1;
    this.picked = -1;
  }
  optionAt(wx, wy) {
    let best = -1, bd = Infinity;
    this.ox.forEach((x, i) => { const dd = infDist(wx, wy, x, this.oy); if (dd < bd) { bd = dd; best = i; } });
    return bd <= 4.3 ? best : -1;
  }
  onMove(wx, wy) { this.hover = this.result ? -1 : this.optionAt(wx, wy); }
  onDown(wx, wy) {
    if (this.result) return;
    const i = this.optionAt(wx, wy);
    if (i < 0) return;
    this.picked = i;
    if (i === this.p.answer) this.win(this.t); else this.fail(this.t, 'wrong');
  }
  update(t) { this.t = t; }
  draw(t) {
    const b = this.b, p = this.p;
    b.begin();
    // 말풍선 (작은 삼각형 점선) + 꼬리
    const bx = 0, by = 8.6, rx = 10, ry = 7.2;
    for (let i = 0; i < 72; i++) {
      const a = i / 72 * Math.PI * 2;
      b.eq(bx + Math.cos(a) * rx, by + Math.sin(a) * ry, 0, 0.5, a, [0.75, 0.73, 0.66]);
    }
    for (let i = 0; i < 5; i++) b.eq(bx - 4 - i * 1.2, by - ry - 0.6 - i * 1.0, 0, 0.5 - i * 0.05, 0, [0.75, 0.73, 0.66]);
    const shown = t < p.showTime || this.result;
    const glyphY = by - 0.3;
    this.big.forEach((o, k) => {
      const on = (p.target >> k) & 1;
      let c;
      if (shown) c = on ? INF_BEIGE : [0.15, 0.16, 0.19];
      else c = infFade([0.5, 0.5, 0.55], 0.35 + 0.25 * Math.sin(t * 5 + k)); // "?" : 모양이 사라짐
      b.eq(bx + o.x, glyphY + o.y, 0.1, 1.9 * 0.9, o.flip ? Math.PI : 0, c);
    });
    // 보기들
    p.options.forEach((m, i) => {
      let s = i === this.hover ? 1.1 : 1, dx = 0, dy = 0;
      let base = this.hues[i % this.hues.length];
      if (this.result && i === this.picked) {
        const k = t - this.resultAt;
        if (this.result === 'win') { s = 1.15 + 0.05 * Math.sin(k * 10); base = INF_GOLD; }
        else { dx = Math.sin(k * 40) * 0.5 * Math.max(0, 1 - k * 1.5); base = INF_RED; }
      }
      if (this.result === 'fail' && i === p.answer) s = 1.05 + 0.08 * Math.sin(t * 12);
      this.small.forEach((o, k) => {
        const on = (m >> k) & 1;
        const c = on ? base : infFade(base, 0.12);
        b.eq(this.ox[i] + dx + o.x * s, this.oy + dy + o.y * s, 0.1, 1.45 * 0.9 * s, o.flip ? Math.PI : 0, c);
      });
    });
    b.end();
  }
}

// =========================================================
// 4. 트롤리 딜레마 - "다수를 살려라!" / "소수를 살려라!"
//    기차가 갈림길로 오는 동안, 왼쪽/오른쪽 무리의 사람 수를 세어 규칙대로 살릴 쪽(화면 왼쪽/오른쪽)을 누름
// =========================================================
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
      hint: '살릴 쪽(화면 왼쪽 / 오른쪽)을 눌러라',
      rule, left: leftBig ? big : small, right: leftBig ? small : big, jitter: infLerp(0.15, 1, d), arrive,
    };
  }
  constructor(ctx, p) {
    super(ctx, p);
    this.b = ctx.batch(1600);
    this.J = [0, 3.5];
    this.ends = { left: [-21, -13.5], right: [21, -13.5] };
    this.people = {
      left: this.makeGroup(p.left, [-19, -9.5], p.jitter),
      right: this.makeGroup(p.right, [19, -9.5], p.jitter),
    };
    this.arrive = p.arrive;
    this.choice = null;    // 살린 쪽
    this.hover = null;
    this.trainU = 0;        // 0: 화면 위 ~ 1: 갈림길
    this.branchU = 0;
    this.debris = [];
  }
  // 사람 배치: 난이도가 낮으면 가지런한 줄, 높을수록 흩어짐 (그래도 서로 겹치지는 않게 -> 셀 수는 있음)
  makeGroup(n, c, jitter) {
    const pts = [];
    const cols = 3;
    const rows = Math.ceil(n / cols);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / cols), col = i % cols;
      const inRow = Math.min(cols, n - row * cols);
      const gx = c[0] + (col - (inRow - 1) / 2) * 2.8, gy = c[1] - row * 2.7 + 2.7 * (rows - 1) / 2;
      let best = null;
      for (let tries = 0; tries < 40; tries++) {
        const x = gx + (Math.random() - 0.5) * 3.2 * jitter, y = gy + (Math.random() - 0.5) * 2.8 * jitter;
        if (pts.every((q) => infDist(q.x, q.y, x, y) >= 2.35)) { best = { x, y }; break; }
      }
      if (!best) best = { x: gx, y: gy };
      pts.push({ x: best.x, y: best.y, rot: (Math.random() - 0.5) * jitter * 1.2 });
    }
    return pts;
  }
  onMove(wx) { this.hover = this.choice || this.result ? null : (wx < 0 ? 'left' : 'right'); }
  onDown(wx) {
    if (this.result || this.choice) return;
    this.choice = wx < 0 ? 'left' : 'right';
    const L = this.p.left, R = this.p.right;
    const savedN = this.choice === 'left' ? L : R, otherN = this.choice === 'left' ? R : L;
    const ok = this.p.rule === 'more' ? savedN > otherN : savedN < otherN;
    if (ok) this.win(this.t); else this.fail(this.t, 'wrong');
  }
  timeout(t) {
    this.choice = this.choice || (Math.random() < 0.5 ? 'left' : 'right');
    this.fail(t, 'timeout');
  }
  victimSide() { return this.choice === 'left' ? 'right' : 'left'; }
  update(t, dt) {
    this.t = t;
    if (!this.choice) this.trainU = Math.min(1, t / this.arrive);
    else if (this.trainU < 1) this.trainU = Math.min(1, this.trainU + dt * 2.6);
    else if (this.branchU < 1) {
      this.branchU = Math.min(1, this.branchU + dt * 1.9);
      if (this.branchU >= 0.78 && !this.debris.length) {
        this.people[this.victimSide()].forEach((q) => {
          for (let k = 0; k < 3; k++) this.debris.push({ x: q.x, y: q.y, vx: infRand(-9, 9), vy: infRand(4, 14), rot: Math.random() * 6, av: infRand(-9, 9) });
        });
        this.exploded = true;
      }
    }
    this.debris.forEach((q) => { q.vy -= 30 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.av * dt; if (q.y < -15.5) { q.y = -15.5; q.vx *= 0.8; q.vy = 0; q.av = 0; } });
  }
  trainPos() {
    const top = [0, 19.5];
    if (this.trainU < 1 || !this.choice) return [0, infLerp(top[1], this.J[1], this.trainU), 0];
    const e = this.ends[this.victimSide()];
    return [infLerp(this.J[0], e[0], this.branchU), infLerp(this.J[1], e[1], this.branchU), Math.atan2(e[0] - this.J[0], -(e[1] - this.J[1]))];
  }
  rail(b, a, c, col) {
    const len = infDist(a[0], a[1], c[0], c[1]), n = Math.floor(len / 1.25);
    const dx = (c[0] - a[0]) / len, dy = (c[1] - a[1]) / len, nx = -dy, ny = dx;
    for (let i = 0; i <= n; i++) {
      const x = a[0] + dx * i * 1.25, y = a[1] + dy * i * 1.25;
      b.eq(x + nx * 0.8, y + ny * 0.8, 0, 0.45, Math.atan2(dy, dx), col);
      b.eq(x - nx * 0.8, y - ny * 0.8, 0, 0.45, Math.atan2(dy, dx), col);
    }
  }
  draw(t) {
    const b = this.b;
    b.begin();
    const railCol = [0.55, 0.53, 0.47];
    this.rail(b, [0, 17.4], this.J, railCol);
    this.rail(b, this.J, this.ends.left, railCol);
    this.rail(b, this.J, this.ends.right, railCol);
    // 사람(트라이포드)
    ['left', 'right'].forEach((side) => {
      const lost = this.exploded && side === this.victimSide();
      if (lost) return;
      let col = INF_BEIGE;
      if (this.choice === side) col = this.result === 'win' ? [0.62, 0.9, 0.66] : [0.9, 0.85, 0.7];
      else if (this.hover === side) col = [1, 0.97, 0.8];
      const s = this.hover === side ? 1.12 : 1;
      this.people[side].forEach((q) => {
        [0, 1, 2].forEach((i) => {
          const a = q.rot + Math.PI / 2 + i * 2.094;
          b.eq(q.x + Math.cos(a) * 0.62 * s, q.y + Math.sin(a) * 0.62 * s, 0.1, 1.05 * s, q.rot, col);
        });
      });
    });
    this.debris.forEach((q) => b.eq(q.x, q.y, 0.2, 0.7, q.rot, INF_RED));
    // 기차 (위에서 본 모양)
    const [tx, ty, rot] = this.trainPos();
    const cs = Math.cos(rot), sn = Math.sin(rot);
    const top = 17.6; // 상자 위쪽 끝 (그 위로는 그리지 않음 -> 제목바를 넘지 않음)
    for (let j = 0; j < 7; j++) for (let i = 0; i < 3; i++) {
      const lx = (i - 1) * 1.05, ly = j * 1.05 - 0.5;
      const x = tx + lx * cs - ly * sn, y = ty + lx * sn + ly * cs;
      if (y > top) continue;
      b.eq(x, y, 0.3, 1.0, rot + ((i + j) % 2 ? Math.PI : 0), j === 0 ? [0.85, 0.85, 0.9] : [0.55, 0.6, 0.68]);
    }
    const nx = tx + 1.6 * sn, ny = ty - 1.6 * cs;
    if (ny <= top - 0.6) b.eq(nx, ny, 0.3, 1.9, rot + Math.PI, [0.7, 0.74, 0.82]); // 앞코
    b.end();
  }
}

// =========================================================
// 5. 무한 원숭이 정리 - "쳐라!"
//    위 빈칸에 들어갈 글자(9칸 도형)를 아래 자판에서 찾아 누름. 원숭이도 옆에서 무작위로 침
// =========================================================
class InfMonkey extends InfGame {
  static setup(p) {
    const d = p.d, T = p.T;
    const m = infClamp(Math.round(infLerp(4, 8, d)), 4, 8);
    // 첫 글자는 찾는 데 약 1.9초, 다음 글자부터는 약 1.25초 걸린다고 보고 제한시간에 맞춤
    const k = infClamp(Math.round(infLerp(2, 6, d)), 1, 1 + Math.max(0, Math.floor((T - 1.9) / 1.25)));
    const alphabet = infPatterns(9, m, 3, 6, 3, null);
    const targets = [];
    for (let i = 0; i < k; i++) { let g; do { g = infRandInt(0, m - 1); } while (targets.length && g === targets[targets.length - 1] && m > 1); targets.push(g); }
    return { command: '쳐라!', hint: '빈칸에 들어갈 모양의 키를 눌러라', m, k, alphabet, targets, monkeyRate: 0.5 };
  }
  constructor(ctx, p) {
    super(ctx, p);
    this.b = ctx.batch(1400);
    this.cellsSlot = infCells9(5.0);
    this.cellsKey = infCells9(3.4);
    const sp = 6.4;
    this.slots = p.targets.map((g, i) => ({ x: (i - (p.k - 1) / 2) * sp, y: 8.5, glyph: g, filled: 0, flash: -9, flashBad: false }));
    const rows = p.m > 6 ? 2 : 1, per = Math.ceil(p.m / rows);
    this.keys = p.alphabet.map((g, i) => {
      const r = Math.floor(i / per), c = i % per, inRow = Math.min(per, p.m - r * per);
      return { x: (c - (inRow - 1) / 2) * 6.6, y: rows === 1 ? -8.5 : -5.6 - r * 6.4, press: -9, user: false };
    });
    this.cur = 0;
    this.hover = -1;
    this.accum = Math.random() * 0.5;
    this.monkey = { x: Math.min(...this.keys.map((k) => k.x)) - 7.5, y: rows === 1 ? -8.0 : -8.4, press: -9 };
    // 원숭이 얼굴: 머리 + 양쪽 귀 + 밝은 얼굴(입 주변)
    const head = (x, y) => x * x + y * y <= 2.3 * 2.3 || (x - 2.4) ** 2 + (y - 0.6) ** 2 <= 0.9 || (x + 2.4) ** 2 + (y - 0.6) ** 2 <= 0.9;
    this.monkeyCells = infLattice(head, -3.4, 3.4, -2.4, 2.4, 0.62).map((c) => ({
      ...c, face: (c.x / 1.5) ** 2 + ((c.y + 0.6) / 1.3) ** 2 <= 1 || (Math.abs(c.x) - 0.85) ** 2 / 0.5 + (c.y - 0.5) ** 2 / 0.6 <= 1,
      eye: Math.abs(Math.abs(c.x) - 0.8) < 0.35 && Math.abs(c.y - 0.45) < 0.35,
    }));
  }
  keyAt(wx, wy) { return this.keys.findIndex((k) => Math.abs(wx - k.x) <= 2.9 && Math.abs(wy - k.y) <= 2.9); }
  onMove(wx, wy) { this.hover = this.result ? -1 : this.keyAt(wx, wy); }
  type(i, t, user) {
    const key = this.keys[i];
    key.press = t; key.user = user;
    const slot = this.slots[this.cur];
    if (!slot) return;
    if (i === slot.glyph) {
      slot.filled = user ? 1 : 2;
      slot.flash = t; slot.flashBad = false;
      this.cur++;
      if (this.cur >= this.slots.length) this.win(t);
    } else if (user) { slot.flash = t; slot.flashBad = true; }
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
    const b = this.b, p = this.p;
    b.begin();
    this.slots.forEach((s, si) => {
      const on = p.alphabet[s.glyph];
      const fl = Math.max(0, 1 - (t - s.flash) / 0.35);
      this.cellsSlot.forEach((c, ci) => {
        let col = [0.2, 0.21, 0.24];
        if (s.filled && ((on >> ci) & 1)) col = infMix(s.filled === 1 ? [0.98, 0.95, 0.8] : INF_GOLD, [1, 1, 1], fl * 0.5);
        else if (!s.filled && s.flashBad && fl > 0 && si === this.cur) col = infMix(col, INF_RED, fl);
        b.eq(s.x + c.x, s.y + c.y, 0, 5.0 / 3 * 0.88, c.up ? 0 : Math.PI, col);
      });
      if (si === this.cur && !this.result) b.eq(s.x, s.y - 4.0 + 0.25 * Math.sin(t * 8), 0, 0.9, 0, INF_BEIGE); // 지금 칸 표시
    });
    this.keys.forEach((k, i) => {
      const pr = Math.max(0, 1 - (t - k.press) / 0.22);
      const base = i === this.hover ? [0.95, 0.93, 0.86] : [0.78, 0.76, 0.7];
      const col = infMix(base, k.user ? [0.62, 0.86, 1] : [1, 0.92, 0.55], pr);
      const h = 2.7 * (1 - 0.08 * pr);
      b.tri(k.x - h, k.y - h, k.x + h, k.y - h, k.x + h, k.y + h, 0, col);
      b.tri(k.x - h, k.y - h, k.x + h, k.y + h, k.x - h, k.y + h, 0, infScale(col, 0.94));
      const g = p.alphabet[i];
      this.cellsKey.forEach((c, ci) => { if ((g >> ci) & 1) b.eq(k.x + c.x, k.y + c.y - 0.15, 0.05, 3.4 / 3 * 0.86, c.up ? 0 : Math.PI, [0.12, 0.12, 0.14]); });
    });
    // 원숭이 (갈색 삼각형 무리) - 누를 때 통통 튐
    const mp = Math.max(0, 1 - (t - this.monkey.press) / 0.2);
    this.monkeyCells.forEach((c) => {
      const col = c.eye ? [0.12, 0.1, 0.08] : c.face ? [0.86, 0.7, 0.52] : [0.55, 0.37, 0.22];
      b.eq(this.monkey.x + c.x * (1 + 0.12 * mp), this.monkey.y + c.y + mp * 0.6, 0, 0.62 * 0.9, c.up ? 0 : Math.PI, col);
    });
    b.end();
  }
}

// =========================================================
// 6. 뷔리당의 당나귀 - "연타하라!" (위에서 본 구도)
//    화면 왼쪽(건초)/오른쪽(물)을 누르면 그 더미가 잠깐 커짐(0.5초 뒤 다시 평형) -> 많은 쪽으로 끌려감
//    평형이면 망설이며 가운데로 돌아옴 -> 한쪽을 연타해 더미에 닿게 하면 성공
// =========================================================
class InfBuridan extends InfGame {
  static setup(p) {
    const d = p.d, T = p.T;
    const rRef = infLerp(4.2, 6.4, d) + 0.6 * p.x; // 이 연타 속도(초당 횟수)면 제한시간의 약 60%에 도착
    const restore = infLerp(0.5, 0.42, d);
    const H = infLerp(3, 5.5, d);
    const D = 15.6;
    const vRef = D / (0.6 * T - 0.2);
    const A = (vRef + H) / (rRef * restore);
    return { command: '연타하라!', hint: '건초(왼쪽)나 물(오른쪽) 한쪽을 마구 눌러라', rRef, restore, H, A, D };
  }
  constructor(ctx, p) {
    super(ctx, p);
    this.b = ctx.batch(1500);
    this.x = 0; this.y = 0; this.ty = 0; this.yaw = Math.PI / 2; this.walk = 0;
    this.items = [];   // { side: -1|1, born }
    this.trail = [];
    const body = (x, y) => (x / 3) ** 2 + (y / 1.45) ** 2 <= 1 || ((x - 3.6) / 1.35) ** 2 + (y / 0.85) ** 2 <= 1;
    this.donkey = infLattice(body, -3.2, 5, -1.6, 1.6, 0.52);
    this.hay = infLattice((x, y) => x * x + y * y <= 3.8 * 3.8, -4, 4, -4, 4, 0.9).map((c) => ({ ...c, sh: 0.8 + Math.random() * 0.25 }));
    this.reached = 0;
  }
  imbalance() { let s = 0; this.items.forEach((q) => { if (this.t - q.born < this.p.restore) s += q.side; }); return s; }
  onDown(wx) {
    if (this.result) return;
    const side = wx < 0 ? -1 : 1;
    const a = Math.random() * Math.PI * 2;
    this.items.push({ side, born: this.t, a });
    this.ty = infClamp(this.y + infRand(-3, 3), -6, 6);
  }
  update(t, dt) {
    this.t = t;
    this.items = this.items.filter((q) => t - q.born < this.p.restore + 0.3);
    let moving = false;
    if (!this.result) {
      const imb = this.imbalance();
      let v = imb * this.p.A;
      if (Math.abs(this.x) > 0.05) v -= Math.sign(this.x) * this.p.H;
      else if (imb === 0) { v = 0; this.x = 0; }
      this.x = infClamp(this.x + v * dt, -this.p.D, this.p.D);
      this.y += (this.ty - this.y) * Math.min(1, dt * 4);
      if (Math.abs(v) > 0.5) {
        moving = true;
        this.yaw += (Math.atan2((this.ty - this.y) * 0.4, Math.sign(v)) - this.yaw) * Math.min(1, dt * 8);
        const last = this.trail[this.trail.length - 1];
        if (!last || infDist(last.x, last.y, this.x, this.y) > 0.8) this.trail.push({ x: this.x, y: this.y, a: Math.atan2(this.y - (last ? last.y : this.y), this.x - (last ? last.x : this.x - 1)) });
      } else {
        let target = Math.PI / 2 + Math.sin(t * 2.4) * 0.6;
        let dy = target - this.yaw; while (dy > Math.PI) dy -= 2 * Math.PI; while (dy < -Math.PI) dy += 2 * Math.PI;
        this.yaw += dy * Math.min(1, dt * 5);
      }
      if (Math.abs(this.x) >= this.p.D) { this.reached = Math.sign(this.x); this.win(t); }
    }
    this.walk += ((moving ? 1 : 0) - this.walk) * Math.min(1, dt * 8);
  }
  draw(t) {
    const b = this.b;
    b.begin();
    this.trail.forEach((q) => b.eq(q.x, q.y - 1.9, 0, 0.55, q.a - Math.PI / 2, [0.55, 0.53, 0.47]));
    [-1, 1].forEach((side) => {
      const cx = side * 22;
      const glow = this.result === 'win' && this.reached === side ? 0.25 + 0.25 * Math.sin(t * 8) : 0;
      const base = side < 0 ? [0.85, 0.7, 0.35] : [0.29, 0.61, 0.91];
      this.hay.forEach((c) => b.eq(cx + c.x, c.y, 0, 0.9 * 0.86, c.up ? 0 : Math.PI, infMix(infScale(base, c.sh), [1, 1, 1], glow)));
      // 누를 때마다 붙는 트라이포드 (0.5초 뒤 사라짐)
      this.items.filter((q) => q.side === side).forEach((q) => {
        const age = t - q.born;
        const k = age < this.p.restore ? infEaseOut(age / 0.12) : 1 - infClamp01((age - this.p.restore) / 0.3);
        const rx = cx + Math.cos(q.a) * 4.6, ry = Math.sin(q.a) * 4.6;
        [0, 1, 2].forEach((i) => { const a = q.a + Math.PI / 2 + i * 2.094; b.eq(rx + Math.cos(a) * 0.6 * k, ry + Math.sin(a) * 0.6 * k, 0.1, 1.05 * k, q.a, infMix(base, [1, 1, 1], 0.3)); });
      });
    });
    // 당나귀 (위에서 본 모양: 몸통 + 머리, 다리와 귀는 작은 삼각형)
    const fail = this.result === 'fail' ? infClamp01((t - this.resultAt) / 0.9) : 0;
    const cs = Math.cos(this.yaw), sn = Math.sin(this.yaw);
    const bob = this.result === 'win' ? 0.12 * Math.sin((t - this.resultAt) * 9) : 0;
    const P = (lx, ly) => [this.x + lx * cs - ly * sn, this.y + lx * sn + ly * cs];
    const col = [0.62, 0.57, 0.52];
    this.donkey.forEach((c, i) => {
      const head = c.x > 2.6;
      const q = P(c.x + (head ? bob : 0), c.y);
      const dx = fail ? Math.cos(i * 2.3) * fail * 3 : 0, dy = fail ? Math.sin(i * 1.7) * fail * 3 : 0;
      b.eq(q[0] + dx, q[1] + dy, 0.2, 0.52 * 0.88 * (1 - fail * 0.5), (c.up ? 0 : Math.PI) + this.yaw, infScale(col, head ? 1.08 : 0.95));
    });
    const legSwing = Math.sin(t * 14) * 0.5 * this.walk;
    [[1.8, 1.5, 1], [1.8, -1.5, -1], [-1.9, 1.4, -1], [-1.9, -1.4, 1]].forEach(([lx, ly, ph]) => { const q = P(lx + legSwing * ph, ly); b.eq(q[0], q[1], 0.15, 0.7, this.yaw, infScale(col, 0.7)); });
    [[3.4, 0.8], [3.4, -0.8]].forEach(([lx, ly]) => { const q = P(lx, ly); b.eq(q[0], q[1], 0.25, 0.75, this.yaw + Math.PI / 2, infScale(col, 0.8)); });
    const tq = P(-3.5, 0); b.eq(tq[0], tq[1], 0.15, 0.6, this.yaw - Math.PI / 2, infScale(col, 0.7));
    b.end();
  }
}

// =========================================================
// 7. 양자 자살과 불멸 - "따라가라!"
//    '나'들이 나란히 서 있고 빨간 삼각형이 점등 -> 대부분 바스러지고 하나만 살아남음
//    살아남은 '나'를 재빨리 클릭 (R번 반복). 늦게 바스러지는 '나'를 먼저 누르면 실패
// =========================================================
class InfQuantum extends InfGame {
  static setup(p) {
    const d = p.d, T = p.T;
    const N = infClamp(Math.round(infLerp(3, 8, d)), 3, 8);
    const ramp = infLerp(0.75, 0.45, d);
    const windowT = infLerp(1.6, 1.0, d) - 0.15 * p.x;
    const R = infClamp(1 + Math.floor(d * 2.5), 1, Math.max(1, Math.floor((T - 0.3) / (ramp + 1.05))));
    return { command: '따라가라!', hint: '바스러지지 않고 살아남은 나를 눌러라', N, ramp, windowT, R, decoy: d > 0.35 };
  }
  constructor(ctx, p) {
    super(ctx, p);
    this.b = ctx.batch(2200);
    // '나' 하나 = 큰 삼각형을 16칸으로 나눈 삼각뿔(2D) 모양
    this.shape = infLattice((x, y) => y >= -3.0 && y <= 3.1 && Math.abs(x) <= (3.1 - y) / Math.sqrt(3), -4, 4, -3.05, 3.1, 1.5);
    this.round = 0;
    this.startRound(0);
  }
  startRound(t) {
    const p = this.p;
    const sp = Math.min(9.5, 58 / p.N);
    this.figs = Array.from({ length: p.N }, (_, i) => ({ x: (i - (p.N - 1) / 2) * sp, y: -3, alive: true, crumbleAt: Infinity, pieces: null }));
    this.survivor = infRandInt(0, p.N - 1);
    this.lateDecoy = -1;
    if (p.decoy && p.N >= 3) { do { this.lateDecoy = infRandInt(0, p.N - 1); } while (this.lateDecoy === this.survivor); }
    this.roundStart = t;
    this.resolved = false;
    this.cleared = -1;
  }
  resolve(t) {
    this.resolved = true;
    this.resolveAt = t;
    this.figs.forEach((f, i) => {
      if (i === this.survivor) return;
      f.crumbleAt = t + (i === this.lateDecoy ? 0.32 : 0);
    });
  }
  figAt(wx, wy) {
    let best = -1, bd = Infinity;
    this.figs.forEach((f, i) => { const dd = infDist(wx, wy, f.x, f.y); if (dd < bd) { bd = dd; best = i; } });
    return bd <= Math.min(4.4, (this.figs.length > 1 ? Math.abs(this.figs[1].x - this.figs[0].x) : 9) * 0.5) ? best : -1;
  }
  onDown(wx, wy) {
    if (this.result || this.cleared >= 0) return;
    const i = this.figAt(wx, wy);
    if (i < 0) return;
    if (i === this.survivor && this.resolved) {
      this.cleared = this.t;
      this.round++;
      if (this.round >= this.p.R) this.win(this.t);
    } else {
      this.badPick = i;
      this.fail(this.t, 'wrong');
    }
  }
  update(t, dt) {
    this.t = t;
    const p = this.p;
    if (!this.result) {
      if (this.cleared >= 0 && t - this.cleared > 0.35) this.startRound(t);
      else if (!this.resolved && t - this.roundStart >= p.ramp) this.resolve(t);
      else if (this.resolved && this.cleared < 0 && t - this.resolveAt > p.windowT) this.fail(t, 'missed');
    }
    // 바스러짐
    this.figs.forEach((f) => {
      if (t >= f.crumbleAt && !f.pieces) {
        f.pieces = this.shape.map((c) => ({ x: f.x + c.x, y: f.y + c.y, up: c.up, vx: -infRand(4, 12), vy: infRand(-1, 6), rot: 0, av: infRand(-8, 8) }));
      }
      if (f.pieces) f.pieces.forEach((q) => { if (q.y > -12) { q.vy -= 22 * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.rot += q.av * dt; } else { q.y = -12; } });
    });
  }
  draw(t) {
    const b = this.b, p = this.p;
    b.begin();
    const fadeOut = this.cleared >= 0 && !this.result ? 1 - infClamp01((t - this.cleared) / 0.35) : 1;
    this.figs.forEach((f, i) => {
      const isSurv = i === this.survivor;
      if (f.pieces) {
        const dim = infClamp01((t - f.crumbleAt) / 0.8);
        f.pieces.forEach((q) => b.eq(q.x, q.y, 0, 1.5 * 0.86 * (1 - 0.35 * dim), (q.up ? 0 : Math.PI) + q.rot, infFade(infScale([0.93, 0.91, 0.86], 1 - 0.55 * dim), isSurv ? 1 : fadeOut)));
      } else {
        let col = [0.93, 0.91, 0.86], s = 1;
        if (isSurv && this.resolved) {
          const k = t - this.resolveAt;
          col = infMix(col, INF_GOLD, 0.55 + 0.45 * Math.sin(k * 10));
          if (this.cleared >= 0) { s = 1 + infClamp01((t - this.cleared) / 0.35) * 0.25; }
        }
        if (this.result === 'fail' && i === this.badPick) col = INF_RED;
        const k2 = !isSurv ? fadeOut : 1;
        this.shape.forEach((c, j) => b.eq(f.x + c.x * s, f.y + c.y * s, 0, 1.5 * 0.86 * s, c.up ? 0 : Math.PI, infFade(infScale(col, 0.78 + (j % 3) * 0.1), k2)));
      }
      // 빨간 삼각형: 점점 붉어졌다가 점등
      let rk = 0;
      if (!this.resolved) rk = infClamp01((t - this.roundStart) / p.ramp);
      else rk = Math.max(0, 1 - (t - this.resolveAt) / 0.4);
      const rc = infMix([0.25, 0.1, 0.1], [1, 0.15 + 0.15 * Math.sin(t * 40), 0.1], rk);
      b.eq(f.x + 3.3, f.y + 3.4, 0.1, 1.5, Math.PI, infFade(rc, isSurv ? 1 : fadeOut));
    });
    // 지금까지 따라간 갈래 (아래 줄의 빛나는 삼각형)
    for (let r = 0; r < p.R; r++) {
      const on = r < this.round;
      b.eq((r - (p.R - 1) / 2) * 2.2, -14.2, 0, 1.2, 0, on ? INF_GOLD : [0.25, 0.25, 0.28]);
    }
    b.end();
  }
}

// =========================================================
// 8. 맥스웰의 악마 - "분리하라!"
//    빨강(빠름)은 오른쪽, 파랑(느림)은 왼쪽 방이 제자리. 잘못된 방의 분자를 클릭하면 구멍으로 보냄
//    제자리 분자를 잘못 누르면(관측 낭비) 다른 분자 하나가 다시 섞임
// =========================================================
class InfMaxwell extends InfGame {
  static setup(p) {
    const d = p.d, T = p.T;
    const k = infClamp(Math.round(infLerp(2, 5, d)), 1, Math.max(1, Math.floor((T - 0.6) / 0.9)));
    return { command: '분리하라!', hint: '잘못된 방의 분자를 눌러라 (빨강은 오른쪽, 파랑은 왼쪽)', k, M: Math.round(infLerp(10, 16, d)), vf: infLerp(5, 10, d) + 3 * p.x, penalty: d >= 0.2 };
  }
  constructor(ctx, p) {
    super(ctx, p);
    this.b = ctx.batch(900);
    this.room = { x0: -22, x1: 22, y0: -12, y1: 8, hole: 2.3 };
    this.mols = [];
    const wrongIdx = new Set(infShuffle([...Array(p.M).keys()]).slice(0, p.k));
    for (let i = 0; i < p.M; i++) {
      const fast = i % 2 === 0;
      const wrong = wrongIdx.has(i);
      const right = fast !== wrong;               // 빨강은 오른쪽이 제자리
      const x = right ? infRand(2.5, 20.5) : infRand(-20.5, -2.5);
      const a = Math.random() * Math.PI * 2, v = fast ? p.vf : p.vf * 0.45;
      this.mols.push({ x, y: infRand(-10.5, 6.5), vx: Math.cos(a) * v, vy: Math.sin(a) * v, fast, rot: Math.random() * 6, send: null, flash: -9 });
    }
    this.hover = -1;
  }
  wrongOf(m) { return m.fast ? m.x < 0 : m.x > 0; }
  wrongCount() { return this.mols.filter((m) => this.wrongOf(m) || m.send).length; }
  molAt(wx, wy) {
    let best = -1, bd = Infinity;
    this.mols.forEach((m, i) => { if (m.send) return; const dd = infDist(wx, wy, m.x, m.y); if (dd < bd) { bd = dd; best = i; } });
    return bd <= Math.max(1.9, this.ctx.px(26)) ? best : -1;
  }
  send(m, t) {
    const toRight = m.x < 0;
    const hy = infClamp(m.y, -this.room.hole + 0.6, this.room.hole - 0.6);
    m.send = { t0: t, fx: m.x, fy: m.y, hy, tx: toRight ? infRand(3, 8) : -infRand(3, 8), ty: hy + infRand(-2, 2) };
  }
  onMove(wx, wy) { this.hover = this.result ? -1 : this.molAt(wx, wy); }
  onDown(wx, wy) {
    if (this.result) return;
    const i = this.molAt(wx, wy);
    if (i < 0) return;
    const m = this.mols[i];
    if (this.wrongOf(m)) this.send(m, this.t);
    else {
      m.flash = this.t;
      if (this.p.penalty) {
        const others = this.mols.filter((q) => q !== m && !q.send && !this.wrongOf(q));
        if (others.length) this.send(infPick(others), this.t); // 관측 낭비 -> 하나가 다시 섞임
      }
    }
  }
  update(t, dt) {
    this.t = t;
    const R = this.room;
    this.mols.forEach((m) => {
      m.rot += dt * (m.fast ? 6 : 2.5);
      if (m.send) {
        const k = (t - m.send.t0) / 0.42;
        if (k < 0.55) { const e = infEaseOut(k / 0.55); m.x = infLerp(m.send.fx, 0, e); m.y = infLerp(m.send.fy, m.send.hy, e); }
        else { const e = infEaseOut((k - 0.55) / 0.45); m.x = infLerp(0, m.send.tx, e); m.y = infLerp(m.send.hy, m.send.ty, e); }
        if (k >= 1) { m.send = null; m.vx = Math.abs(m.vx) * Math.sign(m.x || 1); }
        return;
      }
      const ox = m.x;
      m.x += m.vx * dt; m.y += m.vy * dt;
      if (m.x < R.x0 + 0.8) { m.x = R.x0 + 0.8; m.vx = Math.abs(m.vx); }
      if (m.x > R.x1 - 0.8) { m.x = R.x1 - 0.8; m.vx = -Math.abs(m.vx); }
      if (m.y < R.y0 + 0.8) { m.y = R.y0 + 0.8; m.vy = Math.abs(m.vy); }
      if (m.y > R.y1 - 0.8) { m.y = R.y1 - 0.8; m.vy = -Math.abs(m.vy); }
      if (Math.sign(ox) !== Math.sign(m.x) || Math.abs(m.x) < 0.7) { m.x = ox >= 0 ? 0.7 : -0.7; m.vx = -m.vx; } // 칸막이는 막혀 있음
    });
    if (!this.result && this.wrongCount() === 0) this.win(t);
  }
  draw(t) {
    const b = this.b, R = this.room;
    b.begin();
    const edge = [0.85, 0.83, 0.76];
    const line = (x0, y0, x1, y1, col) => {
      const len = infDist(x0, y0, x1, y1), n = Math.max(1, Math.round(len / 1.1));
      for (let i = 0; i <= n; i++) b.eq(infLerp(x0, x1, i / n), infLerp(y0, y1, i / n), 0, 0.42, i % 2 ? Math.PI : 0, col);
    };
    line(R.x0, R.y0, R.x1, R.y0, edge); line(R.x0, R.y1, R.x1, R.y1, edge);
    line(R.x0, R.y0, R.x0, R.y1, edge); line(R.x1, R.y0, R.x1, R.y1, edge);
    line(0, R.y0, 0, -R.hole, edge); line(0, R.hole, 0, R.y1, edge);
    // 방 바닥의 색 표시: 왼쪽 = 파랑 방, 오른쪽 = 빨강 방
    for (let i = 0; i < 9; i++) {
      b.eq(-20 + i * 2.2, R.y0 - 1.2, 0, 0.7, 0, [0.22, 0.36, 0.6]);
      b.eq(2.4 + i * 2.2, R.y0 - 1.2, 0, 0.7, 0, [0.6, 0.24, 0.22]);
    }
    this.mols.forEach((m, i) => {
      let col = m.fast ? [1, 0.32, 0.26] : [0.32, 0.56, 1];
      const fl = Math.max(0, 1 - (t - m.flash) / 0.4);
      if (fl > 0) col = infMix(col, [1, 1, 1], fl * 0.6);
      const s = i === this.hover ? 1.6 : 1.25;
      b.eq(m.x, m.y, 0.1, s, m.rot, col);
      b.eq(m.x, m.y, 0.11, s * 0.45, m.rot + Math.PI, infScale(col, 0.7));
    });
    b.end();
  }
}

// ---------------------------------------------------------
// 실패했을 때 짧은 이유 (성공/실패 글자 아래)
// ---------------------------------------------------------
const INF_FAIL_TEXT = {
  1: { sink: '배가 가라앉았다', timeout: '배가 가라앉았다' },
  2: { fluctuation: '그건 요동이었다', timeout: '뇌를 놓쳤다' },
  3: { wrong: '다른 모양이다', timeout: '시간 초과' },
  4: { wrong: '규칙과 반대쪽이다', timeout: '고르지 못했다' },
  5: { timeout: '문장을 다 치지 못했다' },
  6: { timeout: '당나귀는 고르지 못했다' },
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
//  InfiniteMode.init({ scene, dom, px })
//    dom: { hud, stage, lives, inter, interStage, interLives, interNext, interSpeed, command, cmdWord, cmdHint, flash }
//    px(n): 화면 n픽셀이 월드 단위로 얼마인지
//  InfiniteMode.start(time, { only, stage }) / update(time, dt) / pointerDown(wx, wy) / pointerMove(wx, wy)
//    only: 그 번호의 게임만 반복 (확인용), stage: 시작 단계 (확인용)
//  InfiniteMode.onGameOver = (record) => {}
// =========================================================
const InfiniteMode = (function () {
  const C = INF_CONFIG;
  let scene = null, dom = null, pxFn = null;
  let root = null, fuse = null;
  let st = { phase: 'idle' };
  let startOpts = {};
  let inst = null, instGroup = null;
  let bag = [], lastId = 0, onlyId = 0;

  function init(o) {
    scene = o.scene; dom = o.dom; pxFn = o.px;
    root = new THREE.Group();
    scene.add(root);
    const fg = new THREE.Group();
    scene.add(fg);
    fuse = new InfBatch(fg, 200);
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
    if (!instGroup) return;
    instGroup.userData.batches.forEach((b) => b.dispose());
    root.remove(instGroup);
    instGroup = null;
    inst = null;
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
    };
    inst = new def.cls(ctx, params);
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
  function drawFuse(frac, visible) {
    const b = fuse, n = 56;
    b.begin();
    if (visible) {
      const left = Math.ceil(frac * n);
      const warn = frac < 0.3;
      for (let i = 0; i < left; i++) {
        const x = -30 + i * (60 / (n - 1));
        let col = warn ? [0.95, 0.55, 0.4] : [0.86, 0.84, 0.76];
        if (warn && Math.sin(performance.now() / 70) > 0.3) col = [1, 0.8, 0.6];
        if (i === left - 1) col = Math.random() < 0.5 ? [1, 0.85, 0.35] : [1, 0.5, 0.2]; // 불꽃
        b.eq(x, C.fuseY, 0.5, i === left - 1 ? 1.1 : 0.8, i % 2 ? Math.PI : 0, col);
      }
    }
    b.end();
  }

  function pointerDown(wx, wy) { if (st.phase === 'play' && inst && !inst.result) inst.onDown(wx, wy); }
  function pointerMove(wx, wy) { if (st.phase === 'play' && inst) inst.onMove(wx, wy); }
  function isPlaying() { return st.phase !== 'idle' && st.phase !== 'over'; }
  function getState() { return st; }
  function getInstance() { return inst; }
  function restart(time) { start(time, startOpts); }

  return { init, start, restart, update, pointerDown, pointerMove, isPlaying, getState, getInstance, onGameOver: null };
})();
