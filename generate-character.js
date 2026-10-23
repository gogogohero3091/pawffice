#!/usr/bin/env node
// 반려동물 사진(assets/reference/*.jpg|png) -> 2D 카툰 캐릭터 일러스트(assets/character.png)
// 실행: npm run generate

const fs = require('fs');
const path = require('path');

// .env 간단 로더 (외부 의존성 없이 GEMINI_API_KEY 읽기)
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split('\n');
  for (const line of lines) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = process.env[m[1]] || m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY가 없어요. .env 파일에 GEMINI_API_KEY=... 를 넣어주세요.');
  process.exit(1);
}

const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
const REF_DIR = path.join(__dirname, 'assets', 'reference');
const STYLE_REF_PATH = path.join(__dirname, 'assets', 'style-reference.png');
const RAW_PATH = path.join(__dirname, 'assets', 'character-raw.png');
const OUT_PATH = path.join(__dirname, 'assets', 'character.png');

const CRITICAL_RULES = `CRITICAL RULES — read carefully, these override your default drawing style:

1. This is a MINIMAL LINE ART DOODLE, not a colored icon. The dog's body is PLAIN WHITE (same as the
   background) with NO color fill anywhere — the only black in the whole image is the outline itself,
   the ears, and the eye/nose dots. Do not fill the body with any color, tan, shading, or texture.
2. The outline is a thick, bold, perfectly consistent-width black line (it is thickened further
   automatically in post-processing, so focus on drawing it clean and uniform rather than maximizing
   thickness yourself). This outline is the ONLY line defining the body/head/legs shape.
3. Simple black floppy ears on both sides of the head — the ears themselves are solid black shapes
   (not white/outlined-only), matching the floppy ear shape seen in the identity photos.
4. Facial features are minimal: two small black dots for eyes, positioned close together near the
   center of the face; one single, slightly larger black dot for the nose, placed just below/between
   the eyes.
5. The snout/muzzle is minimalist — plain white, no extra lines, no muzzle outline, no whisker marks,
   no shading, no "mask" or "patch" shape around it.
6. NO INTERNAL LINES ANYWHERE ON THE BODY. Do not draw a collar/neckline, leg separator lines, toe
   lines on the paws, a mouth line, or any other line inside the silhouette — the only black marks
   anywhere are the outline, the two ears, the two eye dots, and the one nose dot.
7. All line ends are round-capped (like a marker tip), never sharp or flat-cut.
8. Plain white background — no shadow, no scenery, no text, no watermark.`;

const IDENTITY_INTRO = `The following images are reference photos of one specific real pet. Study them closely and match
this exact pet's ear shape/type (e.g. floppy vs. pointed), body proportions, and pose — the final
drawing is plain white line art (see rules above), so fur color/pattern does not need to be matched:`;

const STYLE_INTRO = `The next image is a style-reference sheet. Use it only as a loose reference for how bold/clean the
line work and how simple the overall shape language should be (ignore the colors and specific
breeds/characters shown in it) — the actual target style is the plain white minimal line-art doodle
described in the critical rules above, not a colored icon.`;

const PROMPT = `A minimal line art illustration of a single white dog, based on the identity photos above (match
this specific pet's ear shape and proportions) and the general line quality of the style-reference
image. It has simple black floppy ears on both sides. The outline must be a thick, consistent, bold
black line. Facial features are simple: two small black dots for eyes positioned closely together, and
a slightly larger single dot for a simple nose. The snout is minimalist. The overall feel is a simple
doodle on a plain white background.

Composition requirements:
- Full body visible, sitting in a relaxed, front-facing, symmetrical pose, looking straight at the viewer.
- Centered in frame with generous empty margin all around the character.
- Solid plain white background (NOT transparent, NOT a photo background, no scenery, no text, no watermark,
  no ground shadow).
- Single character only, nothing else in the image.`;

function fileToInlinePart(filePath) {
  const data = fs.readFileSync(filePath).toString('base64');
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  return { inlineData: { mimeType, data } };
}

