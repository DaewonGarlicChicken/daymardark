// =========================================================
// 사고실험 005. 무한 원숭이 정리 (Infinite Monkey Theorem) - 게임 버전
// -----------------------------------------------------------
// 필요: Three.js(전역 THREE)
//
// 구성
//  - 아래: 위에서 본 12키 자판 (삼각형으로 만든 입체물). 키마다 그 키가 치는 "글자(도형)"가 그려져 있음
//  - 위  : 문단 = 문장 1~3줄. 한 문장 = 글자 4개
//          한 글자 = 큰 삼각형 하나를 9칸으로 나눈 판, 그중 1~6칸을 채운 평면도형
//  - 문장마다 왼쪽에 원숭이(작은 삼각형 무리) 한 마리가 붙어 그 문장을 무작위로 침
//
// 게임
//  - 단계 1: 원숭이 1마리, 문장 1줄 / 단계 2: 2마리, 2줄 / 단계 3: 3마리, 3줄
//  - 원숭이는 자동으로 무작위 키를 누름 -> 그 글자가 자기 문장의 지금 칸과 맞으면 고정, 아니면 붉게 점등
//  - 사용자도 키를 클릭해 글자를 칠 수 있음 -> 지금 칸이 그 글자를 기다리는 문장(위에서부터)에 들어감
//    어느 문장에도 맞지 않으면 첫 미완성 문장의 지금 칸에 붉게 점등
//  - 30초 안에 세 문단을 모두 완성하면 목표 완료, 시간이 다 되면 실패
//
// 칸 이름 (큰 삼각형 안, 위에서부터 왼->오른쪽)
//            A
//          B C D
//        E F G H I      (B, D, E, G, I = 위로 뾰족 / C, F, H = 아래로 뾰족)
//
// 공개 함수
//  initExperiment_InfiniteMonkey(scene, time)
//  startGame_InfiniteMonkey(time) / resetGame_InfiniteMonkey(time)
//  updateExperiment_InfiniteMonkey(time, deltaTime)
//  getKeyMeshes_InfiniteMonkey()            -> 클릭 판정용 키 메시 배열 (userData.keyIndex)
//  pressKey_InfiniteMonkey(keyIndex, time)  -> 사용자가 키를 누름: 'ok' | 'wrong' | 'none'
//  setHoverKey_InfiniteMonkey(keyIndex|-1)
//  getGame_InfiniteMonkey(time)
// =========================================================

const IM_CONFIG = {
  stages: 3,                        // 문단 수 (단계 k = 원숭이 k마리, 문장 k줄)
  sentenceLength: 4,                // 한 문장의 글자 수
  timeLimit: 30,                    // 세 문단을 모두 완성해야 하는 시간(초)
  monkeySpeed: 3,                   // 원숭이 한 마리의 초당 타수
  stageHold: 0.9,                   // 문단 완성 후 다음 문단까지
  minCells: 1,                      // 한 도형을 이루는 삼각형 수 범위
  maxCells: 6,
  alphabetSize: 12,                 // 12키 자판 = 글자 12종 (한 번 눌러 맞을 확률 1/12)
  glyphSize: 5.2,                   // 글자판(큰 삼각형) 한 변
  glyphGap: 1.4,                    // 글자 사이
  lineGap: 6.6,                     // 문장(줄) 사이
  sentenceY: 9,                     // 문단 가운데 높이
  cellInset: 0.88,                  // 칸 사이 틈
  monkeyOffset: 6.5,                // 문장 왼쪽 끝에서 원숭이까지
  keyboardY: -16,
  keyboardTilt: -0.42,              // 자판이 책상 위에 놓인 듯 뒤로 눕힌 각도
  keyCols: 6,
  keyRows: 2,
  keySize: 4.6,
  keyGap: 0.8,
  keyGlyphSize: 3.4,                // 키 위에 그린 글자 크기
};

