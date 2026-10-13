// =========================================================
// 사고실험 02. 볼츠만 두뇌 - 3D 형태화
// -----------------------------------------------------------
// 구조:
//   1) 초기 화면: 작은 삼각형들이 "뇌 신경 회로" 구조(신경 다발, 방사형으로 퍼지는 가지)로
//      뇌 모양의 3D 공간을 최소 간격을 두고 채움 (위치 생성은 boltzmann-brain-shape.js)
//      - 색상 그룹(껍질/잔 섬유/다발별 색)마다 병합된 정적 지오메트리 1개씩으로 그림
//   2) 클릭: 클릭한 레이가 뇌 볼륨을 지나는 구간의 한가운데를 중심으로 구형 "진공 포켓"을 만듦
//      - 그 구 안의 앰비언트 삼각형은 사라짐 (진공/열죽음 상태로 전환)
//      - 그 구는 독립된 볼츠만 두뇌 시뮬레이터(boltzmann-brain.js)를 하나 가짐
//   3) 포켓 내부: 시뮬레이터가 만들어내는 사건마다, 에너지 크기에 따라
//      프랙탈 깊이가 다른 삼각형 뭉치가 포켓 안 임의 위치에 나타났다 사라짐
//
// 에너지 -> 프랙탈 깊이 매핑 (E0=1, brainEnergyScale=6 기준):
//   energy <  1.5 : 삼각형 1개
//   1.5 ~ 3       : 트라이포드(3개)
//   3   ~ 6       : 큰 트라이포드(12개)
//   6 이상(브레인) : 초대형 트라이포드(48개)
//
// [연출 참고] 물리 모델 그대로면 에너지가 클수록 수명(Δt)이 극히 짧아져(수십ms
// 단위) 눈에 보이지도 않고 사라진다. 그래서 화면 표시 지속시간은
// max(최소표시시간, 모델수명 × 배율) 로 늘려서 보여준다 - "클수록 짧게 산다"는
// 경향은 유지하되 인지 가능한 범위로 늘리는 절충안.
//
// 사용 전제:
//   - Three.js, boltzmann-brain.js(createBoltzmannBrainSimulator),
//     boltzmann-brain-shape.js(bbGenerateBrainPoints 등)가 먼저 로드됨
//   - updateExperiment_BoltzmannBrain(time, deltaTime)를 매 프레임 호출
//   - 클릭 시: findPocketCenterFromRay_BoltzmannBrain(raycaster.ray)로 포켓 중심(월드 좌표)을
//     구하고(뇌 밖이면 null), spawnVacuumPocket_BoltzmannBrain(point, time) 호출
// =========================================================

