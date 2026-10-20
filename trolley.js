// =========================================================
// 사고실험 004. 트롤리 딜레마 (Trolley Dilemma) - 장면/애니메이션
// -----------------------------------------------------------
// 필요: Three.js(전역 THREE), trolley-shape.js
//
// 게임: 6번의 선택. 매번 왼쪽(1명)과 오른쪽(N명)에 누가 있는지 조건이 주어지고,
//       기차가 오기 전 5초 안에 살릴 쪽을 고른다.
//  - 손가락 끝이 마우스 커서를 가리키며 따라감
//  - 화면 가운데를 기준으로 왼쪽 공간을 누름 -> 왼쪽을 살림 (오른쪽 희생)
//    오른쪽 공간을 누름 -> 오른쪽을 살림 (왼쪽 희생)
//    아무것도 하지 않음 -> 5초가 지나면 기차는 원래 선로(오른쪽)로 감 (선택하지 않음으로 기록)
//  - 6번을 모두 고르면 목표 완료
//
// 흐름 (한 번의 선택)
//  ready   : 손 위 스톱워치가 5.00초부터 거꾸로 셈
//  손 클릭  : 검지가 굽으며 손이 내려감 -> 2초 뒤 왼쪽 1개 트라이포드가 폭발, 오른쪽 5개는 사라짐
//  시간 초과: 오른쪽 5개 트라이포드가 폭발, 왼쪽 1개는 사라짐
//  explode : 작은 삼각형 400개가 중력을 받으며 날아감 (양옆 벽에 튕기고 바닥에 닿으면 멈춤)
//  gather  : 모두 멈추면 가운데로 모여 세로 선로가 됨 (손보다 아래에 깔림)
//  morph   : 손이 위에서 본 기차로 변신
//  depart  : 기차가 선로를 타고 위로 퇴장
//  clear   : 선로가 사라짐 -> 다음 조건으로 손과 트라이포드가 다시 나타남 (6번째 뒤에는 finished)
//
// 공개 함수
//  initExperiment_TrolleyDilemma(scene, time)
//  setViewBounds_TrolleyDilemma(halfW, halfH, topY, camDist) -> z=0 평면의 화면 절반 크기, 제목바 선 높이
//  start_TrolleyDilemma(time)                   -> 본 화면 시작 (카운트다운 시작)
//  updateExperiment_TrolleyDilemma(time, deltaTime)
//  choose_TrolleyDilemma(side, time)  -> 'left' | 'right' 공간을 누름 (고를 수 있을 때만 true)
//  setAim_TrolleyDilemma(ndcX, ndcY)  -> 마우스 위치(화면 정규 좌표): 손가락이 그쪽을 가리킴
//  setHoverSide_TrolleyDilemma(side|null)
//  getStopwatch_TrolleyDilemma(time) -> { text, opacity, x, y, z }  (좌표는 tdSpace 기준)
//  getRoot_TrolleyDilemma()
//  getGame_TrolleyDilemma(time) -> 현재 조건/남은 시간/지금까지의 선택
//  getLabelAnchors_TrolleyDilemma() -> 왼쪽/오른쪽 무리 아래 이름표 자리 (월드 좌표)
//  resetGame_TrolleyDilemma(time)
// =========================================================

const TD_TIMING = {
  countdown: 5,         // 스톱워치 시작값(초) = 고르는 제한 시간
  pressBend: 0.5,       // 검지가 굽고 손이 내려가는 시간
  pressToExplode: 1.1,  // 손을 누른 뒤 폭발까지
  vanish: 0.5,          // 폭발하지 않는 쪽 트라이포드가 사라지는 시간
  explodeMax: 4,        // 안전장치: 이 시간이 지나면 남은 삼각형도 멈춘 것으로 처리
  gatherDelayMax: 0.5,  // 선로로 모일 때 삼각형마다 출발이 늦어지는 최대 시간
  gatherDuration: 1.0,
  morphDelay: 0.2,      // 선로가 다 깔리고 손이 기차로 변하기 시작할 때까지
  morph: 1.1,
  trainAccel: 24,       // 기차 가속도 (단위/초²)
  trackFade: 0.5,
  appear: 0.6,          // 손과 트라이포드가 다시 나타나는 시간
};

// 6번의 선택 조건 (left = 1명 쪽, right = 여러 명 쪽, rightCount = 오른쪽 트라이포드 수)
const TD_ROUNDS = [
  { left: '연쇄살인마 1명', right: '절도범 5명', rightCount: 5 },
  { left: '아기 1명', right: '가정의 가장 3명', rightCount: 3 },
  { left: '나 1명', right: '일반인 2명', rightCount: 2 },
  { left: '일반인 1명', right: '노인 5명', rightCount: 5 },
  { left: '아이돌 1명', right: '아이돌 연습생 3명', rightCount: 3 },
  { left: '응급환자 1명', right: '장기이식 대기자 5명', rightCount: 5 },
];

