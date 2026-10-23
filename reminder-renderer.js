const textInput = document.getElementById('msg-input');
const count = document.getElementById('count');
const intervalInput = document.getElementById('interval-input');
const saveBtn = document.getElementById('save-btn');
const toggle = document.getElementById('enabled-toggle');
const statusText = document.getElementById('status-text');
const statusSub = document.getElementById('status-sub');
const textField = document.getElementById('text-field');
const intervalField = document.getElementById('interval-field');

const current = window.reminderAPI.current || {};
textInput.value = current.text || '';
intervalInput.value = current.intervalMin || 60;
toggle.checked = !!current.enabled;

function updateCount() {
  count.textContent = String(textInput.value.length);
}

// 토글 상태에 따라 "지금 켜져있는지"를 한 줄로 분명하게 보여주고, 꺼져있을 땐 아래 입력칸을
// 흐리게 해서 "지금 이건 의미 없는 값"이라는 걸 바로 알 수 있게 해요.
function updateStatus() {
  const on = toggle.checked;
  statusText.textContent = on ? '켜짐' : '꺼짐';
  statusText.className = 'status-text ' + (on ? 'on' : 'off');
  if (on) {
    const min = Math.max(1, Math.min(600, parseInt(intervalInput.value, 10) || 60));
    statusSub.textContent = `${min}분마다 말풍선 + 알림으로 보여줘요`;
  } else {
    statusSub.textContent = '스위치를 켜면 아래 내용대로 알려줘요';
  }
  textField.classList.toggle('disabled', !on);
  intervalField.classList.toggle('disabled', !on);
}

updateCount();
updateStatus();

textInput.addEventListener('input', () => {
  updateCount();
});
intervalInput.addEventListener('input', updateStatus);
toggle.addEventListener('change', updateStatus);

saveBtn.addEventListener('click', () => {
  if (!toggle.checked) {
    window.reminderAPI.submit({ enabled: false });
    return;
  }
  const text = textInput.value.trim();
  if (!text) {
    // 켠 상태로 저장하려는데 문구가 비어있으면 저장 대신 입력칸에 포커스만 주고 알려줘요.
    textInput.focus();
    textField.style.outline = '2px solid #e2763f';
    setTimeout(() => { textField.style.outline = 'none'; }, 700);
    return;
  }
  const intervalMin = Math.max(1, Math.min(600, parseInt(intervalInput.value, 10) || 60));
  window.reminderAPI.submit({ enabled: true, intervalMin, text });
});

// Cmd/Ctrl+Enter로 바로 저장.
textInput.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') saveBtn.click();
});