const IM_COLORS = {
  template: [0.20, 0.21, 0.24],     // 비어 있는 칸
  landing: [0.93, 0.90, 0.82],
  correct: [1.00, 0.83, 0.22],      // 원숭이가 맞힌 글자 (노란색)
  userCorrect: [0.98, 0.95, 0.80],  // 사용자가 맞힌 글자 (흰빛)
  wrong: [0.90, 0.16, 0.13],        // 오답 (붉은색)
  board: [0.16, 0.17, 0.20],
  key: [0.78, 0.76, 0.70],
  keyLit: [1.00, 0.92, 0.55],       // 원숭이가 누를 때
  keyUser: [0.62, 0.86, 1.00],      // 사용자가 누를 때
  keyHover: [0.95, 0.93, 0.86],
  keyGlyph: [0.12, 0.12, 0.14],
  monkey: [0.62, 0.42, 0.26],
};

const IM_CELL_NAMES = 'ABCDEFGHI';

let imRoot = null;
let imCellGeom = [];       // 큰 삼각형 기준 9칸의 꼭짓점 (로컬)
let imFill = null;         // 채워지는 삼각형 (최대 3줄 x 4글자 x 9칸, 동적)
let imTemplate = null;     // 빈 칸 판 (단계마다 다시 만듦)
let imKeys = [];
let imGlyphPool = [];      // 키 12개가 치는 글자(비트마스크), 키 번호와 같은 순서
let imLines = [];          // 문장: { y, slots: [{ cx, cy, target, mask, t0, ok, user, flash }], cur, monkey }
let imMonkeys = [];        // 원숭이 표시: { mesh, lastPress, accum }
let imState = { phase: 'waiting' };
let imHoverKey = -1;

function imClamp01(x) { return Math.min(1, Math.max(0, x)); }
function imSmooth(x) { x = imClamp01(x); return x * x * (3 - 2 * x); }
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

// 글자(비트마스크) 하나를 삼각형 꼭짓점 배열로 (가운데 원점, z 고정)
function imGlyphVertices(mask, S, z, inset) {
  const cells = imBuildCellGeometry(S);
  const out = [];
  cells.forEach((cell, ci) => {
    if (!((mask >> ci) & 1)) return;
    const gx = (cell[0][0] + cell[1][0] + cell[2][0]) / 3, gy = (cell[0][1] + cell[1][1] + cell[2][1]) / 3;
    cell.forEach(([vx, vy]) => out.push(gx + (vx - gx) * inset, gy + (vy - gy) * inset, z));
  });
  return out;
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
// 자판 글자 12종: 1~6칸 도형 중에서 서로 충분히 다른 것으로 고름 (최소 3칸 이상 다름)
function imBuildAlphabet(size) {
  const C = IM_CONFIG;
  const all = [];
  for (let m = 1; m < 512; m++) {
    const n = imPopcount(m);
    if (n >= Math.max(3, C.minCells) && n <= C.maxCells) all.push(m);
  }
  const set = [];
  for (let tries = 0; set.length < size && tries < 5000; tries++) {
    const m = all[Math.floor(Math.random() * all.length)];
    if (set.every((q) => imPopcount(q ^ m) >= 3)) set.push(m);
  }
  return set;
}

function initExperiment_InfiniteMonkey(scene, time) {
  imRoot = new THREE.Group();
  scene.add(imRoot);
  imCellGeom = imBuildCellGeometry(IM_CONFIG.glyphSize);
  imGlyphPool = imBuildAlphabet(IM_CONFIG.alphabetSize);
  imBuildFill();
  imBuildKeyboard();
  imState = { phase: 'waiting' };
}

function imBuildFill() {
  const C = IM_CONFIG;
  const n = C.stages * C.sentenceLength * 9; // 최대 칸 수 x 9
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
  const glyphMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(...IM_COLORS.keyGlyph), side: THREE.DoubleSide });
  for (let r = 0; r < C.keyRows; r++) {
    for (let c = 0; c < C.keyCols; c++) {
      const index = r * C.keyCols + c;
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(...IM_COLORS.key) });
      const key = new THREE.Mesh(keyGeom, mat);
      const x = (c - (C.keyCols - 1) / 2) * (C.keySize + C.keyGap);
      const y = ((C.keyRows - 1) / 2 - r) * (C.keySize + C.keyGap);
      key.position.set(x, y, 0.6);
      key.userData.keyIndex = index;
      group.add(key);

      // 키 윗면에 그 키의 글자를 그림
      const gg = new THREE.BufferGeometry();
      gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(imGlyphVertices(imGlyphPool[index], C.keyGlyphSize, 0.62, 0.86)), 3));
      const glyph = new THREE.Mesh(gg, glyphMat);
      glyph.position.y = -0.15;
      key.add(glyph);

      imKeys.push({ mesh: key, mat, baseZ: 0.6, lastPress: -100, userPress: false });
    }
  }
  imKeys.group = group;
}

