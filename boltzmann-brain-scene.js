// =========================================================
// 사고실험 02. 볼츠만 두뇌 - 게임 버전
// -----------------------------------------------------------
// 구조:
//   1) 뇌: 작은 삼각형들이 "뇌 신경 회로" 구조로 뇌 모양의 3D 공간을 채움
//      (위치 생성은 boltzmann-brain-shape.js, 색상 그룹마다 병합 메시 1개)
//   2) 게임이 시작되면 뇌 한가운데에 진공이 생겨나 점점 커짐
//      - 그 안의 삼각형은 사라짐. 진공이 잘 보이도록 진공 앞쪽(카메라 쪽) 삼각형도 함께 걷힘
//   3) 진공 안에서 요동(쌍생성/쌍소멸)이 끝없이 일어남 (boltzmann-brain.js 시뮬레이터)
//      - 에너지 크기에 따라 삼각형 1개 / 3개 / 12개 / 48개짜리 흰 구조가 잠깐 나타났다 사라짐
//   4) 아주 드물게, 요동이 "작은 뇌" 하나를 만들어냄 (금색, 뇌 모양)
//      - 순식간에 나타났다가 약 1초 뒤 순식간에 사라짐
//      - 그 순간을 클릭하면 목표 완료
//      - 놓치면 시간이 지나 다시 나타남
//
// 에너지 -> 구조 매핑 (E0=1 기준):
//   energy <  1.5 : 삼각형 1개
//   1.5 ~ 3       : 트라이포드(3개)
//   3   ~ 6       : 큰 트라이포드(12개)
//   6 이상         : 초대형 트라이포드(48개) - 크지만 뇌는 아님 (헷갈리게 하는 요동)
//
// [연출 참고] 물리 모델 그대로면 큰 요동일수록 수명이 극히 짧아 보이지 않는다.
// 그래서 화면 표시 지속시간은 max(최소표시시간, 모델수명 × 배율)로 늘린다.
// 뇌가 조립되는 사건은 물리적으로는 사실상 일어나지 않을 만큼 드물지만,
// 게임에서는 일정 시간 간격(무작위)으로 일어나도록 따로 예약한다.
//
// 공개 함수:
//   initExperiment_BoltzmannBrain(scene, time)
//   startGame_BoltzmannBrain(time)        -> 진공 생성 시작
//   resetGame_BoltzmannBrain(time)        -> 뇌 복원 후 다시 시작
//   updateExperiment_BoltzmannBrain(time, deltaTime)
//   pick_BoltzmannBrain(ndcX, ndcY, camera, viewW, viewH, time) -> 'brain' | 'fluctuation' | 'none'
//   getGame_BoltzmannBrain(time)
//   getSceneRoot_BoltzmannBrain()
// =========================================================

const BB_SCENE_CONFIG = {
  // 뇌(앰비언트) 삼각형
  ambientTriangleSize: 0.35,
  ambientMinSpacing: 1.0,
  ambientMaxCount: 14000,
  ambientOpacity: 0.85,
  // 색상 그룹별 색: [0]=피질 껍질, [1]=잔 섬유, [2~6]=신경 다발별 색
  ambientPalette: [0x2a5aa0, 0x3b4d6b, 0x4c8dff, 0x2fc4d8, 0x7a6bff, 0x3fd1a0, 0xd06ad0],

  fractalTriangleSize: 0.5,

  // 진공
  vacuumCenter: [-2, 3, 0],   // 뇌 로컬 좌표 (대뇌 한가운데)
  vacuumRadius: 13.5,
  vacuumDelay: 0.8,           // 게임 시작 후 진공이 생기기 시작할 때까지
  vacuumGrowTime: 1.6,        // 진공이 다 커지는 시간

  // 요동
  tier1Threshold: 1.5,
  tier2Threshold: 3,
  tier3Threshold: 6,
  minDisplayLifetime: 0.6,
  lifetimeDisplayScale: 3,
  normalStructColor: 0xeaeaea,

  // 뇌가 조립되는 사건
  brainFirstMin: 5,           // 진공이 다 생긴 뒤 첫 뇌까지 (초, 무작위 범위)
  brainFirstMax: 14,
  brainNextMin: 2,            // 놓친 뒤 다음 뇌까지
  brainNextMax: 8,
  brainVisible: 0.40,          // 뇌가 순식간에 나타나 머무는 시간 (그 뒤 순식간에 사라짐)
  brainWidth: 8,             // 작은 뇌의 가로 길이 (world)
  brainTriCount: 110,
  brainTriSize: 0.45,
  brainColor: 0xffd27a,
  pickRadiusPx: 30,           // 클릭 판정 최소 반경(화면 픽셀)
  missCooldown: 1.2,          // 뇌가 아닌 곳을 누르면 이 시간 동안 관측이 흐트러져 클릭이 먹히지 않음

  sway: 0.22,                 // 입체감이 드러나도록 천천히 좌우로 도는 폭(라디안)
};

