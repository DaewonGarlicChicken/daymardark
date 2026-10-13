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
