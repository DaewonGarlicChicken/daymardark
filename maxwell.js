// =========================================================
// 사고실험 008. 맥스웰의 악마 (Maxwell's Demon)
// -----------------------------------------------------------
// 필요: Three.js(전역 THREE), boltzmann-brain-shape.js (뇌 모양 필드를 함께 씀)
//
// 구성
//  - 직사각형 방: 모서리를 작은 삼각형을 나열해 그림, 가운데 구멍(문)이 있는 칸막이
//  - 방 안의 삼각뿔 70개: 파랑 = 느림, 빨강 = 빠름. 자유롭게 돌아다니며 벽과 칸막이에 튕김
//  - 방 위의 뇌: 볼츠만 두뇌와 같은 모양을 작은 삼각형으로 입체적으로 표현
//    그 안에 기억 15칸(작은 삼각뿔, 흰색)이 입체적으로 배치됨
//
// 게임 (사용자 = 악마)
//  - 목표: 분자를 완벽하게 분리 (빨강은 오른쪽, 파랑은 왼쪽)
//  - 떠다니는 분자를 클릭하면 낚아서 구멍 앞으로 데려와 관찰
//      잘못된 방에 있던 분자 -> 문을 열고 옳은 방으로 보냄
//      이미 옳은 방에 있던 분자 -> 문을 열지 않고 돌려보냄 (관찰은 했으므로 기억은 참)
//  - 낚을(관찰할) 때마다 뇌 속 기억 한 칸이 노랗게 변함
//  - 기억이 다 차면 더 낚을 수 없음 -> 기억을 내보냄(열 방출)
//      내보낸 개수 / 1.5 만큼 분자가 다시 잘못된 방으로 섞임
//  - 잘못된 방에 남은 분자가 0이 되면 목표 완료
//  - 15칸이 모두 노래지면 퍼지며 바스러지고 다시 흰색으로 -> 그 수만큼 노란 작은 삼각형(열)이 화면을 떠다님
//  - 뇌, 흩어지는 조각, 노란 삼각형은 상단 제목바의 선을 넘지 않음
//
// 공개 함수
//  initExperiment_MaxwellDemon(scene, time)
//  setView_MaxwellDemon({ camY, camDist, topY, halfW, halfH })  -> 화면 범위(제목바 선 포함)
//  start_MaxwellDemon(time)
//  updateExperiment_MaxwellDemon(time, deltaTime)
//  pickMolecule_MaxwellDemon(ndcX, ndcY, camera) -> 화면 좌표 근처 분자 번호 (없으면 -1)
//  setHover_MaxwellDemon(index)
//  catchMolecule_MaxwellDemon(index, time) -> 'ok' | 'full' | 'busy' | 'none'
//  releaseMemory_MaxwellDemon(time)         -> 기억 내보내기 (가득 찼을 때만)
//  resetGame_MaxwellDemon(time)
//  getGame_MaxwellDemon() -> { wrong, memory, cap, full, busy, won, remixed }
// =========================================================

const MX_CONFIG = {
  room: { hx: 11, hy: 5, hz: 5 },      // 방 절반 크기
  holeHalf: 1.6,                      // 칸막이 구멍(정사각형) 절반 크기
  edgeTriSize: 0.32,                  // 방 모서리를 이루는 삼각형 크기
  edgeTriGap: 0.5,                    // 그 간격
  molecules: 70,
  molEdge: 0.85,                      // 삼각뿔 한 변 (방이 작아져서 함께 줄임)
  slowSpeed: 2.4,                     // 파랑
  fastSpeed: 6.5,                     // 빨강
  brain: {
    scale: 0.115,                     // 볼츠만 두뇌 모양을 이 비율로 줄임 (가로 약 8.5)
    shellCount: 650,                  // 뇌 겉면 삼각형 수
    shellTriSize: 0.3,
    cells: 20,                        // 기억 칸 수
    cellEdge: 0.6,                    // 기억 칸(작은 삼각뿔) 한 변
    topMargin: 1.0,                   // 제목바 선과의 여유
    gap: 1.2,                         // 방 윗면과 뇌 사이 간격
    sway: 0.35,                       // 입체가 드러나도록 천천히 좌우로 도는 폭(라디안)
  },
  initialWrong: 20,                   // 시작할 때 잘못된 방에 있는 분자 수 (빨강 15 왼쪽 + 파랑 15 오른쪽)
  remixRatio: 2.0,                    // 기억을 내보내면 (내보낸 개수 / 1.5)만큼 다시 섞임
  approach: 0.45,                     // 낚은 분자를 구멍 앞으로 데려오는 시간
  passTime: 0.3,                      // 구멍을 통과하는 시간
  pickRadiusPx: 26,                   // 클릭 판정 반경(화면 픽셀)
  flush: 1.4,                         // 기억이 가득 차서 퍼지고 바스러지는 시간
  heatSize: 0.32,
  heatMax: 900,
  heatZ: 9,
};

const MX_COLORS = {
  blue: [0.25, 0.52, 1.0],
  red: [1.0, 0.26, 0.2],
  edge: [0.85, 0.83, 0.76],
  partition: [0.85, 0.83, 0.75],
  shell: [0.62, 0.62, 0.66],
  white: [0.93, 0.93, 0.9],
  yellow: [1.0, 0.84, 0.25],
};

let mxRoot = null;
let mxMol = null;
let mxBrain = null;
let mxHeat = null;
let mxDoor = null;
let mxBeam = null;
let mxView = { camY: 5, camDist: 40, topY: 18, halfW: 30, halfH: 14 };
let mxClip = null;
let mxState = { phase: 'waiting' };