async function generate() {
  const files = fs
    .readdirSync(REF_DIR)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort();
  if (files.length === 0) {
    console.error(`${REF_DIR} 에 참고 사진이 없어요. jpg/png 파일을 넣어주세요.`);
    process.exit(1);
  }
  const hasStyleRef = STYLE_INTRO && fs.existsSync(STYLE_REF_PATH);
  console.log(
    `참고 사진 ${files.length}장${hasStyleRef ? ' + 스타일 참고 이미지 1장' : ''}으로 캐릭터 생성 중... (모델: ${MODEL})`
  );

  const parts = [
    { text: CRITICAL_RULES },
    { text: IDENTITY_INTRO },
    ...files.map((f) => fileToInlinePart(path.join(REF_DIR, f))),
  ];

  if (hasStyleRef) {
    parts.push({ text: STYLE_INTRO });
    parts.push(fileToInlinePart(STYLE_REF_PATH));
  }

  parts.push({ text: PROMPT });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-goog-api-key': API_KEY,
    },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], temperature: 0.3 },
    }),
  });

  const json = await res.json();

  if (!res.ok) {
    console.error('API 에러:', JSON.stringify(json, null, 2));
    process.exit(1);
  }

  const candidate = json.candidates && json.candidates[0];
  const imagePart =
    candidate && candidate.content && candidate.content.parts.find((p) => p.inlineData);

  if (!imagePart) {
    console.error('이미지가 반환되지 않았어요. 응답:', JSON.stringify(json, null, 2));
    process.exit(1);
  }

  const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(RAW_PATH, buffer);
  console.log(`원본 생성 완료: ${RAW_PATH}`);
  return buffer;
}

const CALIBRATION_PATH = path.join(__dirname, 'assets', 'calibration.json');
const BLACK_LUMA_THRESHOLD = 70; // 이 값보다 어두우면 "검정(눈/코/입)"으로 취급
const DECLUTTER_MEDIAN_SIZE = 25; // 외곽선/잔선 제거용 미디언 필터 크기(홀수)
const WHITE_THRESHOLD = 235;

// 연결요소 찾기 (단순 BFS) - 검정 마스크에서 눈을 자동으로 찾기 위함
function findComponents(mask, width, height) {
  const visited = new Uint8Array(width * height);
  const components = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const stack = [start];
    visited[start] = 1;
    let minX = width, maxX = 0, minY = height, maxY = 0, sumX = 0, sumY = 0, count = 0;
    while (stack.length) {
      const p = stack.pop();
      const x = p % width;
      const y = (p / width) | 0;
      sumX += x;
      sumY += y;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const neighbors = [p - 1, p + 1, p - width, p + width];
      for (const n of neighbors) {
        if (n < 0 || n >= mask.length) continue;
        if (Math.abs((n % width) - x) > 1) continue; // 좌우 경계 넘어가는 것 방지
        if (mask[n] && !visited[n]) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }
    components.push({
      area: count,
      cx: sumX / count,
      cy: sumY / count,
      w: maxX - minX + 1,
      h: maxY - minY + 1,
    });
  }
  return components;
}

// 눈 두 개를 자동으로 추정 (작고 동그란 검정 덩어리 중 위쪽에 있는 두 개)
function detectEyes(mask, width, height) {
  const components = findComponents(mask, width, height);
  const candidates = components.filter((c) => {
    const aspect = c.w / c.h;
    return c.area > 60 && c.area < width * height * 0.02 && aspect > 0.5 && aspect < 2;
  });
  candidates.sort((a, b) => b.area - a.area);
  const top = candidates.slice(0, 6).sort((a, b) => a.cy - b.cy); // 위쪽부터
  // 비슷한 높이(cy)를 가진 것들 중 크기가 비슷한 페어를 우선적으로 찾음
  for (let i = 0; i < top.length; i++) {
    for (let j = i + 1; j < top.length; j++) {
      const a = top[i], b = top[j];
      if (Math.abs(a.cy - b.cy) < height * 0.05 && Math.abs(a.area - b.area) < Math.max(a.area, b.area) * 0.6) {
        const left = a.cx < b.cx ? a : b;
        const right = a.cx < b.cx ? b : a;
        return {
          leftEye: { x: left.cx / width, y: left.cy / height },
          rightEye: { x: right.cx / width, y: right.cy / height },
        };
      }
    }
  }
  return null;
}

