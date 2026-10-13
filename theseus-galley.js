// =========================================================
// 사고실험 01-확장 v2. 테세우스의 배 (3D 갤리선, 계층형 트라이포드)
// -----------------------------------------------------------
// 구조:
//   삼각형 3개                         -> 트라이포드(▲) 1개
//   트라이포드 4개(위/왼/오/가운데*)    -> 큰 트라이포드 1개 (12개 삼각형)
//     (*가운데는 180도 뒤집혀서 4등분 삼각형 타일링이 빈틈없이 맞물림)
//   큰 트라이포드 2100개               -> 갤리선 전체 (25,200개 삼각형)
//
// 렌더링 전략 (성능):
//   - 대부분의 큰 트라이포드(intact/broken/repaired 정착 상태)는 상태별로
//     "하나의 병합된 정적 지오메트리"로 묶어서 그림 (최대 3개 드로우콜).
//   - 지금 막 고장/수리 "전환 중"인 것들(한 주기 최대 70개 = 840개 삼각형)만
//     개별 THREE.Mesh로 다뤄서 색/회전 애니메이션을 준다.
//   - 전환이 끝나면 개별 메시를 버리고 해당 정적 풀에 편입시켜 다시 병합.
//
// 3D 선체:
//   길이방향으로 양 끝이 뾰족해지는 타원형 단면 볼륨 + 바닥 중앙의 얇은 용골 +
//   갑판 중앙에서 솟은 돛대 기둥. 이 세 영역의 합집합 부피 안에 큰 트라이포드
//   중심점을 격자로 채운다.
//
// 화면 흐름:
//   setScene_TheseusGalley(scene) 로 씬만 등록해두고, 실제 배 소환은
//   setColor_TheseusGalley(colorHex, time) 를 (버튼 클릭 등으로) 처음 호출할
//   때 일어난다 - 그래야 "설명 -> 버튼 -> 그래픽 등장" 흐름이 된다.
//
// 사용 전제:
//   - Three.js
//   - updateExperiment_TheseusGalley(time, deltaTime, viewHalfWidth)를 매 프레임 호출
//   - 클릭: raycaster.intersectObjects(getRaycastTargets_TheseusGalley())의
//     첫 결과를 handleRaycastHit_TheseusGalley(hit, time)에 전달
// =========================================================

const THESEUS_GALLEY_CONFIG = {
  bigTripodCount: 2100,
  breakBatchSize: 70,        // 한 번 고장날 때 동시에 고장나는 큰 트라이포드 개수
  breakInterval: 2.25,
  autoRepairIdleThreshold: 20, // 배가 멈춘(active 전환) 시점 기준
  autoRepairInterval: 1.5,
  breakTransitionDuration: 0.4,
  repairFlipDuration: 0.6,

  travelSpeed: 30,
  edgeMargin: 6,
  defaultViewHalfWidth: 40,

  triangleSize: 0.45,        // 삼각형 한 변 길이 (커짐)

  // 선체 (world 단위) - 낮고 긴 구조
  hullLength: 106,
  hullWidth: 27,
  hullHeight: 15,
  keelDepth: 5,        // 용골이 선저 아래로 돌출되는 깊이
  keelLengthFrac: 0.55,// 용골이 존재하는 길이 비율(중앙 기준)
  keelWidth: 2.7,
  mastHeight: 25,      // 갑판 위로 솟은 돛대 높이
  mastRadius: 1.5,
  mastXFrac: 0.05,     // 돛대 x 위치 (중앙에서 약간 앞쪽, 길이의 비율)

  bigTripodSpacing: 2.2, // 큰 트라이포드 중심 간 최소 간격(world 단위) - 겹침 방지

  wakeSpawnInterval: 0.04,
  wakeParticleLifeMin: 0.45,
  wakeParticleLifeMax: 0.85,
  wakeParticleSpeedMin: 5,
  wakeParticleSpeedMax: 11,
  wakeParticleScaleMin: 3,
  wakeParticleScaleMax: 8,

  onShipDeparted: null,
  onLeavingStart: null, // 퇴장이 "시작"되는 순간 호출 (진입 구도로 강제 리셋하는 용도 등)
};

