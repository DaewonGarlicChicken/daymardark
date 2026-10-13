// =========================================================
// 사고실험 003. 중국어 방 (Chinese Room) - 장면/애니메이션
// -----------------------------------------------------------
// 필요: Three.js(전역 THREE), chinese-room-shape.js
//
// 구성
//  - 왼쪽: 18색 큰 트라이포드(삼각형 12개) 세로 일렬
//  - 오른쪽: 안구 + 시신경 (삼각형 15,000개, 정점 색으로 물들임)
//  - 클릭 -> 트라이포드가 날아가 안구로 빨려 들어감(12조각이 흩어져 녹아듦)
//         -> 안구가 같은 색으로 앞(각막)에서 뒤(시신경 끝)까지 물듦
//         -> 색이 다시 시신경 끝 쪽으로 빠져나감
//         -> 시신경 끝에서 나무 줄기(삼각형 150~300개, 매번 랜덤)가 자라남
//
// 공개 함수
//  initExperiment_ChineseRoom(scene, time)
//  updateExperiment_ChineseRoom(time, deltaTime)
//  getPickables_ChineseRoom()            -> 클릭 가능한 오브젝트 배열
//  handleRaycastHit_ChineseRoom(hit, time) -> 사이클 시작하면 true
//  setHover_ChineseRoom(object|null)
//  isBusy_ChineseRoom() / getStatus_ChineseRoom()
//  setSpaceRotation_ChineseRoom(rotX, rotY) -> 눈 구조물·나무 회전(원점 기준)
//  getCameraFit_ChineseRoom(aspect, fovDeg) -> {x, y, z} 카메라 위치(항상 (x,y,0)을 바라봄)
// =========================================================

const CR_TIMING = {
  flight: 1.6,            // 트라이포드가 눈 앞까지 날아가는 시간
  absorbDuration: 1.7,    // 12조각이 눈으로 빨려 들어가는 시간
  tintDelay: 0.5,         // 흡수 시작 후 물들기 시작까지
  tintDuration: 6.0,      // 눈이 완전히 물드는 데 걸리는 시간
  hold: 1.2,              // 완전히 물든 채 머무는 시간
  drainDuration: 4.5,     // 색이 빠져나가는 시간
  treeStartFrac: 0.55,    // 빠져나가는 중 이 비율 지점에서 나무가 자라기 시작
  treeDuration: 5.5,      // 나무가 다 자라는 데 걸리는 시간
  soft: 0.3,              // 물드는 경계(파동 앞면)의 부드러움
  respawnDuration: 1.0,   // 사라진 트라이포드가 제자리에 다시 나타나는 시간
};

const CR_LAYOUT = {
  tripodCount: 18,
  tripodTriangleSize: 0.85,
  columnX: -52,
  columnSpacing: 3.4,
  eyeX: -4,
  eyeRotY: 0.45,         // 각막이 카메라 쪽으로 살짝 돌아 있음
};

const CR_EYE_PART_COLORS = [
  [0.80, 0.78, 0.74], // SCLERA
  [0.55, 0.72, 0.85], // CORNEA
  [0.45, 0.32, 0.22], // IRIS
  [0.75, 0.85, 0.95], // LENS
  [0.70, 0.28, 0.25], // RETINA
  [0.86, 0.80, 0.62], // NERVE
];

let crRoot = null;
let crSpace = null;   // 눈 구조물 + 나무만 담은 그룹 (좌클릭 드래그로 회전, 트라이포드 열은 제외)
let crEyeRoot = null;
let crEye = null;
let crTree = null;    // 현재(가장 최근) 나무
let crTrees = [];     // 지금까지 자란 모든 나무 (사라지지 않고 계속 유지)
let crTripods = [];
let crParticles = [];
let crHoverIndex = -1;
let crPrevTime = 0;
let crState = { phase: 'idle', index: -1, t0: 0, times: null, color: new THREE.Color(1, 1, 1), treeGenerated: false };