function mxClamp01(x) { return Math.min(1, Math.max(0, x)); }
function mxSmooth(x) { x = mxClamp01(x); return x * x * (3 - 2 * x); }
function mxEase(x) { x = mxClamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
function mxRandDir() {
  const z = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), r * Math.sin(t), z];
}

function mxDynamicMesh(nTris, opts) {
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

// 삼각뿔 면 4개 (무게중심 원점)
function mxTetraFaces(edge) {
  const r = edge / Math.sqrt(3), h = edge * Math.sqrt(2 / 3);
  const b = [90, 210, 330].map((d) => [r * Math.cos(d * Math.PI / 180), -h / 4, r * Math.sin(d * Math.PI / 180)]);
  const a = [0, h * 3 / 4, 0];
  return [[b[0], b[1], a], [b[1], b[2], a], [b[2], b[0], a], [b[0], b[2], b[1]]];
}

// 축-각 회전 행렬 (3x3, 행 우선)
function mxRotMatrix(axis, ang, out) {
  const [x, y, z] = axis, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  out[0] = t * x * x + c; out[1] = t * x * y - s * z; out[2] = t * x * z + s * y;
  out[3] = t * x * y + s * z; out[4] = t * y * y + c; out[5] = t * y * z - s * x;
  out[6] = t * x * z - s * y; out[7] = t * y * z + s * x; out[8] = t * z * z + c;
  return out;
}

// ---------------------------------------------------------
// 초기화
// ---------------------------------------------------------
function initExperiment_MaxwellDemon(scene, time) {
  mxRoot = new THREE.Group();
  scene.add(mxRoot);
  // 제목바 선을 화면 기준으로 자르는 평면 (카메라와 선을 함께 지남) - 흩어지는 조각/열 입자에 사용
  mxClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  mxBuildRoom();
  mxBuildMolecules();
  mxBuildBrain();
  mxBuildHeat();
  mxState = { phase: 'waiting', memory: 0, action: null, won: false, remixed: 0 };
  mxApplyView();
}

function setView_MaxwellDemon(v) {
  mxView = Object.assign({}, mxView, v);
  if (mxRoot) mxApplyView();
}

function mxApplyView() {
  const V = mxView;
  // 자르는 평면: 카메라(0, camY, D)와 z=0 평면의 선(y = topY)을 함께 지남 -> 그 아래만 보임
  const D = V.camDist, Yr = V.topY - V.camY, L = Math.sqrt(D * D + Yr * Yr);
  mxClip.normal.set(0, -D / L, -Yr / L);
  mxClip.constant = (Yr * D + D * V.camY) / L;
  // 뇌는 방 바로 위에 (방과 한 덩어리로 화면 가운데 정렬됨). 단, 제목바 선은 넘지 않게
  const B = mxBrain;
  const top = B.topExtent;
  const screenTop = (y, z) => V.camY + (y - V.camY) * D / (D - z); // z에 있는 점이 z=0 평면에서 보이는 높이
  let y = MX_CONFIG.room.hy + MX_CONFIG.brain.gap + B.bottomExtent;
  // 앞쪽(카메라 쪽)으로 튀어나온 부분은 원근으로 더 위에 보이므로, 선을 넘으면 맞을 때까지 내림
  for (let i = 0; i < 60 && screenTop(y + top, B.frontZ) > V.topY - MX_CONFIG.brain.topMargin; i++) y -= 0.1;
  B.group.position.y = y;
}

// ---------------------------------------------------------
// 방: 모서리를 작은 삼각형으로 나열
// ---------------------------------------------------------
function mxBuildRoom() {
  const C = MX_CONFIG, { hx, hy, hz } = C.room, h = C.holeHalf;
  const segs = [];
  const P = (x, y, z) => [x, y, z];
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    segs.push([P(-hx, a * hy, b * hz), P(hx, a * hy, b * hz)]);   // 가로
    segs.push([P(a * hx, -hy, b * hz), P(a * hx, hy, b * hz)]);   // 세로
    segs.push([P(a * hx, b * hy, -hz), P(a * hx, b * hy, hz)]);   // 깊이
  }
  // 칸막이 테두리 + 구멍 테두리
  const rect = (y0, y1, z0, z1) => [[P(0, y0, z0), P(0, y0, z1)], [P(0, y1, z0), P(0, y1, z1)], [P(0, y0, z0), P(0, y1, z0)], [P(0, y0, z1), P(0, y1, z1)]];
  segs.push(...rect(-hy, hy, -hz, hz), ...rect(-h, h, -h, h));

  // 선분마다 일정 간격으로 작은 삼각형 (화면을 향하도록 xy 평면에, 꼭짓점은 선 방향)
  const tris = [];
  const r = C.edgeTriSize / Math.sqrt(3);
  segs.forEach(([a, b]) => {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const len = Math.hypot(...d);
    const n = Math.max(2, Math.round(len / C.edgeTriGap));
    let fx = d[0], fy = d[1];
    const fl = Math.hypot(fx, fy);
    if (fl < 1e-6) { fx = 0; fy = 1; } else { fx /= fl; fy /= fl; }   // 깊이 방향 선은 위를 향함
    const sx = -fy, sy = fx;
    for (let i = 0; i <= n; i++) {
      const t = i / n, cx = a[0] + d[0] * t, cy = a[1] + d[1] * t, cz = a[2] + d[2] * t;
      tris.push(
        cx + fx * r, cy + fy * r, cz,
        cx - fx * r / 2 + sx * r * 0.866, cy - fy * r / 2 + sy * r * 0.866, cz,
        cx - fx * r / 2 - sx * r * 0.866, cy - fy * r / 2 - sy * r * 0.866, cz,
      );
    }
  });
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
  mxRoot.add(new THREE.Mesh(eg, new THREE.MeshBasicMaterial({ color: new THREE.Color(...MX_COLORS.edge), side: THREE.DoubleSide })));

  // 칸막이 면: 구멍을 뺀 나머지를 아주 옅게
  const pt = [];
  const quad = (y0, y1, z0, z1) => { pt.push(0, y0, z0, 0, y1, z0, 0, y1, z1, 0, y0, z0, 0, y1, z1, 0, y0, z1); };
  quad(h, hy, -hz, hz); quad(-hy, -h, -hz, hz); quad(-h, h, -hz, -h); quad(-h, h, h, hz);
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pt), 3));
  mxRoot.add(new THREE.Mesh(pg, new THREE.MeshBasicMaterial({
    color: new THREE.Color(...MX_COLORS.partition), transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false,
  })));

  // 문: 구멍을 막는 판 (열릴 때 위로 접힘)
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, -h, -h, 0, h, -h, 0, h, h, 0, -h, -h, 0, h, h, 0, -h, h]), 3));
  const doorMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...MX_COLORS.partition), transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  const door = new THREE.Mesh(dg, doorMat);
  mxRoot.add(door);
  mxDoor = { mesh: door, mat: doorMat, open: 0, target: 0, flash: -100 };

  // 관찰 순간 뇌 -> 분자를 잇는 선
  const bg = new THREE.BufferGeometry();
  const bpos = new THREE.BufferAttribute(new Float32Array(6), 3);
  bpos.setUsage(THREE.DynamicDrawUsage);
  bg.setAttribute('position', bpos);
  const beamMat = new THREE.LineBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0 });
  mxRoot.add(new THREE.LineSegments(bg, beamMat));
  mxBeam = { pos: bpos, mat: beamMat, start: -100 };
}