const TD_LAYOUT = {
  handScale: 1.3,
  handRotX: 0.35,       // 시작 구도: 손등(주먹)이 정면 위쪽, 검지가 보는 사람 쪽을 향함 (보내주신 사진 기준)
  handRotY: -0.05,
  handYFrac: 0,         // 화면 높이 기준 손 위치 (0 = 화면 한가운데, 원점)
  handDrop: 3.5,        // 누를 때 내려가는 거리
  tripodYFrac: 0,       // 선택지(트라이포드 무리)는 화면 상하 가운데
  tripodXFrac: 0.55,
  fiveSpacing: 4.6,
  gravity: 38,
  restitution: 0.75,    // 벽에 튕길 때 속도 유지 비율
  railHalfGauge: 1.6,
  sleeperSpacing: 2.6,
  sleeperTriangles: 5,
  stopwatchGap: 2.5,
  aimYaw: 0.75,         // 커서가 화면 끝에 있을 때 손이 좌우로 도는 최대 각도(라디안)
  aimPitch: 0.6,        // 위아래 최대 각도
  aimFollow: 10,        // 따라가는 빠르기
};

const TD_COLORS = {
  skin: [0.93, 0.74, 0.58],
  train: [0.62, 0.66, 0.72],
  tripod: 0xefe6d2,
  explode: [0.86, 0.12, 0.10], // 폭발한 작은 삼각형 (붉은색) -> 선로가 되면 원래 트라이포드 색으로
};

let tdRoot = null;
let tdSpace = null;   // 손/기차 + 폭발 삼각형/선로를 담는 공간 (상단 트라이포드는 제외)
let tdBounds = { halfW: 50, halfH: 30, topY: 30, camDist: 60 };
let tdClipPlane = null; // 제목바 위로는 기차가 보이지 않게 자르는 평면
let tdHand = null;
let tdTripods = [];
let tdParticles = null;
let tdState = { phase: 'waiting' };
let tdGame = { round: 0, choices: [] }; // choices: { saved: 'left'|'right', timeout }
let tdAim = { x: 0, y: 0, yaw: 0, pitch: 0 }; // 커서 방향 / 지금 손이 향한 각도
let tdHoverSide = null;

function tdClamp01(x) { return Math.min(1, Math.max(0, x)); }
function tdSmooth(x) { x = tdClamp01(x); return x * x * (3 - 2 * x); }
function tdEaseInOutCubic(x) { x = tdClamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

// ---------------------------------------------------------
// 초기화
// ---------------------------------------------------------
function initExperiment_TrolleyDilemma(scene, time) {
  tdRoot = new THREE.Group();
  scene.add(tdRoot);
  tdSpace = new THREE.Group();
  tdRoot.add(tdSpace);
  tdClipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), tdBounds.topY);
  tdUpdateClipPlane();
  tdBuildHand();
  tdBuildTripods();
  tdBuildParticles();
  tdState = { phase: 'waiting' };
  tdApplyLayout();
}

// topY: 상단 제목바 바로 아래의 y (선로 끝 / 기차가 빠져나가는 선). 생략하면 화면 맨 위
// 제목바 선을 "화면 기준"으로 자르는 평면.
// 카메라 위치(0,0,camDist)와 z=0 평면의 선(y = topY)을 함께 지나는 평면이라,
// 카메라 쪽으로 튀어나온 기차 지붕도 화면에서 정확히 흰 선 아래에서 잘린다.
function tdUpdateClipPlane() {
  if (!tdClipPlane) return;
  const D = tdBounds.camDist, Y = tdBounds.topY;
  const L = Math.sqrt(D * D + Y * Y);
  tdClipPlane.normal.set(0, -D / L, -Y / L);
  tdClipPlane.constant = (Y * D) / L;
}

// camDist: 카메라와 z=0 평면 사이 거리 (생략하면 60)
function setViewBounds_TrolleyDilemma(halfW, halfH, topY, camDist) {
  const dist = camDist !== undefined ? camDist : tdBounds.camDist;
  tdBounds = { halfW, halfH, topY: topY === undefined ? halfH : topY, camDist: dist };
  tdUpdateClipPlane();
  if (tdRoot) tdApplyLayout();
}

// 좌클릭 드래그: 공간을 원점(0,0,0) 기준으로 회전 (양쪽 상단 트라이포드는 고정)
// (드래그 회전은 게임 버전에서 쓰지 않음)
function setSpaceRotation_TrolleyDilemma(rotX, rotY) {
  if (!tdSpace) return;
  tdSpace.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotX));
  tdSpace.rotation.y = rotY;
}
function getRoot_TrolleyDilemma() { return tdSpace; }

function tdHandRestY() { return tdBounds.halfH * TD_LAYOUT.handYFrac; }

// 대기 중일 때만 위치를 다시 잡음 (애니메이션 도중에는 건드리지 않음)
function tdApplyLayout() {
  const L = TD_LAYOUT;
  const y = tdBounds.halfH * L.tripodYFrac;
  const lx = -tdBounds.halfW * L.tripodXFrac;
  const rx = tdBounds.halfW * L.tripodXFrac;
  const n = tdRightCount();
  tdTripods.forEach((t) => {
    t.homeX = t.side === 'left' ? lx : rx + (t.slot - (n - 1) / 2) * L.fiveSpacing;
    t.homeY = y;
  });

  const p = tdState.phase;
  if (p === 'waiting' || p === 'ready') {
    tdHand.group.position.set(0, tdHandRestY(), 0);
  }
}