function crClamp01(x) { return Math.min(1, Math.max(0, x)); }
function crSmooth(x) { x = crClamp01(x); return x * x * (3 - 2 * x); }
function crEaseInOutCubic(x) { x = crClamp01(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }

// ---------------------------------------------------------
// 초기화
// ---------------------------------------------------------
function initExperiment_ChineseRoom(scene, time) {
  crRoot = new THREE.Group();
  scene.add(crRoot);
  crSpace = new THREE.Group();
  crRoot.add(crSpace);
  crPrevTime = time || 0;

  crBuildTripods();
  crBuildEye();
  crBuildParticles();
  crUpdateEyeColors(0, 0, true);
  crRoot.updateMatrixWorld(true);
}

function crBuildTripods() {
  const s = CR_LAYOUT.tripodTriangleSize;
  const r1 = s / Math.sqrt(3);
  const offsets = crGenerateTripodOffsets(s);

  const positions = new Float32Array(offsets.length * 9);
  const colors = new Float32Array(offsets.length * 9);
  offsets.forEach((o, i) => {
    const dir = o.flip ? -1 : 1;
    const v = [
      [o.x, o.y + dir * r1],
      [o.x - s / 2, o.y - dir * r1 / 2],
      [o.x + s / 2, o.y - dir * r1 / 2],
    ];
    const shade = 0.80 + Math.random() * 0.20; // 삼각형마다 살짝 다른 밝기 -> 면이 구분되어 보임
    for (let k = 0; k < 3; k++) {
      positions.set([v[k][0], v[k][1], 0], i * 9 + k * 3);
      colors.set([shade, shade, shade], i * 9 + k * 3);
    }
  });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const proxyGeom = new THREE.CircleGeometry(1.7, 14); // 삼각형 사이 빈틈도 클릭되도록 하는 투명 판

  for (let i = 0; i < CR_LAYOUT.tripodCount; i++) {
    const baseColor = new THREE.Color().setHSL(i / CR_LAYOUT.tripodCount, 0.85, 0.56);
    const material = new THREE.MeshBasicMaterial({ color: baseColor.clone(), vertexColors: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, material);

    const proxy = new THREE.Mesh(proxyGeom, new THREE.MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
    }));
    proxy.userData.crIndex = i;

    const group = new THREE.Group();
    group.add(mesh);
    group.add(proxy);
    const homeY = ((CR_LAYOUT.tripodCount - 1) / 2 - i) * CR_LAYOUT.columnSpacing;
    group.position.set(CR_LAYOUT.columnX, homeY, 0);
    crRoot.add(group);

    crTripods.push({
      group, mesh, proxy, material, baseColor,
      homeX: CR_LAYOUT.columnX, homeY,
      available: true, spawnStart: -100, hoverS: 1,
      flyStart: new THREE.Vector3(),
      flying: false, flightProgress: 0,
    });
  }
}

function crBuildEye() {
  const E = CR_SHAPE_CONFIG.eye;
  const data = crGenerateEyeTriangles();
  const positions = crBuildTriangleVertices(data.centers, data.normals, E.triangleSize, null, 4242);
  const n = data.count;

  const baseCol = new Float32Array(n * 3);
  const shade = new Float32Array(n);
  const L = crNorm([-0.45, 0.55, 0.7]);
  for (let i = 0; i < n; i++) {
    const pc = CR_EYE_PART_COLORS[data.part[i]];
    const v = 0.9 + Math.random() * 0.2;
    baseCol[i * 3] = Math.min(1, pc[0] * v);
    baseCol[i * 3 + 1] = Math.min(1, pc[1] * v);
    baseCol[i * 3 + 2] = Math.min(1, pc[2] * v);
    const d = data.normals[i * 3] * L[0] + data.normals[i * 3 + 1] * L[1] + data.normals[i * 3 + 2] * L[2];
    shade[i] = 0.5 + 0.5 * (0.5 + 0.5 * d);
  }

  const colorArray = new Float32Array(n * 9);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const colorAttr = new THREE.BufferAttribute(colorArray, 3);
  colorAttr.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('color', colorAttr);
  geom.computeBoundingSphere();

  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;

  crEyeRoot = new THREE.Group();
  crEyeRoot.position.set(CR_LAYOUT.eyeX, 0, 0);
  crEyeRoot.rotation.y = CR_LAYOUT.eyeRotY;
  crEyeRoot.add(mesh);
  crSpace.add(crEyeRoot);

  crEye = { mesh, count: n, u: data.u, baseCol, shade, colorAttr, colorArray, lastIn: -1, lastOut: -1, tint: new THREE.Color(1, 1, 1) };
}

