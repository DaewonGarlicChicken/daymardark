// =========================================================
// 사고실험 007. 양자 자살과 불멸 (Quantum Suicide and Immortality) - 유아론적 1인칭 / 3인칭
// -----------------------------------------------------------
// 필요: Three.js(전역 THREE)
//
// 게임: 생존 기록을 세워라
//  - 1인칭: 매번 생존 확률(10~17%)이 주어지고, 사용자가 방아쇠를 당긴다 -> 나의 시점에서는 언제나 살아남는다
//  - 5번 살아남으면 목표 달성 -> 자동으로 3인칭("모든 분기")으로 빠져나가,
//    같은 5번의 확률로 갈래들이 갈라지고 죽는 모습을 다시 보여줌 -> 실제 생존 확률이 얼마나 처참한지 입증
//
// 1인칭(나의 시점)
//  - 오른쪽에 세로로 길게 선 원(세로축 기준으로 돌아가 타원처럼 보임)이 방아쇠를 당기면 빨갛게 점등
//  - 점등 순간마다 시야가 베이지색으로 덮였다가 무수한 삼각형이 파도처럼 빠져나가며 갈라지고(페이지가 처리),
//    다른 갈래들이 시야 가장자리로 흩어져 사라짐
//  - 살아남은 이유 한 줄과 함께 다시 점등을 반복. 나의 시점에서는 언제나 살아남는다.
//
// 3인칭("모든 분기 기점")
//  - 카메라가 몸 밖으로 빠지며 5명의 '나'(트라이포드로 면이 이루어진 삼각뿔 구성체)를 보여줌
//  - 각 '나'의 오른쪽에 빨간 삼각형이 서서히 나타나 점등
//  - 대부분의 '나'는 빨간 삼각형 반대쪽(왼쪽)으로 바스러져 시체로 남고, 드물게 각기 다른 이유로 살아남음
//    (첫 시도에서는 반드시 하나가 살아남음)
//  - 살아남으면 아래 선에 빛나는 삼각형이 하나 늘고, 살아남은 '나'가 그 자리에서 위로 올라감
//    (카메라가 함께 올라가므로 화면에서는 시체들이 아래로 내려감)
//    -> 올라간 자리에서 처음 배치대로 다섯 갈래로 갈라져 반복
//  - 모두 죽으면 그 선은 끝나고 처음부터 다시 (게임의 다시 보기에서는 매번 '나' 하나는 살아남음)
//
// 공개 함수
//  initExperiment_Quantum(scene, time)
//  start_Quantum(time)                       -> 본 화면 시작 (1인칭)
//  fire_Quantum(time)                        -> 방아쇠를 당김 (당길 수 있을 때만 true)
//  resetGame_Quantum(time)                   -> 처음(1인칭)부터 다시
//  getGame_Quantum(time)                     -> { phase, survived, need, prob, probs, canFire, replayRound, cumulative, done }
//  setMode_Quantum('first' | 'third', time)
//  updateExperiment_Quantum(time, deltaTime)
//  getCamera_Quantum(time) -> { px, py, pz, lx, ly, lz }
//  popEvents_Quantum()     -> [{ type: 'flash', reason }]   (1인칭 점등 순간)
//  getLabels_Quantum()     -> [{ text, x, y, z, opacity }]  (3인칭 생존 이유)
//  getMode_Quantum()
// =========================================================

const QS_REASONS = ['불발', '공이가 걸렸다', '손이 떨려 빗나갔다', '누군가 막았다', '탄이 젖었다', '탄이 걸렸다'];

const QS_CONFIG = {
  // 게임
  rounds: 5,                // 이만큼 살아남으면 목표 달성
  probMin: 0.10,            // 매번 주어지는 생존 확률 범위
  probMax: 0.17,
  toThirdDelay: 1.6,        // 5번째 생존 후 3인칭으로 빠져나가기까지
  summaryHold: 2.2,         // 3인칭 다시 보기가 끝난 뒤 설명 화면까지
  // 1인칭
  ramp: 0.9,                // 방아쇠를 당기면 빨갛게 점등되는 시간
  afterFlash: 2.0,          // 점등(갈라짐) 후 다음 방아쇠를 당길 수 있을 때까지
  // 붉은 원: 화면 오른쪽에 세로로 길게 선 좁은 타원처럼 보이도록 (보내주신 그림 기준)
  //  - 세로축(Y)으로 돌려 거의 옆면이 보이게 함 (원근까지 계산해 폭:높이 약 1:4.7)
  //  - 화면 높이의 약 70%를 차지, 가운데보다 살짝 위
  ringRadius: 4.1,
  ringRot: [0, -2.22, 0],   // [X, Y, Z] 회전 (라디안)
  ringPos: [6.07, 2.18, -12],
  eye: [0, 1.6, 0],         // 1인칭 눈 위치 = 가운데 '나'의 몸 안
  // 3인칭
  thirdCam: [0, 6.5, 34],
  thirdLook: [0, 0.8, 0],
  camMove: 2.0,             // 몸 밖으로 빠지는 시간
  figures: 5,
  figureGap: 8,
  figureEdge: 4,            // 삼각뿔 한 변
  survive: 0.12,            // 각 '나'가 살아남을 확률
  appear: 1.1,              // 빨간 삼각형이 서서히 나타나는 시간
  lit: 0.6,                 // 점등 유지
  outcome: 2.0,             // 바스러짐 / 생존 이유 표시
  rise: 1.1,                // 살아남은 '나'가 위로 올라가는 시간
  levelHeight: 11,          // 한 번 살아남을 때마다 올라가는 높이
  splitStep: 0.45,          // 다섯 갈래로 퍼질 때 한 칸씩 퍼지는 시간
  allDead: 2.8,             // 모두 죽었을 때 머무는 시간
  lineOffsetY: -5.8,        // 아래 선 높이 (카메라 기준, 화면에 고정)
  lineSlots: 41,
};