// 검정 마스크의 연결요소에 라벨을 붙임 (각 픽셀이 몇 번 덩어리에 속하는지) - 외곽선/눈코입/잡선을 구분하기 위함
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

// 마스크를 radius 만큼 사각형(체비셰프) 팽창 - 외곽선을 두껍게 만들기 위함. 가로/세로 분리로 O(width*height)에 처리
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

// 마스크를 radius 만큼 사각형(체비셰프) 침식(dilateMask의 반대, min 필터) - 가는 선을 완전히 없애기 위함
function erodeMask(mask, width, height, radius) {
  const temp = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let count = 0;
    for (let k = 0; k <= radius && k < width; k++) count += mask[row + k];
    for (let x = 0; x < width; x++) {
      const windowLen = Math.min(width, x + radius + 1) - Math.max(0, x - radius);
      temp[row + x] = count === windowLen ? 1 : 0;
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
      const windowLen = Math.min(height, y + radius + 1) - Math.max(0, y - radius);
      out[y * width + x] = count === windowLen ? 1 : 0;
      const removeIdx = y - radius;
      const addIdx = y + radius + 1;
      if (removeIdx >= 0) count -= temp[removeIdx * width + x];
      if (addIdx < height) count += temp[addIdx * width + x];
    }
  }
  return out;
}

// mask에서 각 픽셀 주변 (radius*2+1) 정사각형 창 안의 1의 개수(합)를 구함 - 가로/세로 분리로 O(width*height).
// dilateMask/erodeMask와 같은 슬라이딩 윈도우 패턴이지만 0/1이 아니라 합계를 그대로 반환한다("로컬 밀도" 계산용).
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