// ---------------------------------------------------------
// 분자
// ---------------------------------------------------------
function mxBuildMolecules() {
  const C = MX_CONFIG, R = C.room;
  const n = C.molecules;
  const m = mxDynamicMesh(n * 4);
  mxRoot.add(m.mesh);
  const faces = mxTetraFaces(C.molEdge);
  const list = [];
  for (let i = 0; i < n; i++) {
    const fast = i < n / 2;                       // 절반 빨강(빠름), 절반 파랑(느림)
    const side = 1;                               // 실제 위치는 mxScatter에서 정함
    const speed = fast ? C.fastSpeed : C.slowSpeed;
    const dir = mxRandDir();
    list.push({
      fast, speed, side,
      x: side * (1.2 + Math.random() * (R.hx - 2.4)), y: (Math.random() * 2 - 1) * (R.hy - 1), z: (Math.random() * 2 - 1) * (R.hz - 1),
      vx: dir[0] * speed, vy: dir[1] * speed, vz: dir[2] * speed,
      axis: mxRandDir(), ang: Math.random() * 6.28, spin: (fast ? 3 : 1.2) * (0.6 + Math.random() * 0.8),
      guided: false,
    });
  }
  const C4 = [1.0, 0.8, 0.65, 0.5];
  list.forEach((mol, i) => {
    const c = mol.fast ? MX_COLORS.red : MX_COLORS.blue;
    for (let f = 0; f < 4; f++) for (let k = 0; k < 3; k++) m.col.array.set([c[0] * C4[f], c[1] * C4[f], c[2] * C4[f]], (i * 4 + f) * 9 + k * 3);
  });
  m.col.needsUpdate = true;
  mxMol = { mesh: m, list, faces, hover: -1 };
  mxScatter();
}

// 분자를 방에 흩뿌림: 빨강/파랑 각각 initialWrong/2개는 잘못된 방, 나머지는 옳은 방
function mxScatter() {
  const C = MX_CONFIG, R = C.room;
  const reds = mxMol.list.filter((m) => m.fast), blues = mxMol.list.filter((m) => !m.fast);
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  shuffle(reds); shuffle(blues);
  const half = Math.round(C.initialWrong / 2);
  mxMol.list.forEach((m) => {
    const group = m.fast ? reds : blues;
    const wrong = group.indexOf(m) < half;
    const correct = m.fast ? 1 : -1;
    const side = wrong ? -correct : correct;
    m.side = side;
    m.x = side * (1.2 + Math.random() * (R.hx - 2.4));
    m.y = (Math.random() * 2 - 1) * (R.hy - 1);
    m.z = (Math.random() * 2 - 1) * (R.hz - 1);
    const d = mxRandDir();
    m.vx = d[0] * m.speed; m.vy = d[1] * m.speed; m.vz = d[2] * m.speed;
    m.guided = false; m.remix = null;
  });
}

