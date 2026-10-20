// =========================================================
// 사고실험 006. 뷔리당의 당나귀 (Buridan's Donkey) - 장면/애니메이션
// -----------------------------------------------------------
// 필요: Three.js(전역 THREE), buridan-shape.js
//
// 게임: 당나귀를 구하라
//  - 가운데 당나귀(삼각형 300개), 왼쪽 건초 트라이포드 / 오른쪽 물 트라이포드 (처음엔 1개씩 = 평형)
//  - 사용자가 건초(화면 왼쪽)나 물(화면 오른쪽)을 누르면 그쪽 더미에 트라이포드가 하나 붙음
//    -> 더 많은 쪽으로 당나귀가 끌려감 (차이가 클수록 빠르게)
//  - 붙은 트라이포드는 0.5초 뒤 사라짐 = 저절로 다시 평형
//  - 평형일 때 당나귀는 망설이며 가운데로 되돌아감 -> 한쪽을 연타해야 끝까지 갈 수 있음
//  - 30초 안에 당나귀가 어느 한쪽 더미에 닿으면 목표 완료 (먹거나 마심)
//  - 30초가 지나면 당나귀는 바스러져 사라짐 (실패)
//    (걸은 길은 땅 위에 삼각형으로 된 직선으로 남음)
//
// 공개 함수
//  initExperiment_BuridanDonkey(scene, time)
//  start_BuridanDonkey(time)
//  choose_BuridanDonkey('hay' | 'water', time) -> 그쪽 더미에 트라이포드를 붙임 (게임 중일 때만 true)
//  resetGame_BuridanDonkey(time)              -> 새 당나귀가 들어오고 다시 시작
//  updateExperiment_BuridanDonkey(time, deltaTime)
//  getStatus_BuridanDonkey(time) -> { phase, hay, water, life, x, progress, result, reached }
// =========================================================

const BD_TIMING = {
  restore: 0.5,         // 누른 뒤 이 시간이 지나면 붙은 트라이포드가 사라짐 (다시 평형)
  life: 30,             // 본 화면 시작(또는 새 당나귀 입장) 후 당나귀의 수명 = 제한 시간
  crumble: 2.2,         // 바스러지는 시간
  enter: 2.6,           // 새 당나귀가 화면 아래에서 들어오는 시간
  tripodDrop: 0.45,
};

const BD_LAYOUT = {
  pileX: 28,            // 건초(왼쪽 -) / 물(오른쪽 +) 더미 위치
  donkeyScale: 0.8,     // 당나귀 크기 (축소)
  zig: 4.5,             // 걸을 때마다 앞뒤(깊이, z)로도 비틀거리는 폭
  zMin: -13,             // 땅 위에서 움직일 수 있는 깊이 범위 (z: 화면 안쪽 - / 바깥쪽 +)
  zMax: 11,
  maxReach: 18.5,       // 여기까지 오면 코끝이 더미에 닿음 = 목표 완료
  pullPerTripod: 3.4,   // 더미 차이 1개당 끌려가는 속도 (단위/초)
  hesitate: 5.0,        // 평형일 때(또는 차이가 작을 때) 가운데로 되돌아가는 속도
  enterFromZ: 30,       // 새 당나귀가 들어오는 출발점 (화면 아래쪽, 탑뷰 기준)
  trailSpacing: 0.7,
  trailSize: 0.6,
  tripodCols: 3,        // 한 층에 가로 3 x 깊이 2 = 6개, 그 위로 층층이 쌓임
  tripodDepth: 2,
  tripodColGap: 2.2,
  tripodLayerGap: 1.25,
};

const BD_COLORS = {
  donkey: [0.62, 0.57, 0.52],
  hay: 0xd8b45a,
  water: 0x4a9be8,
  trail: [0.85, 0.82, 0.72],
};

let bdRoot = null;
let bdDonkey = null;
let bdPiles = null;     // { hay: {...}, water: {...} }
let bdTrail = null;
let bdState = { phase: 'waiting' };
let bdGame = { result: null, reached: 0, presses: 0 }; // result: null | 'win' | 'fail'

function bdClamp01(x) { return Math.min(1, Math.max(0, x)); }
function bdSmooth(x) { x = bdClamp01(x); return x * x * (3 - 2 * x); }
function bdEaseOut(x) { x = bdClamp01(x); return 1 - Math.pow(1 - x, 3); }