function bbCreateTriangleGeometry(size) {
  const geometry = new THREE.BufferGeometry();
  const h = (size * Math.sqrt(3)) / 2;
  const vertices = new Float32Array([
    0, h * (2 / 3), 0,
    -size / 2, -h * (1 / 3), 0,
    size / 2, -h * (1 / 3), 0,
  ]);
  geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return geometry;
}

const BB_AMBIENT_GEOMETRY = bbCreateTriangleGeometry(BB_SCENE_CONFIG.ambientTriangleSize);
const BB_FRACTAL_GEOMETRY = bbCreateTriangleGeometry(BB_SCENE_CONFIG.fractalTriangleSize);

// ---------------------------------------------------------
// 프랙탈(트라이포드) 로컬 오프셋 생성 - 테세우스의 배와 같은 원리
// ---------------------------------------------------------

function bbBuildTripodUnit(rTri) {
  const offsets = [];
  for (let k = 0; k < 3; k++) {
    const angle = Math.PI / 2 + k * ((Math.PI * 2) / 3);
    offsets.push({ dx: Math.cos(angle) * rTri, dy: Math.sin(angle) * rTri, rot: 0 });
  }
  return { offsets, radius: rTri * 2 };
}

function bbSubdivideWithCenter(unit) {
  const slotRadius = unit.radius;
  const slots = [];
  for (let k = 0; k < 3; k++) {
    const angle = Math.PI / 2 + k * ((Math.PI * 2) / 3);
    slots.push({ dx: Math.cos(angle) * slotRadius, dy: Math.sin(angle) * slotRadius, rot: 0 });
  }
  slots.push({ dx: 0, dy: 0, rot: Math.PI }); // 가운데, 180도 뒤집힘

  const result = [];
  for (const slot of slots) {
    const cos = Math.cos(slot.rot), sin = Math.sin(slot.rot);
    for (const t of unit.offsets) {
      const rx = t.dx * cos - t.dy * sin;
      const ry = t.dx * sin + t.dy * cos;
      result.push({ dx: slot.dx + rx, dy: slot.dy + ry, rot: t.rot + slot.rot });
    }
  }
  return { offsets: result, radius: slotRadius * 2 };
}

const BB_FRACTAL_R_TRI = BB_SCENE_CONFIG.fractalTriangleSize / Math.sqrt(3);
const BB_FRACTAL_UNITS = (function buildUnits() {
  const depth0 = { offsets: [{ dx: 0, dy: 0, rot: 0 }], radius: BB_FRACTAL_R_TRI };
  const depth1 = bbBuildTripodUnit(BB_FRACTAL_R_TRI);       // 3개
  const depth2 = bbSubdivideWithCenter(depth1);             // 12개
  const depth3 = bbSubdivideWithCenter(depth2);             // 48개
  return [depth0, depth1, depth2, depth3];
})();

function bbPickFractalUnit(energy) {
  const cfg = BB_SCENE_CONFIG;
  if (energy >= cfg.tier3Threshold) return BB_FRACTAL_UNITS[3];
  if (energy >= cfg.tier2Threshold) return BB_FRACTAL_UNITS[2];
  if (energy >= cfg.tier1Threshold) return BB_FRACTAL_UNITS[1];
  return BB_FRACTAL_UNITS[0];
}

// ---------------------------------------------------------
// 모듈 상태
// ---------------------------------------------------------