// 원숭이 표시: 작은 삼각형 7개로 된 동글동글한 무리
function imBuildMonkeyMesh() {
  const pts = [[0, 1.1], [-1.0, 0.4], [1.0, 0.4], [0, 0], [-0.7, -0.8], [0.7, -0.8], [0, -1.4]];
  const s = 0.95, r = s / Math.sqrt(3);
  const pos = [];
  pts.forEach(([x, y], i) => {
    const d = i % 2 === 0 ? 1 : -1;
    pos.push(x, y + d * r, 0, x - s / 2, y - d * r / 2, 0, x + s / 2, y - d * r / 2, 0);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: new THREE.Color(...IM_COLORS.monkey), side: THREE.DoubleSide }));
}

// ---------------------------------------------------------
// 단계(문단) 만들기
// ---------------------------------------------------------
function imBuildStage(stage, time) {
  const C = IM_CONFIG;
  const nLines = stage + 1;
  const width = C.sentenceLength * C.glyphSize + (C.sentenceLength - 1) * C.glyphGap;

  // 원숭이 표시 정리
  imMonkeys.forEach((m) => { imRoot.remove(m.mesh); m.mesh.geometry.dispose(); m.mesh.material.dispose(); });
  imMonkeys = [];

  imLines = [];
  for (let li = 0; li < nLines; li++) {
    const y = C.sentenceY + ((nLines - 1) / 2 - li) * C.lineGap;
    const slots = [];
    for (let k = 0; k < C.sentenceLength; k++) {
      slots.push({
        cx: -width / 2 + C.glyphSize / 2 + k * (C.glyphSize + C.glyphGap),
        cy: y,
        target: imGlyphPool[Math.floor(Math.random() * imGlyphPool.length)],
        mask: 0, t0: -100, ok: false, user: false, flash: 0.3,
      });
    }
    const mesh = imBuildMonkeyMesh();
    mesh.position.set(-width / 2 - C.monkeyOffset, y - 0.4, 0);
    imRoot.add(mesh);
    imMonkeys.push({ mesh, lastPress: -100, accum: Math.random() });
    imLines.push({ y, slots, cur: 0 });
  }

  // 빈 칸 판
  if (imTemplate) { imRoot.remove(imTemplate); imTemplate.geometry.dispose(); imTemplate.material.dispose(); }
  const tpl = [];
  imLines.forEach((line) => line.slots.forEach((s) => {
    imCellGeom.forEach((cell) => {
      const gx = (cell[0][0] + cell[1][0] + cell[2][0]) / 3, gy = (cell[0][1] + cell[1][1] + cell[2][1]) / 3;
      cell.forEach(([vx, vy]) => tpl.push(s.cx + gx + (vx - gx) * C.cellInset, s.cy + gy + (vy - gy) * C.cellInset, -0.05));
    });
  }));
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tpl), 3));
  imTemplate = new THREE.Mesh(tg, new THREE.MeshBasicMaterial({ color: new THREE.Color(...IM_COLORS.template), side: THREE.DoubleSide }));
  imRoot.add(imTemplate);

  imState.stage = stage;
  imState.stagePhase = 'typing';
  imState.stageStart = time;
}

// ---------------------------------------------------------
// 시작 / 다시 하기
// ---------------------------------------------------------
function startGame_InfiniteMonkey(time) {
  imState = { phase: 'playing', startTime: time, stage: 0, monkeyHits: 0, userHits: 0, monkeyPresses: 0, userPresses: 0, result: null };
  imBuildStage(0, time);
}