function tdBuildHand() {
  const H = TD_SHAPE_CONFIG.hand;
  const hand = tdGenerateHandTriangles();
  const n = hand.count;
  const rest = tdBuildTriangleVertices(hand.centers, hand.normals, H.triangleSize, null, 11);

  // 손 -> 기차 대응: 검지 끝(앞쪽 z)일수록 기관차 앞쪽(위쪽 y)으로 가도록 정렬해서 짝지음
  const train = tdGenerateTrainTriangles(n);
  const trainVertsRaw = tdBuildTriangleVertices(train.centers, train.normals, H.triangleSize,
    new Float32Array(n * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 12);
  const handOrder = Array.from({ length: n }, (_, i) => i).sort((a, b) => hand.centers[b * 3 + 2] - hand.centers[a * 3 + 2]);
  const trainOrder = Array.from({ length: n }, (_, i) => i).sort((a, b) => train.centers[b * 3 + 1] - train.centers[a * 3 + 1]);
  const trainVerts = new Float32Array(n * 9);
  const trainNormals = new Float32Array(n * 3);
  for (let r = 0; r < n; r++) {
    const h = handOrder[r], t = trainOrder[r];
    trainVerts.set(trainVertsRaw.subarray(t * 9, t * 9 + 9), h * 9);
    trainNormals.set(train.normals.subarray(t * 3, t * 3 + 3), h * 3);
  }

  // 색: 손(피부색) / 기차(강철색), 법선으로 명암
  const Lt = tdNorm([-0.45, 0.55, 0.7]);
  const skinCol = new Float32Array(n * 9);
  const trainCol = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const v = 0.92 + Math.random() * 0.16;
    const dh = hand.normals[i * 3] * Lt[0] + hand.normals[i * 3 + 1] * Lt[1] + hand.normals[i * 3 + 2] * Lt[2];
    const dt = trainNormals[i * 3] * Lt[0] + trainNormals[i * 3 + 1] * Lt[1] + trainNormals[i * 3 + 2] * Lt[2];
    const sh = (0.45 + 0.55 * (0.5 + 0.5 * dh)) * v;
    const st = (0.45 + 0.55 * (0.5 + 0.5 * dt)) * v;
    for (let k = 0; k < 3; k++) {
      const o = i * 9 + k * 3;
      skinCol[o] = TD_COLORS.skin[0] * sh; skinCol[o + 1] = TD_COLORS.skin[1] * sh; skinCol[o + 2] = TD_COLORS.skin[2] * sh;
      trainCol[o] = TD_COLORS.train[0] * st; trainCol[o + 1] = TD_COLORS.train[1] * st; trainCol[o + 2] = TD_COLORS.train[2] * st;
    }
  }

  const geom = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(new Float32Array(rest), 3);
  const colAttr = new THREE.BufferAttribute(new Float32Array(skinCol), 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', posAttr);
  geom.setAttribute('color', colAttr);
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;

  // 클릭 판정용 투명 타원체 (삼각형 사이 빈틈도 클릭되도록)
  const proxy = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthWrite: false,
  }));
  proxy.position.set(0.5, -0.6, -1.5);
  proxy.scale.set(5.5, 4.2, 11.5);

  const group = new THREE.Group();
  group.add(mesh);
  group.add(proxy);
  tdSpace.add(group);

  // 스톱워치 위치 계산용: 휴지 상태 손의 화면 위쪽 끝(회전 반영, 크기 1 기준)
  const cx = Math.cos(TD_LAYOUT.handRotX), sx = Math.sin(TD_LAYOUT.handRotX);
  const cy = Math.cos(TD_LAYOUT.handRotY), sy = Math.sin(TD_LAYOUT.handRotY);
  let topY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = hand.centers[i * 3], y = hand.centers[i * 3 + 1], z = hand.centers[i * 3 + 2];
    const z1 = -sy * x + cy * z;
    topY = Math.max(topY, cx * y - sx * z1);
  }

  tdHand = {
    group, mesh, proxy, posAttr, colAttr, n,
    rest, bone: hand.bone, trainVerts, skinCol, trainCol, topY,
    bend: 0, morph: 0, lastBend: 0, lastMorph: 0,
  };
  tdResetHandPose(1);
}

function tdResetHandPose(appear) {
  const g = tdHand.group;
  g.visible = true;
  tdHand.mesh.material.clippingPlanes = null;
  tdHand.mesh.material.needsUpdate = true;
  g.rotation.set(TD_LAYOUT.handRotX, TD_LAYOUT.handRotY, 0);
  g.scale.setScalar(Math.max(0.0001, TD_LAYOUT.handScale * appear));
  g.position.set(0, tdHandRestY(), 0);
  tdHand.bend = 0;
  tdHand.morph = 0;
  tdWriteHand(true);
}