// 트라이포드 내 개별 삼각형 오프셋 반경 / 큰 트라이포드 내 트라이포드 오프셋 반경
const GALLEY_CLUSTER_RADIUS_1 = THESEUS_GALLEY_CONFIG.triangleSize / Math.sqrt(3);
const GALLEY_SLOT_RADIUS_2 = GALLEY_CLUSTER_RADIUS_1 * 2;
const GALLEY_BIG_TRIPOD_RADIUS = GALLEY_SLOT_RADIUS_2 * 2; // 큰 트라이포드 전체 반경

function galleyGetBrokenColor(baseColor) {
  const hsl = { h: 0, s: 0, l: 0 };
  baseColor.getHSL(hsl);
  const c = new THREE.Color();
  c.setHSL(hsl.h, hsl.s * 0.35, Math.max(0.08, hsl.l * 0.5));
  return c;
}

function galleyGetComplementaryColor(baseColor) {
  const hsl = { h: 0, s: 0, l: 0 };
  baseColor.getHSL(hsl);
  const c = new THREE.Color();
  c.setHSL((hsl.h + 0.5) % 1.0, hsl.s, hsl.l);
  return c;
}

function galleyEaseOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// 균등 다운샘플
function galleyDownsampleEvenly(points, n) {
  if (points.length <= n) return points;
  const result = [];
  for (let i = 0; i < n; i++) {
    result.push(points[Math.floor((i * points.length) / n)]);
  }
  return result;
}

