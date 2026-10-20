// =========================================================
// 사고실험 01. 테세우스의 배 - 게임 버전 (3D 갤리선, 계층형 트라이포드)
// -----------------------------------------------------------
// 구조:
//   삼각형 3개                         -> 트라이포드(▲) 1개
//   트라이포드 4개(위/왼/오/가운데*)    -> 큰 트라이포드 1개 (12개 삼각형)
//     (*가운데는 180도 뒤집혀서 4등분 삼각형 타일링이 빈틈없이 맞물림)
//   큰 트라이포드 2100개               -> 갤리선 전체 (25,200개 삼각형)
//   큰 트라이포드 70개(길이 방향으로 인접) -> "부위" 1개 (총 30개 부위)
//
// 게임 규칙:
//   - 배가 화면 가운데로 들어오면 항해(게임)가 시작된다.
//   - 부위가 하나씩 고장 난다(어둡게 변함). 클릭하면 그 부위가 새 판자(보색)로 교체된다.
//   - 고장 난 부위를 5초 안에 고치지 못하거나, 고장 난 부위가 3개를 넘으면 배가 가라앉는다.
//   - 30초 동안 버티면 항해 완주. 배가 오른쪽으로 떠난다.
//   - 고장은 아직 원래 판자인 부위부터 먼저 일어나므로, 완주할 즈음엔 배 대부분이 교체돼 있다.
//
// 바다:
//   - 수면 높이 = 사인 함수 4개의 합. 매 프레임 x 오프셋을 늘려 물결이 뒤로 흘러감(항해 느낌).
//   - 작은 삼각형 약 1만 개를 한 지오메트리로 그리고, 꼭짓점 높이/색만 매 프레임 갱신.
//   - 배는 수면 높이와 기울기를 따라 출렁임.
//
// 렌더링 전략 (성능):
//   - 원래 판자(intact) / 교체된 판자(repaired)는 상태별로 하나의 병합 지오메트리.
//   - 고장 난 부위는 부위마다 병합 메시 하나 (부위별로 경고 깜빡임 색을 주기 위해).
//   - 수리(뒤집기) 중인 부위만 개별 삼각형 메시로 회전 애니메이션.
//
// 사용 전제:
//   - Three.js
//   - setScene_TheseusGalley(scene) 후 (바다도 이때 만들어짐), startGame_TheseusGalley(colorHex, time)로 배 소환
//   - updateExperiment_TheseusGalley(time, deltaTime, viewHalfWidth)를 매 프레임 호출
//   - 클릭: raycaster.intersectObjects(getRaycastTargets_TheseusGalley())의
//     첫 결과를 handleRaycastHit_TheseusGalley(hit, time)에 전달
//   - getGame_TheseusGalley(time)으로 HUD에 쓸 상태를 읽음
// =========================================================