// ---------------------------------------------------------
// 초기화
// ---------------------------------------------------------
function initExperiment_BuridanDonkey(scene, time) {
  bdRoot = new THREE.Group();
  scene.add(bdRoot);
  bdBuildDonkey();
  bdBuildPiles();
  bdBuildTrail();
  bdResetCycle(time, false);
  bdState.phase = 'waiting';
}

function bdBuildDonkey() {
  const D = BD_SHAPE_CONFIG.donkey;
  const shape = bdGenerateDonkeyTriangles();
  const n = shape.count;
  const rest = bdBuildTriangleVertices(shape.centers, shape.normals, D.triangleSize, 5);

  const L = bdNorm([-0.4, 0.7, 0.6]);
  const col = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const d = shape.normals[i * 3] * L[0] + shape.normals[i * 3 + 1] * L[1] + shape.normals[i * 3 + 2] * L[2];
    const sh = (0.45 + 0.55 * (0.5 + 0.5 * d)) * (0.9 + Math.random() * 0.2);
    for (let k = 0; k < 3; k++) col.set([BD_COLORS.donkey[0] * sh, BD_COLORS.donkey[1] * sh, BD_COLORS.donkey[2] * sh], i * 9 + k * 3);
  }

  const geom = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(rest), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', pos);
  geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;

  const group = new THREE.Group();
  group.add(mesh);
  group.scale.setScalar(BD_LAYOUT.donkeyScale);
  bdRoot.add(group);

  // 바스러질 때 쓰는 삼각형별 상태
  const centers = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) centers[i * 3 + k] = (rest[i * 9 + k] + rest[i * 9 + 3 + k] + rest[i * 9 + 6 + k]) / 3;
  }
  bdDonkey = {
    group, mesh, pos, n, rest, centers, leg: shape.leg,
    x: 0, z: 0, targetX: 0, targetZ: 0, yaw: -0.9, walk: 0, walkPhase: 0,
    crumble: { vx: new Float32Array(n), vy: new Float32Array(n), vz: new Float32Array(n), delay: new Float32Array(n),
      ox: new Float32Array(n), oy: new Float32Array(n), oz: new Float32Array(n), spin: new Float32Array(n) },
  };
}