let qsScene = null;
let qsFP = null;            // 1인칭 요소
let qsTP = null;            // 3인칭 요소
let qsMode = 'first';
let qsModeStart = -100;
let qsStarted = false;
let qsEvents = [];
let qsGame = { phase: 'idle', survived: 0, probs: [], prob: 0.6 };

function qsClamp01(x) { return Math.min(1, Math.max(0, x)); }
function qsSmooth(x) { x = qsClamp01(x); return x * x * (3 - 2 * x); }
function qsEase(x) { x = qsClamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
function qsPick(list, avoid) {
  let r;
  do { r = list[Math.floor(Math.random() * list.length)]; } while (list.length > 1 && r === avoid);
  return r;
}

function qsDynamicMesh(nTris, opts) {
  const geom = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(nTris * 9), 3);
  const col = new THREE.BufferAttribute(new Float32Array(nTris * 9), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  col.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', pos);
  geom.setAttribute('color', col);
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial(Object.assign({ vertexColors: true, side: THREE.DoubleSide }, opts || {})));
  mesh.frustumCulled = false;
  return { mesh, pos, col, geom };
}

// ---------------------------------------------------------
// 형태: 트라이포드로 면이 이루어진 삼각뿔 (2단계 시에르핀스키 사면체 = 작은 삼각뿔 16개, 삼각형 64개)
// ---------------------------------------------------------
function qsTetraTriangles(edge, level) {
  const r = edge / Math.sqrt(3);
  const base = [90, 210, 330].map((d) => [r * Math.cos(d * Math.PI / 180), 0, r * Math.sin(d * Math.PI / 180)]);
  const apex = [0, edge * Math.sqrt(2 / 3), 0];
  const out = [];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  (function rec(v, l) {
    if (l === 0) {
      const c = [0, 1, 2].map((k) => (v[0][k] + v[1][k] + v[2][k] + v[3][k]) / 4);
      [[0, 1, 2], [0, 1, 3], [1, 2, 3], [0, 2, 3]].forEach((f) => {
        const p = f.map((i) => v[i]);
        const fc = [0, 1, 2].map((k) => (p[0][k] + p[1][k] + p[2][k]) / 3);
        const nx = fc[0] - c[0], ny = fc[1] - c[1], nz = fc[2] - c[2];
        const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        out.push({ p, n: [nx / nl, ny / nl, nz / nl] });
      });
      return;
    }
    for (let i = 0; i < 4; i++) rec(v.map((w) => mid(v[i], w)), l - 1);
  })([base[0], base[1], base[2], apex], level);
  return out;
}

// ---------------------------------------------------------
// 초기화
// ---------------------------------------------------------
function initExperiment_Quantum(scene, time) {
  qsScene = scene;
  qsBuildFirstPerson();
  qsBuildThirdPerson();
}

