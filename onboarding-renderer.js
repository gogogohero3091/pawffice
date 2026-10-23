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

function updateStartEnabled() {
  startBtn.disabled = !selectedBreed;
}

nameInput.value = current.name || '';
renderBreedList();
updateStartEnabled();

startBtn.addEventListener('click', () => {
  if (!selectedBreed) return;
  window.onboardingAPI.submit({ breed: selectedBreed, name: nameInput.value.trim() });
});

// 이름 입력창에서 엔터 쳐도 바로 시작되게.
nameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !startBtn.disabled) startBtn.click();
});