let bbScene = null;
let bbSceneRoot = null;   // 원점 기준 회전을 위해 뇌+진공을 담는 그룹
let bbAmbientMeshes = []; // 색상 그룹별 병합 메시
let bbAmbientPoints = []; // { x, y, z, alive, g }
let bbPocket = null;      // { center, radius, simulator, group, structures, formStart, ready }
let bbBrainShape = null;  // 작은 뇌 모양의 삼각형 중심/방향 (로컬, 한 번만 계산)
let bbBrainEvent = null;  // 지금 나타나 있는 뇌 { mesh, start, pos, caught, spin }
let bbGame = null;        // { phase, startTime, nextBrainAt, fluctuations, missed, won, wonAt }

// ---------------------------------------------------------
// 뇌(앰비언트) 메시
// ---------------------------------------------------------

function bbBuildAmbientMeshes() {
  for (const m of bbAmbientMeshes) {
    bbSceneRoot.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  }
  bbAmbientMeshes = [];

  const byGroup = new Map();
  for (const p of bbAmbientPoints) {
    if (!p.alive) continue;
    let list = byGroup.get(p.g);
    if (!list) { list = []; byGroup.set(p.g, list); }
    list.push(p);
  }

  const palette = BB_SCENE_CONFIG.ambientPalette;
  const localVerts = BB_AMBIENT_GEOMETRY.attributes.position.array;

  byGroup.forEach((list, g) => {
    const positions = new Float32Array(list.length * 9);
    let vOff = 0;
    for (const p of list) {
      for (let v = 0; v < 3; v++) {
        positions[vOff++] = localVerts[v * 3] + p.x;
        positions[vOff++] = localVerts[v * 3 + 1] + p.y;
        positions[vOff++] = localVerts[v * 3 + 2] + p.z;
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.MeshBasicMaterial({
      color: palette[g % palette.length],
      side: THREE.DoubleSide,
      transparent: true,
      opacity: BB_SCENE_CONFIG.ambientOpacity,
    });
    const mesh = new THREE.Mesh(geometry, material);
    bbSceneRoot.add(mesh);
    bbAmbientMeshes.push(mesh);
  });
}

function getSceneRoot_BoltzmannBrain() {
  return bbSceneRoot;
}

// ---------------------------------------------------------
// 작은 뇌 모양 (요동이 조립하는 뇌) - 볼츠만 두뇌와 같은 모양을 작게
// ---------------------------------------------------------

function bbRandDir() {
  const z = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
  return [r * Math.cos(t), r * Math.sin(t), z];
}

function bbBuildBrainShape() {
  const cfg = BB_SCENE_CONFIG, B = BB_BRAIN_CONFIG;
  const pts = [];
  const weights = B.parts.map((p) => p.s[0] * p.s[1] + p.s[1] * p.s[2] + p.s[0] * p.s[2]);
  const wsum = weights.reduce((a, w) => a + w, 0);
  const minD2 = Math.pow(4.6, 2);
  for (let tries = 0; tries < 40000 && pts.length < cfg.brainTriCount; tries++) {
    let pick = Math.random() * wsum, pi = 0;
    while (pi < weights.length - 1 && pick > weights[pi]) { pick -= weights[pi]; pi++; }
    const part = B.parts[pi];
    const u = bbRandDir();
    const k = 0.95 + Math.random() * 0.1;
    const x = part.c[0] + part.s[0] * u[0] * k, y = part.c[1] + part.s[1] * u[1] * k, z = part.c[2] + part.s[2] * u[2] * k;
    const f = bbBrainField(x, y, z);
    if (f > 1 || f < 0.86) continue;
    if (pts.some((q) => (q[0] - x) ** 2 + (q[1] - y) ** 2 + (q[2] - z) ** 2 < minD2)) continue;
    pts.push([x, y, z]);
  }
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  pts.forEach((p) => { for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a]); } });
  const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
  const s = cfg.brainWidth / (mx[0] - mn[0]);
  return pts.map((p) => ({
    x: (p[0] - c[0]) * s, y: (p[1] - c[1]) * s, z: (p[2] - c[2]) * s,
    rot: Math.random() * Math.PI * 2, tilt: (Math.random() - 0.5) * 1.2,
  }));
}