function qsBuildFirstPerson() {
  const C = QS_CONFIG;
  const group = new THREE.Group();
  qsScene.add(group);

  // 원: 가운데 부채꼴 + 바깥 고리 (모두 삼각형)
  const tris = [];
  const segs = 28, R = C.ringRadius, rIn = R * 0.55;
  for (let i = 0; i < segs; i++) {
    const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
    const p = (rr, a) => [rr * Math.cos(a), rr * Math.sin(a), 0];
    tris.push([[0, 0, 0], p(rIn * 0.92, a0), p(rIn * 0.92, a1)]);      // 안쪽 부채꼴
    tris.push([p(rIn, a0), p(R, a0), p(R, a1)]);                         // 바깥 고리
    tris.push([p(rIn, a0), p(R, a1), p(rIn, a1)]);
  }
  const ring = qsDynamicMesh(tris.length);
  tris.forEach((t, i) => t.forEach((v, k) => ring.pos.array.set(v, i * 9 + k * 3)));
  ring.mesh.position.set(...C.ringPos);
  ring.mesh.rotation.set(C.ringRot[0], C.ringRot[1], C.ringRot[2]);
  group.add(ring.mesh);
  const shade = new Float32Array(tris.length).map(() => 0.75 + Math.random() * 0.25);

  // 갈라지는 순간 시야 가장자리로 흩어지는 "다른 갈래들"
  const nScatter = 110;
  const scatter = qsDynamicMesh(nScatter, { transparent: true, depthWrite: false });
  group.add(scatter.mesh);

  qsFP = {
    group, ring, shade, nTris: tris.length, scatter, nScatter,
    sc: { x: new Float32Array(nScatter), y: new Float32Array(nScatter), z: new Float32Array(nScatter),
      vx: new Float32Array(nScatter), vy: new Float32Array(nScatter), ang: new Float32Array(nScatter),
      av: new Float32Array(nScatter), start: -100 },
    phase: 'idle', t0: 0, glow: 0, lastReason: null, appearStart: -100,
  };
  qsWriteRing(0, 0);
}

function qsWriteRing(glow, appear) {
  const R = qsFP.ring, C = R.col.array;
  const g = qsSmooth(glow);
  for (let i = 0; i < qsFP.nTris; i++) {
    const s = qsFP.shade[i] * appear;
    // 어두운 회색 -> 빨강, 마지막엔 살짝 밝게 달아오름
    const r = (0.2 + (0.95 - 0.2) * g + g * g * 0.25) * s;
    const gg = (0.2 + (0.08 - 0.2) * g) * s;
    const b = (0.22 + (0.07 - 0.22) * g) * s;
    for (let k = 0; k < 3; k++) { C[i * 9 + k * 3] = r; C[i * 9 + k * 3 + 1] = gg; C[i * 9 + k * 3 + 2] = b; }
  }
  R.col.needsUpdate = true;
}

function qsBuildThirdPerson() {
  const C = QS_CONFIG;
  const group = new THREE.Group();
  group.visible = false;
  qsScene.add(group);

  // '나' 하나의 모양(공유)
  const shape = qsTetraTriangles(C.figureEdge, 2);
  const L = [-0.45, 0.7, 0.55], ll = Math.hypot(...L);
  const n = shape.length;
  const rest = new Float32Array(n * 9), centers = new Float32Array(n * 3), colors = new Float32Array(n * 9);
  shape.forEach((t, i) => {
    t.p.forEach((v, k) => rest.set(v, i * 9 + k * 3));
    for (let k = 0; k < 3; k++) centers[i * 3 + k] = (t.p[0][k] + t.p[1][k] + t.p[2][k]) / 3;
    const d = (t.n[0] * L[0] + t.n[1] * L[1] + t.n[2] * L[2]) / ll;
    const sh = 0.5 + 0.5 * (0.5 + 0.5 * d);
    for (let k = 0; k < 3; k++) colors.set([0.93 * sh, 0.91 * sh, 0.86 * sh], i * 9 + k * 3);
  });

  // 빨간 삼각형 모양(공유)
  const rg = new THREE.BufferGeometry();
  const s = 1.5, rr = s / Math.sqrt(3);
  rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, rr, 0, -s / 2, -rr / 2, 0, s / 2, -rr / 2, 0]), 3));

  // 아래 선: 흐린 삼각형 줄 + 살아남을 때마다 하나씩 빛나는 삼각형 (카메라를 따라 화면 아래에 고정)
  const nLine = C.lineSlots;
  const line = qsDynamicMesh(nLine, { transparent: true });
  const lit = qsDynamicMesh(nLine, { transparent: true });
  group.add(line.mesh);
  group.add(lit.mesh);

  qsTP = {
    group, shape: { n, rest, centers, colors }, redGeom: rg,
    figures: [], remains: [],
    line, lit, nLine, count: 0, litTimes: [],
    phase: 'off', t0: 0, round: 0, chosen: null,
    level: 0, camY: 0, fade: 1,
  };
}

function qsSlotX(i) { return (i - (QS_CONFIG.figures - 1) / 2) * QS_CONFIG.figureGap; }