const THESEUS_GALLEY_CONFIG = {
  bigTripodCount: 2100,
  breakBatchSize: 70,        // 한 부위를 이루는 큰 트라이포드 개수
  breakTransitionDuration: 0.4,
  repairFlipDuration: 0.6,

  // 게임 규칙
  goalTime: 30,              // 이만큼 항해하면 완주
  repairLimit: 5,            // 고장 난 부위를 이 시간 안에 고쳐야 함
  maxBroken: 3,              // 동시에 고장 난 부위가 이보다 많으면 침몰
  firstBreakDelay: 1.2,      // 항해 시작 후 첫 고장까지
  breakIntervalStart: 1.7,   // 고장 간격 (처음) -> 점점 짧아짐
  breakIntervalEnd: 0.85,    // 고장 간격 (마지막)
  breakIntervalJitter: 0.35, // 간격의 무작위 폭(비율)
  sinkDuration: 2.4,

  travelSpeed: 30,
  edgeMargin: 6,
  defaultViewHalfWidth: 40,

  triangleSize: 0.45,        // 삼각형 한 변 길이

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

  warnColor: 0xff4a3a,  // 수리 시한이 다가올 때 깜빡이는 색

  onLeavingStart: null, // 완주 후 퇴장이 시작되는 순간 (회전을 정면으로 되돌리는 용도)
  onWin: null,          // 완주 후 배가 화면을 어느 정도 빠져나갔을 때
  onSunk: null,         // 침몰 애니메이션이 끝났을 때 (reason: 'timeout' | 'overload')
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
let galleyShipRoot = null;     // 배 전체를 담는 그룹
let galleyDynamicGroup = null; // 수리(뒤집기) 중인 삼각형 개별 메시
let galleyPoolMeshes = { intact: null, repaired: null }; // 정적 병합 메시

let galleyBigTripods = []; // { index, x,y,z, regionIndex }
let galleyRegions = [];    // { index, memberIndices, state, changedAt, brokenAt, mesh, fromColor, blink, dynamicMeshes }
let galleyBaseColor = new THREE.Color(0xffffff);

// 'idle' | 'entering' | 'active' | 'leaving' | 'sinking' | 'done'
let galleyShipPhase = 'idle';
let galleyTravelOffsetX = 0;
let galleyActiveStart = 0;
let galleySailed = 0;
let galleyNextBreakAt = Infinity;
let galleyPhaseStart = 0;
let galleySinkReason = null;
let galleyResult = null;       // null | 'win' | 'sink'
let galleyNotified = false;
let galleyViewHalfWidth = THESEUS_GALLEY_CONFIG.defaultViewHalfWidth;
let galleyWakeSpawnAccumulator = 0;
let galleyWakeParticles = [];

function setScene_TheseusGalley(scene) {
  galleyScene = scene;
  if (!galleySea) galleyBuildSea(scene);
}

// ---------------------------------------------------------
// 색
// ---------------------------------------------------------

function galleyStateColor(state) {
  if (state === 'repaired') return galleyGetComplementaryColor(galleyBaseColor);
  if (state === 'broken') return galleyGetBrokenColor(galleyBaseColor);
  return galleyBaseColor.clone();
}

// ---------------------------------------------------------
// 병합 지오메트리
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

function galleyDisposeMesh(mesh) {
  if (!mesh) return;
  if (mesh.parent) mesh.parent.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
}

// 원래 판자 / 교체된 판자 풀을 다시 병합 (부위 상태 기준)
function galleyRebuildPool(poolName) {
  const indices = [];
  for (const region of galleyRegions) {
    if (region.state === poolName) indices.push(...region.memberIndices);
  }
  galleyDisposeMesh(galleyPoolMeshes[poolName]);
  const mesh = galleyBuildMergedMesh(indices, galleyStateColor(poolName));
  galleyPoolMeshes[poolName] = mesh;
  if (mesh) galleyShipRoot.add(mesh);
}

// ---------------------------------------------------------
// 배 소환 (= 게임 시작)
// ---------------------------------------------------------

function galleyClearShip() {
  if (!galleyShipRoot) return;
  galleyScene.remove(galleyShipRoot);
  galleyDisposeMesh(galleyPoolMeshes.intact);
  galleyDisposeMesh(galleyPoolMeshes.repaired);
  for (const region of galleyRegions) {
    galleyDisposeMesh(region.mesh);
    if (region.dynamicMeshes) for (const m of region.dynamicMeshes) m.material.dispose();
  }
  for (const p of galleyWakeParticles) {
    galleyScene.remove(p.mesh);
    p.mesh.material.dispose();
  }
  galleyWakeParticles = [];
}

function startGame_TheseusGalley(colorHex, time) {
  const cfg = THESEUS_GALLEY_CONFIG;
  galleyClearShip();

  galleyShipRoot = new THREE.Group();
  galleyDynamicGroup = new THREE.Group();
  galleyShipRoot.add(galleyDynamicGroup);
  galleyPoolMeshes = { intact: null, repaired: null };
  galleyScene.add(galleyShipRoot);

  // 위치 샘플링은 한 번만 해두고 재사용 (다시 하기 때마다 같은 배)
  if (!startGame_TheseusGalley._positions) {
    startGame_TheseusGalley._positions = galleySampleBigTripodPositions(cfg.bigTripodCount, cfg.bigTripodSpacing);
  }
  const positions = startGame_TheseusGalley._positions;

  galleyBigTripods = positions.map((p, i) => ({ index: i, x: p.x, y: p.y, z: p.z, regionIndex: -1 }));

  // 실제 판자 구역처럼: x축(길이 방향)으로 정렬해 70개씩 묶어 공간적으로 인접한 부위를 만듦
  const sortedIndices = galleyBigTripods.map((bt) => bt.index)
    .sort((a, b) => galleyBigTripods[a].x - galleyBigTripods[b].x);
  const regionCount = Math.ceil(positions.length / cfg.breakBatchSize);
  galleyRegions = [];
  for (let r = 0; r < regionCount; r++) {
    galleyRegions.push({
      index: r, memberIndices: [], state: 'intact', changedAt: time, brokenAt: 0,
      mesh: null, fromColor: null, blink: 0, dynamicMeshes: null,
    });
  }
  for (let i = 0; i < sortedIndices.length; i++) {
    const r = Math.min(regionCount - 1, Math.floor(i / cfg.breakBatchSize));
    galleyBigTripods[sortedIndices[i]].regionIndex = r;
    galleyRegions[r].memberIndices.push(sortedIndices[i]);
  }

  galleyBaseColor = new THREE.Color(colorHex);
  galleyRebuildPool('intact');

  galleyTravelOffsetX = -(galleyViewHalfWidth + cfg.edgeMargin + cfg.hullLength / 2);
  galleyShipPhase = 'entering';
  galleySailed = 0;
  galleyNextBreakAt = Infinity;
  galleySinkReason = null;
  galleyResult = null;
  galleyNotified = false;
}

// ---------------------------------------------------------
// 부위 고장 / 수리
// ---------------------------------------------------------

function galleyIsBroken(region) {
  return region.state === 'breaking' || region.state === 'broken';
}

function galleyBreakRegion(region, time) {
  const prev = region.state; // 'intact' | 'repaired'
  region.fromColor = galleyStateColor(prev);
  region.state = 'breaking';
  region.changedAt = time;
  region.brokenAt = time;
  region.blink = 0;
  galleyRebuildPool(prev);
  region.mesh = galleyBuildMergedMesh(region.memberIndices, region.fromColor);
  galleyShipRoot.add(region.mesh);
}

function galleyRepairRegion(region, time) {
  galleyDisposeMesh(region.mesh);
  region.mesh = null;
  region.state = 'repairing';
  region.changedAt = time;
  region.dynamicMeshes = [];
  const brokenColor = galleyStateColor('broken');
  for (const idx of region.memberIndices) {
    const bt = galleyBigTripods[idx];
    for (const tri of BIG_TRIPOD_LOCAL_TRIANGLES) {
      const material = new THREE.MeshBasicMaterial({ color: brokenColor, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(THESEUS_GALLEY_TRIANGLE_GEOMETRY, material);
      mesh.position.set(bt.x + tri.dx, bt.y + tri.dy, bt.z);
      mesh.rotation.z = tri.rot;
      mesh.userData.bigTripodIndex = bt.index;
      galleyDynamicGroup.add(mesh);
      region.dynamicMeshes.push(mesh);
    }
  }
}

function galleyFinishRepair(region) {
  for (const mesh of region.dynamicMeshes) {
    galleyDynamicGroup.remove(mesh);
    mesh.material.dispose();
  }
  region.dynamicMeshes = null;
  region.state = 'repaired';
  galleyRebuildPool('repaired');
}

// 다음에 고장 낼 부위: 아직 원래 판자인 부위를 우선, 없으면 교체된 부위 중에서
function galleyPickRegionToBreak() {
  let pool = galleyRegions.filter((r) => r.state === 'intact');
  if (pool.length === 0) pool = galleyRegions.filter((r) => r.state === 'repaired');
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---------------------------------------------------------
// 레이캐스트 대상 / 클릭 처리
// ---------------------------------------------------------

function getRaycastTargets_TheseusGalley() {
  const targets = [];
  if (galleyPoolMeshes.intact) targets.push(galleyPoolMeshes.intact);
  if (galleyPoolMeshes.repaired) targets.push(galleyPoolMeshes.repaired);
  for (const region of galleyRegions) if (region.mesh) targets.push(region.mesh);
  if (galleyDynamicGroup) targets.push(...galleyDynamicGroup.children);
  return targets;
}

function getShipRoot_TheseusGalley() {
  return galleyShipRoot;
}

// 반환: 'repaired' (수리함) | 'miss' (고장 안 난 곳) | 'none' (게임 중 아님)
function handleRaycastHit_TheseusGalley(intersection, time) {
  if (!intersection || galleyShipPhase !== 'active') return 'none';
  const obj = intersection.object;
  let idx = null;
  if (obj.userData && obj.userData.bigTripodIndex != null) {
    idx = obj.userData.bigTripodIndex;
  } else if (obj.userData && obj.userData.faceToBigTripodIndex) {
    idx = obj.userData.faceToBigTripodIndex[intersection.faceIndex];
  }
  if (idx == null) return 'miss';
  const bt = galleyBigTripods[idx];
  const region = bt && galleyRegions[bt.regionIndex];
  if (!region || !galleyIsBroken(region)) return 'miss';
  galleyRepairRegion(region, time); // 부위 전체를 한꺼번에 새 판자로 교체
  return 'repaired';
}

// ---------------------------------------------------------
// HUD용 상태
// ---------------------------------------------------------

function getGame_TheseusGalley(time) {
  const cfg = THESEUS_GALLEY_CONFIG;
  let broken = 0;
  let minLeft = Infinity;
  let replaced = 0;
  for (const region of galleyRegions) {
    if (galleyIsBroken(region)) {
      broken++;
      minLeft = Math.min(minLeft, cfg.repairLimit - (time - region.brokenAt));
    }
    if (region.state === 'repaired' || region.state === 'repairing') replaced++;
  }
  return {
    phase: galleyShipPhase,
    sailed: galleySailed,
    goal: cfg.goalTime,
    broken,
    maxBroken: cfg.maxBroken,
    minLeft: broken ? Math.max(0, minLeft) : null,
    replaced,
    regionCount: galleyRegions.length,
    result: galleyResult,
    sinkReason: galleySinkReason,
  };
}

// ---------------------------------------------------------
// 파도(웨이크) 파티클
// ---------------------------------------------------------

function galleyLocalToWorld(x, y, z) {
  galleyShipRoot.updateMatrixWorld();
  return galleyShipRoot.localToWorld(new THREE.Vector3(x, y, z));
}

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

// 뱃머리 부근 선체 단면 위에서 파티클을 흩뿌림 (항해 중에는 계속)
function galleyEmitWake(time, deltaTime) {
  const cfg = THESEUS_GALLEY_CONFIG;
  if (galleyShipPhase !== 'entering' && galleyShipPhase !== 'active' && galleyShipPhase !== 'leaving') return;

  galleyWakeSpawnAccumulator += deltaTime;
  const interval = galleyShipPhase === 'active' ? cfg.wakeSpawnInterval * 1.6 : cfg.wakeSpawnInterval;
  if (galleyWakeSpawnAccumulator < interval) return;
  galleyWakeSpawnAccumulator = 0;

  const wakeColor = galleyBaseColor;
  const halfL = cfg.hullLength / 2;
  const count = 1 + (Math.random() < 0.5 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const u = 0.72 + Math.random() * 0.26;
    const taper = galleyHullTaperAt(u);
    const hHalf = (cfg.hullHeight / 2) * taper;
    const wHalf = (cfg.hullWidth / 2) * taper;
    const theta = Math.random() * Math.PI * 2;
    const ny = Math.sin(theta);
    const nz = Math.cos(theta);
    const worldPos = galleyLocalToWorld(u * halfL, ny * hHalf, nz * wHalf);
    const speed = cfg.wakeParticleSpeedMin + Math.random() * (cfg.wakeParticleSpeedMax - cfg.wakeParticleSpeedMin);
    const outward = galleyLocalDirToWorld(0, ny, nz);
    const backward = galleyLocalDirToWorld(-1, 0, 0);
    const back = galleyShipPhase === 'active' ? 10 + Math.random() * 6 : 2 + Math.random() * 2; // 제자리 항해 중엔 뒤로 더 흘러감
    const worldVel = new THREE.Vector3().addScaledVector(outward, speed).addScaledVector(backward, back);
    galleySpawnWakeParticle(worldPos, worldVel, wakeColor, time);
  }
}

// ---------------------------------------------------------
// 바다 (삼각형 파티클로 된 수면)
// -----------------------------------------------------------
// 높이 = 사인 함수 몇 개의 합. 매 프레임 x축 오프셋(galleySeaOffset)을 늘려
// 물결 무늬가 배 뒤쪽(-x)으로 흘러가게 해서, 배가 앞으로 나아가는 느낌을 줌.
// 삼각형 하나하나의 세 꼭짓점이 각각 수면 높이를 따라가므로 매끄럽게 출렁임.
// ---------------------------------------------------------

const GALLEY_SEA_CONFIG = {
  level: -4,            // 평균 수면 높이 (선체 중심 y=0 기준, 아랫부분이 잠김)
  zNear: 108,           // 카메라 쪽 끝 (카메라 z=130, 화면 아래 끝까지 덮음)
  zFar: -170,           // 먼 쪽 끝
  cameraZ: 130,
  halfFovTan: Math.tan((55 * Math.PI / 180) / 2),
  maxAspect: 2.4,       // 이 화면비까지는 가로 끝이 보이지 않게 채움
  spacingNear: 2.3,     // 삼각형 간격 (가까운 곳)
  spacingGrow: 0.011,   // 멀어질수록 간격이 넓어지는 비율
  triScale: 0.62,       // 간격 대비 삼각형 크기 (1보다 작아야 틈이 보임)

  // 물결 (진폭, 파수, 시간 진동)
  waves: [
    { a: 1.15, kx: 0.075, kz: 0.018, w: 0.9 },
    { a: 0.55, kx: 0.16,  kz: -0.06, w: 1.6 },
    { a: 0.30, kx: 0.05,  kz: 0.11,  w: 0.6 },
    { a: 0.18, kx: 0.31,  kz: 0.13,  w: 2.4 },
  ],

  sailSpeed: 16,        // 항해 중 물결이 뒤로 흐르는 속도 (x 오프셋 증가량/초)
  driftSpeed: 3,        // 배가 들어오거나 나갈 때(배 자체가 움직임)

  deepColor: 0x163150,
  crestColor: 0x7fa6c4,
  bgColor: 0x10131a,    // 페이지 배경색 (멀리/가장자리에서 이 색으로 녹아듦)
};

let galleySea = null;       // THREE.Mesh
let galleySeaBase = null;   // 각 꼭짓점의 기준 (x, z) 및 색 정보
let galleySeaOffset = 0;

function galleySeaHeight(x, z, time) {
  const cfg = GALLEY_SEA_CONFIG;
  const px = x + galleySeaOffset;
  let h = 0;
  for (const wv of cfg.waves) h += wv.a * Math.sin(px * wv.kx + z * wv.kz + time * wv.w);
  return cfg.level + h;
}

function galleyBuildSea(scene) {
  const cfg = GALLEY_SEA_CONFIG;
  const verts = [];   // 기준 x, z (꼭짓점마다)
  const fades = [];   // 배경색으로 녹아드는 정도 (꼭짓점마다)

  let z = cfg.zNear;
  let row = 0;
  while (z > cfg.zFar) {
    const depth = cfg.cameraZ - z;
    const spacing = cfg.spacingNear + depth * cfg.spacingGrow;
    const halfW = cfg.halfFovTan * depth * cfg.maxAspect + spacing * 2;
    const size = spacing * cfg.triScale;
    const r = size / Math.sqrt(3); // 정삼각형 외접원 반지름
    const farFade = Math.max(0, Math.min(1, (cfg.zNear - z) / (cfg.zNear - cfg.zFar)));
    const xShift = (row % 2) * spacing * 0.5; // 줄마다 반 칸 어긋나게
    for (let x = -halfW + xShift; x <= halfW; x += spacing) {
      const jx = (Math.random() - 0.5) * spacing * 0.25;
      const jz = (Math.random() - 0.5) * spacing * 0.25;
      const rot = Math.random() * Math.PI * 2;
      const edgeFade = Math.max(0, (Math.abs(x) / halfW - 0.8) / 0.2); // 좌우 끝 20%에서 녹아듦
      const fade = Math.min(1, farFade * farFade * 0.9 + edgeFade);
      for (let k = 0; k < 3; k++) {
        const ang = rot + k * (Math.PI * 2 / 3);
        verts.push(x + jx + Math.cos(ang) * r, z + jz + Math.sin(ang) * r);
        fades.push(fade);
      }
    }
    z -= spacing * 0.866;
    row++;
  }

  const n = verts.length / 2;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const geometry = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  if (posAttr.setUsage) { posAttr.setUsage(THREE.DynamicDrawUsage); colAttr.setUsage(THREE.DynamicDrawUsage); }
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('color', colAttr);

  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  galleySea = new THREE.Mesh(geometry, material);
  galleySea.frustumCulled = false; // 꼭짓점이 매 프레임 움직이므로 경계 계산 생략
  galleySea.renderOrder = -1;
  scene.add(galleySea);

  // 성능: sin(공간항 + 시간항) = sin(공간)cos(시간) + cos(공간)sin(시간)
  // 공간항(꼭짓점마다 고정)의 sin/cos를 미리 계산해두면 매 프레임 삼각함수 호출이 물결 개수만큼만 필요
  const W = cfg.waves.length;
  const sinP = new Float32Array(n * W), cosP = new Float32Array(n * W);
  for (let i = 0; i < n; i++) {
    for (let w = 0; w < W; w++) {
      const ph = verts[i * 2] * cfg.waves[w].kx + verts[i * 2 + 1] * cfg.waves[w].kz;
      sinP[i * W + w] = Math.sin(ph);
      cosP[i * W + w] = Math.cos(ph);
    }
  }

  galleySeaBase = {
    sinP, cosP,
    xz: new Float32Array(verts),
    fade: new Float32Array(fades),
    count: n,
    deep: new THREE.Color(cfg.deepColor),
    crest: new THREE.Color(cfg.crestColor),
    bg: new THREE.Color(cfg.bgColor),
  };
  galleyUpdateSea(0, 0);
}

function galleyUpdateSea(time, deltaTime) {
  if (!galleySea) return;
  const cfg = GALLEY_SEA_CONFIG;

  // 프레임마다 x 오프셋을 늘려 물결이 흘러가게 함
  const sailing = galleyShipPhase === 'active';
  galleySeaOffset += (sailing ? cfg.sailSpeed : cfg.driftSpeed) * deltaTime;

  const b = galleySeaBase;
  const pos = galleySea.geometry.attributes.position.array;
  const col = galleySea.geometry.attributes.color.array;
  let amp = 0;
  for (const wv of cfg.waves) amp += wv.a;

  // 이번 프레임의 시간항 (x 오프셋 + 시간 진동) -> 물결마다 sin/cos 한 번씩
  const W = cfg.waves.length;
  const ampS = new Float32Array(W), ampC = new Float32Array(W);
  for (let w = 0; w < W; w++) {
    const wv = cfg.waves[w];
    const c = galleySeaOffset * wv.kx + time * wv.w;
    ampS[w] = wv.a * Math.cos(c); // sin(p)에 곱할 값
    ampC[w] = wv.a * Math.sin(c); // cos(p)에 곱할 값
  }
  const sinP = b.sinP, cosP = b.cosP;

  for (let i = 0; i < b.count; i++) {
    const x = b.xz[i * 2], z = b.xz[i * 2 + 1];
    let y = cfg.level;
    for (let w = 0, k = i * W; w < W; w++, k++) y += sinP[k] * ampS[w] + cosP[k] * ampC[w];
    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;

    // 높을수록(물마루) 밝게, 멀리/가장자리일수록 배경색으로
    const t = Math.max(0, Math.min(1, ((y - cfg.level) / amp) * 0.5 + 0.5));
    const tt = t * t;
    let r = b.deep.r + (b.crest.r - b.deep.r) * tt;
    let g = b.deep.g + (b.crest.g - b.deep.g) * tt;
    let bl = b.deep.b + (b.crest.b - b.deep.b) * tt;
    const f = b.fade[i];
    col[i * 3] = r + (b.bg.r - r) * f;
    col[i * 3 + 1] = g + (b.bg.g - g) * f;
    col[i * 3 + 2] = bl + (b.bg.b - bl) * f;
  }
  galleySea.geometry.attributes.position.needsUpdate = true;
  galleySea.geometry.attributes.color.needsUpdate = true;
}

// 배가 물결을 타도록: 배 중심의 수면 높이와 앞뒤 기울기
function galleyShipOnSea(time, shipX) {
  const cfg = THESEUS_GALLEY_CONFIG;
  const half = cfg.hullLength * 0.35;
  const lv = GALLEY_SEA_CONFIG.level;
  const hc = galleySeaHeight(shipX, 0, time) - lv;
  const hBow = galleySeaHeight(shipX + half, 0, time) - lv;
  const hStern = galleySeaHeight(shipX - half, 0, time) - lv;
  return {
    y: hc * 0.6 + (hBow + hStern) * 0.2,           // 선체가 길어서 물결을 평균적으로 탐
    pitch: Math.atan2(hBow - hStern, half * 2) * 0.8, // 앞뒤로 살짝 기울어짐
  };
}

// ---------------------------------------------------------
// 매 프레임 업데이트
// ---------------------------------------------------------

function galleyStartSinking(reason, time) {
  galleyShipPhase = 'sinking';
  galleySinkReason = reason;
  galleyPhaseStart = time;
}

function updateExperiment_TheseusGalley(time, deltaTime, viewHalfWidth) {
  const cfg = THESEUS_GALLEY_CONFIG;
  if (typeof viewHalfWidth === 'number' && viewHalfWidth > 0) galleyViewHalfWidth = viewHalfWidth;
  galleyUpdateSea(time, deltaTime);
  if (!galleyShipRoot) return;

  const halfLength = cfg.hullLength / 2;
  // 배는 바다 물결을 따라 오르내리고 앞뒤로 기울어짐
  const ride = galleyShipOnSea(time, galleyTravelOffsetX);
  let bobY = ride.y;
  let rollZ = ride.pitch;

  if (galleyShipPhase === 'entering') {
    galleyTravelOffsetX += cfg.travelSpeed * deltaTime;
    if (galleyTravelOffsetX >= 0) {
      galleyTravelOffsetX = 0;
      galleyShipPhase = 'active';
      galleyActiveStart = time;
      galleyNextBreakAt = time + cfg.firstBreakDelay;
    }
  } else if (galleyShipPhase === 'active') {
    galleySailed = Math.min(cfg.goalTime, time - galleyActiveStart);

    // 새 고장
    if (time >= galleyNextBreakAt) {
      const region = galleyPickRegionToBreak();
      if (region) galleyBreakRegion(region, time);
      const k = galleySailed / cfg.goalTime;
      const base = cfg.breakIntervalStart + (cfg.breakIntervalEnd - cfg.breakIntervalStart) * k;
      galleyNextBreakAt = time + base * (1 - cfg.breakIntervalJitter / 2 + Math.random() * cfg.breakIntervalJitter);
    }

    // 실패 판정
    let broken = 0;
    let expired = false;
    for (const region of galleyRegions) {
      if (!galleyIsBroken(region)) continue;
      broken++;
      if (time - region.brokenAt >= cfg.repairLimit) expired = true;
    }
    if (broken > cfg.maxBroken) galleyStartSinking('overload', time);
    else if (expired) galleyStartSinking('timeout', time);
    else if (galleySailed >= cfg.goalTime) {
      // 완주
      galleyShipPhase = 'leaving';
      galleyPhaseStart = time;
      galleyResult = 'win';
      if (typeof cfg.onLeavingStart === 'function') cfg.onLeavingStart();
    }
  } else if (galleyShipPhase === 'leaving') {
    galleyTravelOffsetX += cfg.travelSpeed * deltaTime;
    const leftEdgeX = -halfLength + galleyTravelOffsetX;
    if (!galleyNotified && (leftEdgeX > galleyViewHalfWidth * 0.2 || time - galleyPhaseStart > 3)) {
      galleyNotified = true;
      if (typeof cfg.onWin === 'function') cfg.onWin();
    }
    if (leftEdgeX > galleyViewHalfWidth + cfg.edgeMargin) galleyShipPhase = 'done';
  } else if (galleyShipPhase === 'sinking') {
    const t = Math.min(1, (time - galleyPhaseStart) / cfg.sinkDuration);
    bobY = ride.y - 55 * t * t;
    rollZ = ride.pitch * (1 - t) - 0.32 * galleyEaseOutCubic(t);
    if (t >= 1 && !galleyNotified) {
      galleyNotified = true;
      galleyResult = 'sink';
      galleyShipPhase = 'done';
      galleyShipRoot.visible = false;
      if (typeof cfg.onSunk === 'function') cfg.onSunk(galleySinkReason);
    }
  }

  // 부위 애니메이션
  const brokenColor = galleyStateColor('broken');
  const repairedColor = galleyStateColor('repaired');
  const warn = new THREE.Color(cfg.warnColor);
  for (const region of galleyRegions) {
    if (region.state === 'breaking') {
      const p = Math.min(1, (time - region.changedAt) / cfg.breakTransitionDuration);
      region.mesh.material.color.copy(region.fromColor).lerp(brokenColor, galleyEaseOutCubic(p));
      if (p >= 1) region.state = 'broken';
    } else if (region.state === 'broken') {
      // 수리 시한이 다가올수록 경고색으로 점점 빠르게 깜빡임
      const urgency = Math.min(1, Math.max(0, (time - region.brokenAt) / cfg.repairLimit));
      region.blink += deltaTime * (2.5 + 14 * urgency);
      const w = (0.5 + 0.5 * Math.sin(region.blink * Math.PI)) * (0.25 + 0.75 * urgency);
      region.mesh.material.color.copy(brokenColor).lerp(warn, galleyShipPhase === 'active' ? w : 0);
    } else if (region.state === 'repairing') {
      const p = Math.min(1, (time - region.changedAt) / cfg.repairFlipDuration);
      const color = p < 0.5 ? brokenColor : repairedColor;
      for (const mesh of region.dynamicMeshes) {
        mesh.rotation.y = p * Math.PI;
        mesh.material.color.copy(color);
      }
      if (p >= 1) galleyFinishRepair(region);
    }
  }

  galleyShipRoot.position.x = galleyTravelOffsetX;
  galleyShipRoot.position.y = bobY;
  galleyShipRoot.rotation.z = rollZ;

  galleyEmitWake(time, deltaTime);
  galleyUpdateWakeParticles(time, deltaTime);
}