// 검지 굽힘(bend)과 기차 변신(morph)을 반영해 손 꼭짓점/색을 다시 씀
const tdTmpP = [0, 0, 0];
function tdWriteHand(force) {
  const h = tdHand;
  if (!force && h.bend === h.lastBend && h.morph === h.lastMorph) return;
  const P = h.posAttr.array;
  const m = h.morph;
  for (let i = 0; i < h.n; i++) {
    const b = h.bone[i];
    for (let k = 0; k < 3; k++) {
      const o = i * 9 + k * 3;
      let x = h.rest[o], y = h.rest[o + 1], z = h.rest[o + 2];
      if (b !== 0 && h.bend > 0) {
        tdBendPoint(x, y, z, b, h.bend, tdTmpP);
        x = tdTmpP[0]; y = tdTmpP[1]; z = tdTmpP[2];
      }
      if (m > 0) {
        x += (h.trainVerts[o] - x) * m;
        y += (h.trainVerts[o + 1] - y) * m;
        z += (h.trainVerts[o + 2] - z) * m;
      }
      P[o] = x; P[o + 1] = y; P[o + 2] = z;
    }
  }
  h.posAttr.needsUpdate = true;
  if (force || m !== h.lastMorph) {
    const C = h.colAttr.array;
    for (let i = 0; i < C.length; i++) C[i] = h.skinCol[i] + (h.trainCol[i] - h.skinCol[i]) * m;
    h.colAttr.needsUpdate = true;
  }
  h.lastBend = h.bend;
  h.lastMorph = m;
}

function tdBuildTripods() {
  const s = TD_SHAPE_CONFIG.tripod.triangleSize;
  const r = s / Math.sqrt(3);
  const offs = tdTripodOffsets(s);
  const pos = new Float32Array(27);
  offs.forEach((o, i) => {
    pos.set([o.x, o.y + r, 0, o.x - s / 2, o.y - r / 2, 0, o.x + s / 2, o.y - r / 2, 0], i * 9);
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const make = (side, slot) => {
    const color = new THREE.Color(TD_COLORS.tripod);
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    tdRoot.add(mesh);
    tdTripods.push({ mesh, side, slot, color, homeX: 0, homeY: 0, vanishStart: -1, appearStart: -100, local: offs, size: s });
  };
  make('left', 0);
  for (let i = 0; i < 5; i++) make('right', i);
  tdApplyRoundVisibility();
}

function tdRightCount() {
  const r = TD_ROUNDS[Math.min(tdGame.round, TD_ROUNDS.length - 1)];
  return r.rightCount;
}

// 이번 조건의 오른쪽 인원 수만큼만 트라이포드를 씀
function tdApplyRoundVisibility() {
  const n = tdRightCount();
  tdTripods.forEach((t) => { t.active = t.side === 'left' || t.slot < n; if (!t.active) t.mesh.visible = false; });
}

function tdBuildParticles() {
  const n = TD_SHAPE_CONFIG.particle.count;
  const geom = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(n * 9), 3);
  const col = new THREE.BufferAttribute(new Float32Array(n * 9), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  col.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', pos);
  geom.setAttribute('color', col);
  // 선로가 손보다 "밑에 깔리도록": 깊이 테스트 없이 가장 먼저 그림
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
  }));
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  mesh.visible = false;
  tdSpace.add(mesh);

  const F = () => new Float32Array(n);
  tdParticles = {
    mesh, pos, col, n,
    px: F(), py: F(), vx: F(), vy: F(), ang: F(), av: F(), stopped: new Uint8Array(n),
    shade: F(), cr: F(), cg: F(), cb: F(), // 삼각형별 명암, 원래(트라이포드) 색
    rx: F(), ry: F(), rang: F(),          // 멈춘 위치(선로로 모이기 시작하는 위치)
    tx: F(), ty: F(), tang: F(), delay: F(), // 선로 위 목표 자리
    scale: 1,
  };
}

// ---------------------------------------------------------
// 클릭
// ---------------------------------------------------------
function start_TrolleyDilemma(time) {
  if (tdState.phase !== 'waiting') return;
  tdState = { phase: 'ready', readyStart: time };
}

function getPickables_TrolleyDilemma() {
  return tdState.phase === 'ready' ? [tdHand.proxy] : [];
}

function isHandClickable_TrolleyDilemma(time) {
  return tdState.phase === 'ready' && time >= tdState.readyStart;
}

// 화면 왼쪽/오른쪽 공간을 누름 = 그쪽을 살림. 손가락이 그쪽을 누르고, 반대쪽이 희생됨
function choose_TrolleyDilemma(side, time) {
  if (side !== 'left' && side !== 'right') return false;
  if (!isHandClickable_TrolleyDilemma(time)) return false;
  const remaining = Math.max(0, TD_TIMING.countdown - (time - tdState.readyStart));
  tdGame.choices.push({ saved: side, timeout: false, round: tdGame.round });
  tdState = { phase: 'pressing', pressStart: time, frozen: remaining, choice: 'press', saved: side };
  tdHoverSide = null;
  return true;
}

// 예전 방식(손 클릭)도 남겨 둠: 손을 누르면 커서가 있는 쪽을 고른 것으로
function handleRaycastHit_TrolleyDilemma(hit, time) {
  if (!hit || hit.object !== tdHand.proxy) return false;
  return choose_TrolleyDilemma(tdAim.x < 0 ? 'left' : 'right', time);
}

function setAim_TrolleyDilemma(ndcX, ndcY) {
  tdAim.x = Math.max(-1, Math.min(1, ndcX));
  tdAim.y = Math.max(-1, Math.min(1, ndcY));
}

function setHoverSide_TrolleyDilemma(side) {
  tdHoverSide = side;
}

