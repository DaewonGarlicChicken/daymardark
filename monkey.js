// =========================================================
// 사고실험 005. 무한 원숭이 정리 (Infinite Monkey Theorem)
// -----------------------------------------------------------
// 필요: Three.js(전역 THREE)
//
// 구성
//  - 아래: 위에서 본 12키 자판 (삼각형으로 만든 입체물)
//  - 위  : 1-2-4-2 글자(총 9칸)로 된 문장 자리
//          한 글자 = 큰 삼각형 하나를 9칸으로 나눈 판, 그중 1~6칸을 채운 평면도형
//
// 흐름
//  - 자판이 자동으로 무작위로 눌림 -> 무작위 도형(1~6칸) 하나가 지금 칸으로 날아가 배열됨
//  - 정답 도형이면 노란색으로 빛나며 고정, 다음 칸으로
//  - 틀리면 붉게 점등했다 사라지고, 그 칸을 다시 시도
//  - 9칸이 모두 맞으면 문장 완성 -> 잠시 빛난 뒤 같은 문장을 처음부터 반복
//
// 칸 이름 (큰 삼각형 안, 위에서부터 왼->오른쪽)
//            A
//          B C D
//        E F G H I      (B, D, E, G, I = 위로 뾰족 / C, F, H = 아래로 뾰족)
//
// 공개 함수
//  initExperiment_InfiniteMonkey(scene, time)
//  start_InfiniteMonkey(time)                 -> 본 화면 시작 (타자 시작, 시간 측정 시작)
//  setSpeed_InfiniteMonkey(pressesPerSecond)
//  updateExperiment_InfiniteMonkey(time, deltaTime)
//  getStats_InfiniteMonkey(time) -> { speed, expectedSeconds, elapsed, attempts, slot, lastRecord, combos }
// =========================================================

const IM_CONFIG = {
  sentence: [                       // 정답 문장 (1-2-4-2 글자)
    ['DGHI'],
    ['BDFG', 'DFH'],
    ['BDF', 'BCDG', 'ABCDG', 'BDF'],
    ['BCEH', 'BDFGH'],
  ],
  minCells: 1,                      // 한 도형을 이루는 삼각형 수 범위
  maxCells: 6,
  glyphSize: 5.2,                   // 글자판(큰 삼각형) 한 변
  glyphGap: 1.2,                    // 같은 단어 안 글자 사이
  wordGap: 4.0,                     // 단어 사이 추가 간격
  sentenceY: 11,
  cellInset: 0.88,                  // 칸 사이 흰 틈을 보여주기 위한 축소 비율
  keyboardY: -15,
  keyboardTilt: -0.42,              // 자판이 책상 위에 놓인 듯 뒤로 눕힌 각도
  keyCols: 6,
  keyRows: 2,
  keySize: 4.2,
  keyGap: 0.8,
  // 자판의 "글자 수": 12키 자판이므로 도형도 12종(정답에 쓰인 도형 + 나머지는 무작위 도형)으로 제한.
  // 타자기에 정해진 글자만 있는 것과 같다. 매번 이 12종 중 하나가 무작위로 나온다 -> 한 칸이 맞을 확률 1/12
  // (0으로 두면 9칸 중 1~6칸의 모든 조합 465종에서 무작위)
  alphabetSize: 12,
  defaultSpeed: 3.6,                // 초당 타수 (9칸 x 12종 / 3.6 = 평균 30초)
  completeHold: 2.5,                // 문장 완성 후 빛나는 시간
  clearDuration: 0.7,
};

const IM_COLORS = {
  template: [0.20, 0.21, 0.24],     // 비어 있는 칸
  landing: [0.93, 0.90, 0.82],      // 날아가는 중
  correct: [1.00, 0.83, 0.22],      // 정답 (노란색)
  wrong: [0.90, 0.16, 0.13],        // 오답 (붉은색)
  board: [0.16, 0.17, 0.20],
  key: [0.78, 0.76, 0.70],
  keyLit: [1.00, 0.92, 0.55],
};