function crBuildParticles() {
  const s = CR_LAYOUT.tripodTriangleSize;
  const r = s / Math.sqrt(3);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    0, r, 0, -s / 2, -r / 2, 0, s / 2, -r / 2, 0,
  ]), 3));
  for (let i = 0; i < 12; i++) {
    const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }));
    mesh.visible = false;
    crRoot.add(mesh);
    crParticles.push({
      mesh, delay: i * 0.07,
      start: new THREE.Vector3(), startQuat: new THREE.Quaternion(),
      targetLocal: new THREE.Vector3(),
      spinAxis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
    });
  }
}

// ---------------------------------------------------------
// 눈 색칠: wIn = 물드는 파동(0~1), wOut = 빠져나가는 파동(0~1)
// 삼각형별 u(0=각막 앞 ~ 1=시신경 끝)와 비교해서 색을 섞음
// ---------------------------------------------------------
function crUpdateEyeColors(wIn, wOut, force) {
  const e = crEye;
  if (!force && wIn === e.lastIn && wOut === e.lastOut) return;
  e.lastIn = wIn; e.lastOut = wOut;

  const soft = CR_TIMING.soft;
  const tr = e.tint.r, tg = e.tint.g, tb = e.tint.b;
  const aIn = wIn * (1 + soft), aOut = wOut * (1 + soft);
  const arr = e.colorArray;
  const n = e.count;

  for (let i = 0; i < n; i++) {
    const u = e.u[i];
    const xi = crClamp01((aIn - u) / soft);
    const xo = crClamp01((aOut - u) / soft);
    const tintW = xi * (1 - xo);
    const edge = Math.max(xi * (1 - xi), xo * (1 - xo)) * 4;
    const glow = edge * 0.35;
    const sh = e.shade[i];

    const r = ((1 - tintW) * e.baseCol[i * 3] + tintW * tr) * sh + glow;
    const g = ((1 - tintW) * e.baseCol[i * 3 + 1] + tintW * tg) * sh + glow;
    const b = ((1 - tintW) * e.baseCol[i * 3 + 2] + tintW * tb) * sh + glow;
    const o = i * 9;
    arr[o] = arr[o + 3] = arr[o + 6] = r;
    arr[o + 1] = arr[o + 4] = arr[o + 7] = g;
    arr[o + 2] = arr[o + 5] = arr[o + 8] = b;
  }
  e.colorAttr.needsUpdate = true;
}

// ---------------------------------------------------------
// 나무: 사이클마다 150~300개 랜덤으로 새로 생성
// ---------------------------------------------------------
function crGenerateTreeForCycle() {
  const T = CR_SHAPE_CONFIG.tree;
  const count = T.minCount + Math.floor(Math.random() * (T.maxCount - T.minCount + 1));
  const tree = crGenerateTree(count);
  const verts = crBuildTriangleVertices(tree.centers, tree.normals, tree.size, tree.dirs, 99);

  const baseCol = new Float32Array(count * 3);
  const c = crState.color;
  for (let i = 0; i < count; i++) {
    const f = (0.6 + 0.4 * crClamp01(tree.birth[i] / 0.95)) * (0.92 + Math.random() * 0.16);
    baseCol[i * 3] = Math.min(1, c.r * f);
    baseCol[i * 3 + 1] = Math.min(1, c.g * f);
    baseCol[i * 3 + 2] = Math.min(1, c.b * f);
  }
  // 사이클마다 새 메시를 만들어 기존 나무 옆에 추가 (이전 나무는 그대로 유지)
  const E = CR_SHAPE_CONFIG.eye;
  const geom = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(count * 9), 3);
  const col = new THREE.BufferAttribute(new Float32Array(count * 9), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  col.setUsage(THREE.DynamicDrawUsage);
  geom.setAttribute('position', pos);
  geom.setAttribute('color', col);
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  mesh.position.set(E.nerveStartX + E.nerveLength, 0, 0); // 시신경 끝
  crEyeRoot.add(mesh);

  crTree = { mesh, pos, col, count, centers: tree.centers, verts, birth: tree.birth, baseCol, height: tree.height, growth: 0 };
  crTrees.push(crTree);
  crUpdateTree(0, 1);
}