function bbSpawnBrainEvent(time) {
  const cfg = BB_SCENE_CONFIG;
  const n = bbBrainShape.length;
  const geometry = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(new Float32Array(n * 9), 3);
  if (attr.setUsage) attr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attr);
  const material = new THREE.MeshBasicMaterial({ color: cfg.brainColor, side: THREE.DoubleSide, transparent: true, opacity: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  bbPocket.group.add(mesh);

  // 진공 안쪽(가운데 쪽)에 나타나야 전체가 보임
  const pos = bbRandomPointInSphere(bbPocket.center, bbPocket.radius * 0.6);
  bbBrainEvent = { mesh, start: time, pos, caught: false, spin: Math.random() * Math.PI * 2 };
}

function bbRemoveBrainEvent() {
  if (!bbBrainEvent) return;
  bbPocket.group.remove(bbBrainEvent.mesh);
  bbBrainEvent.mesh.geometry.dispose();
  bbBrainEvent.mesh.material.dispose();
  bbBrainEvent = null;
}

// 뇌가 지금 보이는지 (잡힌 뒤에는 계속 보임)
function bbBrainShown(time) {
  return !!bbBrainEvent && (bbBrainEvent.caught || time - bbBrainEvent.start < BB_SCENE_CONFIG.brainVisible);
}

function bbUpdateBrainEvent(time, deltaTime) {
  const cfg = BB_SCENE_CONFIG, e = bbBrainEvent;
  const t = time - e.start;
  e.mesh.material.opacity = 1; // 페이드 없이 순식간에 나타남
  e.spin += deltaTime * 0.6;
  const pulse = e.caught ? 1 + 0.06 * Math.sin(time * 5) : 1;

  const arr = e.mesh.geometry.attributes.position.array;
  const r = cfg.brainTriSize / Math.sqrt(3);
  const cs = Math.cos(e.spin), sn = Math.sin(e.spin);
  for (let i = 0; i < bbBrainShape.length; i++) {
    const p = bbBrainShape[i];
    let x = p.x * pulse;
    const y = p.y * pulse;
    let z = p.z * pulse;
    const rx = x * cs + z * sn; z = -x * sn + z * cs; x = rx; // 세로축 회전
    const rot = p.rot;
    for (let k = 0; k < 3; k++) {
      const a = rot + k * (Math.PI * 2 / 3);
      const o = (i * 3 + k) * 3;
      arr[o] = e.pos.x + x + Math.cos(a) * r;
      arr[o + 1] = e.pos.y + y + Math.sin(a) * r;
      arr[o + 2] = e.pos.z + z + Math.sin(a) * r * p.tilt;
    }
  }
  e.mesh.geometry.attributes.position.needsUpdate = true;

  // 놓침 -> 다음 뇌 예약
  if (!e.caught && t >= cfg.brainVisible) { // 순식간에 사라짐
    bbRemoveBrainEvent();
    bbGame.missed++;
    bbGame.nextBrainAt = time + cfg.brainNextMin + Math.random() * (cfg.brainNextMax - cfg.brainNextMin);
  }
}

// ---------------------------------------------------------
// 초기화 / 게임 시작 / 다시 하기
// ---------------------------------------------------------

function initExperiment_BoltzmannBrain(scene, time) {
  bbScene = scene;
  bbSceneRoot = new THREE.Group();
  bbScene.add(bbSceneRoot);
  bbAmbientPoints = bbGenerateBrainPoints(BB_SCENE_CONFIG.ambientMaxCount, BB_SCENE_CONFIG.ambientMinSpacing);
  bbBuildAmbientMeshes();
  bbBrainShape = bbBuildBrainShape();
  bbGame = { phase: 'idle', startTime: time, nextBrainAt: Infinity, fluctuations: 0, missed: 0, won: false, wonAt: 0 };
}

function bbClearPocket() {
  if (!bbPocket) return;
  bbRemoveBrainEvent();
  for (const s of bbPocket.structures) for (const m of s.meshes) m.material.dispose();
  bbSceneRoot.remove(bbPocket.group);
  bbPocket = null;
}

function startGame_BoltzmannBrain(time) {
  const cfg = BB_SCENE_CONFIG;
  bbClearPocket();
  const simulator = createBoltzmannBrainSimulator({ startDelay: 0, attemptRate: 12 });
  simulator.reset(time);
  const group = new THREE.Group();
  bbSceneRoot.add(group);
  bbPocket = {
    center: new THREE.Vector3(cfg.vacuumCenter[0], cfg.vacuumCenter[1], cfg.vacuumCenter[2]),
    radius: 0,
    simulator,
    group,
    structures: [],
    formStart: time + cfg.vacuumDelay,
    ready: false,
  };
  bbGame = { phase: 'forming', startTime: time, nextBrainAt: Infinity, fluctuations: 0, missed: 0, won: false, wonAt: 0, cooldownUntil: 0 };
}

function resetGame_BoltzmannBrain(time) {
  bbClearPocket();
  for (const p of bbAmbientPoints) p.alive = true;
  bbBuildAmbientMeshes();
  startGame_BoltzmannBrain(time);
}

// 진공 반경을 키우며 그 안(과 그 앞쪽)의 뇌 삼각형을 걷어냄
function bbCarveVacuum(radius) {
  const c = bbPocket.center, r2 = radius * radius;
  let removed = false;
  for (const p of bbAmbientPoints) {
    if (!p.alive) continue;
    const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z;
    const inSphere = dx * dx + dy * dy + dz * dz <= r2;
    const inFront = dz > 0 && dx * dx + dy * dy <= r2 * 0.6; // 진공이 들여다보이도록 앞쪽 창
    if (inSphere || inFront) { p.alive = false; removed = true; }
  }
  if (removed) bbBuildAmbientMeshes();
}

// ---------------------------------------------------------
// 요동 -> 흰 구조 생성/소멸
// ---------------------------------------------------------

function bbRandomPointInSphere(center, radius) {
  const r = radius * 0.85 * Math.cbrt(Math.random());
  const d = bbRandDir();
  return new THREE.Vector3(center.x + r * d[0], center.y + r * d[1], center.z + r * d[2]);
}

function bbSpawnStructureForEvent(pocket, event, time) {
  const cfg = BB_SCENE_CONFIG;
  const unit = bbPickFractalUnit(event.energy);
  const pos = bbRandomPointInSphere(pocket.center, pocket.radius);
  const rotZBase = Math.random() * Math.PI * 2;

  const meshes = [];
  for (const off of unit.offsets) {
    const material = new THREE.MeshBasicMaterial({ color: cfg.normalStructColor, side: THREE.DoubleSide, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(BB_FRACTAL_GEOMETRY, material);
    const cos = Math.cos(rotZBase), sin = Math.sin(rotZBase);
    mesh.position.set(pos.x + off.dx * cos - off.dy * sin, pos.y + off.dx * sin + off.dy * cos, pos.z);
    mesh.rotation.z = off.rot + rotZBase;
    pocket.group.add(mesh);
    meshes.push(mesh);
  }
  const displayLifetime = Math.max(cfg.minDisplayLifetime, event.lifetime * cfg.lifetimeDisplayScale);
  pocket.structures.push({ meshes, pos, size: unit.radius, spawnTime: time, displayLifetime, expiresAt: time + displayLifetime });
}

// ---------------------------------------------------------
// 클릭 판정
// ---------------------------------------------------------

function bbScreenOf(localPos, camera, viewW, viewH) {
  const v = bbSceneRoot.localToWorld(localPos.clone()).project(camera);
  return { x: (v.x + 1) / 2 * viewW, y: (1 - v.y) / 2 * viewH };
}

// 반환: 'brain' (뇌를 잡음 -> 목표 완료) | 'fluctuation' (그냥 요동) | 'cooldown' | 'none'
function pick_BoltzmannBrain(ndcX, ndcY, camera, viewW, viewH, time) {
  if (!bbPocket || !bbPocket.ready || bbGame.won) return 'none';
  if (time < bbGame.cooldownUntil) return 'cooldown'; // 마구 누르기 방지
  const res = bbPick(ndcX, ndcY, camera, viewW, viewH, time);
  if (res === 'fluctuation') bbGame.cooldownUntil = time + BB_SCENE_CONFIG.missCooldown;
  return res;
}

function bbPick(ndcX, ndcY, camera, viewW, viewH, time) {
  bbSceneRoot.updateMatrixWorld();
  const mx = (ndcX + 1) / 2 * viewW, my = (1 - ndcY) / 2 * viewH;
  const cfg = BB_SCENE_CONFIG;

  if (bbBrainShown(time)) {
    const c = bbScreenOf(bbBrainEvent.pos, camera, viewW, viewH);
    const edge = bbScreenOf(bbBrainEvent.pos.clone().add(new THREE.Vector3(cfg.brainWidth / 2, 0, 0)), camera, viewW, viewH);
    const rad = Math.max(cfg.pickRadiusPx, Math.hypot(edge.x - c.x, edge.y - c.y));
    if (Math.hypot(mx - c.x, my - c.y) <= rad) {
      bbBrainEvent.caught = true;
      bbGame.won = true;
      bbGame.wonAt = time;
      bbGame.phase = 'won';
      return 'brain';
    }
  }
  for (const s of bbPocket.structures) {
    const c = bbScreenOf(s.pos, camera, viewW, viewH);
    if (Math.hypot(mx - c.x, my - c.y) <= 22) return 'fluctuation';
  }
  // 진공 안을 눌렀으면 요동으로 취급 (뇌가 아님을 알려줌)
  const c = bbScreenOf(bbPocket.center, camera, viewW, viewH);
  const edge = bbScreenOf(bbPocket.center.clone().add(new THREE.Vector3(bbPocket.radius, 0, 0)), camera, viewW, viewH);
  if (Math.hypot(mx - c.x, my - c.y) <= Math.hypot(edge.x - c.x, edge.y - c.y)) return 'fluctuation';
  return 'none';
}

function getGame_BoltzmannBrain(time) {
  return {
    phase: bbGame.phase,
    observed: bbPocket && bbPocket.ready ? time - bbPocket.readyAt : 0,
    fluctuations: bbGame.fluctuations,
    missed: bbGame.missed,
    brainVisible: bbBrainShown(time) && !bbBrainEvent.caught,
    won: bbGame.won,
    wonAt: bbGame.wonAt,
    cooldown: Math.max(0, bbGame.cooldownUntil - time),
  };
}

// ---------------------------------------------------------
// 매 프레임 업데이트
// ---------------------------------------------------------

function updateExperiment_BoltzmannBrain(time, deltaTime) {
  const cfg = BB_SCENE_CONFIG;
  bbSceneRoot.rotation.y = Math.sin(time * 0.2) * cfg.sway;
  if (!bbPocket) return;
  const pocket = bbPocket;

  // 1) 진공이 생겨나 커짐
  if (!pocket.ready && time >= pocket.formStart) {
    const k = Math.min(1, (time - pocket.formStart) / cfg.vacuumGrowTime);
    const r = cfg.vacuumRadius * (1 - Math.pow(1 - k, 2));
    if (r > pocket.radius + 0.25 || k >= 1) {
      pocket.radius = r;
      bbCarveVacuum(r);
    }
    if (k >= 1) {
      pocket.ready = true;
      pocket.readyAt = time;
      pocket.simulator.reset(time);
      bbGame.phase = 'observing';
      bbGame.nextBrainAt = time + cfg.brainFirstMin + Math.random() * (cfg.brainFirstMax - cfg.brainFirstMin);
    }
  }

  // 2) 요동 (목표 완료 후에는 멈춤)
  if (pocket.ready && !bbGame.won) {
    const newEvents = pocket.simulator.update(time, deltaTime);
    for (const event of newEvents) {
      bbSpawnStructureForEvent(pocket, event, time);
      bbGame.fluctuations++;
    }
    if (!bbBrainEvent && time >= bbGame.nextBrainAt) bbSpawnBrainEvent(time);
  }

  for (let i = pocket.structures.length - 1; i >= 0; i--) {
    const s = pocket.structures[i];
    const t = Math.min(1, (time - s.spawnTime) / s.displayLifetime);
    let opacity = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
    if (bbGame.won) opacity *= Math.max(0, 1 - (time - bbGame.wonAt) * 2); // 잡은 뒤엔 다른 요동이 걷힘
    for (const mesh of s.meshes) {
      mesh.material.opacity = opacity;
      mesh.rotation.z += deltaTime * 0.6;
    }
    if (time >= s.expiresAt) {
      for (const mesh of s.meshes) { pocket.group.remove(mesh); mesh.material.dispose(); }
      pocket.structures.splice(i, 1);
    }
  }

  // 3) 뇌 조립 사건
  if (bbBrainEvent) bbUpdateBrainEvent(time, deltaTime);
}