function resetGame_InfiniteMonkey(time) {
  startGame_InfiniteMonkey(time);
}

// ---------------------------------------------------------
// 글자 넣기
// ---------------------------------------------------------
function imLineDone(line) { return line.cur >= line.slots.length; }

function imPut(line, mask, time, byUser) {
  const slot = line.slots[line.cur];
  slot.mask = mask;
  slot.t0 = time;
  slot.ok = mask === slot.target;
  slot.user = byUser;
  slot.flash = byUser ? 0.45 : Math.min(0.3, 0.9 / IM_CONFIG.monkeySpeed);
  if (slot.ok) {
    line.cur++;
    if (byUser) imState.userHits++; else imState.monkeyHits++;
  }
  return slot.ok;
}

// 원숭이 한 번 누르기: 무작위 키 -> 자기 문장의 지금 칸
function imMonkeyPress(li, time) {
  const line = imLines[li];
  if (imLineDone(line)) return;
  const keyIdx = Math.floor(Math.random() * imKeys.length);
  imKeys[keyIdx].lastPress = time;
  imKeys[keyIdx].userPress = false;
  imMonkeys[li].lastPress = time;
  imState.monkeyPresses++;
  imPut(line, imGlyphPool[keyIdx], time, false);
}

// 사용자가 키를 누름: 그 글자를 기다리는 문장(위에서부터)에 넣음
function pressKey_InfiniteMonkey(keyIndex, time) {
  if (imState.phase !== 'playing' || imState.stagePhase !== 'typing') return 'none';
  if (keyIndex < 0 || keyIndex >= imKeys.length) return 'none';
  imKeys[keyIndex].lastPress = time;
  imKeys[keyIndex].userPress = true;
  imState.userPresses++;
  const mask = imGlyphPool[keyIndex];
  const want = imLines.find((l) => !imLineDone(l) && l.slots[l.cur].target === mask);
  if (want) { imPut(want, mask, time, true); return 'ok'; }
  const first = imLines.find((l) => !imLineDone(l));
  if (first) imPut(first, mask, time, true);
  return 'wrong';
}

function getKeyMeshes_InfiniteMonkey() {
  return imKeys.map((k) => k.mesh);
}

function setHoverKey_InfiniteMonkey(i) {
  imHoverKey = i;
}

// ---------------------------------------------------------
// 매 프레임
// ---------------------------------------------------------
function updateExperiment_InfiniteMonkey(time, deltaTime) {
  if (!imRoot) return;
  const dt = Math.max(0, Math.min(0.1, deltaTime || 0));
  const st = imState;
  const C = IM_CONFIG;

  if (st.phase === 'playing') {
    // 제한 시간
    if (time - st.startTime >= C.timeLimit && st.stagePhase === 'typing') {
      st.phase = 'done';
      st.result = 'fail';
      st.endTime = time;
    }

    if (st.phase === 'playing' && st.stagePhase === 'typing') {
      // 원숭이들의 자동 타자
      imLines.forEach((line, li) => {
        const m = imMonkeys[li];
        m.accum += dt * C.monkeySpeed;
        let guard = 0;
        while (m.accum >= 1 && guard < 10) { m.accum -= 1; imMonkeyPress(li, time); guard++; }
      });
      // 문단 완성
      if (imLines.every(imLineDone)) {
        st.stagePhase = 'complete';
        st.completeAt = time;
        if (st.stage + 1 >= C.stages) {
          st.phase = 'done';
          st.result = 'win';
          st.endTime = time;
        }
      }
    } else if (st.stagePhase === 'complete' && time - st.completeAt >= C.stageHold) {
      imBuildStage(st.stage + 1, time);
    }
  }

  imUpdateKeys(time);
  imUpdateMonkeys(time);
  imWriteFill(time);
}