// 외곽선/잔선 제거(미디언 필터, 검정 요소는 원본 유지) + 흰 배경 투명화 + 정사각형 트림 + 512 리사이즈 + 눈 좌표 자동 계산
async function postProcess(buffer) {
  const sharp = require('sharp');

  const original = sharp(buffer).ensureAlpha();
  const { data: origData, info } = await original.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  // 검정(외곽선/눈/코/입/잡선) 마스크 + 흰 배경 마스크
  const blackMask = new Uint8Array(width * height);
  const whiteMask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < origData.length; i += channels, p++) {
    const r = origData[i], g = origData[i + 1], b = origData[i + 2];
    if (Math.max(r, g, b) < BLACK_LUMA_THRESHOLD) blackMask[p] = 1;
    if (r > WHITE_THRESHOLD && g > WHITE_THRESHOLD && b > WHITE_THRESHOLD) whiteMask[p] = 1;
  }

  // === 1단계: 흰 배경까지의 거리로 "진짜 실루엣 외곽선"(배경에 붙어있음) vs "몸속 깊은 곳의 마크/잡선"
  // (눈/코/입, 그리고 muzzle patch·다리 구분선 같은 안쪽 잡선)을 구분한다. 실루엣 외곽선은 정의상 항상
  // 배경과 맞닿아 있고, 안쪽에 그려진 것들은 (양 끝이 외곽선에 붙어 하나의 덩어리로 합쳐지는 경우에도)
  // 배경에서 훨씬 멀리 떨어져 있다 -> 연결 여부에 의존하지 않는 훨씬 안정적인 구분 기준.
  const distToWhite = new Int32Array(width * height).fill(-1);
  {
    const queue = [];
    for (let p = 0; p < width * height; p++) if (whiteMask[p]) { distToWhite[p] = 0; queue.push(p); }
    let qHead = 0;
    while (qHead < queue.length) {
      const p = queue[qHead++];
      const x = p % width, y = (p / width) | 0;
      const neighbors = [];
      if (x > 0) neighbors.push(p - 1);
      if (x < width - 1) neighbors.push(p + 1);
      if (y > 0) neighbors.push(p - width);
      if (y < height - 1) neighbors.push(p + width);
      for (const n of neighbors) if (distToWhite[n] === -1) { distToWhite[n] = distToWhite[p] + 1; queue.push(n); }
    }
  }
  const OUTLINE_MAX_DIST = Math.round(width * 0.05);
  const interiorMask = new Uint8Array(width * height); // 배경과 안 닿아있는(=진짜 외곽선이 아닌) 검정
  for (let p = 0; p < width * height; p++) {
    if (blackMask[p] && distToWhite[p] > OUTLINE_MAX_DIST) interiorMask[p] = 1;
  }

  // === 2단계: 로컬 밀도(box density) - 작은 사각 창 안에서 검정 비율이 매우 높은 곳은 "꽉 찬 덩어리"
  // (눈/코)의 중심부이고, 선(외곽선이든 안쪽 잡선이든)은 아무리 굵어도 밀도가 훨씬 낮게 나온다 -> 눈/코가
  // 다른 잡선과 한 덩어리로 뭉쳐 있어도(연결요소 분리가 안 돼도) 안정적으로 분리해낼 수 있다.
  const DENSITY_RADIUS = Math.max(8, Math.round(width * 0.025));
  const densityWindowArea = (DENSITY_RADIUS * 2 + 1) ** 2;
  const densitySums = boxSum(blackMask, width, height, DENSITY_RADIUS);
  const DENSITY_THRESHOLD = 0.85;
  const blobCore = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    if (densitySums[p] / densityWindowArea > DENSITY_THRESHOLD) blobCore[p] = 1;
  }
  // 코어를 살짝만 넓혀서(원래 눈/코 크기에 가깝게) 복원 - 너무 많이 넓히면 옆에 붙은 잡선까지 다시
  // 딸려 들어오고, 너무 적게 넓히면 눈/코 가장자리가 잘려서 다음 단계(외곽선 팽창)로 넘어가 버린다.
  const RECOVER_R = Math.max(2, Math.round(DENSITY_RADIUS * 0.5));
  const dilatedCore = dilateMask(blobCore, width, height, RECOVER_R);
  const recoveredBlobMask = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    recoveredBlobMask[p] = dilatedCore[p] && blackMask[p] ? 1 : 0;
  }

  const { labels: blobLabels, components: blobRawComponents } = labelComponents(recoveredBlobMask, width, height);
  const minBlobArea = Math.max(20, width * height * 0.0006);
  const maxBlobArea = width * height * 0.02;
  const blobComps = blobRawComponents.filter((c) => c.area >= minBlobArea && c.area <= maxBlobArea);
  const blobIds = new Set(blobComps.map((c) => c.id));

  // 눈 페어 찾기: 비슷한 높이·크기를 가진 덩어리 두 개
  const blobCenters = blobComps.map((c) => ({
    ...c,
    cx: (c.minX + c.maxX) / 2,
    cy: (c.minY + c.maxY) / 2,
  }));
  let eyePair = null;
  outer: for (let i = 0; i < blobCenters.length; i++) {
    for (let j = i + 1; j < blobCenters.length; j++) {
      const a = blobCenters[i], b = blobCenters[j];
      if (Math.abs(a.cy - b.cy) < height * 0.06 && Math.abs(a.area - b.area) < Math.max(a.area, b.area) * 0.7) {
        eyePair = [a, b];
        break outer;
      }
    }
  }
  const eyeIds = new Set(eyePair ? eyePair.map((e) => e.id) : []);
  const noseComps = blobComps.filter((c) => !eyeIds.has(c.id)); // 눈 페어가 아닌 나머지 blob = 코(들)

  // === 3단계: 눈 코어 복원 시 잡선(눈물자국/muzzle patch)이 살짝 꼬리처럼 딸려온 경우, 행(row)별
  // 폭 스캔으로 "눈동자 정점을 지나서 폭이 다시 삐져나오는 지점"을 목(neck)으로 보고 그 아래를 잘라낸다.
  const blobTailDropMask = new Uint8Array(width * height);
  if (eyePair) {
    for (const eye of eyePair) {
      const rows = [];
      for (let y = eye.minY; y <= eye.maxY; y++) {
        let rMinX = eye.maxX + 1, rMaxX = eye.minX - 1, count = 0;
        for (let x = eye.minX; x <= eye.maxX; x++) {
          if (blobLabels[y * width + x] === eye.id) {
            count++;
            if (x < rMinX) rMinX = x;
            if (x > rMaxX) rMaxX = x;
          }
        }
        rows.push({ y, count, rMinX, rMaxX });
      }
      const CONFIRM_DROP = Math.max(4, Math.round(width * 0.005));
      let peak = null;
      let runningMax = -1;
      let runningMaxRow = null;
      for (const r of rows) {
        if (r.count === 0) continue;
        const span = r.rMaxX - r.rMinX + 1;
        if (peak) continue;
        if (span > runningMax) {
          runningMax = span;
          runningMaxRow = { ...r, span };
        } else if (runningMax - span >= CONFIRM_DROP) {
          peak = runningMaxRow;
        }
      }
      if (!peak) peak = runningMaxRow;
      if (!peak) continue;
      const TOL = Math.max(3, Math.round(width * 0.004));
      let cutY = null;
      for (const r of rows) {
        if (r.y <= peak.y || r.count === 0) continue;
        if (r.rMaxX > peak.rMaxX + TOL || r.rMinX < peak.rMinX - TOL) {
          cutY = r.y;
          break;
        }
      }
      if (cutY !== null) {
        for (let y = cutY; y <= eye.maxY; y++) {
          for (let x = eye.minX; x <= eye.maxX; x++) {
            const p = y * width + x;
            if (blobLabels[p] === eye.id) blobTailDropMask[p] = 1;
          }
        }
      }
    }
  }
  const blobTailDropMaskWide = dilateMask(blobTailDropMask, width, height, Math.max(2, Math.round(width * 0.003)));

  // === 4단계: interior(=배경과 안 닿음)인데 blob(눈/코)도 아닌 나머지 검정 -> 코 바로 아래/근처에 붙어
  // 있으면 "입"으로 보고 외곽선처럼 두껍게 그려주고, 그 외(눈에 붙어있거나 허공에 떠있는 것 - muzzle
  // patch, 다리 구분선, 발가락선 등)는 전부 "잡선"으로 간주해서 지워버린다(인페인팅으로 자연스럽게 채움).
  const nonBlobInteriorMask = new Uint8Array(width * height);
  for (let p = 0; p < width * height; p++) {
    if (interiorMask[p] && !(blobLabels[p] !== -1 && blobIds.has(blobLabels[p]))) {
      nonBlobInteriorMask[p] = 1;
    }
  }
  const { labels: niLabels, components: niComponents } = labelComponents(nonBlobInteriorMask, width, height);
  // 입은 코 바로 아래쪽에 넓게 걸쳐있지만 코와의 세로 간격이 제법 벌어질 수 있음 -> 가로는 타이트하게,
  // 아래쪽만 넉넉하게 패딩을 준다(위/옆으로 넉넉히 주면 눈 옆 잡선이 "입"으로 오분류될 수 있어서 제외).
  const NOSE_PAD_X = Math.max(4, Math.round(width * 0.012));
  const NOSE_PAD_UP = Math.max(4, Math.round(width * 0.012));
  const NOSE_PAD_DOWN = Math.max(20, Math.round(height * 0.06));
  const mouthIds = new Set();
  for (const c of niComponents) {
    for (const nose of noseComps) {
      const overlapsX = c.minX <= nose.maxX + NOSE_PAD_X && c.maxX >= nose.minX - NOSE_PAD_X;
      const overlapsY = c.minY <= nose.maxY + NOSE_PAD_DOWN && c.maxY >= nose.minY - NOSE_PAD_UP;
      if (overlapsX && overlapsY) {
        mouthIds.add(c.id);
        break;
      }
    }
  }

  // === 5단계: 최종 분류 ===
  const eyeNoseCore = new Uint8Array(width * height); // 눈/코 원본 덩어리(코어)
  const nonBlobBlackMask = new Uint8Array(width * height); // 두껍게 팽창 (진짜 외곽선 + 입)
  const dropMask = new Uint8Array(width * height); // 지우고 인페인팅 (눈물자국, muzzle patch, 다리선 등 잡선)

  for (let p = 0; p < width * height; p++) {
    if (blobTailDropMaskWide[p]) {
      dropMask[p] = 1;
      continue;
    }
    if (blobLabels[p] !== -1 && blobIds.has(blobLabels[p])) {
      eyeNoseCore[p] = 1;
      continue;
    }
    if (!blackMask[p]) continue;
    if (!interiorMask[p]) {
      nonBlobBlackMask[p] = 1; // 진짜 외곽선
      continue;
    }
    if (niLabels[p] !== -1 && mouthIds.has(niLabels[p])) {
      nonBlobBlackMask[p] = 1; // 입 -> 외곽선처럼 두껍게
    } else {
      dropMask[p] = 1; // 그 외 안쪽 잡선 -> 지움
    }
  }

  // 사용자 요청: "선이 더 굵어야해" - 눈/코/입을 뺀 모든 선(=진짜 외곽선+입)을 두껍게 팽창.
  // 이제 안쪽 잡선은 위에서 이미 걸러져서 지워지므로, 예전처럼 "전체를 두껍게 만들어서 뭉개버리는" 식이
  // 아니라 진짜 외곽선만 두꺼워짐 -> 두껍게 해도 지저분해지지 않고 깔끔한 볼드 라인이 된다.
  const DILATE_RADIUS = Math.max(5, Math.round(width * 0.013));
  const dilatedLineMask = dilateMask(nonBlobBlackMask, width, height, DILATE_RADIUS);

  // 눈/코는 원본 픽셀을 그대로 쓰지 않는다 - Gemini가 그린 원본 이미지 자체에 눈/코 가장자리가 부드럽게
  // 번져있는(blurry) 경우가 있는데, 예전에는 마침 그 자리에 겹쳐 있던 잡선(눈물자국/muzzle patch 등)이
  // 두껍게 칠해지면서 우연히 덮여서 안 보였을 뿐이다. 잡선을 깔끔히 지운 지금은 그 흐릿한 테두리가
  // 그대로 드러나 버리므로, 눈/코 코어를 살짝만 팽창시켜 "순수 검정으로 칠해서" 테두리를 또렷하게
  // 만든다. 외곽선처럼 크게 팽창시키면 눈/코가 너무 커지므로 훨씬 작은 반경만 사용한다.
  const EYE_CRISP_RADIUS = Math.max(3, Math.round(width * 0.007));
  const keepBlackMask = dilateMask(eyeNoseCore, width, height, EYE_CRISP_RADIUS);

  // dropMask 가장자리의 안티에일리어싱 잔영(연한 회색 테두리)까지 확실히 지우기 위해 살짝 팽창.
  // 단, keepBlackMask/dilatedLineMask(진짜 눈코입/외곽선)는 침범하지 않도록 뺀다.
  {
    const widened = dilateMask(dropMask, width, height, Math.max(4, Math.round(width * 0.008)));
    for (let p = 0; p < width * height; p++) {
      if (widened[p] && !keepBlackMask[p] && !dilatedLineMask[p]) dropMask[p] = 1;
    }
  }

  // 미디언 필터로 잔티/anti-aliasing 정리 (경계 부드럽게)
  const medianBuf = await sharp(buffer)
    .ensureAlpha()
    .median(DECLUTTER_MEDIAN_SIZE)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const cleaned = Buffer.from(medianBuf.data);

  // 눈/코/외곽선/입은 전부 순수 검정으로 칠함 (원본 픽셀을 그대로 쓰지 않음 - 위 설명 참고)
  for (let i = 0, p = 0; i < cleaned.length; i += channels, p++) {
    if (keepBlackMask[p] || dilatedLineMask[p]) {
      cleaned[i] = 0;
      cleaned[i + 1] = 0;
      cleaned[i + 2] = 0;
      if (channels === 4) cleaned[i + 3] = 255;
    }
  }

  // 잡선(dropMask) 인페인팅: 캐릭터 자체가 "완전 플랫 컬러"(그림자/그라데이션 없음) 스타일이므로, 지운
  // 자리도 주변과 구분 안 되는 하나의 단색으로 채우는 게 정답이다. 이웃 색을 부드럽게 섞어나가는 확산
  // (diffusion) 방식은 쓰지 않는다 - 원래 색이 살짝만 달라도 그 경계가 흐릿한 "얼룩"으로 남아서 오히려
  // 더 눈에 띄고 지저분해 보인다(실제로 이 문제 때문에 확산 방식을 걷어냈다). 대신 지워진 덩어리(끊어진
  // 잡선 하나하나)마다 바로 바깥 테두리의 색을 모아 중앙값(median) 하나를 구해서, 그 덩어리 전체를 그
  // 단색으로 통째로 칠한다 - 그라데이션/얼룩 없이 캐릭터의 원래 플랫 컬러 스타일과 자연스럽게 이어진다.
  if (dropMask.some((v) => v)) {
    const { labels: dropLabels, components: dropComponents } = labelComponents(dropMask, width, height);
    for (const comp of dropComponents) {
      const BORDER_PAD = 2;
      const samplesR = [], samplesG = [], samplesB = [];
      for (let y = Math.max(0, comp.minY - BORDER_PAD); y <= Math.min(height - 1, comp.maxY + BORDER_PAD); y++) {
        for (let x = Math.max(0, comp.minX - BORDER_PAD); x <= Math.min(width - 1, comp.maxX + BORDER_PAD); x++) {
          const p = y * width + x;
          if (dropLabels[p] !== comp.id) continue;
          const neighbors = [p - 1, p + 1, p - width, p + width];
          for (const n of neighbors) {
            if (n < 0 || n >= width * height) continue;
            if (Math.abs((n % width) - x) > 1) continue;
            if (dropLabels[n] === comp.id) continue; // 같은 잡선 덩어리 내부는 제외
            if (keepBlackMask[n] || dilatedLineMask[n]) continue; // 진짜 눈코입/외곽선은 제외
            const ni = n * channels;
            samplesR.push(cleaned[ni]);
            samplesG.push(cleaned[ni + 1]);
            samplesB.push(cleaned[ni + 2]);
          }
        }
      }
      const median = (arr) => {
        if (arr.length === 0) return 210; // 샘플이 하나도 없으면(거의 없음) 무난한 회색 fallback
        arr.sort((a, b) => a - b);
        return arr[Math.floor(arr.length / 2)];
      };
      const fillR = median(samplesR);
      const fillG = median(samplesG);
      const fillB = median(samplesB);
      for (let y = comp.minY; y <= comp.maxY; y++) {
        for (let x = comp.minX; x <= comp.maxX; x++) {
          const p = y * width + x;
          if (dropLabels[p] !== comp.id) continue;
          if (keepBlackMask[p] || dilatedLineMask[p]) continue; // 눈코입/외곽선이 우선 (덮어쓰지 않음)
          const i = p * channels;
          cleaned[i] = fillR;
          cleaned[i + 1] = fillG;
          cleaned[i + 2] = fillB;
          if (channels === 4) cleaned[i + 3] = 255;
        }
      }
    }
  }

  // 흰 배경 투명화
  for (let i = 0; i < cleaned.length; i += channels) {
    if (cleaned[i] > WHITE_THRESHOLD && cleaned[i + 1] > WHITE_THRESHOLD && cleaned[i + 2] > WHITE_THRESHOLD) {
      if (channels === 4) cleaned[i + 3] = 0;
    }
  }

  // 알파 기준 바운딩박스 찾기 (여백 트림) - 미세한 잡티(구석의 anti-aliasing 픽셀 등) 때문에
  // 바운딩박스가 엉뚱하게 커지지 않도록, 알파>10인 픽셀 중 "가장 큰 연결 덩어리"만 기준으로 삼는다.
  const alphaOnly = await sharp(cleaned, { raw: { width, height, channels } })
    .extractChannel(3)
    .raw()
    .toBuffer();
  const alphaMask = new Uint8Array(width * height);
  for (let p = 0; p < alphaOnly.length; p++) {
    if (alphaOnly[p] > 10) alphaMask[p] = 1;
  }
  const { components: alphaComponents } = labelComponents(alphaMask, width, height);
  let minX = width, maxX = 0, minY = height, maxY = 0;
  if (alphaComponents.length > 0) {
    const mainComp = alphaComponents.reduce((a, b) => (b.area > a.area ? b : a));
    minX = mainComp.minX;
    maxX = mainComp.maxX;
    minY = mainComp.minY;
    maxY = mainComp.maxY;
  }

  const pad = Math.round(width * 0.04);
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(width, maxX + pad);
  const y1 = Math.min(height, maxY + pad);
  const cropW = x1 - x0;
  const cropH = y1 - y0;

  // 캐릭터 영역만 잘라낸 뒤, 정사각형 캔버스 중앙에 배치 (잘라낸 영역이 원본보다 작으므로 항상 안전)
  const croppedBuf = await sharp(cleaned, { raw: { width, height, channels } })
    .extract({ left: x0, top: y0, width: cropW, height: cropH })
    .png()
    .toBuffer();

  const side = Math.max(cropW, cropH);
  const offsetX = Math.round((side - cropW) / 2);
  const offsetY = Math.round((side - cropH) / 2);

  const FINAL_SIZE = 512;
  // 주의: sharp는 같은 파이프라인에서 .composite() 뒤에 .resize()를 이어붙이면
  // 베이스 캔버스를 먼저 리사이즈한 뒤 composite를 시도해서 크기 불일치 에러가 남.
  // 그래서 정사각형 합성을 먼저 버퍼로 완성한 다음, 별도 인스턴스에서 리사이즈함.
  const composited = await sharp({
    create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: croppedBuf, left: offsetX, top: offsetY }])
    .png()
    .toBuffer();

  const finalBuffer = await sharp(composited).resize(FINAL_SIZE, FINAL_SIZE).png().toBuffer();
  fs.writeFileSync(OUT_PATH, finalBuffer);
  console.log(`후처리(외곽선/잔선 제거 + 트림) 완료: ${OUT_PATH}`);

  // 눈 좌표 계산: 예전에는 최종(512) 이미지에서 검정 마스크를 다시 뽑아 detectEyes()로 재탐지했는데,
  // 외곽선이 굵어진 뒤로는 512로 축소하면서 생기는 블러 때문에 눈이 외곽선/코와 시각적으로 붙어버려서
  // (findComponents가 눈+외곽선+입을 전부 하나의 거대한 덩어리로 묶어버림) 눈 좌표를 못 찾는 경우가
  // 생겼다. 이미 위에서 훨씬 정확하게 눈 위치(eyePair, 원본 해상도 좌표)를 알고 있으므로, 그 좌표를
  // crop/캔버스 배치/리사이즈와 동일한 변환을 적용해서 그대로 재사용하는 편이 더 정확하고 안정적이다.
  let eyes = null;
  if (eyePair) {
    const toFinal = (cx, cy) => ({
      x: ((cx - x0) + offsetX) / side,
      y: ((cy - y0) + offsetY) / side,
    });
    const [a, b] = eyePair;
    const aFinal = toFinal(a.cx, a.cy);
    const bFinal = toFinal(b.cx, b.cy);
    const left = aFinal.x < bFinal.x ? aFinal : bFinal;
    const right = aFinal.x < bFinal.x ? bFinal : aFinal;
    eyes = { leftEye: left, rightEye: right };
  }
  if (!eyes) {
    // 폴백: eyePair를 못 찾은 경우(드묾) 예전 방식대로 최종 이미지에서 재탐지 시도
    const finalRaw = await sharp(finalBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const fMask = new Uint8Array(FINAL_SIZE * FINAL_SIZE);
    for (let i = 0, p = 0; i < finalRaw.data.length; i += finalRaw.info.channels, p++) {
      const r = finalRaw.data[i], g = finalRaw.data[i + 1], b = finalRaw.data[i + 2], a = finalRaw.data[i + 3];
      if (a > 10 && Math.max(r, g, b) < BLACK_LUMA_THRESHOLD) fMask[p] = 1;
    }
    eyes = detectEyes(fMask, FINAL_SIZE, FINAL_SIZE);
  }
  if (eyes) {
    fs.writeFileSync(CALIBRATION_PATH, JSON.stringify(eyes, null, 2));
    console.log(`눈 좌표 자동 감지 완료: ${CALIBRATION_PATH}`, eyes);
  } else {
    console.log('눈 좌표를 자동으로 못 찾았어요 - 기존 calibration.json을 그대로 둬요.');
  }
}

async function main() {
  const buffer = await generate();
  try {
    await postProcess(buffer);
  } catch (e) {
    console.log('후처리 실패, 원본을 그대로 사용해요:', e.message);
    fs.copyFileSync(RAW_PATH, OUT_PATH);
  }
  console.log('\n다음: npm start 로 앱을 실행해서 새 캐릭터를 확인해보세요.');
}

main().catch((err) => {
  console.error('실패:', err);
  process.exit(1);
});