// '나' 하나 만들기 (라운드마다 새로 만들고, 죽은 '나'는 시체로 남김)
function qsMakeFigure(x, y, time) {
  const T = qsTP, S = T.shape;
  const fg = new THREE.Group();
  T.group.add(fg);
  const m = qsDynamicMesh(S.n, { transparent: true });
  m.pos.array.set(S.rest);
  m.col.array.set(S.colors);
  fg.add(m.mesh);
  const redMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.05, 0.05), transparent: true, opacity: 0, side: THREE.DoubleSide });
  const red = new THREE.Mesh(T.redGeom, redMat);
  red.position.set(3.2, 1.7, 0);
  fg.add(red);
  const n = S.n;
  return {
    group: fg, mesh: m, red, redMat, n,
    state: 'alive', reason: null, deathStart: -100, bornAt: time,
    x, y, fromX: x, toX: x, fromY: y, toY: y, scaleOut: 1, labelOpacity: 0,
    vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n), spin: new Float32Array(n),
    ox: new Float32Array(n), oy: new Float32Array(n), oz: new Float32Array(n), delay: new Float32Array(n),
    settled: new Uint8Array(n),
  };
}

function qsDisposeFigure(f) {
  qsTP.group.remove(f.group);
  f.mesh.geom.dispose && f.mesh.geom.dispose();
}

// ---------------------------------------------------------
// 시작 / 시점 전환
// ---------------------------------------------------------
function start_Quantum(time) {
  if (qsStarted) return;
  qsStarted = true;
  qsMode = 'first';
  qsModeStart = time - QS_CONFIG.camMove; // 이미 1인칭 위치
  qsNewGame();
  qsStartFirst(time);
}

function qsNewProb() {
  const C = QS_CONFIG;
  return Math.round((C.probMin + Math.random() * (C.probMax - C.probMin)) * 100) / 100;
}

function qsNewGame() {
  qsGame = { phase: 'first', survived: 0, probs: [], prob: qsNewProb() };
}

function qsStartFirst(time) {
  qsFP.phase = 'ready';   // 방아쇠를 기다림
  qsFP.t0 = time;
  qsFP.glow = 0;
  qsFP.appearStart = time;
  qsFP.group.visible = true;
}

// 방아쇠를 당김 -> 원이 빨갛게 점등 -> 갈라짐 (나의 시점에서는 언제나 살아남음)
function fire_Quantum(time) {
  if (qsMode !== 'first' || qsFP.phase !== 'ready' || qsGame.phase !== 'first') return false;
  if (time < qsFP.appearStart + 0.3) return false;
  qsFP.phase = 'ramp';
  qsFP.t0 = time;
  return true;
}

function resetGame_Quantum(time) {
  qsNewGame();
  const wasThird = qsMode === 'third';
  if (wasThird) {
    qsMode = 'first';      // 카메라가 다시 몸 안으로 들어옴
    qsModeStart = time;
    qsTP.phase = 'off';
    qsTP.replay = false;
  }
  qsStartFirst(time + (wasThird ? QS_CONFIG.camMove : 0));
}

function setMode_Quantum(mode, time) {
  if (!qsStarted || mode === qsMode) return;
  qsMode = mode;
  qsModeStart = time;
  if (mode === 'third') {
    qsFP.phase = 'paused';
    qsTP.group.visible = true;
    qsTP.fade = 1;
    qsTP.replay = qsGame.phase === 'replay'; // 게임의 다시 보기: 같은 5번의 확률로
    qsStartLineage(time + QS_CONFIG.camMove * 0.6, true);
  } else {
    qsTP.phase = 'off';
    qsTP.replay = false;
    qsStartFirst(time + QS_CONFIG.camMove * 0.5);
  }
}

function getMode_Quantum() { return qsMode; }

function getCamera_Quantum(time) {
  const C = QS_CONFIG;
  const eyeLook = [C.eye[0], C.eye[1], C.eye[2] - 10];
  const k = qsEase((time - qsModeStart) / C.camMove);
  const w = qsMode === 'third' ? k : 1 - k; // 0 = 1인칭, 1 = 3인칭
  const lerp = (a, b) => a + (b - a) * w;
  const up = qsTP ? qsTP.camY * w : 0;      // 3인칭에서 살아남은 '나'를 따라 올라감
  return {
    px: lerp(C.eye[0], C.thirdCam[0]), py: lerp(C.eye[1], C.thirdCam[1]) + up, pz: lerp(C.eye[2], C.thirdCam[2]),
    lx: lerp(eyeLook[0], C.thirdLook[0]), ly: lerp(eyeLook[1], C.thirdLook[1]) + up, lz: lerp(eyeLook[2], C.thirdLook[2]),
    w,
  };
}

function popEvents_Quantum() { const e = qsEvents; qsEvents = []; return e; }