// ---------------------------------------------------------
// 폭발 / 선로
// ---------------------------------------------------------
function tdExplode(sourceSide, time) {
  const P = tdParticles;
  const sources = tdTripods.filter((t) => t.side === sourceSide && t.active);
  tdRoot.updateMatrixWorld(true);
  const local = new THREE.Vector3();
  P.mesh.material.clippingPlanes = null; // 폭발 중에는 자르지 않음
  P.mesh.material.needsUpdate = true;
  for (let i = 0; i < P.n; i++) {
    const t = sources[i % sources.length];
    // 트라이포드는 회전하지 않으므로, 그 위치를 회전된 공간 안의 좌표로 바꿔 출발점으로 사용
    tdSpace.worldToLocal(local.set(t.mesh.position.x, t.mesh.position.y, 0));
    const cx = local.x, cy = local.y;
    // 원래 트라이포드의 삼각형 중 하나, 그 안의 임의의 점에서 출발
    const o = t.local[Math.floor(Math.random() * 3)];
    const s = t.size, r = s / Math.sqrt(3);
    let a = Math.random(), b = Math.random();
    if (a + b > 1) { a = 1 - a; b = 1 - b; }
    const lx = o.x + (0 * (1 - a - b)) + (-s / 2) * a + (s / 2) * b;
    const ly = o.y + r * (1 - a - b) + (-r / 2) * a + (-r / 2) * b;
    P.px[i] = cx + lx;
    P.py[i] = cy + ly;
    // 트라이포드 중심에서 바깥으로 + 살짝 위로 튀어 오름
    let dx = lx + (Math.random() - 0.5) * 1.2, dy = ly + (Math.random() - 0.5) * 1.2;
    const dl = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = 12 + Math.random() * 22;
    P.vx[i] = (dx / dl) * speed;
    P.vy[i] = (dy / dl) * speed + 10;
    P.ang[i] = Math.random() * Math.PI * 2;
    P.av[i] = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 7);
    P.stopped[i] = 0;
    const shade = 0.8 + Math.random() * 0.2;
    P.shade[i] = shade;
    P.cr[i] = t.color.r; P.cg[i] = t.color.g; P.cb[i] = t.color.b; // 선로가 될 때 돌아갈 원래 색
    tdSetParticleColor(i, 0); // 폭발할 때는 붉은색
    t.mesh.visible = false;
  }
  P.col.needsUpdate = true;
  P.scale = 1;
  P.mesh.visible = true;

  // 폭발하지 않는 쪽은 사라짐
  tdTripods.forEach((t) => { if (t.side !== sourceSide && t.active) t.vanishStart = time; });
  tdState.phase = 'explode';
  tdState.explodeStart = time;
  tdState.source = sourceSide;
}

// 화면 가운데 세로 선로: 레일 2줄 + 침목
// 선로가 화면 바닥 ~ 제목바 흰 선까지 닿으려면 (회전된) 공간 안에서 y가 어디서 어디까지여야 하는지 계산.
// 공간을 X축으로 기울이면(아래/위에서 보는 구도) 선로가 원근으로 짧아 보이므로, 그만큼 늘려 준다.
// 선로는 공간 안의 직선 (0, t, 0). 회전 순서(XYZ)상 이 직선의 방향은 (0, cos rx, sin rx).
function tdTrackRange() {
  const D = tdBounds.camDist, Ytop = tdBounds.topY, Ybot = -tdBounds.halfH;
  const rx = tdSpace ? tdSpace.rotation.x : 0;
  const c = Math.cos(rx), sn = Math.sin(rx);
  const far = tdBounds.halfH * 4;
  // 화면에서의 높이 = t·c·D / (D − t·sn)  ->  이것이 Ytop / Ybot 이 되는 t
  const solve = (Y) => {
    const den = D * c + Y * sn;
    if (den <= D * 0.05) return Y > 0 ? far : -far; // 거의 정면으로 누운 경우: 충분히 길게
    return Math.max(-far, Math.min(far, (Y * D) / den));
  };
  // 위쪽은 흰 선보다 조금 더 길게 깔고, 넘치는 부분은 화면 기준 자르기 평면이 정확히 흰 선에서 잘라냄
  return { y0: solve(Ybot) - 1, y1: solve(Ytop) + 1.5 };
}

// 선로 자리: y는 0(아래 끝)~1(위 끝) 비율로 저장 -> 공간을 돌려도 매 프레임 화면 끝까지 맞춰 늘어남
function tdTrackSlots(n) {
  const L = TD_LAYOUT;
  const range = tdTrackRange();
  const y0 = 0, y1 = 1;
  const len = Math.max(10, range.y1 - range.y0); // 개수 배분용 실제 길이
  let sleepers = Math.floor(len / L.sleeperSpacing);
  let per = L.sleeperTriangles;
  while (sleepers * per > n * 0.5) sleepers--;
  const railEach = Math.floor((n - sleepers * per) / 2);
  const slots = [];
  const width = (L.railHalfGauge + 0.6) * 2;
  for (let s = 0; s < sleepers; s++) {
    const y = (s + 0.5) / sleepers;
    for (let k = 0; k < per; k++) {
      const x = -width / 2 + (k + 0.5) * (width / per);
      slots.push({ x, y, ang: (k % 2 === 0) ? Math.PI / 2 : -Math.PI / 2 });
    }
  }
  [-1, 1].forEach((side) => {
    for (let i = 0; i < railEach; i++) {
      slots.push({ x: side * L.railHalfGauge, y: (i + 0.5) / railEach, ang: Math.PI / 2 });
    }
  });
  while (slots.length < n) slots.push({ x: 0, y: Math.random(), ang: Math.PI / 2 }); // 남는 수 보정 (y0~y1 = 0~1)
  return slots.slice(0, n);
}