const IM_CELL_NAMES = 'ABCDEFGHI';

let imRoot = null;
let imSlots = [];          // 9칸: { cx, cy, target, mask, t0, fd, ok, keyPos }
let imCellGeom = [];       // 큰 삼각형 기준 9칸의 꼭짓점 (로컬)
let imFill = null;         // 채워지는 삼각형 81개 (동적)
let imKeys = [];
let imGlyphPool = [];      // 가능한 모든 도형(비트마스크)
let imState = { phase: 'waiting' };
let imSpeed = IM_CONFIG.defaultSpeed;
let imPressAccum = 0;

function imClamp01(x) { return Math.min(1, Math.max(0, x)); }
function imSmooth(x) { x = imClamp01(x); return x * x * (3 - 2 * x); }
function imMaskFromName(s) { let m = 0; for (const ch of s) m |= 1 << IM_CELL_NAMES.indexOf(ch); return m; }
function imPopcount(m) { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; }

// ---------------------------------------------------------
// 큰 삼각형(한 변 S, 무게중심 원점)을 9칸으로 나눈 꼭짓점
// ---------------------------------------------------------
function imBuildCellGeometry(S) {
  const c = S / 3, h = c * Math.sqrt(3) / 2;
  const top = (S * Math.sqrt(3) / 2) * 2 / 3;
  const cells = [];
  for (let r = 0; r < 3; r++) {
    const yt = top - r * h, yb = top - (r + 1) * h;
    for (let j = 0; j < 2 * r + 1; j++) {
      const k = Math.floor(j / 2);
      if (j % 2 === 0) { // 위로 뾰족
        const xl = -(r + 1) * c / 2 + k * c;
        cells.push([[xl + c / 2, yt], [xl, yb], [xl + c, yb]]);
      } else {           // 아래로 뾰족
        const xl = -r * c / 2 + k * c;
        cells.push([[xl, yt], [xl + c, yt], [xl + c / 2, yb]]);
      }
    }
  }
  return cells;
}