// ---------------------------------------------------------
// 1인칭
// ---------------------------------------------------------
function qsFlash(time) {
  const reason = qsPick(QS_REASONS, qsFP.lastReason);
  qsFP.lastReason = reason;
  qsEvents.push({ type: 'flash', reason });

  // 다른 갈래들: 시야 가운데 근처에서 가장자리로 흩어짐
  const S = qsFP.sc;
  S.start = time;
  for (let i = 0; i < qsFP.nScatter; i++) {
    const a = Math.random() * Math.PI * 2;
    const r0 = Math.random() * 1.5;
    S.x[i] = Math.cos(a) * r0; S.y[i] = 1.6 + Math.sin(a) * r0; S.z[i] = -6 - Math.random() * 3;
    const sp = 5 + Math.random() * 7;
    S.vx[i] = Math.cos(a) * sp; S.vy[i] = Math.sin(a) * sp * 0.7;
    S.ang[i] = Math.random() * Math.PI * 2; S.av[i] = (Math.random() - 0.5) * 8;
    const c = 0.75 + Math.random() * 0.25;
    for (let k = 0; k < 3; k++) qsFP.scatter.col.array.set([c, c, c * 0.88], i * 9 + k * 3);
  }
  qsFP.scatter.col.needsUpdate = true;
}

function qsUpdateFirst(time, dt) {
  const F = qsFP, C = QS_CONFIG;
  if (F.phase === 'ramp') {
    F.glow = qsClamp01((time - F.t0) / C.ramp);
    if (F.glow >= 1) {
      qsFlash(time);
      // 살아남음: 이번 확률을 기록
      qsGame.probs.push(qsGame.prob);
      qsGame.survived++;
      F.glow = 0;
      F.phase = 'after';
      F.t0 = time;
    }
  }
  if (F.phase === 'after' && time - F.t0 >= C.afterFlash * (qsGame.survived >= C.rounds ? 0.5 : 1)) {
    if (qsGame.survived >= C.rounds) {
      F.phase = 'idle';
      qsGame.phase = 'toThird';
      qsGame.switchAt = time + C.toThirdDelay * 0.3;
    } else {
      qsGame.prob = qsNewProb();
      F.phase = 'ready';
    }
  }
  const appear = qsSmooth((time - F.appearStart) / 0.6) * (qsMode === 'first' ? 1 : 1 - qsSmooth((time - qsModeStart) / 0.8));
  qsWriteRing(F.phase === 'paused' ? 0 : F.glow, appear);

  // 흩어지는 갈래들
  const S = F.sc, A = F.scatter.pos.array;
  const age = time - S.start;
  const life = 1.3;
  const sc = age < life ? (1 - qsSmooth(age / life)) * 0.35 : 0;
  F.scatter.mesh.material.opacity = age < life ? 1 - age / life : 0;
  for (let i = 0; i < F.nScatter; i++) {
    const x = S.x[i] + S.vx[i] * age, y = S.y[i] + S.vy[i] * age, ang = S.ang[i] + S.av[i] * age;
    for (let k = 0; k < 3; k++) {
      const a = ang + k * 2.0944;
      A[i * 9 + k * 3] = x + Math.cos(a) * sc;
      A[i * 9 + k * 3 + 1] = y + Math.sin(a) * sc;
      A[i * 9 + k * 3 + 2] = S.z[i];
    }
  }
  F.scatter.pos.needsUpdate = true;
  F.group.visible = appear > 0.001 || age < life;
}

// ---------------------------------------------------------
// 3인칭
// ---------------------------------------------------------
function qsStartLineage(time, resetCamera) {
  const T = qsTP;
  T.figures.forEach(qsDisposeFigure);
  T.remains.forEach(qsDisposeFigure);
  T.figures = [];
  T.remains = [];
  T.count = 0;
  T.litTimes = [];
  T.round = 1;
  T.level = 0;
  if (resetCamera) { T.camY = 0; }
  T.fade = 1;
  for (let i = 0; i < QS_CONFIG.figures; i++) {
    const f = qsMakeFigure(qsSlotX(i), 0, time + i * 0.12);
    T.figures.push(f);
  }
  T.phase = 'appear';
  T.t0 = time;
}