function crUpdateTree(growth, alive) {
  const t = crTree;
  if (!t.count) return;
  const scaled = growth * 1.2; // 마지막 삼각형까지 다 자라도록 여유
  const P = t.pos.array, C = t.col.array;
  for (let i = 0; i < t.count; i++) {
    const g = crSmooth((scaled - t.birth[i]) / 0.12) * alive;
    const cx = t.centers[i * 3], cy = t.centers[i * 3 + 1], cz = t.centers[i * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const o = i * 9 + k * 3;
      P[o] = cx + (t.verts[o] - cx) * g;
      P[o + 1] = cy + (t.verts[o + 1] - cy) * g;
      P[o + 2] = cz + (t.verts[o + 2] - cz) * g;
      const wh = 0.55 * (1 - g); // 갓 태어난 삼각형은 하얗게 빛나다 색이 자리 잡음
      C[o] = t.baseCol[i * 3] * (1 - wh) + wh;
      C[o + 1] = t.baseCol[i * 3 + 1] * (1 - wh) + wh;
      C[o + 2] = t.baseCol[i * 3 + 2] * (1 - wh) + wh;
    }
  }
  t.pos.needsUpdate = true;
  t.col.needsUpdate = true;
}

// ---------------------------------------------------------
// 클릭 처리
// ---------------------------------------------------------
function getPickables_ChineseRoom() {
  return crTripods.filter((t) => t.available).map((t) => t.proxy);
}

function isBusy_ChineseRoom() {
  return crState.phase !== 'idle';
}

function setHover_ChineseRoom(object) {
  crHoverIndex = object && object.userData && object.userData.crIndex !== undefined ? object.userData.crIndex : -1;
}

function handleRaycastHit_ChineseRoom(hit, time) {
  if (!hit || !hit.object || hit.object.userData.crIndex === undefined) return false;
  if (isBusy_ChineseRoom()) return false;
  const idx = hit.object.userData.crIndex;
  if (!crTripods[idx].available) return false;
  startCycle_ChineseRoom(idx, time);
  return true;
}

function startCycle_ChineseRoom(index, time) {
  const T = CR_TIMING;
  const t0 = time;
  const absorbStart = t0 + T.flight;
  const tintStart = absorbStart + T.tintDelay;
  const tintEnd = tintStart + T.tintDuration;
  const drainStart = tintEnd + T.hold;
  const drainEnd = drainStart + T.drainDuration;
  const treeStart = drainStart + T.treeStartFrac * T.drainDuration;
  const treeEnd = treeStart + T.treeDuration;

  const tp = crTripods[index];
  crState = {
    phase: 'flight', index, t0,
    times: { absorbStart, tintStart, tintEnd, drainStart, drainEnd, treeStart, treeEnd, cycleEnd: Math.max(drainEnd, treeEnd) },
    color: tp.baseColor.clone(),
    treeGenerated: false,
  };
  crEye.tint.copy(crState.color);

  tp.flyStart.copy(tp.group.position);
  tp.flying = true;
  tp.available = false; // 사이클이 끝날 때까지 다시 고를 수 없음 (끝나면 제자리에 복원)

  crParticles.forEach((p) => p.mesh.material.color.copy(crState.color));
  crUpdateEyeColors(0, 0, true);
}

// ---------------------------------------------------------
// 매 프레임 갱신
// ---------------------------------------------------------
const crTmpA = new THREE.Vector3();
const crTmpB = new THREE.Vector3();
const crTmpC = new THREE.Vector3();
const crTmpQ = new THREE.Quaternion();

