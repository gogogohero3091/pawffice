#!/usr/bin/env node
// 손으로 그린 포즈 그림(투명 배경 PNG)에서 눈 위치를 자동으로 찾아 calibration.json을 만들어줍니다.
// 사용법: node detect-eyes.js [이미지경로] [출력경로]
//   기본값: assets/poses/idle.png -> assets/poses/idle.json
//
// 그림 조건: 눈이 "작고 동글동글한 진한 색 덩어리" 두 개로 그려져 있어야 자동으로 찾을 수 있어요.
// (외곽선이나 코와 살짝 붙어있어도 괜찮아요 - 로컬 밀도 기반으로 찾기 때문에 완전히 분리된
// 덩어리가 아니어도 인식됩니다.) 자동으로 못 찾으면 이 스크립트가 실패 이유와 함께,
// calibration.json을 손으로 채우는 방법을 안내해요.

const fs = require('fs');
const path = require('path');

const BLACK_LUMA_THRESHOLD = 70; // 이 값보다 어두우면 "진한 색(눈/코/입/외곽선)"으로 취급

// 연결요소에 라벨을 붙임 (각 픽셀이 몇 번 덩어리에 속하는지)
function labelComponents(mask, width, height) {
  const labels = new Int32Array(width * height).fill(-1);
  const components = [];
  let nextId = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    const id = nextId++;
    const stack = [start];
    labels[start] = id;
    let minX = width, maxX = 0, minY = height, maxY = 0, area = 0;
    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = (p / width) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [p - 1, p + 1, p - width, p + width];
      for (const n of neighbors) {
        if (n < 0 || n >= mask.length) continue;
        if (Math.abs((n % width) - x) > 1) continue;
        if (mask[n] && labels[n] === -1) {
          labels[n] = id;
          stack.push(n);
        }
      }
    }
    components.push({ id, area, minX, maxX, minY, maxY, w: maxX - minX + 1, h: maxY - minY + 1 });
  }
  return { labels, components };
}

// 마스크를 radius 만큼 사각형 팽창 (가로/세로 분리로 O(width*height))
function dilateMask(mask, width, height, radius) {
  const temp = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let count = 0;
    for (let k = 0; k <= radius && k < width; k++) count += mask[row + k];
    for (let x = 0; x < width; x++) {
      temp[row + x] = count > 0 ? 1 : 0;
      const removeIdx = x - radius;
      const addIdx = x + radius + 1;
      if (removeIdx >= 0) count -= mask[row + removeIdx];
      if (addIdx < width) count += mask[row + addIdx];
    }
  }
  const out = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let k = 0; k <= radius && k < height; k++) count += temp[k * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = count > 0 ? 1 : 0;
      const removeIdx = y - radius;
      const addIdx = y + radius + 1;
      if (removeIdx >= 0) count -= temp[removeIdx * width + x];
      if (addIdx < height) count += temp[addIdx * width + x];
    }
  }
  return out;
}

// mask에서 각 픽셀 주변 (radius*2+1) 정사각형 창 안의 1의 개수(합) - "로컬 밀도" 계산용
function boxSum(mask, width, height, radius) {
  const temp = new Int32Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let count = 0;
    for (let k = 0; k <= radius && k < width; k++) count += mask[row + k];
    for (let x = 0; x < width; x++) {
      temp[row + x] = count;
      const removeIdx = x - radius;
      const addIdx = x + radius + 1;
      if (removeIdx >= 0) count -= mask[row + removeIdx];
      if (addIdx < width) count += mask[row + addIdx];
    }
  }
  const out = new Int32Array(width * height);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let k = 0; k <= radius && k < height; k++) count += temp[k * width + x];
    for (let y = 0; y < height; y++) {
      out[y * width + x] = count;
      const removeIdx = y - radius;
      const addIdx = y + radius + 1;
      if (removeIdx >= 0) count -= temp[removeIdx * width + x];
      if (addIdx < height) count += temp[addIdx * width + x];
    }
  }
  return out;
}

// 눈처럼 "작고 꽉 찬 덩어리"를 로컬 밀도로 찾는다 - 외곽선/코 등과 살짝 붙어있어도
// (연결요소가 하나로 합쳐져도) 밀도 차이로 분리해낼 수 있다.
function findBlobs(blackMask, width, height) {
  const DENSITY_RADIUS = Math.max(8, Math.round(width * 0.025));
  const windowArea = (DENSITY_RADIUS * 2 + 1) ** 2;
  const sums = boxSum(blackMask, width, height, DENSITY_RADIUS);
  const DENSITY_THRESHOLD = 0.85;
  const core = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    if (sums[p] / windowArea > DENSITY_THRESHOLD) core[p] = 1;
  }
  const RECOVER_R = Math.max(2, Math.round(DENSITY_RADIUS * 0.6));
  const dilated = dilateMask(core, width, height, RECOVER_R);
  const recovered = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    recovered[p] = dilated[p] && blackMask[p] ? 1 : 0;
  }
  const { components } = labelComponents(recovered, width, height);
  const minArea = Math.max(15, width * height * 0.0003);
  const maxArea = width * height * 0.02;
  return components.filter((c) => c.area >= minArea && c.area <= maxArea);
}