function qsResolve(time) {
  const T = qsTP, C = QS_CONFIG;
  const survivors = [];
  const p = T.replay ? qsGame.probs[T.round - 1] : C.survive; // 다시 보기: 그 판의 생존 확률
  T.figures.forEach((f, i) => { if (Math.random() < p) survivors.push(i); });
  // 모두 살아남으면 갈라짐이 안 보이므로, 다시 보기에서는 적어도 하나는 죽음
  if (T.replay && survivors.length === T.figures.length) survivors.splice(Math.floor(Math.random() * survivors.length), 1);
  // 첫 시도(다시 보기에서는 매번) 반드시 하나가 살아남음 = 지금의 '나'
  if ((T.round === 1 || T.replay) && survivors.length === 0) survivors.push(Math.floor(Math.random() * T.figures.length));
  let lastReason = null;
  T.figures.forEach((f, i) => {
    if (survivors.indexOf(i) >= 0) {
      f.state = 'survived';
      f.reason = qsPick(QS_REASONS, lastReason);
      lastReason = f.reason;
    } else {
      f.state = 'dying';
      f.deathStart = time;
      for (let j = 0; j < f.n; j++) {
        // 빨간 삼각형 반대쪽(왼쪽, -x)으로 바스러짐
        f.vx[j] = -(3 + Math.random() * 7);
        f.vy[j] = -1 + Math.random() * 4;
        f.vz[j] = (Math.random() - 0.5) * 4;
        f.spin[j] = (Math.random() - 0.5) * 10;
        f.ox[j] = 0; f.oy[j] = 0; f.oz[j] = 0; f.settled[j] = 0;
        f.delay[j] = (T.shape.centers[j * 3] + C.figureEdge / 2) / C.figureEdge * 0.35 * Math.random(); // 오른쪽부터 먼저
      }
    }
  });
  T.survivors = survivors;
}

function qsUpdateThird(time, dt) {
  const T = qsTP, C = QS_CONFIG;
  if (T.phase === 'off') {
    if (qsMode === 'first' && time - qsModeStart > C.camMove * 0.5) T.group.visible = false;
    return;
  }

  if (T.phase === 'appear' && time - T.t0 >= C.appear) { T.phase = 'lit'; T.t0 = time; }
  if (T.phase === 'lit' && time - T.t0 >= C.lit) { qsResolve(time); T.phase = 'outcome'; T.t0 = time; }
  if (T.phase === 'outcome' && time - T.t0 >= C.outcome) {
    // 죽은 '나'들은 시체로 남김
    T.figures.forEach((f) => { if (f.state === 'dying' || f.state === 'dead') T.remains.push(f); });
    if (T.survivors.length && T.replay && T.round >= QS_CONFIG.rounds) {
      // 다시 보기 끝: 5번째에서 살아남은 갈래들이 지금의 '나' -> 멈추고 결과
      T.count++;
      T.litTimes.push(time);
      T.phase = 'summary'; T.t0 = time;
      qsGame.phase = 'summary';
      qsGame.summaryAt = time;
    } else if (T.survivors.length) {
      // 살아남음: 선에 빛나는 삼각형 하나 + 그중 하나의 '나'가 그 자리에서 위로 올라감
      T.count++;
      T.litTimes.push(time);
      const pickIdx = T.survivors[Math.floor(Math.random() * T.survivors.length)];
      T.chosen = T.figures[pickIdx];
      T.chosenSlot = pickIdx;
      // 다른 생존자들은 관찰되지 않는 갈래로 사라짐
      T.figures.forEach((f, i) => { if (f.state === 'survived' && i !== pickIdx) f.fadeStart = time; });
      T.level++;
      T.chosen.fromY = T.chosen.y;
      T.chosen.toY = T.level * C.levelHeight;
      T.phase = 'rise'; T.t0 = time;
    } else {
      T.phase = 'allDead'; T.t0 = time;
    }
  }
  if (T.phase === 'rise') {
    const p = qsEase((time - T.t0) / C.rise);
    const ch = T.chosen;
    ch.y = ch.fromY + (ch.toY - ch.fromY) * p;
    T.camY = ch.y; // 카메라가 살아남은 '나'와 정확히 같이 올라감 -> 화면에서 '나'는 고정, 시체들만 아래로
    ch.labelOpacity = 1 - qsSmooth((time - T.t0) / 0.5);
    if (time - T.t0 >= C.rise) {
      // 올라간 자리에서 다섯 갈래로 갈라짐: 살아남은 '나'는 제자리에 고정,
      // 이웃 칸부터 한 칸씩 차례로 퍼져 나감 (바로 옆 칸 -> 그 옆 칸 ...)
      //   X X X O X  ->  X X O O O  ->  X O O O O  ->  O O O O O
      const y = ch.toY;
      T.figures.forEach((f) => { if (f !== ch && f.state === 'survived') qsDisposeFigure(f); });
      ch.reason = null;
      ch.fromX = ch.toX = ch.x = qsSlotX(T.chosenSlot);
      ch.splitStart = time;
      const next = [];
      let maxD = 0;
      for (let i = 0; i < C.figures; i++) {
        if (i === T.chosenSlot) { ch.state = 'alive'; next.push(ch); continue; }
        const d = Math.abs(i - T.chosenSlot);
        const toward = i < T.chosenSlot ? 1 : -1;            // 살아남은 '나' 쪽 이웃 칸
        const start = time + (d - 1) * C.splitStep;
        const f = qsMakeFigure(qsSlotX(i + toward), y, start); // 이웃 칸에서 태어나
        f.fromX = qsSlotX(i + toward); f.toX = qsSlotX(i);     // 한 칸 옆 제자리로
        f.x = f.fromX;
        f.splitStart = start;
        maxD = Math.max(maxD, d);
        next.push(f);
      }
      T.figures = next;
      T.splitEnd = time + maxD * C.splitStep;
      T.phase = 'split'; T.t0 = time;
    }
  }
  if (T.phase === 'split') {
    T.figures.forEach((f) => {
      const p = qsEase((time - f.splitStart) / C.splitStep);
      f.x = f.fromX + (f.toX - f.fromX) * p;
    });
    if (time >= T.splitEnd + 0.15) { T.round++; T.phase = 'appear'; T.t0 = time; }
  }
  if (T.phase === 'allDead') {
    // 모든 갈래에서 '나'는 죽었다: 장면이 사그라든 뒤 처음부터
    T.fade = 1 - qsSmooth((time - T.t0 - 1.4) / 1.2);
    if (time - T.t0 >= C.allDead) { qsStartLineage(time, true); }
  }

  // 화면 밖으로 멀리 내려간 시체는 정리
  T.remains = T.remains.filter((f) => {
    if (f.y < T.camY - C.levelHeight * 3) { qsDisposeFigure(f); return false; }
    return true;
  });


  // ----- '나'들 그리기 -----
  const all = T.figures.concat(T.remains);
  all.forEach((f) => {
    f.group.position.set(f.x, f.y, 0);
    const born = qsSmooth((time - f.bornAt) / 0.5);
    const out = f.fadeStart !== undefined ? 1 - qsSmooth((time - f.fadeStart) / 0.6) : 1;
    if (f.fadeStart !== undefined) f.labelOpacity = out;
    f.group.scale.setScalar(Math.max(0.0001, born * out));
    f.mesh.mesh.material.opacity = T.fade;

    // 빨간 삼각형: 서서히 나타남 -> 점등 -> 사라짐 (지금 라운드의 '나'들만)
    let ro = 0, rc = [0.45, 0.04, 0.04];
    if (T.figures.indexOf(f) >= 0) {
      if (T.phase === 'appear') ro = qsSmooth((time - T.t0) / C.appear);
      else if (T.phase === 'lit') { ro = 1; rc = [1, 0.12 + 0.2 * Math.sin((time - T.t0) * 30) ** 2, 0.08]; }
      else if (T.phase === 'outcome') { ro = 1 - qsSmooth((time - T.t0) / 0.8); rc = [0.95, 0.1, 0.08]; }
    }
    f.redMat.opacity = ro * T.fade;
    f.redMat.color.setRGB(rc[0], rc[1], rc[2]);
    f.red.scale.setScalar(T.phase === 'lit' ? 1.25 : 1);

    if (f.state === 'survived' && T.phase === 'outcome') f.labelOpacity = qsSmooth((time - T.t0 - 0.3) / 0.4);

    if (f.state === 'dying') qsCrumble(f, time, dt);
  });

  qsWriteLine(time);
}