// ---------------------------------------------------------
// 삼각형으로 만든 상자 (자판 몸체/키) - 면마다 명암
// ---------------------------------------------------------
function imBoxGeometry(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;
  const faces = [ // [네 꼭짓점, 밝기]
    [[[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], 1.0],    // 윗면(카메라 쪽)
    [[[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z]], 0.78],   // 뒤쪽 옆면
    [[[-x, -y, z], [x, -y, z], [x, -y, -z], [-x, -y, -z]], 0.6], // 앞쪽 옆면
    [[[x, -y, -z], [x, y, -z], [x, y, z], [x, -y, z]], 0.7],
    [[[-x, -y, z], [-x, y, z], [-x, y, -z], [-x, -y, -z]], 0.7],
  ];
  const pos = [], col = [];
  faces.forEach(([q, b]) => {
    [[0, 1, 2], [0, 2, 3]].forEach((t) => t.forEach((i) => { pos.push(...q[i]); col.push(b, b, b); }));
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
  return g;
}

// ---------------------------------------------------------
// 초기화
// ---------------------------------------------------------
// 자판 글자(도형) 목록: 정답 문장에 쓰인 도형을 모두 넣고, 남는 자리는 다른 무작위 도형으로 채움
function imBuildAlphabet(all, size) {
  const set = [];
  IM_CONFIG.sentence.forEach((w) => w.forEach((g) => {
    const m = imMaskFromName(g);
    if (set.indexOf(m) < 0) set.push(m);
  }));
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  while (set.length < size) {
    const m = all[Math.floor(rnd() * all.length)];
    if (set.indexOf(m) < 0) set.push(m);
  }
  return set;
}

function initExperiment_InfiniteMonkey(scene, time) {
  const C = IM_CONFIG;
  imRoot = new THREE.Group();
  scene.add(imRoot);

  // 가능한 모든 도형: 9칸 중 1~6칸을 고르는 경우 (465가지)
  const all = [];
  for (let m = 1; m < 512; m++) {
    const n = imPopcount(m);
    if (n >= C.minCells && n <= C.maxCells) all.push(m);
  }
  imGlyphPool = C.alphabetSize > 0 ? imBuildAlphabet(all, C.alphabetSize) : all;

  imBuildSentence();
  imBuildKeyboard();
  imState = { phase: 'waiting', attempts: 0 };
}

function imBuildSentence() {
  const C = IM_CONFIG;
  imCellGeom = imBuildCellGeometry(C.glyphSize);

  // 글자 위치 (가운데 정렬)
  const centers = [];
  let x = 0;
  C.sentence.forEach((word, wi) => {
    if (wi > 0) x += C.wordGap;
    word.forEach((g, gi) => {
      if (gi > 0 || wi > 0) x += C.glyphSize + C.glyphGap;
      centers.push({ x, target: imMaskFromName(g) });
    });
  });
  const shift = (centers[0].x + centers[centers.length - 1].x) / 2;
  imSlots = centers.map((c) => ({ cx: c.x - shift, cy: C.sentenceY, target: c.target, mask: 0, t0: -100, fd: 0.1, ok: false }));

  // 빈 칸 판 (정적)
  const tpl = [];
  imSlots.forEach((s) => {
    imCellGeom.forEach((cell) => {
      const gx = (cell[0][0] + cell[1][0] + cell[2][0]) / 3, gy = (cell[0][1] + cell[1][1] + cell[2][1]) / 3;
      cell.forEach(([vx, vy]) => tpl.push(s.cx + gx + (vx - gx) * C.cellInset, s.cy + gy + (vy - gy) * C.cellInset, -0.05));
    });
  });
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tpl), 3));
  imRoot.add(new THREE.Mesh(tg, new THREE.MeshBasicMaterial({
    color: new THREE.Color(...IM_COLORS.template), side: THREE.DoubleSide,
  })));

  // 채워지는 삼각형 (9칸 x 9글자 = 81개, 매 프레임 갱신)
  const n = imSlots.length * 9;
  const fg = new THREE.BufferGeometry();
  const pos = new THREE.BufferAttribute(new Float32Array(n * 9), 3);
  const col = new THREE.BufferAttribute(new Float32Array(n * 9), 3);
  pos.setUsage(THREE.DynamicDrawUsage);
  col.setUsage(THREE.DynamicDrawUsage);
  fg.setAttribute('position', pos);
  fg.setAttribute('color', col);
  const mesh = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  imRoot.add(mesh);
  imFill = { mesh, pos, col, n };
}

function imBuildKeyboard() {
  const C = IM_CONFIG;
  const group = new THREE.Group();
  group.position.set(0, C.keyboardY, 0);
  group.rotation.x = C.keyboardTilt;
  imRoot.add(group);

  const bw = C.keyCols * C.keySize + (C.keyCols - 1) * C.keyGap + 2.4;
  const bh = C.keyRows * C.keySize + (C.keyRows - 1) * C.keyGap + 2.4;
  const board = new THREE.Mesh(imBoxGeometry(bw, bh, 1.5), new THREE.MeshBasicMaterial({
    vertexColors: true, color: new THREE.Color(...IM_COLORS.board),
  }));
  board.position.z = -0.75;
  group.add(board);

  const keyGeom = imBoxGeometry(C.keySize, C.keySize, 1.2);
  for (let r = 0; r < C.keyRows; r++) {
    for (let c = 0; c < C.keyCols; c++) {
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(...IM_COLORS.key) });
      const key = new THREE.Mesh(keyGeom, mat);
      const x = (c - (C.keyCols - 1) / 2) * (C.keySize + C.keyGap);
      const y = ((C.keyRows - 1) / 2 - r) * (C.keySize + C.keyGap);
      key.position.set(x, y, 0.6);
      group.add(key);
      imKeys.push({ mesh: key, mat, baseZ: 0.6, lastPress: -100 });
    }
  }
  imKeys.group = group;
}