// ---------------------------------------------------------
// 뇌: 볼츠만 두뇌와 같은 모양(BB_BRAIN_CONFIG, bbBrainField)을 작게 줄여 입체로
// ---------------------------------------------------------
function mxBuildBrain() {
  const B = MX_CONFIG.brain, cfg = BB_BRAIN_CONFIG, s = B.scale;

  // 1) 겉면(피질): 각 부위 타원체 표면 근처에서 뽑고 합쳐진 뇌 필드로 걸러냄, 서로 일정 간격
  const shell = [];
  const weights = cfg.parts.map((p) => p.s[0] * p.s[1] + p.s[1] * p.s[2] + p.s[0] * p.s[2]);
  const wsum = weights.reduce((a, w) => a + w, 0);
  const minD2 = Math.pow(2.6, 2);
  for (let tries = 0; tries < 60000 && shell.length < B.shellCount; tries++) {
    let pick = Math.random() * wsum, pi = 0;
    while (pi < weights.length - 1 && pick > weights[pi]) { pick -= weights[pi]; pi++; }
    const part = cfg.parts[pi];
    const u = mxRandDir();
    const k = 0.95 + Math.random() * 0.1;
    const x = part.c[0] + part.s[0] * u[0] * k, y = part.c[1] + part.s[1] * u[1] * k, z = part.c[2] + part.s[2] * u[2] * k;
    const f = bbBrainField(x, y, z);
    if (f > 1 || f < 0.86) continue;
    if (shell.some((q) => (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2 < minD2)) continue;
    // 법선 = 뇌 필드가 커지는 방향
    const e = 0.5;
    const n = [
      bbBrainFieldRaw(x + e, y, z) - bbBrainFieldRaw(x - e, y, z),
      bbBrainFieldRaw(x, y + e, z) - bbBrainFieldRaw(x, y - e, z),
      bbBrainFieldRaw(x, y, z + e) - bbBrainFieldRaw(x, y, z - e),
    ];
    shell.push([x, y, z, n]);
  }

  // 뇌 중심과 크기 (뇌 단위 -> 세계 단위)
  const mn = [Infinity, Infinity, Infinity], mxv = [-Infinity, -Infinity, -Infinity];
  shell.forEach((p) => { for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mxv[k] = Math.max(mxv[k], p[k]); } });
  const center = [(mn[0] + mxv[0]) / 2, (mn[1] + mxv[1]) / 2, (mn[2] + mxv[2]) / 2];

  const group = new THREE.Group();
  mxRoot.add(group);

  // 겉면 삼각형 (반투명 -> 안쪽 기억 칸이 비쳐 보임)
  const sm = mxDynamicMesh(shell.length, { transparent: true, opacity: 0.55, depthWrite: false, clippingPlanes: [mxClip] });
  const r = B.shellTriSize / Math.sqrt(3);
  const L = [-0.4, 0.7, 0.6], ll = Math.hypot(...L);
  shell.forEach((p, i) => {
    const c = [(p[0] - center[0]) * s, (p[1] - center[1]) * s, (p[2] - center[2]) * s];
    let n = p[3]; const nl = Math.hypot(...n) || 1; n = [n[0] / nl, n[1] / nl, n[2] / nl];
    const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e1 = [n[1] * ref[2] - n[2] * ref[1], n[2] * ref[0] - n[0] * ref[2], n[0] * ref[1] - n[1] * ref[0]];
    const el = Math.hypot(...e1); e1 = [e1[0] / el, e1[1] / el, e1[2] / el];
    const e2 = [n[1] * e1[2] - n[2] * e1[1], n[2] * e1[0] - n[0] * e1[2], n[0] * e1[1] - n[1] * e1[0]];
    const a0 = Math.random() * Math.PI * 2;
    const sh = (0.55 + 0.45 * (0.5 + 0.5 * (n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / ll)) * (0.9 + Math.random() * 0.2);
    for (let k = 0; k < 3; k++) {
      const a = a0 + k * 2.0944;
      const o = i * 9 + k * 3;
      sm.pos.array.set([
        c[0] + (e1[0] * Math.cos(a) + e2[0] * Math.sin(a)) * r,
        c[1] + (e1[1] * Math.cos(a) + e2[1] * Math.sin(a)) * r,
        c[2] + (e1[2] * Math.cos(a) + e2[2] * Math.sin(a)) * r,
      ], o);
      sm.col.array.set([MX_COLORS.shell[0] * sh, MX_COLORS.shell[1] * sh, MX_COLORS.shell[2] * sh], o);
    }
  });
  group.add(sm.mesh);

  // 2) 기억 30칸: 뇌 안쪽 격자 후보 중 서로 가장 멀리 떨어지게 골라 입체적으로 배치
  const cand = [];
  for (let x = mn[0]; x <= mxv[0]; x += 3.2)
    for (let y = mn[1]; y <= mxv[1]; y += 3.2)
      for (let z = mn[2]; z <= mxv[2]; z += 3.2)
        if (bbBrainField(x, y, z) < 0.62) cand.push([x, y, z]);
  const cells = [];
  const minDist = new Float64Array(cand.length).fill(Infinity);
  let cur = Math.floor(cand.length / 2);
  for (let i = 0; i < B.cells && cand.length; i++) {
    const p = cand[cur];
    cells.push({ x: (p[0] - center[0]) * s, y: (p[1] - center[1]) * s, z: (p[2] - center[2]) * s,
      axis: mxRandDir(), ang: Math.random() * 6.28, spin: 0.3 + Math.random() * 0.5 });
    let far = -1, fi = 0;
    cand.forEach((q, j) => {
      const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
      if (d < minDist[j]) minDist[j] = d;
      if (minDist[j] > far) { far = minDist[j]; fi = j; }
    });
    cur = fi;
  }
  cells.sort((a, b) => a.x - b.x || b.y - a.y); // 기억이 차는 순서: 왼쪽(앞이마) -> 오른쪽(뒤통수)

  const cm = mxDynamicMesh(cells.length * 4, { clippingPlanes: [mxClip] });
  const shards = mxDynamicMesh(cells.length * 4, { transparent: true, depthWrite: false, clippingPlanes: [mxClip] });
  group.add(cm.mesh);
  group.add(shards.mesh);

  // 위아래 크기 (뇌를 제목바 아래에 두기 위해)
  const half = [(mxv[0] - mn[0]) / 2 * s, (mxv[1] - mn[1]) / 2 * s, (mxv[2] - mn[2]) / 2 * s];
  mxBrain = {
    group, shell: sm, cm, shards, cells, faces: mxTetraFaces(B.cellEdge),
    lit: new Float32Array(cells.length).fill(-100), flushStart: -100,
    shardDir: cells.map(() => mxRandDir()),
    topExtent: half[1], bottomExtent: half[1], frontZ: half[2],
  };
}

const mxRot = new Float32Array(9);
function mxWriteBrain(time, dt) {
  const B = mxBrain, C = MX_CONFIG, st = mxState;
  // 천천히 좌우로 돌아 입체가 드러남
  B.group.rotation.y = Math.sin(time * 0.25) * C.brain.sway;
  B.group.rotation.x = 0.12;

  const P = B.cm.pos.array, Cc = B.cm.col.array;
  const flushP = (time - B.flushStart) / C.flush;
  const inFlush = flushP >= 0 && flushP < 1;
  const shade = [1.0, 0.8, 0.65, 0.5];
  B.cells.forEach((c, i) => {
    c.ang += c.spin * dt;
    mxRotMatrix(c.axis, c.ang, mxRot);
    const on = i < st.memory;
    const age = time - B.lit[i];
    const pop = on ? 1 + 0.5 * Math.max(0, 1 - age / 0.35) : 1;
    const back = inFlush ? mxSmooth(flushP) : 1; // 방출 뒤 흰 칸이 다시 서서히 나타남
    const k = pop * back;
    const col = on ? MX_COLORS.yellow : MX_COLORS.white;
    const glow = on ? Math.max(0, 0.45 - age) : 0;
    for (let f = 0; f < 4; f++) for (let v = 0; v < 3; v++) {
      const p = B.faces[f][v], o = (i * 4 + f) * 9 + v * 3;
      P[o] = c.x + (mxRot[0] * p[0] + mxRot[1] * p[1] + mxRot[2] * p[2]) * k;
      P[o + 1] = c.y + (mxRot[3] * p[0] + mxRot[4] * p[1] + mxRot[5] * p[2]) * k;
      P[o + 2] = c.z + (mxRot[6] * p[0] + mxRot[7] * p[1] + mxRot[8] * p[2]) * k;
      Cc[o] = Math.min(1, col[0] * shade[f] + glow); Cc[o + 1] = Math.min(1, col[1] * shade[f] + glow); Cc[o + 2] = Math.min(1, col[2] * shade[f] + glow);
    }
  });
  B.cm.pos.needsUpdate = true; B.cm.col.needsUpdate = true;

  // 방출: 노란 칸들이 퍼지며 바스러짐
  const S = B.shards, SP = S.pos.array, SC = S.col.array;
  S.mesh.visible = inFlush;
  if (inFlush) {
    const e = 1 - Math.pow(1 - flushP, 2);
    B.cells.forEach((c, i) => {
      const d = B.shardDir[i];
      const ox = (c.x * 0.8 + d[0] * 2.5) * e * 1.6, oy = (c.y * 0.4 + d[1] * 1.5) * e * 1.6, oz = (c.z * 0.8 + d[2] * 2.5) * e * 1.6;
      const k = 1.3 * (1 - mxSmooth(flushP));
      mxRotMatrix(c.axis, c.ang + e * 6, mxRot);
      for (let f = 0; f < 4; f++) for (let v = 0; v < 3; v++) {
        const p = B.faces[f][v], o = (i * 4 + f) * 9 + v * 3;
        SP[o] = c.x + ox + (mxRot[0] * p[0] + mxRot[1] * p[1] + mxRot[2] * p[2]) * k;
        SP[o + 1] = c.y + oy + (mxRot[3] * p[0] + mxRot[4] * p[1] + mxRot[5] * p[2]) * k;
        SP[o + 2] = c.z + oz + (mxRot[6] * p[0] + mxRot[7] * p[1] + mxRot[8] * p[2]) * k;
        SC[o] = MX_COLORS.yellow[0] * shade[f]; SC[o + 1] = MX_COLORS.yellow[1] * shade[f]; SC[o + 2] = MX_COLORS.yellow[2] * shade[f];
      }
    });
    S.mesh.material.opacity = 1 - flushP;
    S.pos.needsUpdate = true; S.col.needsUpdate = true;
  }
}

// 뇌 안의 칸 위치를 세계 좌표로 (뇌 그룹의 회전/위치 반영, three.js 기본 순서 XYZ: R = Rx * Ry)
function mxCellWorld(c) {
  const g = mxBrain.group;
  const ry = g.rotation.y, rx = g.rotation.x;
  const x = c.x * Math.cos(ry) + c.z * Math.sin(ry), z = -c.x * Math.sin(ry) + c.z * Math.cos(ry), y = c.y;
  const y2 = y * Math.cos(rx) - z * Math.sin(rx), z2 = y * Math.sin(rx) + z * Math.cos(rx);
  return [x + g.position.x, y2 + g.position.y, z2 + g.position.z];
}

// ---------------------------------------------------------
// 열: 방출된 만큼 화면을 떠다니는 노란 작은 삼각형 (제목바 선 아래에서만)
// ---------------------------------------------------------
function mxBuildHeat() {
  const C = MX_CONFIG;
  const m = mxDynamicMesh(C.heatMax, { transparent: true, depthWrite: false, clippingPlanes: [mxClip] });
  m.geom.setDrawRange(0, 0);
  mxRoot.add(m.mesh);
  mxHeat = { m, list: [] };
}

function mxReleaseHeat(time, count) {
  const C = MX_CONFIG;
  mxBrain.cells.slice(0, count === undefined ? mxBrain.cells.length : count).forEach((c) => {
    if (mxHeat.list.length >= C.heatMax) mxHeat.list.shift(); // 너무 많아지면 가장 오래된 것부터
    const w = mxCellWorld(c);
    const d = mxRandDir();
    mxHeat.list.push({
      x: w[0], y: w[1], z: w[2],
      vx: d[0] * 6, vy: d[1] * 3 - 2, vz: d[2] * 4,   // 처음엔 퍼져 나가다가 (위보다 옆/아래로)
      ang: Math.random() * 6.28, spin: (Math.random() - 0.5) * 3,
      phase: Math.random() * 6.28, born: time,
    });
  });
}

function mxUpdateHeat(time, dt) {
  const H = mxHeat, C = MX_CONFIG, V = mxView;
  const A = H.m.pos.array, Cc = H.m.col.array;
  const r = C.heatSize / Math.sqrt(3);
  const D = V.camDist;
  H.list.forEach((p, i) => {
    p.vx *= 1 - Math.min(1, dt * 0.9); p.vy *= 1 - Math.min(1, dt * 0.9); p.vz *= 1 - Math.min(1, dt * 0.9);
    const wx = Math.sin(time * 0.5 + p.phase) * 0.9, wy = Math.cos(time * 0.37 + p.phase * 1.3) * 0.7;
    p.x += (p.vx + wx) * dt; p.y += (p.vy + wy) * dt; p.z += p.vz * dt;
    if (Math.abs(p.z) > C.heatZ) { p.z = Math.sign(p.z) * C.heatZ; p.vz = -Math.sign(p.z) * (Math.abs(p.vz) + 0.3); }
    // 화면 안에 머묾: 원근을 반영한 화면상 위치로 판단 (위쪽 한계 = 제목바 선)
    const k = D / Math.max(1, D - p.z);
    const sx = p.x * k, sy = V.camY + (p.y - V.camY) * k;
    if (Math.abs(sx) > V.halfW - 0.8) { p.x = Math.sign(p.x) * (V.halfW - 0.8) / k; p.vx = -Math.sign(p.x) * (Math.abs(p.vx) + 0.4); }
    if (sy > V.topY - 0.6) { p.y = V.camY + (V.topY - 0.6 - V.camY) / k; p.vy = -(Math.abs(p.vy) + 0.4); }
    if (sy < V.camY - V.halfH + 0.6) { p.y = V.camY + (-V.halfH + 0.6) / k; p.vy = Math.abs(p.vy) + 0.4; }
    p.ang += p.spin * dt;
    const tw = 0.75 + 0.25 * Math.sin(time * 3 + p.phase * 5);
    const pop = Math.min(1, (time - p.born) / 0.3);
    for (let q = 0; q < 3; q++) {
      const a = p.ang + q * 2.0944, o = i * 9 + q * 3;
      A[o] = p.x + Math.cos(a) * r * pop; A[o + 1] = p.y + Math.sin(a) * r * pop; A[o + 2] = p.z;
      Cc[o] = MX_COLORS.yellow[0] * tw; Cc[o + 1] = MX_COLORS.yellow[1] * tw; Cc[o + 2] = MX_COLORS.yellow[2] * tw;
    }
  });
  H.m.geom.setDrawRange(0, H.list.length * 3);
  H.m.pos.needsUpdate = true; H.m.col.needsUpdate = true;
}

// ---------------------------------------------------------
// 악마의 관찰 / 통과
// ---------------------------------------------------------
function start_MaxwellDemon(time) {
  if (mxState.phase !== 'waiting') return;
  mxState.phase = 'running';
}

// 화면 좌표(NDC, -1~1) 근처에 있는 분자 찾기 (가장 가까운 것, 판정 반경 안)
const mxProj = new THREE.Vector3();
function pickMolecule_MaxwellDemon(ndcX, ndcY, camera, viewW, viewH) {
  let best = -1, bestD = Infinity;
  const r = MX_CONFIG.pickRadiusPx;
  mxMol.list.forEach((m, i) => {
    if (m.guided) return;
    mxProj.set(m.x, m.y, m.z).project(camera);
    const dx = (mxProj.x - ndcX) * viewW / 2, dy = (mxProj.y - ndcY) * viewH / 2;
    const d = Math.hypot(dx, dy);
    if (d < r && d < bestD) { bestD = d; best = i; }
  });
  return best;
}

function setHover_MaxwellDemon(i) { mxMol.hover = i; }

function mxBusy() { return !!mxState.action || mxMol.list.some((m) => m.remix) || mxState.flushAt !== undefined; }

function catchMolecule_MaxwellDemon(i, time) {
  const st = mxState;
  if (st.phase !== 'running' || st.won) return 'none';
  if (i < 0 || !mxMol.list[i] || mxMol.list[i].guided) return 'none';
  if (st.memory >= mxBrain.cells.length) return 'full';   // 기억이 가득 차면 더 낚을 수 없음
  if (mxBusy()) return 'busy';
  mxStartAction(time, mxMol.list[i]);
  return 'ok';
}

// 기억 내보내기: 열로 방출 + (내보낸 개수 / 1.5)만큼 옳은 방의 분자가 다시 잘못된 방으로
function releaseMemory_MaxwellDemon(time) {
  const st = mxState, C = MX_CONFIG;
  if (st.phase !== 'running' || st.memory < mxBrain.cells.length || mxBusy()) return false;
  const released = st.memory;
  mxBrain.flushStart = time;
  mxReleaseHeat(time, released);
  st.memory = 0;
  const n = Math.round(released / C.remixRatio);
  const candidates = mxMol.list.filter((m) => !m.guided && !mxWrongSide(m));
  for (let i = candidates.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [candidates[i], candidates[j]] = [candidates[j], candidates[i]]; }
  candidates.slice(0, n).forEach((m, k) => {
    const side = m.x < 0 ? -1 : 1;
    m.guided = true;
    m.remix = { t0: time + 0.5 + k * 0.12, from: null, side };
  });
  st.remixed = n;
  return true;
}

function resetGame_MaxwellDemon(time) {
  mxScatter();
  mxState.memory = 0;
  mxState.action = null;
  mxState.flushAt = undefined;
  mxState.won = false;
  mxState.remixed = 0;
  mxState.phase = 'running';
  mxBrain.flushStart = -100;
  mxHeat.list = [];
  mxDoor.target = 0;
}

function getGame_MaxwellDemon() {
  const st = mxState;
  return {
    wrong: mxMol.list.filter(mxWrongSide).length,
    memory: st.memory, cap: mxBrain.cells.length,
    full: st.memory >= mxBrain.cells.length,
    busy: mxBusy(), won: st.won, remixed: st.remixed,
  };
}

function mxWrongSide(m) { return m.fast ? m.x < 0 : m.x > 0; } // 빨강은 오른쪽, 파랑은 왼쪽이 제자리

function mxStartAction(time, mol) {
  const side = mol.x < 0 ? -1 : 1;
  mol.guided = true;
  mxState.action = {
    mol, side, t0: time,
    from: [mol.x, mol.y, mol.z],
    gate: [side * 2.2, 0, 0],                  // 구멍 앞
    through: [-side * 2.4, 0, 0],              // 구멍 건너편
    pass: mxWrongSide(mol),                    // 잘못된 쪽에 있으면 통과, 제자리면 돌려보냄
    stage: 'approach',
  };
}

function mxUpdateAction(time) {
  const st = mxState, a = st.action, C = MX_CONFIG;
  if (!a) return;
  const m = a.mol;
  if (a.stage === 'approach') {
    const p = mxEase((time - a.t0) / C.approach);
    m.x = a.from[0] + (a.gate[0] - a.from[0]) * p;
    m.y = a.from[1] + (a.gate[1] - a.from[1]) * p;
    m.z = a.from[2] + (a.gate[2] - a.from[2]) * p;
    if (p >= 1) {
      mxMemorize(time);                        // 관찰: 판단 하나 = 기억 한 칸
      mxBeam.start = time;
      a.stage = a.pass ? 'pass' : 'reject';
      a.t1 = time;
      if (a.pass) mxDoor.target = 1; else mxDoor.flash = time;
    }
  } else if (a.stage === 'pass') {
    const p = mxEase((time - a.t1 - 0.2) / C.passTime);
    m.x = a.gate[0] + (a.through[0] - a.gate[0]) * p;
    if (p >= 1) mxRelease(m, -a.side);
  } else if (a.stage === 'reject') {
    if (time - a.t1 > 0.35) mxRelease(m, a.side);
  }
}

// 다시 자유롭게: 칸막이에서 멀어지는 방향으로
function mxRelease(m, side) {
  const d = mxRandDir();
  d[0] = Math.abs(d[0]) * side + side * 0.6;
  const l = Math.hypot(...d);
  m.vx = d[0] / l * m.speed; m.vy = d[1] / l * m.speed; m.vz = d[2] / l * m.speed;
  m.side = side;          // 이제 이쪽 방의 분자
  m.guided = false;
  mxState.action = null;
}

function mxMemorize(time) {
  const st = mxState, n = mxBrain.cells.length;
  if (st.memory < n) { mxBrain.lit[st.memory] = time; st.memory++; }
}

// ---------------------------------------------------------
// 매 프레임
// ---------------------------------------------------------
function updateExperiment_MaxwellDemon(time, deltaTime) {
  if (!mxRoot) return;
  const dt = Math.min(1 / 30, Math.max(0, deltaTime || 0));
  const st = mxState, C = MX_CONFIG;

  mxUpdateAction(time);
  mxUpdateRemix(time);

  // 목표 완료: 잘못된 방에 남은 분자가 없고, 움직이는 중인 것도 없음
  if (st.phase === 'running' && !st.won && !mxBusy() && mxMol.list.every((m) => !mxWrongSide(m))) st.won = true;

  // 문 (다시 섞이는 중에도 열림)
  if (mxMol.list.some((m) => m.remix && time >= m.remix.t0)) mxDoor.target = 1;
  else if (!st.action) mxDoor.target = 0;
  mxDoor.open += (mxDoor.target - mxDoor.open) * Math.min(1, dt * 10);
  mxDoor.mesh.position.y = mxDoor.open * C.holeHalf * 0.9;
  mxDoor.mesh.scale.y = Math.max(0.0001, 1 - mxDoor.open * 0.9);
  const fl = Math.max(0, 1 - (time - mxDoor.flash) / 0.35);
  mxDoor.mat.color.setRGB(MX_COLORS.partition[0] + (1 - MX_COLORS.partition[0]) * fl, MX_COLORS.partition[1] * (1 - fl * 0.6), MX_COLORS.partition[2] * (1 - fl * 0.6));
  mxDoor.mat.opacity = 0.3 + fl * 0.45;

  mxMoveMolecules(dt);
  mxWriteMolecules();
  mxWriteBrain(time, dt);
  mxUpdateHeat(time, dt);
  mxUpdateBeam(time);
}

// 기억을 내보낸 대가: 골라진 분자들이 차례로 구멍을 지나 잘못된 방으로 되돌아감
function mxUpdateRemix(time) {
  mxMol.list.forEach((m) => {
    const r = m.remix;
    if (!r || time < r.t0) return;
    if (!r.from) r.from = [m.x, m.y, m.z];
    const t = time - r.t0;
    const g = [r.side * 2.2, 0, 0], th = [-r.side * 2.4, 0, 0];
    if (t < 0.35) {
      const p = mxEase(t / 0.35);
      m.x = r.from[0] + (g[0] - r.from[0]) * p; m.y = r.from[1] + (g[1] - r.from[1]) * p; m.z = r.from[2] + (g[2] - r.from[2]) * p;
    } else if (t < 0.6) {
      m.x = g[0] + (th[0] - g[0]) * mxEase((t - 0.35) / 0.25); m.y = 0; m.z = 0;
    } else {
      const side = -r.side;
      const d = mxRandDir();
      d[0] = Math.abs(d[0]) * side + side * 0.6;
      const l = Math.hypot(...d);
      m.vx = d[0] / l * m.speed; m.vy = d[1] / l * m.speed; m.vz = d[2] / l * m.speed;
      m.side = side;
      m.guided = false;
      m.remix = null;
    }
  });
}

function mxMoveMolecules(dt) {
  const R = MX_CONFIG.room, pad = MX_CONFIG.molEdge * 0.6;
  mxMol.list.forEach((m) => {
    m.ang += m.spin * dt;
    if (m.guided) return;
    m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
    if (m.x < -R.hx + pad) { m.x = -R.hx + pad; m.vx = Math.abs(m.vx); }
    if (m.x > R.hx - pad) { m.x = R.hx - pad; m.vx = -Math.abs(m.vx); }
    if (m.y < -R.hy + pad) { m.y = -R.hy + pad; m.vy = Math.abs(m.vy); }
    if (m.y > R.hy - pad) { m.y = R.hy - pad; m.vy = -Math.abs(m.vy); }
    if (m.z < -R.hz + pad) { m.z = -R.hz + pad; m.vz = Math.abs(m.vz); }
    if (m.z > R.hz - pad) { m.z = R.hz - pad; m.vz = -Math.abs(m.vz); }
    // 칸막이 (문이 닫혀 있으면 구멍도 벽): 지금 있는 쪽을 벗어나지 못함
    if (m.side < 0 && m.x > -pad) { m.x = -pad; m.vx = -Math.abs(m.vx); }
    if (m.side > 0 && m.x < pad) { m.x = pad; m.vx = Math.abs(m.vx); }
  });
}

function mxWriteMolecules() {
  const A = mxMol.mesh.pos.array, F = mxMol.faces;
  mxMol.list.forEach((m, i) => {
    mxRotMatrix(m.axis, m.ang, mxRot);
    const k2 = i === mxMol.hover ? 1.7 : 1; // 마우스를 올린 분자는 크게
    for (let f = 0; f < 4; f++) for (let k = 0; k < 3; k++) {
      const v = F[f][k], o = (i * 4 + f) * 9 + k * 3;
      A[o] = m.x + (mxRot[0] * v[0] + mxRot[1] * v[1] + mxRot[2] * v[2]) * k2;
      A[o + 1] = m.y + (mxRot[3] * v[0] + mxRot[4] * v[1] + mxRot[5] * v[2]) * k2;
      A[o + 2] = m.z + (mxRot[6] * v[0] + mxRot[7] * v[1] + mxRot[8] * v[2]) * k2;
    }
  });
  mxMol.mesh.pos.needsUpdate = true;
}

function mxUpdateBeam(time) {
  const a = mxState.action;
  const age = time - mxBeam.start;
  mxBeam.mat.opacity = Math.max(0, 0.8 * (1 - age / 0.6));
  if (a) {
    const P = mxBeam.pos.array, g = mxBrain.group.position;
    P[0] = g.x; P[1] = g.y - mxBrain.bottomExtent * 0.7; P[2] = g.z;
    P[3] = a.mol.x; P[4] = a.mol.y; P[5] = a.mol.z;
    mxBeam.pos.needsUpdate = true;
  }
}

// 화면 맞춤용: 방 + 뇌 전체의 위아래 범위(z=0 기준)
function getLayout_MaxwellDemon() {
  const R = MX_CONFIG.room, B = mxBrain;
  return { bottom: -R.hy, top: R.hy + MX_CONFIG.brain.gap + B.bottomExtent + B.topExtent, hx: R.hx, hz: R.hz };
}

function getStatus_MaxwellDemon() {
  return { memory: mxState.memory, heat: mxHeat.list.length, wrong: mxMol.list.filter(mxWrongSide).length };
}