function theseusCreateTriangleGeometry(size) {
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

const THESEUS_GALLEY_TRIANGLE_GEOMETRY = theseusCreateTriangleGeometry(
  THESEUS_GALLEY_CONFIG.triangleSize
);

// ---------------------------------------------------------
// 계층 구조 로컬 오프셋 계산 (트라이포드 -> 큰 트라이포드)
// ---------------------------------------------------------

// 트라이포드(▲) 1개 = 삼각형 3개, 각도 90/210/330 고정, 회전 없음
function galleyBuildTripodOffsets(radius) {
  const offsets = [];
  for (let k = 0; k < 3; k++) {
    const angle = Math.PI / 2 + k * ((Math.PI * 2) / 3);
    offsets.push({ dx: Math.cos(angle) * radius, dy: Math.sin(angle) * radius, rot: 0 });
  }
  return offsets;
}

// 큰 트라이포드 1개 = 트라이포드 4개(위/왼/오 코너 + 가운데[180도 뒤집힘])
function galleyBuildBigTripodOffsets() {
  const slots = [];
  for (let k = 0; k < 3; k++) {
    const angle = Math.PI / 2 + k * ((Math.PI * 2) / 3);
    slots.push({
      dx: Math.cos(angle) * GALLEY_SLOT_RADIUS_2,
      dy: Math.sin(angle) * GALLEY_SLOT_RADIUS_2,
      rot: 0,
    });
  }
  slots.push({ dx: 0, dy: 0, rot: Math.PI }); // 가운데, 180도 뒤집힘

  const baseTripod = galleyBuildTripodOffsets(GALLEY_CLUSTER_RADIUS_1);
  const result = [];
  for (const slot of slots) {
    const cos = Math.cos(slot.rot), sin = Math.sin(slot.rot);
    for (const t of baseTripod) {
      const rx = t.dx * cos - t.dy * sin;
      const ry = t.dx * sin + t.dy * cos;
      result.push({ dx: slot.dx + rx, dy: slot.dy + ry, rot: t.rot + slot.rot });
    }
  }
  return result; // 12개
}

const BIG_TRIPOD_LOCAL_TRIANGLES = galleyBuildBigTripodOffsets();

// ---------------------------------------------------------
// 3D 선체 볼륨 (선체 + 용골 + 돛대)
// ---------------------------------------------------------

function galleyHullTaperAt(u) {
  return Math.sqrt(Math.max(0, 1 - u * u));
}

function galleyIsInsideHullVolume(x, y, z) {
  const cfg = THESEUS_GALLEY_CONFIG;
  const halfL = cfg.hullLength / 2;
  const u = x / halfL;
  if (u < -1 || u > 1) return false;
  const taper = galleyHullTaperAt(u);
  const hHalf = (cfg.hullHeight / 2) * taper;
  const wHalf = (cfg.hullWidth / 2) * taper;
  if (hHalf <= 0.001 || wHalf <= 0.001) return false;
  return (y * y) / (hHalf * hHalf) + (z * z) / (wHalf * wHalf) <= 1;
}

function galleyIsInsideKeel(x, y, z) {
  const cfg = THESEUS_GALLEY_CONFIG;
  const halfL = cfg.hullLength / 2;
  if (Math.abs(x) > halfL * cfg.keelLengthFrac) return false;
  if (Math.abs(z) > cfg.keelWidth / 2) return false;
  const taper = galleyHullTaperAt(x / halfL);
  const hHalf = (cfg.hullHeight / 2) * taper;
  return y < -hHalf && y >= -hHalf - cfg.keelDepth;
}

function galleyIsInsideMast(x, y, z) {
  const cfg = THESEUS_GALLEY_CONFIG;
  const mastX = cfg.hullLength * cfg.mastXFrac;
  const dx = x - mastX;
  if (dx * dx + z * z > cfg.mastRadius * cfg.mastRadius) return false;
  const taper = galleyHullTaperAt(mastX / (cfg.hullLength / 2));
  const deckY = (cfg.hullHeight / 2) * taper;
  return y >= deckY && y <= deckY + cfg.mastHeight;
}

function galleyIsInsideShip(x, y, z) {
  return galleyIsInsideHullVolume(x, y, z) || galleyIsInsideKeel(x, y, z) || galleyIsInsideMast(x, y, z);
}

// 격자 해상도를 점점 높여가며 목표 개수 이상 확보되면 균등 다운샘플
function galleySampleBigTripodPositions(targetCount, baseSpacing) {
  const cfg = THESEUS_GALLEY_CONFIG;
  const halfL = cfg.hullLength / 2;
  const maxY = cfg.hullHeight / 2 + cfg.keelDepth + cfg.mastHeight + 2;
  const minY = -(cfg.hullHeight / 2 + cfg.keelDepth + 2);
  const maxZ = cfg.hullWidth / 2 + 1;

  let points = [];
  for (let attempt = 0; attempt < 16; attempt++) {
    const spacing = baseSpacing * Math.pow(0.9, attempt);
    points = [];
    for (let x = -halfL; x <= halfL; x += spacing) {
      for (let y = minY; y <= maxY; y += spacing) {
        for (let z = -maxZ; z <= maxZ; z += spacing) {
          if (galleyIsInsideShip(x, y, z)) points.push({ x, y, z });
        }
      }
    }
    if (points.length >= targetCount) {
      return galleyDownsampleEvenly(points, targetCount);
    }
  }
  return points; // 목표에 못 미칠 수 있음 (최선의 결과)
}

// ---------------------------------------------------------
// 모듈 상태
// ---------------------------------------------------------

let galleyScene = null;
let galleyShipRoot = null;     // 배 전체를 담는 그룹 (이동은 이 그룹의 position.x만 바꾸면 됨)
let galleyDynamicGroup = null; // 전환 중인 큰 트라이포드들의 개별 메시
let galleyPoolMeshes = { intact: null, broken: null, repaired: null }; // 정적 병합 메시

let galleyBigTripods = []; // { index, x,y,z, state, stateChangedAt, regionIndex, dynamicMeshes }
let galleyRegions = [];    // { index, memberIndices:[...], breakScheduledAt }
let galleyRegionBreakOrder = [];
let galleyBaseColor = new THREE.Color(0xffffff);

let galleyShipPhase = 'awaiting-color'; // 'entering' | 'active' | 'leaving' | 'awaiting-color'
let galleyTravelOffsetX = 0;
let galleySpawnActiveTime = 0;
let galleyLastInteractionTime = 0;
let galleyLastAutoRepairAt = -Infinity;
let galleyDepartedNotified = false;
let galleyViewHalfWidth = THESEUS_GALLEY_CONFIG.defaultViewHalfWidth;
let galleyWakeSpawnAccumulator = 0;
let galleyWakeParticles = [];

// 씬만 등록 (아직 배는 소환하지 않음) - "설명 -> 버튼 -> 등장" 흐름을 위해 분리
function setScene_TheseusGalley(scene) {
  galleyScene = scene;
}

// ---------------------------------------------------------
// 병합 지오메트리 (정적 풀)
// ---------------------------------------------------------

function galleyBuildMergedMesh(indices, color) {
  if (indices.length === 0) return null;

  const triPerBig = BIG_TRIPOD_LOCAL_TRIANGLES.length; // 12
  const localVerts = THESEUS_GALLEY_TRIANGLE_GEOMETRY.attributes.position.array; // 9 floats
  const positions = new Float32Array(indices.length * triPerBig * 9);
  const faceToBigTripodIndex = new Array(indices.length * triPerBig);

  let vOff = 0;
  let fOff = 0;
  for (const idx of indices) {
    const bt = galleyBigTripods[idx];
    for (const tri of BIG_TRIPOD_LOCAL_TRIANGLES) {
      const cos = Math.cos(tri.rot), sin = Math.sin(tri.rot);
      for (let v = 0; v < 3; v++) {
        const lx = localVerts[v * 3], ly = localVerts[v * 3 + 1], lz = localVerts[v * 3 + 2];
        const rx = lx * cos - ly * sin;
        const ry = lx * sin + ly * cos;
        positions[vOff++] = bt.x + tri.dx + rx;
        positions[vOff++] = bt.y + tri.dy + ry;
        positions[vOff++] = bt.z + lz;
      }
      faceToBigTripodIndex[fOff++] = idx;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.faceToBigTripodIndex = faceToBigTripodIndex;
  return mesh;
}

function galleyRebuildPool(poolName) {
  const color =
    poolName === 'intact' ? galleyBaseColor
    : poolName === 'broken' ? galleyGetBrokenColor(galleyBaseColor)
    : galleyGetComplementaryColor(galleyBaseColor);

  const indices = [];
  for (const bt of galleyBigTripods) {
    if (bt.state === poolName) indices.push(bt.index);
  }

  const old = galleyPoolMeshes[poolName];
  if (old) {
    galleyShipRoot.remove(old);
    old.geometry.dispose();
    old.material.dispose();
  }

  const mesh = galleyBuildMergedMesh(indices, color);
  galleyPoolMeshes[poolName] = mesh;
  if (mesh) galleyShipRoot.add(mesh);
}

// ---------------------------------------------------------
// 배 소환
// ---------------------------------------------------------

function galleySpawnNewShip(colorHex, time) {
  const cfg = THESEUS_GALLEY_CONFIG;

  if (galleyShipRoot) {
    galleyScene.remove(galleyShipRoot);
    for (const name of ['intact', 'broken', 'repaired']) {
      const m = galleyPoolMeshes[name];
      if (m) { m.geometry.dispose(); m.material.dispose(); }
    }
    if (galleyDynamicGroup) {
      galleyDynamicGroup.traverse((o) => { if (o.material) o.material.dispose(); });
    }
  }

  galleyShipRoot = new THREE.Group();
  galleyDynamicGroup = new THREE.Group();
  galleyShipRoot.add(galleyDynamicGroup);
  galleyPoolMeshes = { intact: null, broken: null, repaired: null };
  galleyScene.add(galleyShipRoot);

  const positions = galleySampleBigTripodPositions(cfg.bigTripodCount, cfg.bigTripodSpacing);
  const actualCount = positions.length;

  galleyBigTripods = positions.map((p, i) => ({
    index: i,
    x: p.x, y: p.y, z: p.z,
    state: 'intact',
    stateChangedAt: time,
    regionIndex: -1,
    dynamicMeshes: null,
  }));

  // 실제 판자 구역처럼: x축(길이 방향) 기준으로 정렬한 뒤 70개씩 묶어서
  // "공간적으로 인접한" 구역을 만든다 (완전 랜덤 산포가 아님)
  const sortedIndices = galleyBigTripods.map((bt) => bt.index)
    .sort((a, b) => galleyBigTripods[a].x - galleyBigTripods[b].x);

  const regionCount = Math.ceil(actualCount / cfg.breakBatchSize);
  galleyRegions = [];
  for (let r = 0; r < regionCount; r++) {
    galleyRegions.push({ index: r, memberIndices: [], breakScheduledAt: Infinity });
  }
  for (let i = 0; i < sortedIndices.length; i++) {
    const regionIdx = Math.min(regionCount - 1, Math.floor(i / cfg.breakBatchSize));
    galleyBigTripods[sortedIndices[i]].regionIndex = regionIdx;
    galleyRegions[regionIdx].memberIndices.push(sortedIndices[i]);
  }

  // 구역이 고장 나는 순서를 무작위로 섞음
  const regionOrder = Array.from({ length: regionCount }, (_, i) => i);
  for (let i = regionOrder.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [regionOrder[i], regionOrder[j]] = [regionOrder[j], regionOrder[i]];
  }
  galleyRegionBreakOrder = regionOrder; // update()에서 active 전환 시점에 실제 시각으로 환산

  galleyBaseColor = new THREE.Color(colorHex);
  galleyLastInteractionTime = time;
  galleyLastAutoRepairAt = -Infinity;
  galleyDepartedNotified = false;

  galleyRebuildPool('intact'); // 전부 intact 상태이므로 하나의 병합 메시로

  const halfLength = cfg.hullLength / 2;
  galleyTravelOffsetX = -(galleyViewHalfWidth + cfg.edgeMargin + halfLength);
  galleyShipPhase = 'entering';
}

function setColor_TheseusGalley(colorHex, time) {
  galleySpawnNewShip(colorHex, time);
}

// 하위 호환: scene 등록 + 즉시 소환을 한 번에
function initExperiment_TheseusGalley(scene, initialColorHex, time) {
  galleyScene = scene;
  galleySpawnNewShip(initialColorHex, time || 0);
}

// ---------------------------------------------------------
// 레이캐스트 대상 / 클릭 처리
// ---------------------------------------------------------

function getRaycastTargets_TheseusGalley() {
  const targets = [];
  if (galleyPoolMeshes.intact) targets.push(galleyPoolMeshes.intact);
  if (galleyPoolMeshes.broken) targets.push(galleyPoolMeshes.broken);
  if (galleyPoolMeshes.repaired) targets.push(galleyPoolMeshes.repaired);
  if (galleyDynamicGroup) targets.push(...galleyDynamicGroup.children);
  return targets;
}

// 마우스 드래그로 배를 회전시키는 인터랙션 등에서 사용
function getShipRoot_TheseusGalley() {
  return galleyShipRoot;
}

function galleyStartTransition(bt, targetState, time) {
  const oldPool = targetState === 'transitioning-break' ? 'intact' : 'broken';
  bt.state = targetState;
  bt.stateChangedAt = time;
  galleyRebuildPool(oldPool);

  bt.dynamicMeshes = [];
  for (const tri of BIG_TRIPOD_LOCAL_TRIANGLES) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(THESEUS_GALLEY_TRIANGLE_GEOMETRY, material);
    mesh.position.set(bt.x + tri.dx, bt.y + tri.dy, bt.z);
    mesh.rotation.z = tri.rot;
    mesh.userData.bigTripodIndex = bt.index;
    galleyDynamicGroup.add(mesh);
    bt.dynamicMeshes.push(mesh);
  }
}

function galleyEndTransition(bt, finalState) {
  for (const mesh of bt.dynamicMeshes) {
    galleyDynamicGroup.remove(mesh);
    mesh.material.dispose();
  }
  bt.dynamicMeshes = null;
  bt.state = finalState;
  galleyRebuildPool(finalState);
}

function handleRaycastHit_TheseusGalley(intersection, time) {
  if (!intersection || galleyShipPhase !== 'active') return;
  const obj = intersection.object;
  let idx = null;
  if (obj.userData && obj.userData.bigTripodIndex != null) {
    idx = obj.userData.bigTripodIndex;
  } else if (obj.userData && obj.userData.faceToBigTripodIndex) {
    idx = obj.userData.faceToBigTripodIndex[intersection.faceIndex];
  }
  if (idx == null) return;

  galleyLastInteractionTime = time;
  const bt = galleyBigTripods[idx];
  if (!bt || bt.state !== 'broken') return;

  // 구역 전체를 한꺼번에 수리 (판자 한 장이 아니라 구역 단위로 교체)
  const region = galleyRegions[bt.regionIndex];
  for (const memberIdx of region.memberIndices) {
    const member = galleyBigTripods[memberIdx];
    if (member.state === 'broken') {
      galleyStartTransition(member, 'transitioning-repair', time);
    }
  }
}

// ---------------------------------------------------------
// 파도(웨이크) 파티클
// ---------------------------------------------------------

// 로컬(선체 기준) 좌표를 배의 현재 이동/회전을 반영해 월드 좌표로 변환
function galleyLocalToWorld(x, y, z) {
  galleyShipRoot.updateMatrixWorld();
  return galleyShipRoot.localToWorld(new THREE.Vector3(x, y, z));
}

// 로컬 방향 벡터를 배의 현재 회전만 반영해 월드 방향으로 변환 (이동은 무시)
function galleyLocalDirToWorld(x, y, z) {
  galleyShipRoot.updateMatrixWorld();
  return new THREE.Vector3(x, y, z).transformDirection(galleyShipRoot.matrixWorld);
}

function galleySpawnWakeParticle(worldPos, worldVel, color, time) {
  const cfg = THESEUS_GALLEY_CONFIG;
  const material = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 1 });
  const mesh = new THREE.Mesh(THESEUS_GALLEY_TRIANGLE_GEOMETRY, material);
  const baseScale = cfg.wakeParticleScaleMin + Math.random() * (cfg.wakeParticleScaleMax - cfg.wakeParticleScaleMin);
  mesh.scale.setScalar(baseScale);
  mesh.position.copy(worldPos);
  mesh.rotation.z = Math.random() * Math.PI * 2;
  galleyScene.add(mesh);

  galleyWakeParticles.push({
    mesh,
    vx: worldVel.x, vy: worldVel.y, vz: worldVel.z,
    spawnTime: time,
    life: cfg.wakeParticleLifeMin + Math.random() * (cfg.wakeParticleLifeMax - cfg.wakeParticleLifeMin),
    baseScale,
  });
}