function updateExperiment_ChineseRoom(time, deltaTime) {
  if (!crRoot) return;
  const dt = deltaTime !== undefined ? deltaTime : Math.max(0, time - crPrevTime);
  crPrevTime = time;

  // 눈은 가만히 있지 않고 아주 천천히 숨 쉬듯 흔들림
  crEyeRoot.rotation.y = CR_LAYOUT.eyeRotY + Math.sin(time * 0.35) * 0.05;
  crEyeRoot.rotation.x = Math.sin(time * 0.27) * 0.03;
  crRoot.updateMatrixWorld(true);

  const st = crState;
  const tm = st.times;

  // ----- 트라이포드 -----
  crTripods.forEach((tp, i) => {
    const g = tp.group;
    g.rotation.y = Math.sin(time * 0.7 + i * 0.6) * 0.45;
    g.rotation.x = Math.sin(time * 0.5 + i) * 0.12;

    const hoverTarget = i === crHoverIndex && tp.available && st.phase === 'idle' ? 1.18 : 1;
    tp.hoverS += (hoverTarget - tp.hoverS) * Math.min(1, dt * 10);

    if (tp.flying) return; // 날아가는 중에는 아래에서 따로 처리

    if (tp.available) {
      g.visible = true;
      const appear = crSmooth((time - tp.spawnStart) / CR_TIMING.respawnDuration);
      g.scale.setScalar(Math.max(0.0001, appear) * tp.hoverS);
      g.position.set(tp.homeX, tp.homeY + Math.sin(time * 0.9 + i * 0.8) * 0.12, 0);
      const k = tp.hoverS > 1.001 ? (tp.hoverS - 1) / 0.18 * 0.35 : 0;
      tp.material.color.copy(tp.baseColor).lerp(new THREE.Color(1, 1, 1), k);
    } else {
      g.visible = false;
    }
  });

  if (st.phase === 'idle') {
    return;
  }

  // ----- 비행 -----
  const tp = crTripods[st.index];
  if (tp.flying) {
    const p = (time - st.t0) / CR_TIMING.flight;
    const e = crEaseInOutCubic(p);
    crEyeRoot.localToWorld(crTmpA.set(-17, 0, 0)); // 각막 바로 앞
    crRoot.worldToLocal(crTmpA);                    // crRoot 로컬 좌표로
    crTmpB.copy(tp.flyStart).add(crTmpA).multiplyScalar(0.5);
    crTmpB.y += 7; crTmpB.z += 14; // 곡선 경로의 중간 제어점 (위로, 카메라 쪽으로)
    const u1 = 1 - e;
    tp.group.position.set(
      u1 * u1 * tp.flyStart.x + 2 * u1 * e * crTmpB.x + e * e * crTmpA.x,
      u1 * u1 * tp.flyStart.y + 2 * u1 * e * crTmpB.y + e * e * crTmpA.y,
      u1 * u1 * tp.flyStart.z + 2 * u1 * e * crTmpB.z + e * e * crTmpA.z
    );
    tp.group.rotation.z = e * Math.PI * 2;
    tp.group.scale.setScalar(tp.hoverS * (1 + 0.25 * Math.sin(e * Math.PI)));

    if (p >= 1) {
      // 12조각으로 흩어져 눈으로 빨려 듦
      tp.group.rotation.z = 0;
      tp.group.updateMatrixWorld(true);
      const offs = crGenerateTripodOffsets(CR_LAYOUT.tripodTriangleSize);
      crTmpQ.copy(tp.group.quaternion);
      crParticles.forEach((pt, k) => {
        crTmpC.set(offs[k].x, offs[k].y, 0);
        tp.group.localToWorld(crTmpC);
        crRoot.worldToLocal(crTmpC);
        pt.start.copy(crTmpC);
        pt.startQuat.copy(crTmpQ);
        // 안구 안쪽(수정체 근처) 임의 지점으로 빨려 들어감
        pt.targetLocal.set(-7 + (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3);
        pt.mesh.visible = true;
        pt.mesh.position.copy(pt.start);
        pt.mesh.quaternion.copy(pt.startQuat);
        pt.mesh.scale.setScalar(tp.group.scale.x);
      });
      tp.group.visible = false;
      tp.flying = false;
      st.phase = 'absorb';
    }
  }

  // ----- 흡수 입자 -----
  if (time >= tm.absorbStart) {
    let anyActive = false;
    crParticles.forEach((pt) => {
      if (!pt.mesh.visible) return;
      const p = crClamp01((time - tm.absorbStart - pt.delay) / 0.9);
      if (p >= 1) { pt.mesh.visible = false; return; }
      anyActive = true;
      const e = p * p; // 점점 빨라지며 빨려 들어감
      crEyeRoot.localToWorld(crTmpA.copy(pt.targetLocal));
      crRoot.worldToLocal(crTmpA);
      pt.mesh.position.lerpVectors(pt.start, crTmpA, e);
      crTmpQ.setFromAxisAngle(pt.spinAxis, e * 7);
      pt.mesh.quaternion.copy(pt.startQuat).multiply(crTmpQ);
      pt.mesh.scale.setScalar(Math.max(0.0001, (1 - crSmooth((p - 0.5) / 0.5)) * 1.1));
    });
    if (!anyActive && st.phase === 'absorb') st.phase = 'tint';
  }

  // ----- 눈 물들기 / 빠져나가기 -----
  const wIn = crSmooth((time - tm.tintStart) / CR_TIMING.tintDuration);
  const wOut = crSmooth((time - tm.drainStart) / CR_TIMING.drainDuration);
  crUpdateEyeColors(wIn, wOut, false);

  // ----- 나무 -----
  if (time >= tm.treeStart && !st.treeGenerated) {
    st.treeGenerated = true;
    crGenerateTreeForCycle();
  }
  if (st.treeGenerated) {
    crTree.growth = crClamp01((time - tm.treeStart) / CR_TIMING.treeDuration);
    crUpdateTree(crTree.growth, 1);
  }

  // ----- 사이클 종료 -----
  if (time >= tm.cycleEnd) {
    crUpdateEyeColors(1, 1, true);
    const done = crTripods[st.index];
    done.available = true;       // 사라졌던 트라이포드가 제자리에 다시 나타남
    done.spawnStart = time;
    st.phase = 'idle';
  }
}

// ---------------------------------------------------------
// 상태 텍스트 / 카메라 맞춤
// ---------------------------------------------------------
let crEverClicked = false;
function getStatus_ChineseRoom(time) {
  const st = crState;
  if (st.phase !== 'idle') crEverClicked = true;
  // 안내 문구는 두 가지뿐: 대기 중에만 표시하고, 사이클 진행 중에는 비움
  let caption = '';
  if (st.phase === 'idle') caption = crEverClicked ? '다른 기호를 클릭해보세요' : '기호를 클릭해보세요';
  return { phase: st.phase, busy: st.phase !== 'idle', caption, treeCount: crTree ? crTree.count : 0, treesTotal: crTrees.length };
}

// 눈 구조물과 나무를 원점(0,0,0) 기준으로 회전 (왼쪽 트라이포드 열은 돌지 않는다)
function setSpaceRotation_ChineseRoom(rotX, rotY) {
  if (!crSpace) return;
  crSpace.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, rotX));
  crSpace.rotation.y = rotY;
}

function getCameraFit_ChineseRoom(aspect, fovDeg) {
  const tanH = Math.tan((fovDeg * Math.PI / 180) / 2);
  const minX = CR_LAYOUT.columnX - 3;
  const maxX = CR_LAYOUT.eyeX + 50;      // 시신경 끝 + 나무 가지
  const centerX = (minX + maxX) / 2;
  const halfW = (maxX - minX) / 2;
  const halfH = 34;                      // 트라이포드 열(±31)과 나무 높이(최대 32) 기준
  const margin = 1.2;                    // 상단 제목바 여유
  const dist = Math.max(halfH / tanH, halfW / (tanH * aspect)) * margin;
  return { x: centerX, y: 4, z: dist };
}