// 바스러짐: 조각이 왼쪽으로 흩어져 땅에 떨어진 뒤 어둡고 작은 시체 조각으로 남음
function qsCrumble(f, time, dt) {
  const T = qsTP, S = T.shape;
  const t = time - f.deathStart;
  const P = f.mesh.pos.array, R = S.rest, Cc = f.mesh.col.array;
  let moving = 0;
  for (let j = 0; j < f.n; j++) {
    const lt = t - f.delay[j];
    let sc = 1;
    if (lt > 0) {
      if (!f.settled[j]) {
        f.vy[j] -= 9 * dt;
        f.ox[j] += f.vx[j] * dt; f.oy[j] += f.vy[j] * dt; f.oz[j] += f.vz[j] * dt;
        f.vx[j] *= 0.985;
        if (S.centers[j * 3 + 1] + f.oy[j] <= 0.05) { f.oy[j] = 0.05 - S.centers[j * 3 + 1]; f.settled[j] = 1; }
        else moving++;
      }
      sc = 1 - 0.45 * qsSmooth(lt / 1.4);
      const dim = 1 - 0.55 * qsSmooth(lt / 1.4); // 시체는 어둡게
      for (let k = 0; k < 9; k++) Cc[j * 9 + k] = S.colors[j * 9 + k] * dim;
    } else moving++;
    const cx = S.centers[j * 3], cy = S.centers[j * 3 + 1], cz = S.centers[j * 3 + 2];
    const a = f.settled[j] ? f.spinStop || 0 : Math.max(0, lt) * f.spin[j];
    const cs = Math.cos(a), sn = Math.sin(a);
    for (let k = 0; k < 3; k++) {
      const o = j * 9 + k * 3;
      const dx = (R[o] - cx) * sc, dy = (R[o + 1] - cy) * sc, dz = (R[o + 2] - cz) * sc;
      P[o] = cx + f.ox[j] + dx * cs - dy * sn;
      P[o + 1] = cy + f.oy[j] + dx * sn + dy * cs;
      P[o + 2] = cz + f.oz[j] + dz;
    }
  }
  f.mesh.pos.needsUpdate = true;
  f.mesh.col.needsUpdate = true;
  if (moving === 0 && t > 1.5) f.state = 'dead'; // 다 떨어지면 그대로 멈춤
}