// mix: 0 = 붉은색(폭발), 1 = 원래 트라이포드 색(선로)
function tdSetParticleColor(i, mix) {
  const P = tdParticles, E = TD_COLORS.explode, sh = P.shade[i];
  const r = (E[0] + (P.cr[i] - E[0]) * mix) * sh;
  const g = (E[1] + (P.cg[i] - E[1]) * mix) * sh;
  const b = (E[2] + (P.cb[i] - E[2]) * mix) * sh;
  for (let k = 0; k < 3; k++) {
    const o = i * 9 + k * 3;
    P.col.array[o] = r; P.col.array[o + 1] = g; P.col.array[o + 2] = b;
  }
}

function tdStartGather(time) {
  const P = tdParticles;
  const slots = tdTrackSlots(P.n);
  // 무작위로 자리 배정
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = slots[i]; slots[i] = slots[j]; slots[j] = tmp;
  }
  for (let i = 0; i < P.n; i++) {
    P.rx[i] = P.px[i]; P.ry[i] = P.py[i]; P.rang[i] = P.ang[i];
    P.tx[i] = slots[i].x; P.ty[i] = slots[i].y; // ty = 선로 위 비율(0~1)
    // 가장 가까운 각도로 돌아가도록
    let target = slots[i].ang;
    while (target - P.ang[i] > Math.PI) target -= Math.PI * 2;
    while (target - P.ang[i] < -Math.PI) target += Math.PI * 2;
    P.tang[i] = target;
    P.delay[i] = Math.random() * TD_TIMING.gatherDelayMax;
  }
  P.mesh.material.clippingPlanes = [tdClipPlane]; // 선로도 제목바를 넘지 않게 (공간을 돌렸을 때 대비)
  P.mesh.material.needsUpdate = true;
  tdState.phase = 'gather';
  tdState.gatherStart = time;
}

function tdWriteParticles() {
  const P = tdParticles;
  const A = P.pos.array;
  const r = (TD_SHAPE_CONFIG.particle.triangleSize / Math.sqrt(3)) * P.scale;
  const step = (Math.PI * 2) / 3;
  for (let i = 0; i < P.n; i++) {
    for (let k = 0; k < 3; k++) {
      const a = P.ang[i] + k * step;
      const o = i * 9 + k * 3;
      A[o] = P.px[i] + r * Math.cos(a);
      A[o + 1] = P.py[i] + r * Math.sin(a);
      A[o + 2] = 0;
    }
  }
  P.pos.needsUpdate = true;
}

