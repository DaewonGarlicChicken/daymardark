// =========================================================
// 공통 템플릿 스크립트
// - 사고실험 목록, 제목바/목차 사이드바 생성, 메뉴 토글 동작
// - 사고실험 내용(캔버스, 컨트롤 패널 등)은 포함하지 않음
// -----------------------------------------------------------
// 사용법 (각 사고실험 HTML 페이지에서):
//   <link rel="stylesheet" href="./template.css">
//   <script src="./template.js"></script>
//   <script>
//     initPageTemplate({
//       title: "Thought Experiment 0 0 1 - Theseus's Ship",
//       activeId: 1,
//     });
//   <\/script>
// =========================================================

// 3D 장면은 책상 위 보고서 종이에 그려지도록 캔버스 바탕을 투명하게 (각 페이지 코드는 그대로)
(function () {
  try {
    if (typeof THREE === 'undefined' || !THREE.WebGLRenderer || THREE.WebGLRenderer.__paper) return;
    const Base = THREE.WebGLRenderer;
    const Paper = function (o) {
      const r = new Base(Object.assign({}, o || {}, { alpha: true }));
      r.setClearColor(0x000000, 0);
      return r;
    };
    Paper.prototype = Base.prototype;
    Paper.__paper = true;
    THREE.WebGLRenderer = Paper;
  } catch (e) { /* 바꿀 수 없으면 원래대로 */ }
})();

// 전체 사고실험 목차. href가 null이면 아직 안 만들어진 것 (목차에는 뜨지만 비활성)
const THOUGHT_EXPERIMENTS = [
  { id: 1, title: "0 0 1: Theseus's Ship", href: 'theseus-galley.html' },
  { id: 2, title: '0 0 2: Bolzmann Brain', href: 'boltzmann-brain.html' },
  { id: 3, title: '0 0 3: the Chinese room argument', href: 'chinese-room.html' },
  { id: 4, title: '0 0 4: Trolley dilemma', href: 'trolley-dilemma.html' },
  { id: 5, title: '0 0 5: Infinite monkey theorem', href: 'infinite-monkey.html' },
  { id: 6, title: "0 0 6: Buridan's donkey", href: 'buridan-donkey.html' },
  { id: 7, title: '0 0 7: Quantum suicide and immortality', href: 'quantum-immortality.html' },
  { id: 8, title: '0 0 8: Maxwell\'s Demon', href: 'maxwell-demon.html' },
];

// 모든 사고실험을 클리어하면 열리는 무한모드 (index 맨 밑과 목차 맨 밑에 나타남)
const INFINITE_MODE = { id: 'infinite', title: '[무한모드]', href: 'infinite-mode.html' };
// 모든 사고실험을 클리어하면 열리는 기록 페이지 (사고실험별 걸린 시간 / 재도전 횟수 / 클릭 횟수)
const RECORDS_PAGE = { id: 'records', title: '[기록]', href: 'records.html' };

