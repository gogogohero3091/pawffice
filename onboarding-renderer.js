// 온보딩(견종/이름 설정) 화면 로직.
// 처음 실행이면 breeds 목록만 있고 currentSettings는 {} - 아무것도 안 골라진 상태로 시작.
// 트레이 메뉴로 "설정 변경"을 눌러서 다시 열었으면 currentSettings에 기존 값이 들어있어서
// 그 견종/이름이 미리 선택/입력된 채로 열려요(있던 값을 바꾸는 느낌으로).
const breeds = window.onboardingAPI.breeds;
const current = window.onboardingAPI.currentSettings || {};

const listEl = document.getElementById('breed-list');
const nameInput = document.getElementById('name-input');
const startBtn = document.getElementById('start-btn');

let selectedBreed = breeds.some((b) => b.id === current.breed) ? current.breed : null;

function renderBreedList() {
  listEl.innerHTML = '';
  breeds.forEach((b) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'breed-card' + (b.id === selectedBreed ? ' selected' : '');
    card.innerHTML = `<img src="${b.thumb}" alt="${b.label}" /><span>${b.label}</span>`;
    card.addEventListener('click', () => {
      selectedBreed = b.id;
      renderBreedList();
      updateStartEnabled();
    });
    listEl.appendChild(card);
  });
}

// (2026-10-23 변경) 이름도 견종이랑 같이 필수로 바꿨어요 - 이전엔 이름 안 써도 시작이
// 눌렸는데, placeholder("예: 콩이")는 말 그대로 힌트일 뿐 실제 값이 아니라서 빈 이름으로
// 시작되는 경우가 있었어요(트레이 메뉴 등 여러 군데서 이름을 그대로 보여주는데 비어있으면
// 어색함). 이름 입력창에 뭔가 쳐야만 "시작" 버튼이 눌리게 함.
function updateStartEnabled() {
  startBtn.disabled = !selectedBreed || !nameInput.value.trim();
}

nameInput.value = current.name || '';
renderBreedList();
updateStartEnabled();
nameInput.addEventListener('input', updateStartEnabled);

startBtn.addEventListener('click', () => {
  if (!selectedBreed) return;
  window.onboardingAPI.submit({ breed: selectedBreed, name: nameInput.value.trim() });
});

// 이름 입력창에서 엔터 쳐도 바로 시작되게.
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !startBtn.disabled) startBtn.click();
});