function qsWriteLine(time) {
  const T = qsTP, C = QS_CONFIG;
  const span = (C.figures - 1) * C.figureGap + 8;
  const gap = span / (T.nLine - 1);
  const s = 0.6, r = s / Math.sqrt(3);
  const baseY = T.camY + C.lineOffsetY;  // 카메라를 따라 화면 아래에 고정
  const write = (m, count, colorFn, scaleFn) => {
    const A = m.pos.array, Cc = m.col.array;
    for (let i = 0; i < T.nLine; i++) {
      const on = i < count;
      const x = -span / 2 + i * gap, y = baseY;
      const k = on ? scaleFn(i) : 0;
      const v = [[x, y + r * k], [x - s / 2 * k, y - r / 2 * k], [x + s / 2 * k, y - r / 2 * k]];
      const c = colorFn(i);
      for (let j = 0; j < 3; j++) {
        A.set([v[j][0], v[j][1], 0], i * 9 + j * 3);
        Cc.set(c, i * 9 + j * 3);
      }
    }
    m.pos.needsUpdate = true; m.col.needsUpdate = true;
  };
  write(T.line, T.nLine, () => [0.22, 0.22, 0.25], () => 1);
  T.line.mesh.material.opacity = T.fade;
  const n = Math.min(T.count, T.nLine);
  write(T.lit, n, (i) => {
    const age = time - (T.litTimes[i] || -100);
    const g = Math.max(0, 1 - age / 0.8);
    return [1, 0.86 + 0.14 * g, 0.45 + 0.55 * g];
  }, (i) => {
    const age = time - (T.litTimes[i] || -100);
    return 1.15 + 0.6 * Math.max(0, 1 - age / 0.5);
  });
  T.lit.mesh.material.opacity = T.fade;
}

function getLabels_Quantum() {
  if (!qsTP || qsTP.phase === 'off') return [];
  return qsTP.figures.map((f) => ({
    text: f.reason || '', x: f.x, y: f.y + QS_CONFIG.figureEdge * 0.82 + 1.6, z: 0,
    opacity: f.reason ? f.labelOpacity : 0,
  }));
}

// ---------------------------------------------------------
// 매 프레임
// ---------------------------------------------------------
function updateExperiment_Quantum(time, deltaTime) {
  if (!qsFP) return;
  const dt = Math.min(1 / 30, Math.max(0, deltaTime || 0));
  // 5번 살아남음 -> 3인칭으로 빠져나가 같은 5번을 모든 갈래에서 다시 봄
  if (qsGame.phase === 'toThird' && time >= qsGame.switchAt) {
    qsGame.phase = 'replay';
    setMode_Quantum('third', time);
  }
  if (qsStarted) qsUpdateFirst(time, dt);
  qsUpdateThird(time, dt);
}

function getStatus_Quantum() {
  return { mode: qsMode, fp: qsFP.phase, tp: qsTP.phase, round: qsTP.round, count: qsTP.count, level: qsTP.level };
}

// ---------------------------------------------------------
// 게임 상태
// ---------------------------------------------------------
function getGame_Quantum(time) {
  const g = qsGame, C = QS_CONFIG;
  const round = qsTP && qsTP.replay ? Math.min(qsTP.round, C.rounds) : 0;
  // 다시 보기에서 지금까지(이번 판 포함) 모두 살아남을 확률
  let cumulative = 1;
  const upto = g.phase === 'replay' || g.phase === 'summary' ? round : g.probs.length;
  for (let i = 0; i < upto; i++) cumulative *= g.probs[i];
  let all = 1;
  g.probs.forEach((p) => { all *= p; });
  return {
    phase: g.phase,
    survived: g.survived,
    need: C.rounds,
    prob: g.prob,
    probs: g.probs.slice(),
    canFire: qsMode === 'first' && qsFP.phase === 'ready' && g.phase === 'first',
    firing: qsFP.phase === 'ramp',
    replayRound: round,
    replayStage: qsTP ? qsTP.phase : 'off',
    cumulative,
    allSurvive: all,
    done: g.phase === 'summary' && time - g.summaryAt >= C.summaryHold,
  };
}