// ---------------------------------------------------------
// 시작 / 속도
// ---------------------------------------------------------
function start_InfiniteMonkey(time) {
  if (imState.phase !== 'waiting') return;
  imResetSentence(time);
}

function imResetSentence(time) {
  imSlots.forEach((s) => { s.mask = 0; s.ok = false; s.t0 = -100; });
  imState = {
    phase: 'typing', cur: 0, sentenceStart: time, attempts: 0,
    lastRecord: imState.lastRecord, completedCount: imState.completedCount || 0,
  };
  imPressAccum = 0;
}

function setSpeed_InfiniteMonkey(pps) {
  imSpeed = Math.max(0.1, pps);
}

// 지금 속도에서 문장 하나를 완성하는 데 걸리는 평균 시간(초)
// 한 칸이 맞을 확률 = 1 / (가능한 도형 수) -> 한 칸당 평균 시도 = 도형 수
function imExpectedSeconds() {
  return (imSlots.length * imGlyphPool.length) / imSpeed;
}

// ---------------------------------------------------------
// 한 번 누르기
// ---------------------------------------------------------
const imTmpV = new THREE.Vector3();
function imPress(time) {
  const st = imState;
  const keyIdx = Math.floor(Math.random() * imKeys.length);
  const key = imKeys[keyIdx];
  key.lastPress = time;

  const mask = imGlyphPool[Math.floor(Math.random() * imGlyphPool.length)];
  const slot = imSlots[st.cur];
  key.mesh.getWorldPosition(imTmpV);
  slot.keyX = imTmpV.x; slot.keyY = imTmpV.y; slot.keyZ = imTmpV.z;
  slot.mask = mask;
  slot.t0 = time;
  slot.fd = 0.0001;                               // 날아가지 않고 칸에 바로 나타남
  slot.flash = Math.min(0.5, 0.9 / imSpeed);      // 붉은 점등 시간 (다음 타자 전에 사라지도록)
  slot.ok = mask === slot.target;
  st.attempts++;

  if (slot.ok) {
    st.cur++;
    if (st.cur >= imSlots.length) {
      st.phase = 'complete';
      st.completeStart = time + slot.fd;          // 마지막 글자가 도착한 순간부터
      st.lastRecord = st.completeStart - st.sentenceStart;
      st.completedCount = (st.completedCount || 0) + 1;
    }
  }
}

// ---------------------------------------------------------
// 매 프레임
// ---------------------------------------------------------
function updateExperiment_InfiniteMonkey(time, deltaTime) {
  if (!imRoot) return;
  const dt = Math.max(0, deltaTime || 0);
  const st = imState;

  // 자동 타자
  if (st.phase === 'typing') {
    imPressAccum += dt * imSpeed;
    let guard = 0;
    while (imPressAccum >= 1 && st.phase === 'typing' && guard < 40) {
      imPressAccum -= 1;
      imPress(time);
      guard++;
    }
    if (guard >= 40) imPressAccum = 0; // 너무 밀리면 버림 (탭 전환 후 복귀 등)
  }

  // 완성 -> 잠시 빛남 -> 지우고 반복
  if (st.phase === 'complete' && time >= st.completeStart + IM_CONFIG.completeHold) {
    st.phase = 'clearing';
    st.clearStart = time;
  }
  if (st.phase === 'clearing' && time >= st.clearStart + IM_CONFIG.clearDuration) {
    imResetSentence(time);
  }

  imUpdateKeys(time);
  imWriteFill(time);
}