function galleyUpdateWakeParticles(time, deltaTime) {
  for (let i = galleyWakeParticles.length - 1; i >= 0; i--) {
    const p = galleyWakeParticles[i];
    const age = time - p.spawnTime;
    if (age >= p.life) {
      galleyScene.remove(p.mesh);
      p.mesh.material.dispose();
      galleyWakeParticles.splice(i, 1);
      continue;
    }
    const t = age / p.life;
    p.mesh.position.x += p.vx * deltaTime;
    p.mesh.position.y += p.vy * deltaTime;
    p.mesh.position.z += p.vz * deltaTime;
    p.mesh.rotation.z += deltaTime * 3;
    p.mesh.material.opacity = 1 - t;
    p.mesh.scale.setScalar(p.baseScale * (1 - t * 0.4));
  }
}

// 뱃머리 부근의 실제 선체 단면(타원) 표면 위에서, 배의 진행 방향(3D)으로 파티클을 흩뿌림
function galleyEmitWakeIfMoving(time, deltaTime) {
  const cfg = THESEUS_GALLEY_CONFIG;
  if (galleyShipPhase !== 'entering' && galleyShipPhase !== 'leaving') return;

  galleyWakeSpawnAccumulator += deltaTime;
  if (galleyWakeSpawnAccumulator < cfg.wakeSpawnInterval) return;
  galleyWakeSpawnAccumulator = 0;

  const repairedColor = galleyGetComplementaryColor(galleyBaseColor);
  const wakeColor = galleyGetComplementaryColor(repairedColor); // = 원래 색
  const halfL = cfg.hullLength / 2;

  const count = 1 + (Math.random() < 0.5 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    // 뱃머리 끝(u=1)은 단면 반경이 0이라, 그 바로 못 미친 구간에서 발생
    const u = 0.72 + Math.random() * 0.26;
    const localX = u * halfL;
    const taper = galleyHullTaperAt(u);
    const hHalf = (cfg.hullHeight / 2) * taper;
    const wHalf = (cfg.hullWidth / 2) * taper;

    const theta = Math.random() * Math.PI * 2;
    const ny = Math.sin(theta); // 단면 둘레 위의 한 점 (선체 표면 바깥 방향)
    const nz = Math.cos(theta);
    const localY = ny * hHalf;
    const localZ = nz * wHalf;

    const worldPos = galleyLocalToWorld(localX, localY, localZ);

    // 진행 방향(배 기준 -X, 즉 뒤쪽)으로 밀리면서 선체 바깥 방향(ny,nz)으로 튀는 3D 속도
    const speed = cfg.wakeParticleSpeedMin + Math.random() * (cfg.wakeParticleSpeedMax - cfg.wakeParticleSpeedMin);
    const outward = galleyLocalDirToWorld(0, ny, nz);
    const backward = galleyLocalDirToWorld(-1, 0, 0);
    const worldVel = new THREE.Vector3()
      .addScaledVector(outward, speed)
      .addScaledVector(backward, 2 + Math.random() * 2);

    galleySpawnWakeParticle(worldPos, worldVel, wakeColor, time);
  }
}

