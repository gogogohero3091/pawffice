const input = document.getElementById('msg-input');
const count = document.getElementById('count');
const pinBtn = document.getElementById('pin-btn');
const clearBtn = document.getElementById('clear-btn');

input.value = window.messageAPI.currentMessage || '';

function updateCount() {
  count.textContent = String(input.value.length);
}
updateCount();
input.addEventListener('input', updateCount);

pinBtn.addEventListener('click', () => {
  window.messageAPI.submit(input.value.trim());
});

clearBtn.addEventListener('click', () => {
  input.value = '';
  updateCount();
  window.messageAPI.clear();
});

// Cmd/Ctrl+Enter로 바로 고정.
input.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') pinBtn.click();
});