function imUpdateKeys(time) {
  const dur = 0.22;
  imKeys.forEach((k, i) => {
    const p = 1 - imSmooth((time - k.lastPress) / dur);
    k.mesh.position.z = k.baseZ - 0.55 * p;
    const base = i === imHoverKey ? IM_COLORS.keyHover : IM_COLORS.key;
    const lit = k.userPress ? IM_COLORS.keyUser : IM_COLORS.keyLit;
    k.mat.color.setRGB(base[0] + (lit[0] - base[0]) * p, base[1] + (lit[1] - base[1]) * p, base[2] + (lit[2] - base[2]) * p);
    const s = i === imHoverKey ? 1.06 : 1;
    k.mesh.scale.set(s, s, 1);
  });
}

function imUpdateMonkeys(time) {
  imMonkeys.forEach((m, i) => {
    const p = 1 - imSmooth((time - m.lastPress) / 0.18);
    m.mesh.scale.setScalar(1 + 0.25 * p);
    m.mesh.rotation.z = Math.sin(time * 3 + i) * 0.12;
  });
}

function imWriteFill(time) {
  const C = IM_CONFIG, st = imState;
  const P = imFill.pos.array, Cc = imFill.col.array;
  let completeGlow = 0;
  if (st.stagePhase === 'complete') completeGlow = 0.5 + 0.5 * Math.sin((time - st.completeAt) * 8);

  let si = 0;
  imLines.forEach((line) => line.slots.forEach((s) => {
    const after = time - s.t0;
    let scale = 1, color = IM_COLORS.landing, glow = 0;
    if (s.mask === 0) scale = 0;
    else if (s.ok) {
      color = s.user ? IM_COLORS.userCorrect : IM_COLORS.correct;
      glow = Math.max(0, 0.5 - after * 1.5) + completeGlow * 0.3;
    } else {
      color = IM_COLORS.wrong;
      const f = imClamp01(after / s.flash);
      scale = 1 - imSmooth((f - 0.4) / 0.6);   // 붉게 점등 후 사라짐
      glow = Math.max(0, 0.35 - f);
    }
    for (let ci = 0; ci < 9; ci++) {
      const idx = si * 9 + ci;
      const on = (s.mask >> ci) & 1;
      const cell = imCellGeom[ci];
      const gx = (cell[0][0] + cell[1][0] + cell[2][0]) / 3, gy = (cell[0][1] + cell[1][1] + cell[2][1]) / 3;
      const k = on ? C.cellInset * scale : 0;
      for (let v = 0; v < 3; v++) {
        const o = idx * 9 + v * 3;
        P[o] = s.cx + gx + (cell[v][0] - gx) * k;
        P[o + 1] = s.cy + gy + (cell[v][1] - gy) * k;
        P[o + 2] = 0.05;
        Cc[o] = Math.min(1, color[0] + glow);
        Cc[o + 1] = Math.min(1, color[1] + glow);
        Cc[o + 2] = Math.min(1, color[2] + glow);
      }
    }
    si++;
  }));
  // 쓰지 않는 칸은 숨김
  for (let o = si * 81; o < imFill.n * 9; o++) P[o] = 0;
  imFill.pos.needsUpdate = true;
  imFill.col.needsUpdate = true;
}

// ---------------------------------------------------------
// 화면 표시용
// ---------------------------------------------------------
function getGame_InfiniteMonkey(time) {
  const st = imState;
  const C = IM_CONFIG;
  const elapsed = st.phase === 'playing' ? time - st.startTime : st.phase === 'done' ? st.endTime - st.startTime : 0;
  let filled = 0, total = 0;
  imLines.forEach((l) => { filled += Math.min(l.cur, l.slots.length); total += l.slots.length; });
  return {
    phase: st.phase,
    stage: st.stage || 0,
    stages: C.stages,
    monkeys: imLines.length,
    filled, total,
    timeLeft: Math.max(0, C.timeLimit - elapsed),
    timeLimit: C.timeLimit,
    stageComplete: st.stagePhase === 'complete',
    monkeyHits: st.monkeyHits || 0,
    userHits: st.userHits || 0,
    monkeyPresses: st.monkeyPresses || 0,
    userPresses: st.userPresses || 0,
    result: st.result || null,
  };
}
