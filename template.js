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

function initPageTemplate(options) {
  const opts = options || {};

  // ---------- 상단 타이틀 바 ----------
  const topBar = document.createElement('div');
  topBar.id = 'topBar';
  topBar.innerHTML = `<h1></h1><hr />`;
  topBar.querySelector('h1').textContent = opts.title || document.title;
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

  document.body.appendChild(tocSidebar);

  menuToggleBtn.addEventListener('click', () => setMenuOpen(!menuOpen));

  return { setMenuOpen };
}

// =========================================================
// 공통 게임 UI: 목표 패널(왼쪽 위) + 성공/실패 화면(가운데)
// -----------------------------------------------------------
//  GameUI.initHud({ goal })              -> 목표 패널을 만듦 (본 화면 시작 시)
//  GameUI.setStatus(html)                -> 진행 상황 줄 (예: "기억 3 / 15")
//  GameUI.setHint(text, warn)            -> 지금 할 일 안내 (warn=true면 강조색)
//  GameUI.setAction(label, onClick)      -> 패널 안 버튼 (label이 null이면 숨김)
//  GameUI.showResult({ success, title, original, question, retryText, onRetry })
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
    overlay = document.createElement('div');
    overlay.id = 'gameResult';
    overlay.className = o.success ? 'success' : 'fail';
    const box = document.createElement('div');
    box.className = 'gr-box';
    const add = (cls, text, html) => {
      if (!text && !html) return;
      const d = document.createElement('div');
      d.className = cls;
      if (html) d.innerHTML = html; else d.textContent = text;
      box.appendChild(d);
    };
    add('gr-title', o.title || (o.success ? '목표 완료' : '실패'));
    add('gr-original', null, o.original);   // 실험 원문 (HTML 허용: <br> 등)
    add('gr-question', o.question);
    const btn = document.createElement('button');
    btn.className = 'gr-retry';
    btn.textContent = o.retryText || '다시 하기';
    btn.onclick = (e) => { e.stopPropagation(); hideResult(); o.onRetry && o.onRetry(); };
    box.appendChild(btn);
    overlay.appendChild(box);
    // 화면 클릭이 뒤의 장면으로 전달되지 않게
    ['mousedown', 'mouseup', 'click', 'wheel'].forEach((ev) => overlay.addEventListener(ev, (e) => e.stopPropagation()));
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('show'));
  }
  function hideResult() { if (overlay) { overlay.remove(); overlay = null; } }
  function isResultOpen() { return !!overlay; }

  return { initHud, setStatus, setHint, setAction, showResult, hideResult, isResultOpen };
})();