// ---------------------------------------------------------
// 매 프레임 갱신
// ---------------------------------------------------------
function updateExperiment_TrolleyDilemma(time, deltaTime) {
  if (!tdRoot) return;
  const dt = Math.min(1 / 30, Math.max(0, deltaTime || 0));
  const st = tdState;
  const T = TD_TIMING;

  // ----- 트라이포드 (살짝 떠 있는 듯 흔들림 / 사라짐 / 다시 나타남) -----
  tdTripods.forEach((t, i) => {
    const m = t.mesh;
    if (!t.active) { m.visible = false; return; }
    m.position.set(t.homeX, t.homeY + Math.sin(time * 1.1 + i * 0.9) * 0.15, 0);
    if (t.vanishStart >= 0) {
      const k = 1 - tdSmooth((time - t.vanishStart) / T.vanish);
      m.scale.setScalar(Math.max(0.0001, k));
      if (k <= 0) { m.visible = false; t.vanishStart = -1; }
    } else if (m.visible) {
      const hover = tdState.phase === 'ready' && tdHoverSide === t.side ? 1.15 : 1;
      t.hoverS = (t.hoverS || 1) + (hover - (t.hoverS || 1)) * Math.min(1, dt * 10);
      m.scale.setScalar(Math.max(0.0001, tdSmooth((time - t.appearStart) / T.appear)) * t.hoverS);
    }
  });

  // ----- 시간 초과 -----
  if (st.phase === 'ready' && time - st.readyStart >= T.countdown) {
    tdGame.choices.push({ saved: 'left', timeout: true, round: tdGame.round });
    tdState = { phase: 'timeout', choice: 'wait' };
    tdExplode('right', time); // 아무것도 고르지 않으면 원래 선로(여러 명 쪽)로
  }

  // ----- 손가락이 커서를 가리킴 (고르기 전까지) -----
  if (tdState.phase === 'waiting' || tdState.phase === 'ready') {
    const k = Math.min(1, dt * TD_LAYOUT.aimFollow);
    tdAim.yaw += (tdAim.x * TD_LAYOUT.aimYaw - tdAim.yaw) * k;
    tdAim.pitch += (tdAim.y * TD_LAYOUT.aimPitch - tdAim.pitch) * k;
  }
  if (['waiting', 'ready', 'pressing', 'timeout', 'explode', 'gather'].includes(tdState.phase)) {
    // 검지는 +z(보는 사람 쪽)를 향함: y축 회전으로 좌우, x축 회전으로 위아래를 가리킴
    tdHand.group.rotation.set(TD_LAYOUT.handRotX - tdAim.pitch, TD_LAYOUT.handRotY + tdAim.yaw, 0);
  }

  // ----- 손을 누름 -----
  if (st.phase === 'pressing') {
    const e = tdEaseInOutCubic((time - st.pressStart) / T.pressBend);
    tdHand.bend = e;
    tdHand.group.position.y = tdHandRestY() - TD_LAYOUT.handDrop * e;
    tdWriteHand(false);
    if (time - st.pressStart >= T.pressToExplode) tdExplode(st.saved === 'left' ? 'right' : 'left', time); // 살리지 않은 쪽
  }

  // ----- 폭발: 중력 + 양옆 벽 반사 + 바닥에서 정지 -----
  if (tdState.phase === 'explode') {
    const P = tdParticles;
    const W = tdBounds.halfW - 0.3;
    const floor = -tdBounds.halfH + 0.3;
    const g = TD_LAYOUT.gravity, e = TD_LAYOUT.restitution;
    let moving = 0;
    for (let i = 0; i < P.n; i++) {
      if (P.stopped[i]) continue;
      P.vy[i] -= g * dt;
      P.px[i] += P.vx[i] * dt;
      P.py[i] += P.vy[i] * dt;
      P.ang[i] += P.av[i] * dt;
      if (P.px[i] < -W) { P.px[i] = -W; P.vx[i] = Math.abs(P.vx[i]) * e; }
      if (P.px[i] > W) { P.px[i] = W; P.vx[i] = -Math.abs(P.vx[i]) * e; }
      if (P.py[i] <= floor) {
        P.py[i] = floor;
        P.vx[i] = 0; P.vy[i] = 0;
        P.stopped[i] = 1;
        continue;
      }
      moving++;
    }
    tdWriteParticles();
    if (moving === 0 || time - tdState.explodeStart > T.explodeMax) tdStartGather(time);
  }

  // ----- 선로로 모임 -----
  if (tdState.phase === 'gather') {
    const P = tdParticles;
    const range = tdTrackRange();
    let done = true;
    for (let i = 0; i < P.n; i++) {
      const p = tdClamp01((time - tdState.gatherStart - P.delay[i]) / T.gatherDuration);
      if (p < 1) done = false;
      const e = tdEaseInOutCubic(p);
      const ty = range.y0 + P.ty[i] * (range.y1 - range.y0);
      P.px[i] = P.rx[i] + (P.tx[i] - P.rx[i]) * e;
      P.py[i] = P.ry[i] + (ty - P.ry[i]) * e + Math.sin(Math.PI * e) * 4; // 살짝 떠오르며 이동
      P.ang[i] = P.rang[i] + (P.tang[i] - P.rang[i]) * e;
      tdSetParticleColor(i, e); // 선로 자리로 가면서 붉은색 -> 원래 색
    }
    P.col.needsUpdate = true;
    tdWriteParticles();
    if (done) {
      tdState.phase = 'morph';
      tdState.morphStart = time + T.morphDelay;
      tdState.morphFromY = tdHand.group.position.y;
      tdState.morphFromRotX = tdHand.group.rotation.x;
      tdState.morphFromRotY = tdHand.group.rotation.y;
    }
  }

  // ----- 깔린 선로: 공간을 돌려도 항상 화면 바닥 ~ 흰 선까지 이어지도록 매 프레임 길이 맞춤 -----
  if (tdState.phase === 'morph' || tdState.phase === 'depart' || tdState.phase === 'clear') {
    const P = tdParticles;
    const range = tdTrackRange();
    for (let i = 0; i < P.n; i++) {
      P.px[i] = P.tx[i];
      P.py[i] = range.y0 + P.ty[i] * (range.y1 - range.y0);
      P.ang[i] = P.tang[i];
    }
    if (tdState.phase !== 'clear') tdWriteParticles(); // clear 단계는 아래에서 크기를 줄이며 씀
  }

  // ----- 손 -> 위에서 본 기차 -----
  if (tdState.phase === 'morph') {
    const e = tdEaseInOutCubic((time - tdState.morphStart) / T.morph);
    const g = tdHand.group;
    g.rotation.set(tdState.morphFromRotX * (1 - e), tdState.morphFromRotY * (1 - e), 0);
    g.scale.setScalar(TD_LAYOUT.handScale + (1 - TD_LAYOUT.handScale) * e);
    g.position.set(0, tdState.morphFromY, 0);
    tdHand.morph = e;
    tdWriteHand(false);
    if (time - tdState.morphStart >= T.morph) {
      tdState.phase = 'depart';
      tdHand.mesh.material.clippingPlanes = [tdClipPlane]; // 제목바 선에서부터 기차가 사라짐
      tdHand.mesh.material.needsUpdate = true;
      tdState.departStart = time + 0.3;
      tdState.departFromY = g.position.y;
    }
  }

  // ----- 기차 퇴장 -----
  if (tdState.phase === 'depart') {
    const tau = Math.max(0, time - tdState.departStart);
    const y = tdState.departFromY + 0.5 * T.trainAccel * tau * tau;
    tdHand.group.position.y = y;
    const tail = y - 18.5; // 기차 꼬리(객차 2 끝)
    // 꼬리가 흰 선(회전된 공간 기준 선로 위 끝)을 완전히 넘으면 퇴장 완료, 안전장치로 시간 제한
    if (tail > tdTrackRange().y1 + 4 || tau > 10) {
      tdHand.group.visible = false;
      tdState.phase = 'clear';
      tdState.clearStart = time;
    }
  }

  // ----- 선로가 사라짐 -> 처음으로 -----
  if (tdState.phase === 'clear') {
    const P = tdParticles;
    P.scale = 1 - tdSmooth((time - tdState.clearStart) / T.trackFade);
    tdWriteParticles();
    if (P.scale <= 0) {
      P.mesh.visible = false;
      tdGame.round++;
      if (tdGame.round >= TD_ROUNDS.length) {
        tdState = { phase: 'finished' }; // 6번 모두 골랐음
        return;
      }
      tdApplyRoundVisibility();
      tdApplyLayout();
      tdTripods.forEach((t) => {
        t.vanishStart = -1;
        if (!t.active) return;
        t.mesh.visible = true;
        t.appearStart = time;
        t.mesh.scale.setScalar(0.0001);
      });
      tdResetHandPose(0);
      tdState = { phase: 'ready', readyStart: time + T.appear, appearStart: time };
    }
  }

  // ----- 다시 나타나는 손 -----
  if (tdState.phase === 'ready' && tdState.appearStart !== undefined) {
    const k = tdSmooth((time - tdState.appearStart) / T.appear);
    tdHand.group.scale.setScalar(Math.max(0.0001, TD_LAYOUT.handScale * k));
  }
}