// =========================================================
// 클리어 기록 (브라우저 sessionStorage에 저장)
//  - 같은 창(탭) 안에서 페이지를 오가는 동안은 유지되고,
//    브라우저(또는 탭)를 닫았다가 사이트를 새로 열면 처음부터 (클리어 기록 초기화)
// -----------------------------------------------------------
//  GameProgress.markCleared(id)  -> 클리어 기록. 이번 클리어로 "모두 클리어"가 되었으면 true
//  GameProgress.isCleared(id) / allCleared()
//  GameProgress.unlockAll() / reset()   (확인용: 주소 끝에 ?unlock 또는 ?reset-progress)
//  GameProgress.setJustUnlocked() / consumeJustUnlocked()  -> 처음 화면에서 [무한모드]가 새로 열리는 연출용
// =========================================================
const GameProgress = (function () {
  const KEY = 'tel_cleared_v1';
  const JUST = 'tel_just_unlocked';
  function load() {
    try {
      const v = JSON.parse(sessionStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function save(list) { try { sessionStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* 저장 불가 환경 */ } }
  try { localStorage.removeItem(KEY); } catch (e) { /* 예전 방식(계속 남는 기록)으로 저장된 것은 지움 */ }
  function isCleared(id) { return load().indexOf(id) >= 0; }
  function allCleared() {
    const c = load();
    return THOUGHT_EXPERIMENTS.every((e) => c.indexOf(e.id) >= 0);
  }
  function markCleared(id) {
    const before = allCleared();
    const c = load();
    if (c.indexOf(id) < 0) { c.push(id); save(c); }
    return !before && allCleared();
  }
  function unlockAll() { save(THOUGHT_EXPERIMENTS.map((e) => e.id)); }
  function reset() { save([]); }
  function setJustUnlocked() { try { sessionStorage.setItem(JUST, '1'); } catch (e) { /* */ } }
  function consumeJustUnlocked() {
    try {
      const v = sessionStorage.getItem(JUST) === '1';
      sessionStorage.removeItem(JUST);
      return v;
    } catch (e) { return false; }
  }
  return { markCleared, isCleared, allCleared, unlockAll, reset, setJustUnlocked, consumeJustUnlocked };
})();

// =========================================================
// 플레이 기록 (사고실험마다: 걸린 시간 / 재도전 횟수 / 클릭 횟수) - 클리어 기록과 같이 sessionStorage
// -----------------------------------------------------------
//  - 걸린 시간: 그 페이지에서 처음 클릭(시작 화면 클릭)한 때부터 처음 클리어할 때까지,
//    그 페이지를 보고 있던 시간만 더함 (다른 페이지로 갔다 오거나 탭을 숨긴 동안은 빼고)
//  - 재도전 횟수: 성공/실패 화면에서 '다시 하기'를 누른 횟수
//  - 클릭 횟수: 게임 화면을 누른 횟수 (목차/버튼은 빼고)
//  - 처음 클리어한 순간 기록이 고정됨 (그 뒤에 다시 해도 바뀌지 않음)
//  GameStats.get(id) -> { time(초), retries, clicks, done } 또는 null
// =========================================================
const GameStats = (function () {
  const KEY = 'tel_stats_v1';
  let id = null, t0 = 0, running = false;
  function all() { try { return JSON.parse(sessionStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveAll(o) { try { sessionStorage.setItem(KEY, JSON.stringify(o)); } catch (e) { /* */ } }
  function edit(fn) {
    if (typeof id !== 'number') return;
    const o = all();
    const r = o[id] || { time: 0, retries: 0, clicks: 0, done: false };
    if (r.done) return;
    fn(r);
    o[id] = r;
    saveAll(o);
  }
  function now() { return (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000; }
  function flush() {
    if (!running) return;
    const t = now(), dt = t - t0;
    t0 = t;
    edit((r) => { r.time += dt; });
  }
  function isUi(target) {
    return target && target.closest && target.closest('#menuToggleBtn, #tocSidebar, #gameResult, #gameHud .gh-action, a, button');
  }
  function begin(pageId) {
    id = pageId;
    if (typeof id !== 'number') return;
    // 템플릿이 페이지 스크립트보다 먼저 등록하므로, 시작 화면 클릭도 셈
    window.addEventListener('pointerdown', (e) => {
      if (isUi(e.target)) return;
      edit((r) => { r.clicks++; });
      if (!running && document.visibilityState !== 'hidden') { running = true; t0 = now(); }
    }, true);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { flush(); running = false; }
      else if (wasStarted()) { running = true; t0 = now(); }
    });
    window.addEventListener('pagehide', flush);
    // 페이지를 다시 연 경우(다시 하기로 새로고침 등): 이미 시작했던 실험이면 바로 이어서 잼
    if (wasStarted()) { running = true; t0 = now(); }
  }
  function wasStarted() { const r = all()[id]; return !!(r && !r.done && (r.clicks > 0 || r.time > 0)); }
  function retry() { flush(); edit((r) => { r.retries++; }); }
  function finish() { flush(); edit((r) => { r.done = true; }); running = false; }
  function get(pid) { const r = all()[pid]; return r && r.done ? r : null; }
  function reset() { try { sessionStorage.removeItem(KEY); } catch (e) { /* */ } }
  return { begin, retry, finish, get, reset };
})();

// 확인용 주소 옵션: ...html?unlock -> 모두 클리어한 것으로, ...html?reset-progress -> 기록 지우기
(function () {
  try {
    const q = window.location.search || '';
    if (/[?&]unlock\b/.test(q)) GameProgress.unlockAll();
    if (/[?&]reset-progress\b/.test(q)) { GameProgress.reset(); GameStats.reset(); }
  } catch (e) { /* */ }
})();

let TEMPLATE_PAGE_ID = null; // 지금 페이지의 사고실험 번호 (initPageTemplate의 activeId)

function initPageTemplate(options) {
  const opts = options || {};
  TEMPLATE_PAGE_ID = opts.activeId !== undefined ? opts.activeId : null;
  GameStats.begin(TEMPLATE_PAGE_ID);

  document.body.classList.add('tpl-page');

  // ---------- 책상 위 보고서 종이 (줄 그은 공책 + 바인더 구멍) ----------
  const sheet = document.createElement('div');
  sheet.id = 'paperSheet';
  document.body.insertBefore(sheet, document.body.firstChild);
  const holes = document.createElement('div');
  holes.id = 'paperHoles';
  document.body.appendChild(holes);

  // ---------- 문서 머리 (제목바): REPORT No.003 / 제목 / p. 3 / 8 ----------
  const topBar = document.createElement('div');
  topBar.id = 'topBar';
  topBar.innerHTML = `<div class="tb-row"><span class="tb-left"></span><h1></h1><span class="tb-right"></span></div><hr />`;
  const head = templateHeader(opts);
  topBar.querySelector('.tb-left').textContent = head.left;
  topBar.querySelector('h1').textContent = head.center;
  topBar.querySelector('.tb-right').textContent = head.right;
  topBar.title = opts.title || document.title;
  document.body.appendChild(topBar);

  // ---------- 목차 토글 버튼 ----------
  const menuToggleBtn = document.createElement('button');
  menuToggleBtn.id = 'menuToggleBtn';
  menuToggleBtn.innerHTML = '<span class="glyph">&#9776;</span>';
  document.body.appendChild(menuToggleBtn);

  // ---------- 목차 사이드바 ----------
  const tocSidebar = document.createElement('div');
  tocSidebar.id = 'tocSidebar';

  let menuOpen = false;
  function setMenuOpen(open) {
    menuOpen = open;
    document.body.classList.toggle('menu-open', menuOpen);
    menuToggleBtn.innerHTML = menuOpen
      ? '<span class="chevron"></span>'             // ⌄ (선으로 그림)
      : '<span class="glyph">&#9776;</span>';       // ☰
  }

  // 사이드바 왼쪽 위: index(처음 화면)로 돌아가는 버튼
  const homeLink = document.createElement('a');
  homeLink.id = 'tocHome';
  homeLink.href = 'index.html';
  homeLink.innerHTML = '&#8592; 이상한 사고실험실'; // ← 이상한 사고실험실
  tocSidebar.appendChild(homeLink);

  THOUGHT_EXPERIMENTS.forEach((exp) => {
    const item = document.createElement('div');
    item.className = 'tocItem';
    item.textContent = exp.title;
    if (GameProgress.isCleared(exp.id)) item.classList.add('cleared'); // 클리어한 실험은 작은 표시

    if (exp.id === opts.activeId) {
      item.classList.add('active');
      item.addEventListener('click', () => setMenuOpen(false));
    } else if (exp.href) {
      item.addEventListener('click', () => { window.location.href = exp.href; });
    } else {
      item.classList.add('disabled'); // 아직 만들어지지 않은 사고실험
    }

    tocSidebar.appendChild(item);
  });

  // 모두 클리어했으면 목차 맨 밑에 [무한모드]
  if (GameProgress.allCleared() || opts.activeId === INFINITE_MODE.id) {
    const item = document.createElement('div');
    item.className = 'tocItem tocInfinite';
    item.textContent = INFINITE_MODE.title;
    if (opts.activeId === INFINITE_MODE.id) {
      item.classList.add('active');
      item.addEventListener('click', () => setMenuOpen(false));
    } else {
      item.addEventListener('click', () => { window.location.href = INFINITE_MODE.href; });
    }
    tocSidebar.appendChild(item);
  }
  // 모두 클리어했으면 [무한모드] 아래에 [기록]
  if (GameProgress.allCleared() || opts.activeId === RECORDS_PAGE.id) tocSidebar.appendChild(makeRecordsTocItem(opts.activeId === RECORDS_PAGE.id, setMenuOpen));

  document.body.appendChild(tocSidebar);

  menuToggleBtn.addEventListener('click', () => setMenuOpen(!menuOpen));

  return { setMenuOpen };
}

// 문서 머리에 들어갈 글자: 사고실험이면 번호/제목/쪽, 아니면 opts.header 또는 제목
function templateHeader(opts) {
  if (opts.header) return { left: opts.header.left || '', center: opts.header.center || '', right: opts.header.right || '' };
  const exp = THOUGHT_EXPERIMENTS.find((e) => e.id === opts.activeId);
  if (exp) {
    const name = exp.title.split(': ').slice(1).join(': ') || exp.title;
    return { left: 'REPORT No.' + String(exp.id).padStart(3, '0'), center: name, right: `p. ${exp.id} / ${THOUGHT_EXPERIMENTS.length}` };
  }
  return { left: '', center: opts.title || document.title, right: '' };
}

function makeRecordsTocItem(active, setMenuOpen) {
  const item = document.createElement('div');
  item.className = 'tocItem tocInfinite tocRecords';
  item.textContent = RECORDS_PAGE.title;
  if (active) {
    item.classList.add('active');
    item.addEventListener('click', () => setMenuOpen && setMenuOpen(false));
  } else {
    item.addEventListener('click', () => { window.location.href = RECORDS_PAGE.href; });
  }
  return item;
}

// =========================================================
// 공통 게임 UI: 목표 패널(왼쪽 위) + 성공/실패 화면(가운데)
// -----------------------------------------------------------
//  GameUI.initHud({ goal })              -> 목표 패널을 만듦 (본 화면 시작 시)
//  GameUI.setStatus(html)                -> 진행 상황 줄 (예: "기억 3 / 15")
//  GameUI.setHint(text, warn)            -> 지금 할 일 안내 (warn=true면 강조색)
//  GameUI.setAction(label, onClick)      -> 패널 안 버튼 (label이 null이면 숨김)
//  GameUI.showResult({ success, title, original, question, retryText, onRetry, extra: { text, href } })
//    - 사고실험 페이지에서 success로 끝나면 자동으로 클리어가 기록됨
//    - 그 클리어로 8개를 모두 깼다면: 무한모드가 열렸다는 문구 + "기록 보기" 버튼(records.html)
//    - 성공하면 '다시 하기' 옆에 '다음으로' (다음 번호의 사고실험 / 8번 다음은 처음 화면)
//  GameUI.hideResult()
// =========================================================
const GameUI = (function () {
  let hud = null, overlay = null;

  function initHud(opts) {
    if (hud) hud.remove();
    hud = document.createElement('div');
    hud.id = 'gameHud';
    hud.innerHTML = '<div class="gh-goal"></div><div class="gh-status"></div><div class="gh-hint"></div><button class="gh-action" style="display:none"></button>';
    hud.querySelector('.gh-goal').textContent = '목표: ' + (opts && opts.goal ? opts.goal : '');
    document.body.appendChild(hud);
    requestAnimationFrame(() => hud.classList.add('show'));
    return hud;
  }
  function setStatus(html) { if (hud) hud.querySelector('.gh-status').innerHTML = html; }
  function setHint(text, warn) {
    if (!hud) return;
    const el = hud.querySelector('.gh-hint');
    el.textContent = text || '';
    el.classList.toggle('warn', !!warn);
  }
  function setAction(label, onClick) {
    if (!hud) return;
    const btn = hud.querySelector('.gh-action');
    if (!label) { btn.style.display = 'none'; btn.onclick = null; return; }
    btn.textContent = label;
    btn.style.display = 'inline-block';
    btn.onclick = (e) => { e.stopPropagation(); onClick && onClick(); };
  }

  function showResult(o) {
    hideResult();
    // 사고실험 페이지(번호가 있는 페이지)에서 목표 완료 -> 클리어 기록
    let justUnlocked = false;
    if (o.success && typeof TEMPLATE_PAGE_ID === 'number') {
      GameStats.finish(); // 처음 클리어한 순간의 기록을 고정
      justUnlocked = GameProgress.markCleared(TEMPLATE_PAGE_ID);
      if (justUnlocked) GameProgress.setJustUnlocked(); // 처음 화면에 [무한모드]가 떠오르는 연출
    }
    overlay = document.createElement('div');
    overlay.id = 'gameResult';
    overlay.className = o.success ? 'success' : 'fail';
    // 보고서 카드: 위로 튀어나온 인덱스 탭 + 클립
    const wrap = document.createElement('div');
    wrap.className = 'gr-tabwrap';
    const tab = document.createElement('div');
    tab.className = 'gr-tab';
    tab.textContent = typeof TEMPLATE_PAGE_ID === 'number' ? 'RESULT No.' + String(TEMPLATE_PAGE_ID).padStart(3, '0') : 'RESULT';
    const clip = document.createElement('div');
    clip.className = 'gr-clip';
    const box = document.createElement('div');
    box.className = 'gr-box';
    wrap.appendChild(tab);
    wrap.appendChild(clip);
    wrap.appendChild(box);
    const add = (cls, text, html) => {
      if (!text && !html) return;
      const d = document.createElement('div');
      d.className = cls;
      if (html) d.innerHTML = html; else d.textContent = text;
      box.appendChild(d);
    };
    // 제목 + 도장 (성공 CLEARED / 실패 FAILED)
    const headRow = document.createElement('div');
    headRow.className = 'gr-head';
    const title = document.createElement('div');
    title.className = 'gr-title';
    title.textContent = o.title || (o.success ? '목표 완료' : '실패');
    const stamp = document.createElement('div');
    stamp.className = 'gr-stamp';
    stamp.textContent = o.stamp || (o.success ? 'CLEARED' : 'FAILED');
    headRow.appendChild(title);
    headRow.appendChild(stamp);
    box.appendChild(headRow);
    add('gr-original', null, o.original);   // 실험 원문 (HTML 허용: <br> 등)
    add('gr-question', o.question);
    if (justUnlocked) {
      add('gr-unlock', null, '모든 사고실험을 클리어했다.<br>지금까지의 <b>[기록]</b>을 확인하라. 처음 화면에는 <b>[무한모드]</b>가 열렸다.');
    }
    const row = document.createElement('div');
    row.className = 'gr-buttons';
    box.appendChild(row);
    if (justUnlocked) {
      // 모두 클리어: 기록 페이지로 가는 버튼이 먼저 (기록 페이지 맨 밑에 '처음 화면으로')
      const rec = document.createElement('button');
      rec.className = 'gr-retry gr-primary';
      rec.textContent = '기록 보기';
      rec.onclick = (e) => { e.stopPropagation(); window.location.href = RECORDS_PAGE.href; };
      row.appendChild(rec);
    }
    const btn = document.createElement('button');
    btn.className = 'gr-retry';
    btn.textContent = o.retryText || '다시 하기';
    // 다시 하기 = 재도전 (클리어한 뒤의 다시 하기는 기록이 고정되어 있어 세지 않음)
    btn.onclick = (e) => { e.stopPropagation(); GameStats.retry(); hideResult(); o.onRetry && o.onRetry(); };
    row.appendChild(btn);
    // 사고실험 페이지에서 성공: 다시 하기 옆에 '다음으로' (다음 번호의 사고실험, 8번 다음은 처음 화면)
    //  - 8개를 모두 깨서 '처음 화면으로'가 이미 있으면 겹치지 않게 생략
    const next = nextPageHref();
    if (o.success && next && !justUnlocked) {
      const nb = document.createElement('button');
      nb.className = 'gr-retry';
      nb.textContent = '다음으로';
      nb.onclick = (e) => { e.stopPropagation(); window.location.href = next; };
      row.appendChild(nb);
    }
    if (o.extra) {
      const ex = document.createElement('button');
      ex.className = 'gr-retry';
      ex.textContent = o.extra.text;
      ex.onclick = (e) => { e.stopPropagation(); window.location.href = o.extra.href; };
      row.appendChild(ex);
    }
    overlay.appendChild(wrap);
    // 화면 클릭이 뒤의 장면으로 전달되지 않게
    ['mousedown', 'mouseup', 'click', 'wheel'].forEach((ev) => overlay.addEventListener(ev, (e) => e.stopPropagation()));
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
  }
  // 지금 사고실험의 다음 페이지 (무한모드 등 번호가 없는 페이지면 null)
  function nextPageHref() {
    if (typeof TEMPLATE_PAGE_ID !== 'number') return null;
    const i = THOUGHT_EXPERIMENTS.findIndex((e) => e.id === TEMPLATE_PAGE_ID);
    if (i < 0) return null;
    for (let k = i + 1; k < THOUGHT_EXPERIMENTS.length; k++) if (THOUGHT_EXPERIMENTS[k].href) return THOUGHT_EXPERIMENTS[k].href;
    return 'index.html';
  }
  function hideResult() { if (overlay) { overlay.remove(); overlay = null; } }
  function isResultOpen() { return !!overlay; }

  return { initHud, setStatus, setHint, setAction, showResult, hideResult, isResultOpen };
})();

// =========================================================
// 숨은 커맨드 (코나미 커맨드처럼 키보드로 입력)
// -----------------------------------------------------------
//  ↑ ↑ ↓ ↓ A   : 지금 보고 있는 사고실험을 바로 클리어 (무한모드에서는 지금 미니게임을 바로 성공)
//  ← → ← → B   : [무한모드]를 바로 열기
//  (한글 입력 상태여도 동작하도록 키 위치(code)로 판단)
// =========================================================
(function () {
  const CMD_CLEAR = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'KeyA'];
  const CMD_UNLOCK = ['ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB'];
  const buf = [];
  const ends = (seq) => seq.every((k, i) => buf[buf.length - seq.length + i] === k);

  // 입력 알림 (template.css를 쓰지 않는 처음 화면에서도 보이도록 스타일을 직접 지정)
  function toast(text) {
    let el = document.getElementById('cmdToast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'cmdToast';
      Object.assign(el.style, {
        position: 'fixed', bottom: '48px', left: '50%', transform: 'translateX(-50%)', zIndex: '30',
        color: '#24221e', background: '#ece3a6', padding: '8px 18px', boxShadow: '2px 4px 10px rgba(0,0,0,0.25)',
        fontFamily: "'Courier Prime', 'Nanum Gothic Coding', monospace", fontWeight: '700', fontSize: '15px', textAlign: 'center',
        lineHeight: '1.6', letterSpacing: '0.08em', pointerEvents: 'none', opacity: '0', whiteSpace: 'nowrap',
      });
      document.body.appendChild(el);
    }
    el.innerHTML = text;
    if (el.animate) {
      el.animate([
        { opacity: 0, transform: 'translate(-50%, 8px)' },
        { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.12 },
        { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.75 },
        { opacity: 0, transform: 'translate(-50%, 0)' },
      ], { duration: 2400, easing: 'ease' });
    }
  }

  function cheatClear() {
    // 무한모드: 지금 미니게임을 바로 성공
    if (typeof InfiniteMode !== 'undefined' && InfiniteMode.cheatWin) {
      if (InfiniteMode.cheatWin()) toast('↑ ↑ ↓ ↓ A');
      return;
    }
    if (typeof TEMPLATE_PAGE_ID !== 'number') return; // 처음 화면 등에서는 동작 안 함
    toast('↑ ↑ ↓ ↓ A');
    // 각 페이지의 원문/질문(ORIGINAL_HTML, QUESTION)을 그대로 보여줌
    const pageValue = (name) => { try { return (0, eval)(name) || ''; } catch (e) { return ''; } };
    GameUI.showResult({
      success: true,
      title: '목표 완료',
      original: pageValue('ORIGINAL_HTML'),
      question: pageValue('QUESTION'),
      retryText: '다시 하기',
      onRetry: () => window.location.reload(),
    });
  }

  function cheatUnlock() {
    const was = GameProgress.allCleared();
    GameProgress.unlockAll();
    toast(was ? '[무한모드]는 이미 열려 있다' : '← → ← → B<br>[무한모드]가 열렸다');
    if (was) return;
    // 목차 맨 밑에 [무한모드] 추가
    const side = document.getElementById('tocSidebar');
    if (side && !side.querySelector('.tocInfinite')) {
      side.querySelectorAll('.tocItem').forEach((it) => { if (!it.classList.contains('tocInfinite')) it.classList.add('cleared'); });
      const item = document.createElement('div');
      item.className = 'tocItem tocInfinite';
      item.textContent = INFINITE_MODE.title;
      item.addEventListener('click', () => { window.location.href = INFINITE_MODE.href; });
      side.appendChild(item);
      if (!side.querySelector('.tocRecords')) side.appendChild(makeRecordsTocItem(false));
    }
    // 처음 화면이면 목록 맨 밑에 바로 나타나게, 무한모드의 잠긴 화면이면 새로고침
    window.dispatchEvent(new Event('tel-unlocked'));
    if ((typeof INFINITE_PAGE_LOCKED !== 'undefined' && INFINITE_PAGE_LOCKED) || (typeof RECORDS_PAGE_LOCKED !== 'undefined' && RECORDS_PAGE_LOCKED)) setTimeout(() => window.location.reload(), 900);
  }

  window.addEventListener('keydown', (e) => {
    buf.push(e.code);
    if (buf.length > 8) buf.shift();
    if (ends(CMD_CLEAR)) { buf.length = 0; cheatClear(); }
    else if (ends(CMD_UNLOCK)) { buf.length = 0; cheatUnlock(); }
  });
})();