function imUpdateKeys(time) {
  const dur = Math.min(0.25, 0.9 / imSpeed);
  imKeys.forEach((k) => {
    const p = 1 - imSmooth((time - k.lastPress) / dur);
    k.mesh.position.z = k.baseZ - 0.55 * p;
    const a = IM_COLORS.key, b = IM_COLORS.keyLit;
    k.mat.color.setRGB(a[0] + (b[0] - a[0]) * p, a[1] + (b[1] - a[1]) * p, a[2] + (b[2] - a[2]) * p);
  });
}

function imWriteFill(time) {
  const C = IM_CONFIG, st = imState;
  const P = imFill.pos.array, Cc = imFill.col.array;
  let completeGlow = 0, clearFade = 1;
  if (st.phase === 'complete') completeGlow = 0.5 + 0.5 * Math.sin((time - st.completeStart) * 6);
  if (st.phase === 'clearing') clearFade = 1 - imSmooth((time - st.clearStart) / C.clearDuration);

  imSlots.forEach((s, si) => {
    const landed = imClamp01((time - s.t0) / s.fd);
    const e = landed * landed * (3 - 2 * landed);
    const after = time - (s.t0 + s.fd);           // 도착 후 지난 시간
    let scale = 1, color = IM_COLORS.landing, glow = 0;

    if (s.mask === 0) scale = 0;
    else if (landed >= 1) {
      if (s.ok) {
        color = IM_COLORS.correct;
        glow = Math.max(0, 0.5 - after * 1.5) + completeGlow * 0.35;   // 맞은 순간 번쩍
        scale = clearFade;
      } else {
        color = IM_COLORS.wrong;
        const f = imClamp01(after / s.flash);
        scale = 1 - imSmooth((f - 0.4) / 0.6);       // 붉게 점등 후 사라짐
        glow = Math.max(0, 0.35 - f);
      }
    }

    for (let ci = 0; ci < 9; ci++) {
      const idx = si * 9 + ci;
      const on = (s.mask >> ci) & 1;
      const cell = imCellGeom[ci];
      const gx = (cell[0][0] + cell[1][0] + cell[2][0]) / 3, gy = (cell[0][1] + cell[1][1] + cell[2][1]) / 3;
      // 날아가는 동안: 누른 키 위치 -> 칸 위치
      const tx = s.cx + gx, ty = s.cy + gy;
      const cx = (s.keyX || 0) + (tx - (s.keyX || 0)) * e;
      const cy = (s.keyY || 0) + (ty - (s.keyY || 0)) * e;
      const cz = (s.keyZ || 0) * (1 - e) + 0.05 * e;
      const k = on ? C.cellInset * scale : 0;
      for (let v = 0; v < 3; v++) {
        const o = idx * 9 + v * 3;
        P[o] = cx + (cell[v][0] - gx) * k;
        P[o + 1] = cy + (cell[v][1] - gy) * k;
        P[o + 2] = cz;
        Cc[o] = Math.min(1, color[0] + glow);
        Cc[o + 1] = Math.min(1, color[1] + glow);
        Cc[o + 2] = Math.min(1, color[2] + glow);
      }
    }
  });
  imFill.pos.needsUpdate = true;
  imFill.col.needsUpdate = true;
}

// ---------------------------------------------------------
// 화면 표시용 숫자
// ---------------------------------------------------------
function getStats_InfiniteMonkey(time) {
  const st = imState;
  let elapsed = 0;
  if (st.phase === 'typing') elapsed = time - st.sentenceStart;
  else if (st.phase === 'complete' || st.phase === 'clearing') elapsed = st.lastRecord;
  return {
    speed: imSpeed,
    expectedSeconds: imExpectedSeconds(),
    elapsed,
    attempts: st.attempts || 0,
    slot: Math.min(st.cur || 0, imSlots.length),
    slots: imSlots.length,
    lastRecord: st.lastRecord,
    completedCount: st.completedCount || 0,
    combos: imGlyphPool.length,
    phase: st.phase,
  };
}