// ---------------------------------------------------------
// 스톱워치 (00.00초 형식, 손 위)
// ---------------------------------------------------------
function tdFormatTime(sec) {
  const v = Math.max(0, Math.min(99.99, sec));
  return v.toFixed(2).padStart(5, '0');
}

function getStopwatch_TrolleyDilemma(time) {
  const st = tdState;
  let value = TD_TIMING.countdown;
  if (st.phase === 'ready') value = Math.min(TD_TIMING.countdown, TD_TIMING.countdown - (time - st.readyStart));
  else if (st.phase === 'pressing' || (st.choice === 'press')) value = st.frozen;
  else if (st.phase !== 'waiting') value = st.choice === 'press' ? st.frozen : 0;

  const visiblePhases = ['waiting', 'ready', 'pressing', 'timeout', 'explode', 'gather'];
  let opacity = visiblePhases.indexOf(st.phase) >= 0 ? 1 : 0;
  if (st.phase === 'ready' && st.appearStart !== undefined) opacity = tdSmooth((time - st.appearStart) / TD_TIMING.appear);

  const g = tdHand.group;
  return {
    text: tdFormatTime(value),
    opacity,
    x: g.position.x,
    y: g.position.y + tdHand.topY * g.scale.x + TD_LAYOUT.stopwatchGap,
    z: 0,
  };
}

// ---------------------------------------------------------
// 게임 상태
// ---------------------------------------------------------
function getGame_TrolleyDilemma(time) {
  const st = tdState;
  const r = TD_ROUNDS[Math.min(tdGame.round, TD_ROUNDS.length - 1)];
  return {
    phase: st.phase,
    round: tdGame.round,
    rounds: TD_ROUNDS.length,
    left: r.left,
    right: r.right,
    timeLeft: st.phase === 'ready' ? Math.max(0, Math.min(TD_TIMING.countdown, TD_TIMING.countdown - (time - st.readyStart))) : 0,
    choosing: st.phase === 'ready' && time >= st.readyStart,
    choices: tdGame.choices.map((c) => ({
      left: TD_ROUNDS[c.round].left, right: TD_ROUNDS[c.round].right, saved: c.saved, timeout: c.timeout,
    })),
    finished: st.phase === 'finished',
    hoverSide: tdHoverSide,
  };
}

// 무리 아래 이름표 자리 (월드 좌표, tdRoot는 회전하지 않음)
function getLabelAnchors_TrolleyDilemma() {
  const L = TD_LAYOUT;
  const y = tdBounds.halfH * L.tripodYFrac - 3.0;
  return {
    left: new THREE.Vector3(-tdBounds.halfW * L.tripodXFrac, y, 0),
    right: new THREE.Vector3(tdBounds.halfW * L.tripodXFrac, y, 0),
  };
}

function resetGame_TrolleyDilemma(time) {
  tdGame = { round: 0, choices: [] };
  tdApplyRoundVisibility();
  tdApplyLayout();
  tdTripods.forEach((t) => {
    t.vanishStart = -1;
    if (!t.active) return;
    t.mesh.visible = true;
    t.appearStart = time;
    t.mesh.scale.setScalar(0.0001);
  });
  tdParticles.mesh.visible = false;
  tdResetHandPose(0);
  tdState = { phase: 'ready', readyStart: time + TD_TIMING.appear, appearStart: time };
}