// ---------------------------------------------------------
// 매 프레임 업데이트
// ---------------------------------------------------------

function updateExperiment_TheseusGalley(time, deltaTime, viewHalfWidth) {
  const cfg = THESEUS_GALLEY_CONFIG;
  if (typeof viewHalfWidth === 'number' && viewHalfWidth > 0) {
    galleyViewHalfWidth = viewHalfWidth;
  }
  if (!galleyShipRoot) return;

  const halfLength = cfg.hullLength / 2;

  if (galleyShipPhase === 'entering') {
    galleyTravelOffsetX += cfg.travelSpeed * deltaTime;
    if (galleyTravelOffsetX >= 0) {
      galleyTravelOffsetX = 0;
      galleyShipPhase = 'active';
      galleySpawnActiveTime = time;
      galleyLastInteractionTime = time; // 자동수리 대기시간의 기준점 = 배가 멈춘 시점
      for (let r = 0; r < galleyRegions.length; r++) {
        const orderPos = galleyRegionBreakOrder.indexOf(r);
        galleyRegions[r].breakScheduledAt = time + cfg.breakInterval * (orderPos + 1);
      }
    }
  } else if (galleyShipPhase === 'active') {
    // 구역 단위로 고장 처리 (한 구역=70개가 동시에 고장)
    for (const region of galleyRegions) {
      if (time < region.breakScheduledAt) continue;
      const first = galleyBigTripods[region.memberIndices[0]];
      if (first.state !== 'intact') continue; // 이미 처리된 구역
      for (const memberIdx of region.memberIndices) {
        galleyStartTransition(galleyBigTripods[memberIdx], 'transitioning-break', time);
      }
    }

    const idleTime = time - galleyLastInteractionTime;
    if (idleTime >= cfg.autoRepairIdleThreshold && time - galleyLastAutoRepairAt >= cfg.autoRepairInterval) {
      // 고장난 구역 하나를 통째로 자동 수리
      const brokenRegion = galleyRegions.find(
        (region) => galleyBigTripods[region.memberIndices[0]].state === 'broken'
      );
      if (brokenRegion) {
        for (const memberIdx of brokenRegion.memberIndices) {
          const member = galleyBigTripods[memberIdx];
          if (member.state === 'broken') {
            galleyStartTransition(member, 'transitioning-repair', time);
          }
        }
        galleyLastAutoRepairAt = time;
      }
    }

    const allRepaired = galleyBigTripods.every((b) => b.state === 'repaired');
    if (allRepaired) {
      galleyShipPhase = 'leaving';
      galleyTravelOffsetX = 0;
      if (typeof cfg.onLeavingStart === 'function') cfg.onLeavingStart();
    }
  } else if (galleyShipPhase === 'leaving') {
    galleyTravelOffsetX += cfg.travelSpeed * deltaTime;
    const leftEdgeX = -halfLength + galleyTravelOffsetX;
    if (leftEdgeX > galleyViewHalfWidth + cfg.edgeMargin && !galleyDepartedNotified) {
      galleyDepartedNotified = true;
      galleyShipPhase = 'awaiting-color';
      if (typeof cfg.onShipDeparted === 'function') cfg.onShipDeparted();
    }
  }

  // 전환 중인 큰 트라이포드들 애니메이션
  const brokenColor = galleyGetBrokenColor(galleyBaseColor);
  const repairedColor = galleyGetComplementaryColor(galleyBaseColor);

  for (const bt of galleyBigTripods) {
    if (bt.state === 'transitioning-break') {
      const p = Math.min(1, (time - bt.stateChangedAt) / cfg.breakTransitionDuration);
      const color = galleyBaseColor.clone().lerp(brokenColor, galleyEaseOutCubic(p));
      for (const mesh of bt.dynamicMeshes) mesh.material.color.copy(color);
      if (p >= 1) galleyEndTransition(bt, 'broken');
    } else if (bt.state === 'transitioning-repair') {
      const p = Math.min(1, (time - bt.stateChangedAt) / cfg.repairFlipDuration);
      const rotY = p * Math.PI;
      const color = p < 0.5 ? brokenColor : repairedColor;
      for (const mesh of bt.dynamicMeshes) {
        mesh.rotation.y = rotY;
        mesh.material.color.copy(color);
      }
      if (p >= 1) galleyEndTransition(bt, 'repaired');
    }
  }

  galleyShipRoot.position.x = galleyTravelOffsetX;

  galleyEmitWakeIfMoving(time, deltaTime);
  galleyUpdateWakeParticles(time, deltaTime);
}

