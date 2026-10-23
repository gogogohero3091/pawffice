#!/usr/bin/env node
// 캐릭터 그림에서 "털색 자리표시 색" 부분을 원하는 색으로 통째로 바꿔치기하는 유틸리티.
//
// 그림을 그릴 때 털(코트) 영역은 항상 자리표시 색 하나로 칠해주세요 (기본값: #FF00FF, 새빨간 마젠타 —
// 실제 털색으로는 절대 안 쓰는 색이라 안전해요). 외곽선/눈/코 같은 무채색(검정)은 안 건드리고,
// 마젠타 색조에 가까운 픽셀만 바뀌어요.
//
// 안티에일리어싱된 경계(마젠타 ↔ 검정 외곽선 사이의 부드러운 픽셀들)도 자연스럽게 같이 바뀌어요:
// 픽셀의 명도(밝기)는 원본 그대로 두고 색상(hue)/채도만 바꾸는 방식이라서, 외곽선에 가까워지며
// 어두워지는 그라데이션이 새 색에서도 그대로 유지돼요.
//
// 사용법: node recolor.js <입력.png> <출력.png> <목표색(#RRGGBB)> [자리표시색, 기본 #FF00FF]

const HUE_TOLERANCE_DEG = 40;
const MIN_SATURATION = 0.12; // 이보다 채도가 낮으면 무채색(외곽선/눈/코)으로 보고 건드리지 않음

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = 0; s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return [h, s, l];
}

function hue2rgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hk = h / 360;
  const r = hue2rgb(p, q, hk + 1 / 3);
  const g = hue2rgb(p, q, hk);
  const b = hue2rgb(p, q, hk - 1 / 3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hueDist(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// 순수 함수 - Node든 브라우저(캔버스 ImageData)든 그대로 재사용할 수 있어요 (외부 의존성 없음).
// data: RGBA Uint8ClampedArray/Buffer (길이 = width*height*4). 제자리(in-place)에서 바꿔요.
//
// 명도(밝기)를 픽셀 원본 그대로 유지하면 안 돼요 - 그러면 자리표시색(마젠타, 명도 50%) 기준으로
// 고정돼서, 크림색처럼 밝은 색이나 검정에 가까운 아주 어두운 색을 목표로 해도 전부 중간 밝기로만
// 나와버려요. 대신 "자리표시색 대비 얼마나 밝고 어두운지(offset)"만 유지하고, 그 offset을
// 목표색의 명도 위에 얹어요 - 그러면 외곽선과 만나는 경계의 안티에일리어싱 그라데이션은 그대로
// 살아있으면서, 전체적인 밝기는 목표색에 맞게 나와요.
function recolorCoat(data, width, height, targetHex, placeholderHex = '#FF00FF') {
  const [tr, tg, tb] = hexToRgb(targetHex);
  const [targetH, targetS, targetL] = rgbToHsl(tr, tg, tb);
  const [pr, pg, pb] = hexToRgb(placeholderHex);
  const [placeholderH, , placeholderL] = rgbToHsl(pr, pg, pb);

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue; // 완전 투명 - 건드리지 않음
    const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2]);
    if (s < MIN_SATURATION) continue; // 무채색(외곽선/눈/코) - 건드리지 않음
    if (hueDist(h, placeholderH) > HUE_TOLERANCE_DEG) continue; // 자리표시 색과 다른 색조 - 건드리지 않음
    const lightnessOffset = l - placeholderL; // 자리표시색 대비 이 픽셀이 얼마나 밝은지/어두운지
    const newL = Math.min(1, Math.max(0, targetL + lightnessOffset));
    const [nr, ng, nb] = hslToRgb(targetH, targetS, newL);
    data[i] = nr; data[i + 1] = ng; data[i + 2] = nb;
  }
  return data;
}

module.exports = { recolorCoat, rgbToHsl, hslToRgb, hexToRgb, hueDist };

if (require.main === module) {
  (async () => {
    const sharp = require('sharp');
    const [, , inputArg, outputArg, targetHex, placeholderHex] = process.argv;
    if (!inputArg || !outputArg || !targetHex) {
      console.error('사용법: node recolor.js <입력.png> <출력.png> <목표색(#RRGGBB)> [자리표시색, 기본 #FF00FF]');
      process.exit(1);
    }
    const { data, info } = await sharp(inputArg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    recolorCoat(data, info.width, info.height, targetHex, placeholderHex || '#FF00FF');
    await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toFile(outputArg);
    console.log(`색 교체 완료: ${outputArg} (목표색 ${targetHex})`);
  })().catch((err) => {
    console.error('실패:', err);
    process.exit(1);
  });
}
