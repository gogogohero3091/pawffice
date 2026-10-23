// license.js
// 유료 라이선스 키 검증 - Lemon Squeezy의 License Key API를 그대로 써요(별도 서버 안 만들어도 됨).
// "키 공유 막기"는 여기서 직접 막는 게 아니라, Lemon Squeezy 상품 설정의 "Activation Limit"(기기당
// 활성화 가능 개수)가 해줘요 - 우리는 그냥 "이 기기"를 하나의 instance로 등록(activate)하고, 실행할
// 때마다 그게 아직 유효한지(validate) 물어보기만 하면 돼요. 같은 키를 다른 사람이 쓰려고 하면,
// 이미 Activation Limit만큼 기기가 등록돼 있는 경우 activate 호출 자체가 실패해요.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { app, safeStorage } = require('electron');

const LEMON_API = 'https://api.lemonsqueezy.com/v1/licenses';

// 오프라인(네트워크 없음/일시 장애)일 때, 마지막으로 서버에서 확인된 지 이 시간 안쪽이면 그냥
// 써지게 해줘요 - 비행기/와이파이 없는 곳에서도 앱이 갑자기 안 켜지면 안 되니까.
const OFFLINE_GRACE_MS = 14 * 24 * 60 * 60 * 1000; // 14일

function getLicenseFilePath() {
  return path.join(app.getPath('userData'), 'license.dat');
}

function getMachineInstanceName() {
  // 이 설치본(기기)을 구분하는 고유 이름 - 한 번 만들면 userData에 영구 저장, Lemon Squeezy의
  // instance_name으로 그대로 씀(기기별 활성화 추적/표시용 - 사람이 알아볼 수 있는 이름이면 충분).
  const idPath = path.join(app.getPath('userData'), 'machine-id.txt');
  try {
    return fs.readFileSync(idPath, 'utf8').trim();
  } catch (e) {
    const id = `${os.hostname()}-${crypto.randomUUID().slice(0, 8)}`;
    try {
      fs.mkdirSync(path.dirname(idPath), { recursive: true });
      fs.writeFileSync(idPath, id, 'utf8');
    } catch (e2) {
      // 무시 - 최악의 경우 매번 새 instance_name이 생기는데, 그래도 activate 자체는 동작함.
    }
    return id;
  }
}

function loadStoredLicense() {
  try {
    const raw = fs.readFileSync(getLicenseFilePath());
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8');
    return JSON.parse(json);
  } catch (e) {
    return null; // 파일 없음(첫 실행) 또는 손상 - 둘 다 "라이선스 없음"으로 취급
  }
}

function saveStoredLicense(data) {
  try {
    fs.mkdirSync(path.dirname(getLicenseFilePath()), { recursive: true });
    const json = JSON.stringify(data);
    // safeStorage는 OS 키체인(macOS Keychain)을 이용해 암호화해줘요 - 평문으로 그냥 두는 것보다
    // 라이선스 키를 복사해가기 훨씬 어렵게 만들어줌.
    const out = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(json)
      : Buffer.from(json, 'utf8');
    fs.writeFileSync(getLicenseFilePath(), out);
    return true;
  } catch (e) {
    console.log('[mypet] 라이선스 저장 실패:', e.message);
    return false;
  }
}

function clearStoredLicense() {
  try {
    fs.unlinkSync(getLicenseFilePath());
  } catch (e) {
    // 이미 없으면 그냥 무시
  }
}

async function callLemon(endpoint, params) {
  const res = await fetch(`${LEMON_API}/${endpoint}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  });
  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    // 응답이 JSON이 아닌 경우(서버 에러 페이지 등) - 아래에서 res.ok로 걸러짐
  }
  return { httpOk: res.ok, data };
}

// 라이선스 창에서 키를 입력하고 "활성화" 눌렀을 때 호출.
async function activateLicense(licenseKeyRaw) {
  const licenseKey = (licenseKeyRaw || '').trim();
  if (!licenseKey) {
    return { ok: false, error: '라이선스 키를 입력해주세요.' };
  }

  const instanceName = getMachineInstanceName();
  let httpOk, data;
  try {
    ({ httpOk, data } = await callLemon('activate', {
      license_key: licenseKey,
      instance_name: instanceName,
    }));
  } catch (e) {
    return { ok: false, error: '인터넷 연결을 확인해주세요 (서버에 연결할 수 없어요).' };
  }

  if (!httpOk || !data.activated) {
    return {
      ok: false,
      error:
        (data && data.error) ||
        '라이선스 키가 올바르지 않거나, 이미 이 키로 활성화할 수 있는 기기 수를 다 썼어요.',
    };
  }

  saveStoredLicense({
    licenseKey,
    instanceId: data.instance && data.instance.id,
    status: (data.license_key && data.license_key.status) || 'active',
    lastCheckedAt: Date.now(),
  });
  return { ok: true };
}

// 앱 켜질 때마다 저장된 라이선스가 아직 유효한지 서버에 물어봄.
async function validateStoredLicense() {
  const stored = loadStoredLicense();
  if (!stored || !stored.licenseKey) {
    return { ok: false, reason: 'no-license' };
  }

  try {
    const { httpOk, data } = await callLemon('validate', {
      license_key: stored.licenseKey,
      instance_id: stored.instanceId,
    });
    if (httpOk && data.valid) {
      saveStoredLicense({
        ...stored,
        status: (data.license_key && data.license_key.status) || 'active',
        lastCheckedAt: Date.now(),
      });
      return { ok: true };
    }
    // 서버가 "유효하지 않다"고 명확히 응답한 경우(환불/비활성화 등) - 유예기간 없이 바로 막음.
    return { ok: false, reason: 'invalid' };
  } catch (e) {
    // 네트워크 문제로 서버에 아예 못 닿은 경우만 유예기간을 줌.
    if (Date.now() - (stored.lastCheckedAt || 0) < OFFLINE_GRACE_MS) {
      return { ok: true, offline: true };
    }
    return { ok: false, reason: 'offline-grace-expired' };
  }
}

module.exports = {
  activateLicense,
  validateStoredLicense,
  clearStoredLicense,
  loadStoredLicense,
};
