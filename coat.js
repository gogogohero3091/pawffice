// 라인아트(외곽선만 있는) 그림에서 "안에 갇힌 빈 영역"을 찾아 털(코트) 색을 입히는 순수 JS 모듈.
// 브라우저(캔버스 ImageData)와 Node(sharp raw buffer + {width,height}) 양쪽에서 그대로 쓸 수 있게
// DOM에 의존하지 않고 짰어요.
//
// 전제: 그림은 외곽선이 완전히 닫힌 루프인 라인아트여야 해요 (recolor.js/detect-eyes.js와 같은 결의
// "닫힌 도형" 가정). 배경(이미지 바깥 테두리)에서부터 BFS로 퍼졌을 때 못 닿는 투명 픽셀 = 코트로 추정.
// 눈/코처럼 이미 칠해진(불투명) 부분은 "잉크"로 취급되어 자동으로 제외돼요.

(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else {
    root.Coat = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const INK_ALPHA = 10; // 이 이상 불투명하면 "잉크"(외곽선/눈/코)로 취급

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  // imageLike: { data: Uint8ClampedArray|Buffer (RGBA), width, height }
  // 반환: Uint8Array 마스크 (1 = 코트로 추정되는 픽셀)
  function deriveCoatMask(imageLike) {
    const { data, width, height } = imageLike;
    const n = width * height;
    const isInk = new Uint8Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      isInk[p] = data[i + 3] > INK_ALPHA ? 1 : 0;
    }

    const outside = new Uint8Array(n);
    const queue = new Int32Array(n);
    let qLen = 0;
    function tryPush(p) {
      if (!isInk[p] && !outside[p]) {
        outside[p] = 1;
        queue[qLen++] = p;
      }
    }
    for (let x = 0; x < width; x++) {
      tryPush(x);
      tryPush((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      tryPush(y * width);
      tryPush(y * width + width - 1);
    }
    let qi = 0;
    while (qi < qLen) {
      const p = queue[qi++];
      const x = p % width;
      const y = (p / width) | 0;
      if (x > 0) tryPush(p - 1);
      if (x < width - 1) tryPush(p + 1);
      if (y > 0) tryPush(p - width);
      if (y < height - 1) tryPush(p + width);
    }

    const coat = new Uint8Array(n);
    for (let p = 0; p < n; p++) {
      if (!isInk[p] && !outside[p]) coat[p] = 1;
    }
    return coat;
  }

  // imageLike.data를 제자리에서 칠해요 - mask가 1인 픽셀을 목표색(완전 불투명)으로 통째로 바꿔치기.
  // (닫힌 라인아트를 전제로 하기 때문에, 따로 안티에일리어싱 경계 처리를 할 필요가 없어요 - 외곽선
  // 안쪽을 평평한 한 가지 색으로 채우는 것뿐이라서요.)
  function paintCoat(imageLike, mask, targetHex) {
    const { data, width, height } = imageLike;
    const [r, g, b] = hexToRgb(targetHex);
    const n = width * height;
    for (let p = 0; p < n; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }

  return { deriveCoatMask, paintCoat, hexToRgb };
});