async function main() {
  const sharp = require('sharp');
  const inputArg = process.argv[2] || path.join(__dirname, 'assets', 'poses', 'idle.png');
  const outputArg = process.argv[3] || inputArg.replace(/\.png$/i, '.json');

  if (!fs.existsSync(inputArg)) {
    console.error(`이미지가 없어요: ${inputArg}`);
    process.exit(1);
  }

  const { data, info } = await sharp(inputArg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const blackMask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += channels, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    if (a > 10 && Math.max(r, g, b) < BLACK_LUMA_THRESHOLD) blackMask[p] = 1;
  }

  const blobs = findBlobs(blackMask, width, height);
  const centers = blobs.map((c) => ({ ...c, cx: (c.minX + c.maxX) / 2, cy: (c.minY + c.maxY) / 2 }));

  // 눈 후보 쌍을 전부 모은 다음, 그중 "가장 위쪽에 있는" 쌍을 눈으로 선택해요.
  // 포메라니안/불독처럼 주둥이가 짧으면 코가 눈 가까이 올라와서 코를 눈으로 착각하기 쉬운데,
  // 주둥이가 아무리 짧아도 코가 눈보다 위로 올라가는 경우는 없으니 "가장 위쪽 쌍 = 눈"은
  // 견종/주둥이 길이에 상관없이 안전한 기준이에요.
  const candidatePairs = [];
  for (let i = 0; i < centers.length; i++) {
    for (let j = i + 1; j < centers.length; j++) {
      const a = centers[i], b = centers[j];
      const cyDiff = Math.abs(a.cy - b.cy);
      const areaDiff = Math.abs(a.area - b.area);
      const cxDiff = Math.abs(a.cx - b.cx);
      if (cyDiff < height * 0.06 && areaDiff < Math.max(a.area, b.area) * 0.7 && cxDiff > width * 0.04) {
        candidatePairs.push({ pair: [a, b], avgCy: (a.cy + b.cy) / 2 });
      }
    }
  }
  candidatePairs.sort((p1, p2) => p1.avgCy - p2.avgCy);
  const eyePair = candidatePairs.length ? candidatePairs[0].pair : null;

  if (!eyePair) {
    console.error(`
눈 위치를 자동으로 못 찾았어요. (${inputArg})

가능한 원인:
- 눈이 서로 너무 다른 크기/높이로 그려짐
- 눈 두 개가 서로 붙어서 하나의 덩어리로 그려짐
- 눈이 좌우로 충분히 떨어져 있지 않음
- 그림에 알파(투명) 배경이 없어서 전체가 한 덩어리로 잡힘

이럴 땐 ${outputArg} 파일을 직접 만들어서 눈 좌표를 0~1 비율로 적어주세요. 예시:
{
  "leftEye": { "x": 0.39, "y": 0.38 },
  "rightEye": { "x": 0.61, "y": 0.38 }
}
(x, y는 이미지 왼쪽 위를 (0,0), 오른쪽 아래를 (1,1)로 봤을 때 눈 중심의 비율 위치예요.)
`);
    process.exit(1);
  }

  const [a, b] = eyePair;
  const left = a.cx < b.cx ? a : b;
  const right = a.cx < b.cx ? b : a;
  const eyes = {
    leftEye: { x: left.cx / width, y: left.cy / height },
    rightEye: { x: right.cx / width, y: right.cy / height },
  };

  // 코 위치는 calibration에 저장하진 않지만, 눈-코가 제대로 구분됐는지 눈으로 확인할 수 있게
  // 참고용으로 같이 찾아서 보여줘요 (눈 쌍과 겹치지 않고, 눈 높이와 같거나 그보다 아래인 덩어리 중
  // 눈 중앙과 가장 가까운 것).
  const eyeMidX = (a.cx + b.cx) / 2;
  const eyeAvgCy = (a.cy + b.cy) / 2;
  const noseCandidates = centers
    .filter((c) => c !== a && c !== b && c.cy >= eyeAvgCy - height * 0.02)
    .sort((c1, c2) => Math.abs(c1.cx - eyeMidX) - Math.abs(c2.cx - eyeMidX));
  const nose = noseCandidates[0];

  fs.mkdirSync(path.dirname(outputArg), { recursive: true });
  fs.writeFileSync(outputArg, JSON.stringify(eyes, null, 2));
  console.log(`눈 좌표 자동 감지 완료: ${outputArg}`);
  console.log(eyes);
  if (nose) {
    console.log(
      `(참고) 코로 추정되는 위치: { x: ${(nose.cx / width).toFixed(3)}, y: ${(nose.cy / height).toFixed(3)} }` +
        ' — 이 위치가 이상하면 눈-코가 헷갈렸을 수 있으니 idle.json을 확인해보세요.'
    );
  }
}

main().catch((err) => {
  console.error('실패:', err);
  process.exit(1);
});