// ---------------------------------------------------------
// 디버깅용
// ---------------------------------------------------------

function getDebugState_TheseusGalley() {
  return {
    phase: galleyShipPhase,
    travelOffsetX: galleyTravelOffsetX,
    viewHalfWidth: galleyViewHalfWidth,
    bigTripodCount: galleyBigTripods.length,
  };
}

// -----------------------------------------------------------
// 연동 예시 (참고용)
// -----------------------------------------------------------
//
// function getViewHalfWidthAtZ0(camera) {
//   const vFOV = camera.fov * Math.PI / 180;
//   const heightHalf = Math.tan(vFOV / 2) * camera.position.z;
//   return heightHalf * camera.aspect;
// }
//
// setScene_TheseusGalley(scene); // 페이지 로드 시
// // 버튼 클릭 시:
// setColor_TheseusGalley(pickedHexColor, elapsedTime);
//
// renderer.domElement.addEventListener('click', (event) => {
//   const rect = renderer.domElement.getBoundingClientRect();
//   pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
//   pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
//   raycaster.setFromCamera(pointer, camera);
//   const hits = raycaster.intersectObjects(getRaycastTargets_TheseusGalley());
//   if (hits.length > 0) handleRaycastHit_TheseusGalley(hits[0], elapsedTime);
// });
//
// function animate() {
//   requestAnimationFrame(animate);
//   const deltaTime = clock.getDelta();
//   elapsedTime += deltaTime;
//   updateExperiment_TheseusGalley(elapsedTime, deltaTime, getViewHalfWidthAtZ0(camera));
//   renderer.render(scene, camera);
// }