// 트라이포드(삼각형 3개)를 접어 올린 삼각뿔: 옆면 3개 + 밑면 1개, 바닥(y=0)에 서 있음
function bdBuildPiles() {
  const s = BD_SHAPE_CONFIG.tripod.triangleSize;
  const r = s / Math.sqrt(3);
  const h = s * Math.sqrt(2 / 3);
  const b = [90, 210, 330].map((d) => [r * Math.cos(d * Math.PI / 180), 0, r * Math.sin(d * Math.PI / 180)]);
  const apex = [0, h, 0];
  const faces = [[b[0], b[1], apex, 1.0], [b[1], b[2], apex, 0.78], [b[2], b[0], apex, 0.62], [b[0], b[2], b[1], 0.45]];
  const pos = [], col = [];
  faces.forEach(([p, q, w, sh]) => {
    pos.push(...p, ...q, ...w);
    col.push(sh, sh, sh, sh, sh, sh, sh, sh, sh);
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  bdPiles = {
    geom, height: h,
    hay: { side: -1, color: new THREE.Color(BD_COLORS.hay), items: [] },
    water: { side: 1, color: new THREE.Color(BD_COLORS.water), items: [] },
  };
}

function bdBuildTrail() {
  const max = 600;
  const geom = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(max * 9), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', pos);
  geom.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({
    color: new THREE.Color(...BD_COLORS.trail), side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  bdRoot.add(mesh);
  bdTrail = { mesh, pos, max, items: [], index: new Set(), scale: 1 };
}

// ---------------------------------------------------------
// 트라이포드 더미
// ---------------------------------------------------------
function bdSlotPosition(pile, i) {
  const L = BD_LAYOUT;
  const per = L.tripodCols * L.tripodDepth;
  const layer = Math.floor(i / per), j = i % per;
  const c = j % L.tripodCols, row = Math.floor(j / L.tripodCols);
  const shift = layer % 2 ? L.tripodColGap / 2 : 0;   // 위층은 아래층 사이 홈에 얹힘
  const x = pile.side * L.pileX + (c - (L.tripodCols - 1) / 2) * L.tripodColGap - pile.side * shift;
  const z = (row - (L.tripodDepth - 1) / 2) * L.tripodColGap + shift * 0.5;
  return { x, y: layer * L.tripodLayerGap, z };
}

function bdAddTripod(pile, time, instant) {
  const mesh = new THREE.Mesh(bdPiles.geom, new THREE.MeshBasicMaterial({
    vertexColors: true, color: pile.color.clone(), side: THREE.DoubleSide,
  }));
  // 비어 있는 가장 낮은 자리에 얹음 (사라진 자리를 다시 씀)
  const used = new Set(pile.items.filter((it) => it.removeStart < 0).map((it) => it.slotIndex));
  let si = 0;
  while (used.has(si)) si++;
  const slot = bdSlotPosition(pile, si);
  mesh.position.set(slot.x, slot.y, slot.z);
  mesh.rotation.y = Math.random() * Math.PI * 2;
  bdRoot.add(mesh);
  pile.items.push({ mesh, slot, slotIndex: si, born: instant ? -100 : time, removeStart: -1 });
}

function bdUpdatePiles(time) {
  ['hay', 'water'].forEach((k) => {
    const pile = bdPiles[k];
    pile.items.forEach((it) => {
      if (it.restoreAt !== undefined && it.removeStart < 0 && time >= it.restoreAt) it.removeStart = time; // 다시 평형
    });
    pile.items = pile.items.filter((it) => {
      if (it.removeStart >= 0) {
        const f = 1 - bdSmooth((time - it.removeStart) / 0.8);
        it.mesh.scale.setScalar(Math.max(0.0001, f));
        if (f <= 0) { bdRoot.remove(it.mesh); return false; }
        return true;
      }
      // 위에서 떨어져 붙음
      const p = bdClamp01((time - it.born) / BD_TIMING.tripodDrop);
      const e = bdEaseOut(p);
      it.mesh.position.set(it.slot.x, it.slot.y + (1 - e) * 6, it.slot.z);
      it.mesh.rotation.y += 0.004; // 천천히 돌아서 입체가 드러남
      const flash = Math.max(0, 1 - (time - it.born - BD_TIMING.tripodDrop) / 0.5) * (p >= 1 ? 1 : 0);
      const eat = bdGame.result === 'win' && bdGame.reached === pile.side ? 0.25 + 0.25 * Math.sin(time * 6) : 0; // 닿은 더미가 빛남
      it.mesh.material.color.copy(pile.color).lerp(new THREE.Color(1, 1, 1), Math.max(flash * 0.5, eat));
      it.mesh.scale.setScalar(0.6 + 0.4 * e);
      return true;
    });
  });
}

function bdCounts() {
  const alive = (p) => p.items.filter((it) => it.removeStart < 0).length;
  return { hay: alive(bdPiles.hay), water: alive(bdPiles.water) };
}

// ---------------------------------------------------------
// 걸은 길 (땅 위의 삼각형 직선)
// ---------------------------------------------------------
// 걸은 길: 땅(x-z 평면) 위 지나간 자리마다 삼각형 하나 (같은 칸은 한 번만)
function bdTrailMark(x, z, dx, dz) {
  const sp = BD_LAYOUT.trailSpacing;
  const key = Math.round(x / sp) + ':' + Math.round(z / sp);
  if (bdTrail.index.has(key) || bdTrail.items.length >= bdTrail.max) return;
  bdTrail.index.add(key);
  const l = Math.sqrt(dx * dx + dz * dz) || 1;
  bdTrail.items.push({ x, z, dx: dx / l, dz: dz / l });
}

function bdWriteTrail() {
  const A = bdTrail.pos.array;
  const r = (BD_LAYOUT.trailSize / Math.sqrt(3)) * bdTrail.scale;
  bdTrail.items.forEach((it, i) => {
    // 땅(y=0)에 눕힌 삼각형, 꼭짓점이 걸어간 방향을 향함
    const o = i * 9;
    const fx = it.dx, fz = it.dz, sx = -it.dz, sz = it.dx; // 앞 방향 / 옆 방향
    A[o] = it.x + fx * r; A[o + 1] = 0.03; A[o + 2] = it.z + fz * r;
    A[o + 3] = it.x - fx * r / 2 + sx * r * 0.866; A[o + 4] = 0.03; A[o + 5] = it.z - fz * r / 2 + sz * r * 0.866;
    A[o + 6] = it.x - fx * r / 2 - sx * r * 0.866; A[o + 7] = 0.03; A[o + 8] = it.z - fz * r / 2 - sz * r * 0.866;
  });
  bdTrail.mesh.geometry.setDrawRange(0, bdTrail.items.length * 3);
  bdTrail.pos.needsUpdate = true;
}

// ---------------------------------------------------------
// 사이클
// ---------------------------------------------------------
function bdResetCycle(time, entering) {
  // 더미는 처음처럼 1개씩, 길은 지움
  ['hay', 'water'].forEach((k) => {
    const pile = bdPiles[k];
    pile.items.forEach((it) => bdRoot.remove(it.mesh));
    pile.items = [];
    bdAddTripod(pile, time, true);
  });
  bdTrail.items = [];
  bdTrail.index = new Set();
  bdTrail.scale = 1;
  bdTrailMark(0, 0, 1, 0);

  const d = bdDonkey;
  d.x = 0; d.z = 0; d.targetX = 0; d.targetZ = 0; d.walk = 0;
  d.group.visible = true;
  d.crumbling = false;
  d.pos.array.set(d.rest);
  d.pos.needsUpdate = true;
  bdState = { phase: entering ? 'enter' : 'alive', cycleStart: time, enterStart: time };
  bdGame = { result: null, reached: 0, presses: 0 };
}

function resetGame_BuridanDonkey(time) {
  bdResetCycle(time, true);
  bdDonkey.group.position.z = BD_LAYOUT.enterFromZ;
}

function start_BuridanDonkey(time) {
  if (bdState.phase !== 'waiting') return;
  bdState = { phase: 'alive', cycleStart: time };
  bdGame = { result: null, reached: 0, presses: 0 };
}

// 사용자가 건초나 물을 고름 -> 그 더미에 트라이포드가 붙고, 0.5초 뒤 사라짐
function choose_BuridanDonkey(which, time) {
  if (bdState.phase !== 'alive' || bdGame.result) return false;
  const pile = which === 'hay' ? bdPiles.hay : bdPiles.water;
  bdAddTripod(pile, time, false);
  pile.items[pile.items.length - 1].restoreAt = time + BD_TIMING.restore;
  bdGame.presses++;
  // 앞뒤(깊이)로 살짝 비틀거림
  bdDonkey.targetZ = Math.max(BD_LAYOUT.zMin, Math.min(BD_LAYOUT.zMax, bdDonkey.z + (Math.random() * 2 - 1) * BD_LAYOUT.zig));
  return true;
}

function bdStartCrumble(time) {
  const d = bdDonkey, C = d.crumble;
  for (let i = 0; i < d.n; i++) {
    C.vx[i] = (Math.random() - 0.5) * 5;
    C.vy[i] = 1 + Math.random() * 4;
    C.vz[i] = (Math.random() - 0.5) * 5;
    // 위쪽(귀, 머리)부터 먼저 바스러짐
    C.delay[i] = Math.max(0, (9.5 - d.centers[i * 3 + 1]) / 9.5) * 0.7 + Math.random() * 0.25;
    C.ox[i] = 0; C.oy[i] = 0; C.oz[i] = 0;
    C.spin[i] = (Math.random() - 0.5) * 10;
  }
  d.crumbling = true;
  d.crumbleStart = time;
  bdState.phase = 'crumble';
  bdState.crumbleStart = time;
  // 더미의 추가분도 함께 사라짐 (처음 1개씩만 남김)
  ['hay', 'water'].forEach((k) => bdPiles[k].items.forEach((it) => { if (it.restoreAt !== undefined && it.removeStart < 0) it.removeStart = time; }));
}

// ---------------------------------------------------------
// 당나귀 꼭짓점 (다리 흔들기 / 바스러짐)
// ---------------------------------------------------------
function bdWriteDonkey(time, dt) {
  const d = bdDonkey, P = d.pos.array, R = d.rest;
  const legs = BD_SHAPE_CONFIG.donkey.legs;
  const swing = d.walk * 0.45;

  if (!d.crumbling) {
    for (let i = 0; i < d.n; i++) {
      const lg = d.leg[i];
      if (lg === 0 || swing < 0.001) {
        for (let k = 0; k < 9; k++) P[i * 9 + k] = R[i * 9 + k];
        continue;
      }
      // 대각선 다리끼리 같은 박자 (앞왼+뒤오른 / 앞오른+뒤왼)
      const phase = (lg === 1 || lg === 4) ? 0 : Math.PI;
      const a = Math.sin(d.walkPhase + phase) * swing;
      const cs = Math.cos(a), sn = Math.sin(a);
      const hx = legs[lg - 1][0][0], hy = legs[lg - 1][0][1];
      for (let k = 0; k < 3; k++) {
        const o = i * 9 + k * 3;
        const dx = R[o] - hx, dy = R[o + 1] - hy;
        P[o] = hx + dx * cs - dy * sn;
        P[o + 1] = hy + dx * sn + dy * cs;
        P[o + 2] = R[o + 2];
      }
    }
  } else {
    const C = d.crumble;
    const t = time - d.crumbleStart;
    for (let i = 0; i < d.n; i++) {
      const lt = t - C.delay[i];
      let sc = 1;
      if (lt > 0) {
        C.vy[i] -= 14 * dt;
        C.ox[i] += C.vx[i] * dt; C.oy[i] += C.vy[i] * dt; C.oz[i] += C.vz[i] * dt;
        const cy = d.centers[i * 3 + 1] + C.oy[i];
        if (cy < 0.05) { C.oy[i] = 0.05 - d.centers[i * 3 + 1]; C.vx[i] *= 0.8; C.vz[i] *= 0.8; C.vy[i] = 0; }
        sc = 1 - bdSmooth(lt / (BD_TIMING.crumble - 0.9));
      }
      const cx = d.centers[i * 3], cy = d.centers[i * 3 + 1], cz = d.centers[i * 3 + 2];
      const ang = Math.max(0, lt) * C.spin[i];
      const cs = Math.cos(ang), sn = Math.sin(ang);
      for (let k = 0; k < 3; k++) {
        const o = i * 9 + k * 3;
        const dx = (R[o] - cx) * sc, dy = (R[o + 1] - cy) * sc, dz = (R[o + 2] - cz) * sc;
        P[o] = cx + C.ox[i] + dx * cs - dy * sn;
        P[o + 1] = cy + C.oy[i] + dx * sn + dy * cs;
        P[o + 2] = cz + C.oz[i] + dz;
      }
    }
  }
  d.pos.needsUpdate = true;
}

// ---------------------------------------------------------
// 매 프레임
// ---------------------------------------------------------
function updateExperiment_BuridanDonkey(time, deltaTime) {
  if (!bdRoot) return;
  const dt = Math.min(1 / 30, Math.max(0, deltaTime || 0));
  const st = bdState, T = BD_TIMING, d = bdDonkey;

  // ----- 살아 있는 동안: 1초마다 트라이포드, 20초가 되면 바스러짐 -----
  if (st.phase === 'alive' && !bdGame.result) {
    const t = time - st.cycleStart;
    if (t >= T.life) { bdGame.result = 'fail'; bdStartCrumble(time); }
  }

  // ----- 이동 / 방향: 더 많은 쪽으로 끌려가고, 평형이면 망설이며 가운데로 -----
  let walking = false;
  if (st.phase === 'alive' && !bdGame.result) {
    const L = BD_LAYOUT;
    const c = bdCounts();
    const imb = c.water - c.hay;                        // + 이면 물(오른쪽)이 더 많음
    let v = imb * L.pullPerTripod;
    if (Math.abs(d.x) > 0.05) v -= Math.sign(d.x) * L.hesitate; // 망설임: 가운데로 되돌아감
    else if (imb === 0) { v = 0; d.x = 0; }
    d.x = Math.max(-L.maxReach, Math.min(L.maxReach, d.x + v * dt));
    const dz = d.targetZ - d.z;
    d.z += Math.sign(dz) * Math.min(Math.abs(dz), 7 * dt);
    if (Math.abs(v) > 0.4) {
      walking = true;
      bdTrailMark(d.x, d.z, Math.sign(v), dz);
      d.facingYaw = Math.atan2(-dz * 0.3, Math.sign(v)); // 머리(+x)가 가는 방향을 보도록
    } else {
      d.targetZ += (0 - d.targetZ) * Math.min(1, dt); // 멈춰 있으면 앞뒤 흔들림이 가라앉음
    }
    if (Math.abs(d.x) >= L.maxReach) {
      bdGame.result = 'win';
      bdGame.reached = Math.sign(d.x);           // -1 = 건초, +1 = 물
      bdGame.wonAt = time;
      st.phase = 'eat';
    }
  }

  // 바라보는 방향: 걷는 중이면 가는 쪽, 멈춰 있으면 건초와 물을 번갈아 봄 (망설임)
  let yawTarget;
  if (st.phase === 'enter') yawTarget = Math.PI / 2; // 머리가 화면 위쪽(-z)을 향해 걸어 들어옴
  else if (st.phase === 'eat') yawTarget = bdGame.reached > 0 ? 0 : Math.PI; // 닿은 더미를 향함
  else if (walking) yawTarget = d.facingYaw;
  else yawTarget = Math.PI / 2 + Math.sin(time * 2.2) * 0.65; // 멈춰 있으면 건초와 물을 번갈아 봄
  let dy = yawTarget - d.yaw;                       // 가장 가까운 쪽으로 돌기
  while (dy > Math.PI) dy -= Math.PI * 2;
  while (dy < -Math.PI) dy += Math.PI * 2;
  d.yaw += dy * Math.min(1, dt * 5);

  // ----- 새 당나귀 입장 (화면 아래에서) -----
  let y = 0, zEnter = 0;
  if (st.phase === 'enter') {
    const p = bdClamp01((time - st.enterStart) / T.enter);
    zEnter = BD_LAYOUT.enterFromZ * (1 - bdEaseOut(p)); // 화면 아래에서 걸어 들어옴
    walking = true;
    if (p >= 1) { st.phase = 'alive'; st.cycleStart = time; }
  }

  d.walk += ((walking ? 1 : 0) - d.walk) * Math.min(1, dt * 8);
  d.walkPhase += dt * 14 * d.walk; // 빨라진 걸음에 맞춰 다리도 빠르게
  let bob = Math.abs(Math.sin(d.walkPhase)) * 0.18 * d.walk;
  if (st.phase === 'eat') bob = -0.25 + 0.25 * Math.sin((time - bdGame.wonAt) * 5); // 먹고 마시는 끄덕임
  d.group.position.set(d.x, y + bob, d.z + zEnter);
  d.group.rotation.y = d.yaw;

  // ----- 바스러짐 -> 새 당나귀 -----
  if (st.phase === 'crumble') {
    const p = (time - st.crumbleStart) / T.crumble;
    bdTrail.scale = 1 - bdSmooth(p);
    if (p >= 1) {
      st.phase = 'dead'; // 실패: 다시 하기를 누를 때까지 그대로
      bdDonkey.group.visible = false;
    }
  }

  bdWriteDonkey(time, dt);
  bdUpdatePiles(time);
  bdWriteTrail();
}

function getStatus_BuridanDonkey(time) {
  const c = bdCounts();
  const st = bdState;
  let life = BD_TIMING.life;
  if (st.phase === 'alive') life = Math.max(0, BD_TIMING.life - (time - st.cycleStart));
  else if (st.phase === 'eat') life = Math.max(0, BD_TIMING.life - (bdGame.wonAt - st.cycleStart));
  else if (st.phase === 'crumble' || st.phase === 'dead') life = 0;
  return {
    phase: st.phase, hay: c.hay, water: c.water, life, lifeMax: BD_TIMING.life,
    x: bdDonkey.x, z: bdDonkey.z,
    progress: bdDonkey.x / BD_LAYOUT.maxReach,   // -1 = 건초에 닿음, +1 = 물에 닿음
    result: bdGame.result, reached: bdGame.reached, presses: bdGame.presses,
    playing: st.phase === 'alive' && !bdGame.result,
    finished: st.phase === 'dead' || (st.phase === 'eat' && time - bdGame.wonAt > 1.6),
  };
}