const BB_SCENE_CONFIG = {
  // 앰비언트(뇌 모양) 삼각형
  ambientTriangleSize: 0.35,
  ambientMinSpacing: 1.0,   // "3px" 요청을 world 단위로 근사한 값 (카메라 세팅에 따라 체감 픽셀 간격이 달라짐)
  ambientMaxCount: 14000,   // 안전 상한 (실제로는 뇌 모양/신경 구조가 채워지는 만큼만 생성됨)
  ambientOpacity: 0.85,
  // 색상 그룹별 색: [0]=피질 껍질, [1]=잔 섬유, [2~6]=신경 다발별 색
  // (하나의 색으로 통일하고 싶으면 배열을 모두 같은 값으로 바꾸면 됨)
  ambientPalette: [0x2a5aa0, 0x3b4d6b, 0x4c8dff, 0x2fc4d8, 0x7a6bff, 0x3fd1a0, 0xd06ad0],

  fractalTriangleSize: 0.5,

  vacuumRadius: 15,   // 진공 포켓 반경 (기존 10에서 50% 증가)

  // 에너지 문턱 (E0=1, brainEnergyScale=6 기준)
  tier1Threshold: 1.5, // 이상이면 트라이포드
  tier2Threshold: 3,   // 이상이면 큰 트라이포드
  // 6 이상(brainEnergyScale)은 boltzmann-brain.js의 isBrainEvent로 판정 -> 초대형 트라이포드

  minDisplayLifetime: 0.6, // 화면에 보이는 최소 지속시간(초)
  lifetimeDisplayScale: 3, // 모델 수명에 곱하는 배율

  normalStructColor: 0xeaeaea,// 보통 에너지 사건 색
  brainStructColor: 0xffd27a, // 볼츠만 두뇌급 사건 색 (눈에 띄게)
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

function bbPickFractalUnit(energy, isBrainEvent) {
  const cfg = BB_SCENE_CONFIG;
  if (isBrainEvent) return BB_FRACTAL_UNITS[3];
  if (energy >= cfg.tier2Threshold) return BB_FRACTAL_UNITS[2];
  if (energy >= cfg.tier1Threshold) return BB_FRACTAL_UNITS[1];
  return BB_FRACTAL_UNITS[0];
}

// ---------------------------------------------------------
// 앰비언트 필드 (초기 화면을 덮는 작은 삼각형들)
// ---------------------------------------------------------

let bbScene = null;
let bbSceneRoot = null;   // 원점(0,0,0) 기준 회전을 위해 앰비언트+포켓을 담는 그룹
let bbAmbientMeshes = []; // 색상 그룹별 병합 메시
let bbAmbientPoints = []; // { x, y, z, alive, g }  (g: 색상 그룹 번호)
let bbPockets = [];       // { center: THREE.Vector3, radius, simulator, group, structures: [] }

// 살아있는 점들을 색상 그룹별로 모아 병합 메시를 다시 만든다 (진공화로 점이 사라질 때마다 호출)
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
  const localVerts = BB_AMBIENT_GEOMETRY.attributes.position.array; // 9 floats

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
    geometry.computeVertexNormals();

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

function getAmbientMeshes_BoltzmannBrain() {
  return bbAmbientMeshes;
}

// 화면 클릭(레이) -> 진공 포켓 중심(월드 좌표).
// 레이가 뇌 볼륨을 관통하는 구간의 한가운데를 쓴다. 공간을 회전시켜 놓은 상태에서도,
// 삼각형에 정확히 맞지 않아도(점들이 듬성해도) 항상 일관되게 동작한다.
// 레이가 뇌 볼륨을 지나지 않으면(= 범위 밖 클릭) null.
function findPocketCenterFromRay_BoltzmannBrain(worldRay) {
  bbSceneRoot.updateMatrixWorld();
  const inv = new THREE.Matrix4().copy(bbSceneRoot.matrixWorld).invert();
  const o = worldRay.origin.clone().applyMatrix4(inv);
  const d = worldRay.direction.clone().transformDirection(inv); // 방향만 변환 + 정규화

  const tMid = -o.dot(d); // 레이가 로컬 원점에 가장 가까워지는 지점
  const step = 0.5;
  const half = 60;
  const insideTs = [];
  for (let t = tMid - half; t <= tMid + half; t += step) {
    if (bbBrainFieldRaw(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t) <= 1.0) insideTs.push(t);
  }
  if (insideTs.length === 0) return null;

  const target = (insideTs[0] + insideTs[insideTs.length - 1]) / 2;
  let best = insideTs[0];
  let bestGap = Infinity;
  for (const t of insideTs) {
    const gap = Math.abs(t - target);
    if (gap < bestGap) { bestGap = gap; best = t; }
  }
  const local = new THREE.Vector3(o.x + d.x * best, o.y + d.y * best, o.z + d.z * best);
  return bbSceneRoot.localToWorld(local);
}

// 마우스 드래그로 공간 전체를 회전시키는 인터랙션 등에서 사용
// (0,0,0을 중심으로 회전하도록, 그룹 자체는 원점에서 이동하지 않음)
function getSceneRoot_BoltzmannBrain() {
  return bbSceneRoot;
}

// ---------------------------------------------------------
// 초기화
// ---------------------------------------------------------

function initExperiment_BoltzmannBrain(scene, time) {
  bbScene = scene;
  bbPockets = [];
  bbSceneRoot = new THREE.Group(); // 원점(0,0,0) 기준 회전을 위한 루트
  bbScene.add(bbSceneRoot);
  // 뇌 모양 + 신경 회로 구조로 앰비언트 점 생성 (boltzmann-brain-shape.js)
  bbAmbientPoints = bbGenerateBrainPoints(BB_SCENE_CONFIG.ambientMaxCount, BB_SCENE_CONFIG.ambientMinSpacing);
  bbBuildAmbientMeshes();
}

// ---------------------------------------------------------
// 클릭 -> 진공 포켓 생성
// ---------------------------------------------------------

// point는 월드 좌표로 받되(레이캐스트 결과가 항상 월드 좌표이므로),
// 내부적으로는 회전 가능한 bbSceneRoot의 로컬 좌표로 변환해서 사용한다.
function spawnVacuumPocket_BoltzmannBrain(worldPoint, time) {
  const cfg = BB_SCENE_CONFIG;
  bbSceneRoot.updateMatrixWorld();
  const center = bbSceneRoot.worldToLocal(worldPoint.clone());

  // 뇌 볼륨 범위 밖이면 진공 포켓을 만들지 않음
  if (!bbIsInsideBrainVolume(center.x, center.y, center.z)) {
    return false;
  }

  const r2 = cfg.vacuumRadius * cfg.vacuumRadius;

  // 반경 안의 앰비언트 삼각형 제거 (진공화)
  let removedAny = false;
  for (const p of bbAmbientPoints) {
    if (!p.alive) continue;
    const dx = p.x - center.x, dy = p.y - center.y, dz = p.z - center.z;
    if (dx * dx + dy * dy + dz * dz <= r2) {
      p.alive = false;
      removedAny = true;
    }
  }
  if (removedAny) bbBuildAmbientMeshes();

  const simulator = createBoltzmannBrainSimulator();
  simulator.reset(time);

  const group = new THREE.Group();
  bbSceneRoot.add(group);

  bbPockets.push({
    center,
    radius: cfg.vacuumRadius,
    simulator,
    group,
    structures: [], // { meshes: [...], expiresAt, spawnTime, energy, isBrainEvent }
  });

  return true;
}

// ---------------------------------------------------------
// 포켓 내부 사건 -> 프랙탈 구조 생성/소멸
// ---------------------------------------------------------

function bbRandomPointInSphere(center, radius) {
  // 균등하지는 않지만(반경 방향으로 살짝 중심 쪽에 몰림), 시각적으로는 충분함
  const u = Math.random();
  const r = radius * 0.85 * Math.cbrt(u);
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  return new THREE.Vector3(
    center.x + r * Math.sin(phi) * Math.cos(theta),
    center.y + r * Math.sin(phi) * Math.sin(theta),
    center.z + r * Math.cos(phi)
  );
}

function bbSpawnStructureForEvent(pocket, event, time) {
  const cfg = BB_SCENE_CONFIG;
  const unit = bbPickFractalUnit(event.energy, event.isBrainEvent);
  const color = event.isBrainEvent ? cfg.brainStructColor : cfg.normalStructColor;
  const pos = bbRandomPointInSphere(pocket.center, pocket.radius);
  const rotZBase = Math.random() * Math.PI * 2;

  const meshes = [];
  for (const off of unit.offsets) {
    const material = new THREE.MeshBasicMaterial({
      color, side: THREE.DoubleSide, transparent: true, opacity: 0,
    });
    const mesh = new THREE.Mesh(BB_FRACTAL_GEOMETRY, material);
    const cos = Math.cos(rotZBase), sin = Math.sin(rotZBase);
    const rx = off.dx * cos - off.dy * sin;
    const ry = off.dx * sin + off.dy * cos;
    mesh.position.set(pos.x + rx, pos.y + ry, pos.z);
    mesh.rotation.z = off.rot + rotZBase;
    pocket.group.add(mesh);
    meshes.push(mesh);
  }

  const displayLifetime = Math.max(cfg.minDisplayLifetime, event.lifetime * cfg.lifetimeDisplayScale);

  pocket.structures.push({
    meshes,
    spawnTime: time,
    displayLifetime,
    expiresAt: time + displayLifetime,
  });
}

// ---------------------------------------------------------
// 매 프레임 업데이트
// ---------------------------------------------------------

function updateExperiment_BoltzmannBrain(time, deltaTime) {
  for (const pocket of bbPockets) {
    const newEvents = pocket.simulator.update(time, deltaTime);
    for (const event of newEvents) {
      bbSpawnStructureForEvent(pocket, event, time);
    }

    for (let i = pocket.structures.length - 1; i >= 0; i--) {
      const s = pocket.structures[i];
      const age = time - s.spawnTime;
      const t = Math.min(1, age / s.displayLifetime);

      // 페이드 인(앞 15%) / 페이드 아웃(뒤 15%), 은은한 회전
      let opacity;
      if (t < 0.15) opacity = t / 0.15;
      else if (t > 0.85) opacity = (1 - t) / 0.15;
      else opacity = 1;

      for (const mesh of s.meshes) {
        mesh.material.opacity = opacity;
        mesh.rotation.z += deltaTime * 0.6;
      }

      if (time >= s.expiresAt) {
        for (const mesh of s.meshes) {
          pocket.group.remove(mesh);
          mesh.material.dispose();
        }
        pocket.structures.splice(i, 1);
      }
    }
  }
}
