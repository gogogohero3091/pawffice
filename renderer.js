// ------- 캐릭터 렌더링 + 상호작용 로직 -------
// assets/breeds/<견종>/idle/center.png, left.png, right.png, up.png, down.png / running/1.svg... 를 사용해서 그립니다.
// 색은 이제 코드에서 칠하지 않고 그림 파일에 있는 색 그대로 그려요 (색칠은 그림 그릴 때 직접 하는 걸로).
// 어떤 견종을 보여줄지는 온보딩(또는 트레이의 "설정 변경")에서 고른 값을 따라가요.
// 좌표계: 260x370 캔버스 - 정사각형이 아니라 위쪽엔 말풍선(고정 메시지) 자리, 아래쪽엔 이름표
// 자리까지 확보해둔 크기예요(안 그러면 창 가장자리에서 잘려 보임). 캐릭터 중심은 대략 (130, 210).
// main.js의 WIN_WIDTH/WIN_HEIGHT/CHAR_CY와 반드시 같이 맞춰야 해요.

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');

const CX = 130;
const CY = 210;
const DISPLAY_MAX = 160; // 캔버스 위에 그려질 캐릭터의 (가로/세로 중 큰 쪽) 최대 크기(px) - 비율은 유지 (기존 200에서 20% 축소)

// ---- 지금 보여줄 견종/이름 ----
// main.js가 창을 만들 때 loadFile의 query로 breed/name을 실어서 보내줘요(온보딩에서 고른 값,
// 또는 저장돼 있던 값) - 이 값이 처음부터 있어야 페이지가 뜨자마자 바로 맞는 견종이 보이고,
// "일단 아무 견종이나 보였다가 바뀌는" 깜빡임이 없어요.
const params = new URLSearchParams(location.search);
const breedsInfo = (window.petAPI && window.petAPI.breeds) || {};
let CURRENT_BREED = params.get('breed') || Object.keys(breedsInfo)[0] || null;
let petName = params.get('name') || '';
let petMessage = params.get('message') || ''; // 트레이 "고정 메시지 설정"에서 지은 말풍선 문구

// ---- 그림 한 장을 로드해서 래스터화만 미리 해둠 (색은 그림에 있는 그대로, 따로 칠하지 않음) ----
function loadFrame(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const RASTER_MAX = 400; // 래스터화 해상도 (화질용, 화면엔 더 작게 그려짐)
        const scale = RASTER_MAX / Math.max(img.naturalWidth, img.naturalHeight);
        const rw = Math.max(1, Math.round(img.naturalWidth * scale));
        const rh = Math.max(1, Math.round(img.naturalHeight * scale));
        const off = document.createElement('canvas');
        off.width = rw;
        off.height = rh;
        const octx = off.getContext('2d');
        octx.drawImage(img, 0, 0, rw, rh);

        // "실제 내용"(투명하지 않은 픽셀)만의 바운딩 박스 - 포즈마다(특히 touched.png, licking
        // 프레임들) 작업자가 내보낼 때 캔버스 여백/크롭을 idle/center.png랑 다르게 잡는 경우가
        // 많아서, 캔버스 전체 크기를 기준으로 그리면 포즈를 바꿀 때마다 캐릭터가 갑자기 커지거나
        // 작아지거나 옆으로 쏠려 보여요(여러 견종에서 "만질 때/핥을 때 작아짐·위치 바뀜" 버그의
        // 원인). 캔버스 전체가 아니라 이 바운딩 박스만 잘라서 그리면, 여백이 얼마나 다르든 실제
        // 그려지는 건 항상 "내용만"이라 크기/중심이 흔들리지 않아요.
        let bbox = null;
        try {
          const data = octx.getImageData(0, 0, rw, rh).data;
          let minX = rw, minY = rh, maxX = -1, maxY = -1;
          const ALPHA_THRESHOLD = 10;
          for (let y = 0; y < rh; y++) {
            const rowBase = y * rw;
            for (let x = 0; x < rw; x++) {
              const a = data[(rowBase + x) * 4 + 3];
              if (a > ALPHA_THRESHOLD) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
              }
            }
          }
          if (maxX >= minX && maxY >= minY) {
            bbox = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
          }
        } catch (bboxErr) {
          bbox = null; // 실패하면(드물게) 아래에서 캔버스 전체로 대체
        }
        if (!bbox) bbox = { x: 0, y: 0, w: rw, h: rh };

        resolve({
          canvas: off,
          naturalW: img.naturalWidth,
          naturalH: img.naturalHeight,
          rasterW: rw,
          rasterH: rh,
          bbox,
        });
      } catch (err) {
        // 여기서 조용히 실패하면 이 프레임이 영원히 안 뜨는데 원인을 알 수가 없으니, 꼭 콘솔에 남겨요.
        console.error(`[mypet] 프레임 처리 실패 (${src.slice(0, 40)}...):`, err);
        resolve(null);
      }
    };
    img.onerror = () => {
      console.log(`${src} 로드 실패`);
      resolve(null);
    };
    img.src = src;
  });
}

// ---- 쓰다듬을 때(머리 호버) 떠오르는 작은 하트 이펙트용 그림 미리 로드 ----
// 견종별 그림이 아니라 전역 UI 이펙트라서, breeds-config를 거치지 않고 SVG를 바로 데이터 URI로
// 인라인해서 loadFrame()으로 로드해요(캔버스에 그릴 수 있게 래스터화까지 loadFrame이 해줌).
const HEART_SVG = '<?xml version="1.0" encoding="UTF-8"?><svg id="_\uB808\uC774\uC5B4_2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64.81 56.91"><defs><style>.cls-1{fill:#ff2e74;stroke-width:0px;}</style></defs><g id="_\uB808\uC774\uC5B4_1-2"><polygon class="cls-1" points="61.24 33.55 64.02 26.68 64.81 19.62 64.79 12.32 60.35 6.51 55.06 1.64 47.96 1.31 41.57 1.36 35.84 4.69 32.7 11.31 29.04 5.21 23.71 1.63 17.44 0 10.8 2.59 5.18 6.62 .98 12.45 0 19.62 1.37 26.68 4.65 33.13 4.96 33.34 5.8 32.87 4.89 34.01 10.94 38.07 16.54 42.5 22.27 46.83 26.88 52.5 32.7 56.91 38.2 52.13 43.05 46.73 49.02 42.7 55.36 39.11 60.63 34.12 60.09 33.33 59.56 32.56 61.24 33.55"/></g></svg>';
let heartImg = null; // loadFrame()과 같은 형태({canvas, naturalW, naturalH}) - 로딩 끝나면 채워짐
loadFrame(`data:image/svg+xml;utf8,${encodeURIComponent(HEART_SVG)}`).then((frameObj) => { heartImg = frameObj; });

// ---- 포즈별 프레임 로드 ----
// idle은 특별 취급: frames 배열이 아니라 방향별(center/left/right/up/down) 그림을 따로 들고 있어요.
// running/lying/typing/eating은 이전처럼 frames 배열(비동기로 채워짐) + fps로 순환 재생해요.
// applyBreed()로 함수화해둬서, 나중에(트레이 "설정 변경") 다른 견종을 고르면 페이지를
// 새로고침하지 않고 poseFrames를 통째로 다시 채워서 바로 그 견종으로 바뀌게 했어요.
let poseFrames = {};

// frame(loadFrame의 결과물)의 "내용만"(알파 바운딩 박스)의 크기를 원본(natural) 픽셀 단위로
// 환산해줘요. frame.bbox는 래스터 캔버스(rasterW x rasterH) 기준이라, natural/raster 배율로
// 다시 곱해줘야 원본 그림 기준 크기가 나와요(raster는 natural을 RASTER_MAX 기준으로 균일하게
// 축소한 것뿐이라 자르지 않은 비율 변환).
function contentSize(frame, bboxOverride) {
  const bbox = bboxOverride || frame.bbox;
  const rx = frame.naturalW / frame.rasterW;
  const ry = frame.naturalH / frame.rasterH;
  return { w: bbox.w * rx, h: bbox.h * ry };
}

// (2026-10-22) 멀티프레임 포즈(타이핑/핥기 등)에서 프레임마다 bbox를 공유시켜보려는 시도를
// 여러 번(합집합 -> 첫 프레임 -> 교집합) 했었는데, 전부 "그 프레임엔 없는 남의 여백"을 완전히
// 배제하지 못해 GSP 꼬리 쪽에 이상한 선/테두리가 남는다는 재현 보고가 계속 있었어요. 그래서
// 이 공유 bbox 접근 자체를 걷어냈어요 - render()의 srcBbox는 이제 그냥 frame.bbox(자기 자신의
// bbox)를 써요. 자세한 이유는 render() 안 srcBbox 계산 주석 참고.

// (예전엔 "눈/코/입 크기"를 전 견종 공통으로 맞추는 자동 보정을 했었는데, 그러면 원본 그림이
// 서로 다른 해상도로 작업된 경우(예: 말티즈/골든을 새로 작업하면서 다른 견종보다 훨씬 큰
// 캔버스로 내보낸 경우) 의도와 다르게 특정 견종만 과하게 커지는 문제가 있었어요. 사용자 요청으로
// 이 자동 보정은 없앴고, 지금은 "원본 그림(idle/center.png)의 내용 세로 크기"를 공통 배율
// (FLAT_SCALE) 하나로만 환산해요 - 즉 작업자가 그림을 그릴 때 정한 견종간 상대적 크기를
// 그대로 존중하고, 렌더러가 임의로 다시 계산해서 바꾸지 않아요. 그림 자체의 상대 크기가
// 어색하면(예: 어떤 견종만 캔버스 해상도가 달라서 너무 크거나 작으면) 그림 파일 쪽을 다른
// 견종들과 비슷한 해상도로 맞춰야 해요(코드가 아니라 에셋을 맞추는 문제).
// (2026-10-22 변경) 예전엔 "내용"(알파 바운딩 박스) 세로 높이를 기준으로 삼았는데, 그러면
// 견종마다 그림 여백/크롭 습관이 조금만 달라도(귀 숱이 많거나, 포즈가 더 컴팩트하거나) 측정값이
// 흔들려서 "소형견이 이상하게 크다/작다", "만지면 커진다" 류의 문제가 반복됐어요. 작업자(사용자)가
// 모든 포즈를 동일한 세로 기준 대지(캔버스)로 작업한다고 확인해줘서, 이제는 "그림 내용"이 아니라
// "원본 파일(대지) 자체의 세로 픽셀 크기"(naturalH)를 기준으로 삼아요 - 가로는 각 그림 본연의
// 가로/세로 비율을 그대로 쓰고(비틀지 않음, 강제로 안 맞춤), 세로만 항상 이 기준에 맞춰요.
const CANVAS_SCALE = 150 / 900; // 대지 세로 900px(대부분 idle 그림의 원본 해상도 기준)가 화면에서 150px로 보이게
const BODY_MIN_PX = 115; // 그림이 깨졌거나 너무 작게 내보내진 경우를 막는 안전장치일 뿐, 보정 목적 아님
const BODY_MAX_PX = 190; // 위와 동일 - 너무 커지는 극단적인 경우만 막음

// ※ 중요: 아래 "목표 크기"는 긴 변(max(w,h))이 아니라 항상 "세로(높이)" 기준이에요.
// 처음엔 긴 변 기준으로 맞췄었는데, 그러면 idle은 보통 거의 정사각형~살짝 가로로 넓은데
// touched는 포즈 때문에 더 정사각형에 가까워지는 식으로 "가로세로 비율 자체가 포즈마다
// 다른" 경우에, 긴 변만 똑같이 맞춰도 세로 길이(키)는 포즈마다 달라져 버렸어요(예: 말티즈
// touched가 idle보다 세로로 더 길게 그려짐). 캐릭터는 항상 "바닥(발)"에 고정해서 그리기
// 때문에, 세로 길이가 흔들리면 머리 쪽이 위로 쑥 커지거나 줄어드는 게 바로 눈에 띄어서
// "만지면 커짐/작아짐"으로 느껴졌던 거예요. 세로(높이)를 기준으로 고정하면 포즈가 바뀌어도
// 캐릭터의 "키"는 절대 안 흔들리고, 가로 폭만(귀가 접히거나 포즈가 통통해지는 정도) 자연스럽게
// 달라져요 - 이게 실제 눈에 보이는 "커짐/작아짐" 버그를 훨씬 확실하게 잡아줘요.

// 이 견종에서 "모든 포즈가 공통으로 맞출 목표 세로 크기"(높이, px) - idle 하나만 보고 한 번
// 정해서 모든 포즈(touched/licking/lying...)가 전부 이 높이에 맞춰 그려지게 해요(아래
// getFrameScale). 견종이 바뀌면(applyBreed) null로 되돌려서 새로 계산되게 해요.
// (2026-10-22 변경) 소형견/귀가 접힌 대형견을 수동으로 더 줄이던 보정(SMALL_BREED_SCALE,
// LARGE_EARS_DOWN_SCALE)은 삭제했어요 - "강아지 크기는 렌더러가 임의로 손대지 말고, 작업자가
// 정한 대지(캔버스) 세로 크기를 그대로 믿어달라"는 사용자 요청 때문이에요. 이제 견종 간
// 상대적인 크기 차이는 전적으로 각 idle/center.png 파일의 실제 세로 픽셀 크기(naturalH)로만
// 결정돼요 - 특정 견종이 이상하게 크거나 작으면, 코드가 아니라 그 견종의 idle 캔버스 세로
// 크기를 다른 견종들과 비슷하게 맞추는 쪽(에셋)에서 고쳐야 해요.

let bodyTargetPx = null;
function getBodyTargetPx() {
  if (bodyTargetPx != null) return bodyTargetPx;
  const idle = poseFrames.idle;
  const ref = idle && idle.directions.center;
  if (!ref) return null;
  const canvasH = ref.naturalH; // 내용(bbox)이 아니라 원본 파일(대지) 자체의 세로 픽셀 크기
  if (!canvasH || canvasH <= 0) return null;
  const target = canvasH * CANVAS_SCALE;
  bodyTargetPx = Math.max(BODY_MIN_PX, Math.min(BODY_MAX_PX, target));
  return bodyTargetPx;
}

// 캐릭터의 "바닥(기준점)" 오프셋 - 모든 포즈가 공통으로 맞출 목표 높이(getBodyTargetPx)의
// 절반이에요. 모든 포즈를 그릴 때 이 값을 바닥 기준으로 삼아서(가운데 정렬이 아니라), 포즈마다
// 그림의 여백/crop이 달라도 캐릭터의 발/바닥 위치가 안 흔들려요.
let groundY = null;
function getGroundY() {
  if (groundY != null) return groundY;
  const target = getBodyTargetPx();
  if (target == null) return null;
  if (bodyTargetPx != null) groundY = target / 2; // 목표값이 확정(캐싱)된 뒤에만 같이 캐싱
  return target / 2;
}

// 포즈 하나(frame)를 그릴 확대 비율 - 그 포즈 자신의 "내용"(bbox) 세로(높이)를 항상 같은
// 목표값(getBodyTargetPx)에 맞춰요. 가로는 이 비율을 그대로 곱해서 나오는 "자기 그림 본연의
// 폭"을 써요(강제로 어떤 고정 박스에 욱여넣지 않음 - 그렇게 했더니 가로세로 비율이 많이
// 다른 포즈(예: 불독 타이핑 동작)가 눈에 띄게 좌우로 눌리거나 늘어나 보이는 부작용이 있었어요).
// 안전장치: 세로(높이) 기준으로 맞추면 '엎드리기'처럼 세로는 짧고 가로로 아주 넓은 포즈는
// 가로 폭이 창 너비를 훌쩍 넘어버려서 오른쪽이 통째로 잘려 보여요(실측 결과 모든 견종에서
// 발생). 비율은 그대로 유지한 채(비틀지 않음) 가로 폭 자체에 상한(MAX_FRAME_DW)을 둬서,
// 상한에 걸리면 그 포즈만 전체적으로 조금 더 작게 그려지게 해요 - 잘리는 대신 작게 보이는
// 쪽이 훨씬 자연스러워요.
const MAX_FRAME_DW = canvas.width - 20; // 창 가로(260)에서 양쪽 10px씩 여백

// idle 자신의 "본연의 가로 폭" - idle 기준 목표 높이에 맞췄을 때 idle이 차지하는 가로
// 폭이에요. touched/licking/typing 같은 "서 있는 자세의 변형" 포즈들이 이 폭보다 더
// 넓게 그려지면(귀가 접히거나 팔이 벌어지는 포즈라 실제로 더 넓게 그려진 경우) 왼쪽
// 기준점(getIdleLeftAnchorX)은 고정이라 오른쪽으로만 퍼지면서 "커짐"으로 느껴져요.
// idle 폭을 넘지 않도록(줄이기만 함, 비율은 유지) 같이 캡을 걸어서 이 체감을 없애요.
// lying은 원래부터 서 있는 포즈와 실루엣 자체가 달라서(옆으로 누움) 이 캡에서 제외.
// (2026-10-22 변경) getIdleDw()는 아래 getFrameScale()의 '만지면 폭이 idle보다 넓어지면
// 절반만 보정' 로직 전용이었는데, 그 로직 자체를 없애서(가로는 포즈마다 자연스럽게 다르게
// 두기로 함) 더 이상 안 써서 삭제했어요.

// 엎드리기(lying)는 원래 가로세로 비율이 다른 포즈들보다 훨씬 납작하고 넓어서, 다른
// 포즈랑 "같은 세로 높이"에 맞추면 가로 폭이 거의 항상 창 너비 한계(MAX_FRAME_DW)에
// 딱 붙게 돼요(실측해보니 22개 견종 중 대부분이 240px 꽉 채움) - 세로는 오히려 다른
// 포즈보다 작아지는데도(바닥 기준 정렬이라 위쪽 여백만 늘어남), 가로로 창을 거의 꽉
// 채우는 모습이 "커졌다"는 인상을 줘요. 그래서 엎드리기만 목표 높이 자체를 한 번 더
// 줄여서(LYING_SCALE), 창 가장자리에 딱 붙지 않고 다른 포즈들과 비슷한 "무게감"으로
// 보이게 해요.
// (2026-10-22 변경) LYING_SCALE(엎드리기 전용 축소)과 "만지면 idle보다 넓어지면 절반만
// 보정"하던 로직을 모두 없앴어요 - "세로(대지 높이)는 전 견종/전 포즈 공통으로 고정하고,
// 가로는 포즈마다(특히 엎드리기처럼 원래 옆으로 넓은 포즈는 더더욱) 자연스럽게 달라지는 게
// 정상"이라는 사용자 설명에 따른 거예요. 이제 모든 포즈는 "원본 대지의 세로 픽셀 크기
// (naturalH)를 공통 목표 높이에 맞추고, 가로는 그 비율 그대로"만 적용해요 - MAX_FRAME_DW만
// 화면 밖으로 안 잘리게 막는 순수 안전장치로 남겨뒀어요(스타일 보정 아님).
function getFrameScale(frame, poseName, bboxOverride) {
  const target = getBodyTargetPx() || DISPLAY_MAX;
  const canvasH = frame.naturalH;
  if (!canvasH || canvasH <= 0) return 1;
  let scale = target / canvasH;
  const cs = contentSize(frame, bboxOverride); // 실제로 그려지는 건 bbox(내용)만이라, 오버플로 체크는 bbox 기준으로
  const dw = cs.w * scale;
  if (dw > MAX_FRAME_DW) {
    scale *= MAX_FRAME_DW / dw;
  }
  return scale;
}

// 가로 위치 기준점 - 캔버스/내용을 "가운데" 정렬하지 않고, idle 그림의 "왼쪽 가장자리"가
// 화면의 어디에 오는지를 딱 한 번 정해서, 포즈가 뭐든 항상 그 자리에 왼쪽 가장자리를 맞춰요.
// 실측해보니(여러 견종) touched/licking 등에서 내용이 좁아지거나 넓어지는 변화가 거의 항상
// "오른쪽"(귀/다리/꼬리 쪽)에서만 일어나고 왼쪽 가장자리(raster 좌표)는 포즈가 달라져도 거의
// 안 움직였어요 - 그림을 그릴 때 왼쪽을 기준으로 맞춰 그리는 습관 같아요. 그래서 내용 전체를
// 가운데 정렬하면(이전 방식) 오히려 왼쪽도 같이 움직여서 "쏠려 보임" 버그가 생겼던 거고,
// 왼쪽 가장자리를 고정하면 실제 그림 습관과 맞아떨어져서 쏠림이 없어져요.
let idleLeftAnchorX = null;
function getIdleLeftAnchorX() {
  if (idleLeftAnchorX != null) return idleLeftAnchorX;
  const target = getBodyTargetPx();
  const idle = poseFrames.idle;
  const ref = idle && idle.directions.center;
  if (!ref || target == null) return null;
  const cs = contentSize(ref);
  const scale = getFrameScale(ref, 'idle'); // getFrameScale()과 같은(대지 세로 기준) 스케일을 그대로 써야 일관돼요
  const idleDw = cs.w * scale;
  const anchor = -idleDw / 2; // idle 자신은 그대로 가운데 정렬되도록(왼쪽 가장자리가 -idleDw/2)
  if (bodyTargetPx != null) idleLeftAnchorX = anchor; // 목표값이 확정된 뒤에만 같이 캐싱
  return anchor;
}

// 이름표/말풍선 위치(face.json 비율)를 화면 좌표로 바꿀 때 쓰는, idle(center) 그림 "자체"의
// 고정 박스 정보 - 지금 활성화된 포즈가 뭐든 상관없이 항상 idle 기준으로 고정해서 써야
// 이름표가 포즈 바뀔 때마다 흔들리지 않아요.
let idleFaceBox = null;
function getIdleFaceBox() {
  if (idleFaceBox) return idleFaceBox;
  const target = getBodyTargetPx();
  const ground = getGroundY();
  const idle = poseFrames.idle;
  const ref = idle && idle.directions.center;
  if (!ref || target == null || ground == null) return null;
  const cs = contentSize(ref);
  const scale = getFrameScale(ref, 'idle'); // getFrameScale()과 같은(대지 세로 기준) 스케일을 그대로 써야 일관돼요
  const dw = cs.w * scale;
  const dh = cs.h * scale;
  idleFaceBox = { dw, dh, drawTop: ground - dh, bbox: ref.bbox, rasterW: ref.rasterW, rasterH: ref.rasterH };
  return idleFaceBox;
}

// 이름표를 "양 눈 사이 가운데, 정수리 위"에 띄우기 위한 좌표 - idle/center.png에서 자동
// 분석해둔 face.json({x, y, headTopY}, 캔버스 대비 0~1 비율 - x는 두 눈 사이 가로 중심,
// headTopY는 그 x 위치에서 머리 윤곽선의 맨 위쪽/정수리, y는 눈 윗쪽(예전 방식, 하위호환용))을
// 화면 좌표로 바꿔서 캐싱해요. face.json이 없거나 headTopY가 없는(예전에 만든) 견종은
// {x:0.5, y:0, headTopY:0}로 대체 - 이러면 예전 방식(그림 전체 맨 위 가운데)과 비슷하게 동작.
// 견종 바뀌면(applyBreed) null로 되돌려서 새로 계산.
let faceAnchor = null;
function getFaceAnchor() {
  if (faceAnchor) return faceAnchor;
  const idle = poseFrames.idle;
  const ref = idle && idle.directions.center;
  if (!ref) return null;
  const face = (idle && idle.face) || { x: 0.5, y: 0, headTopY: 0 };
  const headTopY = typeof face.headTopY === 'number' ? face.headTopY : face.y;
  faceAnchor = { x: face.x, y: face.y, headTopY, naturalW: ref.naturalW, naturalH: ref.naturalH };
  return faceAnchor;
}

function applyBreed(breedName) {
  const breedData = breedsInfo[breedName];
  if (!breedData) return; // 그림이 없는 견종이면 조용히 무시(지금 보여주던 걸 그대로 유지)
  CURRENT_BREED = breedName;
  bodyTargetPx = null;
  idleLeftAnchorX = null;
  faceAnchor = null;
  groundY = null;
  idleFaceBox = null;

  const posesInfo = breedData.poses || {};
  const nextPoseFrames = {};

  if (posesInfo.idle) {
    const directionsInfo = posesInfo.idle.directions || {};
    const directions = {};
    nextPoseFrames.idle = { directions, face: posesInfo.idle.face || null, gaze: null };
    Object.keys(directionsInfo).forEach((dirName) => {
      directions[dirName] = null;
      loadFrame(directionsInfo[dirName]).then((frameObj) => {
        directions[dirName] = frameObj;
      });
    });
    // base(눈/코입 지운 얼굴) + feature(눈/코입만) 레이어 - 있으면 렌더러가 커서 방향에 따라
    // feature를 연속적으로 옮겨 그려서 시선이 자연스럽게(4방향으로 뚝뚝 끊기지 않고) 따라가게 해요.
    if (posesInfo.idle.gazeLayers) {
      const gaze = { base: null, feature: null };
      nextPoseFrames.idle.gaze = gaze;
      loadFrame(posesInfo.idle.gazeLayers.base).then((frameObj) => { gaze.base = frameObj; });
      loadFrame(posesInfo.idle.gazeLayers.feature).then((frameObj) => { gaze.feature = frameObj; });
    }
  }

  for (const poseName of Object.keys(posesInfo)) {
    if (poseName === 'idle') continue;
    const def = posesInfo[poseName];
    const entry = { fps: def.fps, frames: def.frames.map(() => null) };
    nextPoseFrames[poseName] = entry;
    def.frames.forEach((f, idx) => {
      loadFrame(f.src).then((frameObj) => {
        entry.frames[idx] = frameObj;
      });
    });
  }

  poseFrames = nextPoseFrames;
}

if (CURRENT_BREED) applyBreed(CURRENT_BREED);

// 우선순위: 드래그(뛰기) > 타이핑(반응) > 스크롤(핥기) > 머리 호버(귀 젖힘) > 오래 무활동(엎드리기) > idle.
// 각 포즈 그림이 아직 없으면(poseFrames에 없으면) 자동으로 다음 우선순위로 넘어가서 idle로 떨어짐.
const IDLE_TO_LYING_MS = 30000; // 30초 - 이 시간 동안 마우스/드래그/타이핑 전부 없으면 엎드림
const TYPING_HOLD_MS = 300; // 마지막 키 입력 후 이 시간(ms)만 타이핑 포즈 유지 - 짧게 잡아서 타이핑 멈추면 거의 바로 돌아옴
const SCROLL_HOLD_MS = 550; // 마지막 스크롤 신호 후 이 시간(ms)만 핥기 포즈 유지 - 혀 넣고 빼는 동작이라 타이핑보다 살짝 길게

function getCurrentPoseName() {
  if (dragging && poseFrames.running) return 'running';
  if (Date.now() - lastTypeTime < TYPING_HOLD_MS && poseFrames.typing) return 'typing';
  if (Date.now() - lastScrollTime < SCROLL_HOLD_MS && poseFrames.licking) return 'licking';
  if (headHover && poseFrames.touched) return 'touched';
  if (headHover && poseFrames.earsback) return 'earsback';
  if (idleMs > IDLE_TO_LYING_MS && poseFrames.lying) return 'lying';
  return 'idle';
}

// 포즈 하나에서 지금 시점(t)에 보여줄 프레임을 고름 - 여러 장이면(fps 있으면) 시간에 따라 순환 재생
function pickFrame(pose, t) {
  const frames = pose.frames;
  if (!frames || !frames.length) return null;
  let idx = 0;
  if (pose.fps && frames.length > 1) {
    idx = Math.floor((t / 1000) * pose.fps) % frames.length;
  }
  return frames[idx] || frames.find((f) => f) || null; // 아직 로딩 중이면 로드된 다른 프레임이라도
}

// 커서 방향(eyeTarget, -1~1)에 따라 idle의 5방향 그림 중 하나를 골라요.
// 가운데 근처(데드존)는 center, 그 외엔 더 크게 벗어난 축(가로/세로)을 기준으로 4방향 중 하나.
// 그 방향 그림이 없으면(덜 그려졌으면) 조용히 center로 대체.
const GAZE_DEADZONE = 0.15;

// facingFlip이 true면(화면 오른쪽에 있어서 캐릭터를 통째로 좌우 반전해서 그림) left/right를
// 서로 바꿔서 골라요 - 어차피 그리는 쪽(render)에서 캔버스를 한 번 더 좌우 반전하기 때문에,
// 여기서 미리 반대 그림을 골라둬야 최종적으로 커서가 있는 실제 방향과 눈이 맞아요.
function mirrorDirName(name) {
  if (name === 'left') return 'right';
  if (name === 'right') return 'left';
  return name;
}

function pickIdleDirection() {
  const idle = poseFrames.idle;
  if (!idle) return null;
  const ax = Math.abs(eyeTarget.x);
  const ay = Math.abs(eyeTarget.y);
  let dirName = 'center';
  if (Math.max(ax, ay) > GAZE_DEADZONE) {
    if (ax >= ay) dirName = eyeTarget.x > 0 ? 'right' : 'left';
    else dirName = eyeTarget.y > 0 ? 'down' : 'up';
  }
  if (facingFlip) dirName = mirrorDirName(dirName);
  return idle.directions[dirName] || idle.directions.center || null;
}

// base/feature 레이어가 둘 다 로드돼 있으면 { base, feature }를 돌려줘요(연속 추적용).
// 아직 없거나(이 견종은 예전 5장 방식) 로딩 중이면 null - 그러면 위 pickIdleDirection()으로 대체.
function pickIdleGaze() {
  const idle = poseFrames.idle;
  if (!idle || !idle.gaze) return null;
  const { base, feature } = idle.gaze;
  if (!base || !feature) return null;
  return { base, feature };
}

function getActiveFrame() {
  const wantedName = getCurrentPoseName();
  if (wantedName === 'idle') {
    const gaze = pickIdleGaze();
    if (gaze) return { gaze, poseName: 'idle' };
    const frame = pickIdleDirection();
    return frame ? { frame, poseName: 'idle' } : null;
  }
  const wanted = poseFrames[wantedName];
  const t = Date.now() - startTime;
  let frame = wanted ? pickFrame(wanted, t) : null;
  if (!frame) {
    frame = pickIdleDirection(); // 아직 없으면 idle로 대체
    return frame ? { frame, poseName: 'idle' } : null;
  }
  return frame ? { frame, poseName: wantedName, pose: wanted } : null;
}

// ---- 상태값 ----
let eyeTarget = { x: 0, y: 0 };   // -1~1, 커서가 있는 방향 - idle 그림을 고를 때만 씀
let smoothEye = { x: 0, y: 0 };   // eyeTarget을 매 프레임 조금씩 뒤쫓아가는 값 - 연속 시선(gaze) 추적을
                                   // 뚝뚝 끊기지 않고 자연스럽게(관성 있는 느낌으로) 만들려고 씀
let hearts = [];                  // 쓰다듬을 때(headHover) 떠오르는 작은 하트 파티클들 { x, y, born, size, swayPhase }
let lastHeartSpawn = 0;           // 마지막으로 하트를 하나 새로 만든 시각(ms) - 일정 간격으로만 새로 생기게
const HEART_SPAWN_MS = 520;       // 이 간격(ms)마다 쓰다듬는 동안 하트 하나씩 새로 생김(개수를 줄이려고 예전보다 길게)
const HEART_LIFE_MS = 1100;       // 하트 하나가 떠올랐다 사라지기까지 걸리는 시간(ms)
let stretch = { x: 0, y: 0 };     // 드래그로 인한 당겨짐(px 단위, 클램프 전)
let dragging = false;
let lastTypeTime = 0;             // 마지막으로 키 입력이 있었던 시각(ms, Date.now()) - 타이핑 포즈 판단용
let lastScrollTime = 0;           // 마지막으로 스크롤(휠) 신호가 온 시각(ms) - 핥기(licking) 포즈 판단용
let headHover = false;            // 커서가 머리 위 영역에 있는지 - 귀 젖힘(earsback) 포즈 판단용
let headRegion = null;            // 매 프레임 갱신되는 머리 영역 { faceX, topY, bottomY, halfW } (화면 좌표)
let idleMs = 0;                   // 마지막 활동(마우스 이동/드래그/타이핑) 이후 지난 시간(ms) - 메인 프로세스가 계산
let facingFlip = false;           // 창이 화면 중앙보다 오른쪽에 있으면 true - 캐릭터를 안쪽(왼쪽)을 보도록 통째로 반전
let transientMessage = '';        // 리마인더가 울렸을 때 잠깐 보여주는 말풍선 문구 (고정 메시지와 별개)
let transientMessageUntil = 0;    // transientMessage를 이 시각(ms)까지만 보여줌
let transientKind = null;         // 'reminder' | null - 지금 뜬 말풍선이 리마인더인지(스타일/깜빡임 분기용)
const TRANSIENT_MESSAGE_MS = 10000; // 말풍선 노출 시간(ms)
let transientPopStart = 0;        // 말풍선이 막 나타난 시각 - 통통 튀며 나타나는 팝인 효과용
const REMINDER_POP_MS = 380;      // 팝인 애니메이션 길이(ms)
const REMINDER_FLASH_PERIOD = 700; // 리마인더 말풍선이 코랄<->흰색으로 한 번 깜빡이는 데 걸리는 시간(ms) - 노출되는 내내 계속 깜빡여요

const startTime = Date.now();

// ---- 메인 프로세스로부터 프레임 데이터 수신 ----
if (window.petAPI) {
  window.petAPI.onFrame((data) => {
    eyeTarget = data.eye;
    stretch = data.stretch;
    dragging = data.dragging;
    idleMs = data.idleMs || 0;
    facingFlip = !!data.flip;
  });
  window.petAPI.onType(() => {
    lastTypeTime = Date.now();
  });
  window.petAPI.onScroll(() => {
    lastScrollTime = Date.now();
  });
  // 리마인더가 울리면(설정한 주기마다) 말풍선에 잠깐 띄워요 - 고정 메시지가 있어도 잠깐은
  // 이게 덮어서 보이고, 시간 지나면 자동으로 원래(고정 메시지든 빈 화면이든)로 돌아가요.
  window.petAPI.onReminder((data) => {
    if (!data || !data.text) return;
    transientMessage = data.text;
    transientMessageUntil = Date.now() + TRANSIENT_MESSAGE_MS;
    transientKind = 'reminder';
    transientPopStart = Date.now();
  });
  // 트레이 "견종/이름 설정 변경"에서 새로 고른 값 - 새로고침 없이 바로 반영.
  window.petAPI.onSettingsUpdate((data) => {
    if (data.breed && data.breed !== CURRENT_BREED) applyBreed(data.breed);
    if (typeof data.name === 'string') petName = data.name;
    if (typeof data.message === 'string') petMessage = data.message;
  });
}

// ---- 실루엣 히트테스트 (클릭스루 판정 + 쓰다듬기 판정) ----
function isInsideSilhouette(x, y) {
  const dx = (x - CX) / 76;  // 95 * 0.8 (캐릭터 크기 20% 축소에 맞춰 히트 영역도 같이 축소)
  const dy = (y - (CY + 10)) / 84; // 105 * 0.8
  return dx * dx + dy * dy <= 1;
}

// 머리 위 호버 판정(귀 젖힘 반응용) - headRegion은 render()에서 매 프레임 최신 얼굴 위치로 갱신돼요.
function isInsideHeadRegion(x, y) {
  if (!headRegion) return false;
  if (y < headRegion.topY - 8 || y > headRegion.bottomY + 6) return false;
  return Math.abs(x - headRegion.faceX) <= headRegion.halfW;
}

let lastIgnoreState = null;
function updateIgnoreMouse(x, y) {
  const inside = isInsideSilhouette(x, y);
  if (inside !== lastIgnoreState) {
    lastIgnoreState = inside;
    window.petAPI && window.petAPI.setIgnoreMouse(!inside);
  }
  return inside;
}

// 머리 영역 경계에 커서가 걸쳐있으면 mousemove마다 미세하게 안/밖을 왔다갔다 하면서
// touched(쓰다듬기)/idle이 순간순간 바뀌어서 캐릭터가 떨리는 것처럼 보였어요(두 포즈의
// 그림 크기/비율이 완전히 같지 않아서 바뀔 때마다 살짝 "팍" 하고 바뀌는 게 눈에 띔).
// 들어갈 때는 바로 반응하고, 나갈 때만 짧게(HEAD_HOVER_EXIT_MS) 유예를 둬서 - 그 사이에
// 다시 안으로 들어오면 안 꺼진 걸로 쳐서 - 경계에서의 깜빡임을 없애요.
let headHoverExitTimer = null;
const HEAD_HOVER_EXIT_MS = 140;
function setHeadHover(inside) {
  if (inside) {
    if (headHoverExitTimer) {
      clearTimeout(headHoverExitTimer);
      headHoverExitTimer = null;
    }
    headHover = true;
  } else if (headHover && !headHoverExitTimer) {
    headHoverExitTimer = setTimeout(() => {
      headHover = false;
      headHoverExitTimer = null;
    }, HEAD_HOVER_EXIT_MS);
  }
}

document.addEventListener('mousemove', (e) => {
  updateIgnoreMouse(e.clientX, e.clientY);
  setHeadHover(isInsideHeadRegion(e.clientX, e.clientY));
});

// (2026-10-23 수정) 우클릭 메뉴 추가하면서 생긴 버그: 여기서 버튼 종류를 안 가려서
// 우클릭의 mousedown도 드래그 시작으로 잡혔었어요. 우클릭하면 바로 OS 메뉴가 뜨면서
// 페이지가 mouseup을 못 받아서(메뉴가 가로채감) dragEnd()가 영영 안 불리고, 캐릭터가
// 커서를 계속 쫓아다니다가 아무 데나 다시 클릭해야만(그 클릭의 mouseup에서) 멈추는
// 문제였어요. 왼쪽 버튼(e.button === 0)일 때만 드래그를 시작하도록 고쳤어요.
document.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (!isInsideSilhouette(e.clientX, e.clientY)) return;
  dragging = true;
  window.petAPI && window.petAPI.dragStart({ x: e.clientX, y: e.clientY });
});

// 캐릭터(실루엣) 위에서 우클릭하면 트레이 아이콘이랑 똑같은 설정/리마인더 메뉴가 뜨게 -
// 사용자 요청. 실루엣 밖에서는 이 창이 평소 클릭스루라 애초에 이벤트가 안 들어와요.
document.addEventListener('contextmenu', (e) => {
  if (!isInsideSilhouette(e.clientX, e.clientY)) return;
  e.preventDefault();
  // 혹시라도(다른 OS/입력 장치 등) 드래그가 걸린 채로 들어왔으면 메뉴 뜨기 전에 확실히 풀어줌.
  if (dragging) {
    dragging = false;
    window.petAPI && window.petAPI.dragEnd();
  }
  window.petAPI && window.petAPI.showContextMenu();
});

document.addEventListener('mouseup', () => {
  if (dragging) {
    window.petAPI && window.petAPI.dragEnd();
  }
});

document.addEventListener('mouseleave', () => {
  window.petAPI && window.petAPI.setIgnoreMouse(true);
  lastIgnoreState = true;
  if (headHoverExitTimer) {
    clearTimeout(headHoverExitTimer);
    headHoverExitTimer = null;
  }
  headHover = false;
});

// ---- 스크롤(핥기) 보조 감지: 캐릭터 위에서 스크롤할 때 ----
// main.js의 전역 휠 후킹(uiohook-napi)이 일부 환경(특히 macOS)에서 트랙패드든 마우스든
// wheel 이벤트를 아예 못 잡는 경우가 있어서(키보드 후킹은 되는데 휠만 안 되는 라이브러리
// 한계로 보임) - 적어도 "캐릭터 위에서 스크롤"하는 가장 흔한 상황만큼은 전역 후킹 없이도
// 반응하도록 브라우저 자체 wheel 이벤트로 보조 감지해요. 이 창은 평소엔 클릭스루(마우스
// 이벤트 무시) 상태라서 실루엣 밖에서는 이 이벤트가 애초에 안 들어오고, isInsideSilhouette
// 안에서 setIgnoreMouse(false)가 된 동안에만 들어와요 - 그래서 자연스럽게 "캐릭터 위"로
// 범위가 제한됨.
document.addEventListener('wheel', () => {
  lastScrollTime = Date.now();
}, { passive: true });

// ---- 메인 렌더 루프 ----
function render() {
  const t = Date.now() - startTime;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const active = getActiveFrame();
  if (!active) {
    requestAnimationFrame(render);
    return;
  }
  const gaze = active.gaze || null;
  const frame = gaze ? gaze.base : active.frame;
  const poseName = active.poseName;

  // (2026-10-22 재수정) 멀티프레임 포즈(타이핑/핥기 등)는 프레임마다 bbox가 미세하게 달라서,
  // 공유 bbox(먼저는 합집합, 그다음엔 "첫 프레임 기준", 그다음엔 "교집합")로 고정해보려고
  // 여러 번 시도했는데 - 결국 "그 프레임엔 없는 남의 여백"을 어떤 식으로든 완전히 배제하기
  // 어렵고(GSP 꼬리 쪽에 계속 이상한 선/테두리가 남는다는 재현 보고가 있었어요), 아예 이
  // 접근 자체를 접었어요. 그냥 각 프레임 "자기 자신의" bbox만 써요 - 그러면 다른 프레임의
  // 내용이 섞여 노출될 가능성이 원천적으로 없어요(수학적으로 불가능). 가로 흔들림은 아래
  // dx 계산에서 타이핑/엎드리기를 가운데 정렬(왼쪽 고정 대신)로 이미 따로 잡아놔서, 자기
  // bbox를 써도 몸이 옆으로 쏠리지는 않고(세로 높이는 getFrameScale이 항상 같은 기준으로
  // 맞춰줌) 폭만 프레임마다 아주 살짝 숨쉬듯 달라지는 정도라 훨씬 안전해요.
  const srcBbox = frame.bbox;

  // 그리는 크기(dw, dh) - 세로(dh)는 항상 같은 목표 높이로 고정되고(getFrameScale), 가로(dw)는
  // 그 비율을 그대로 곱한 "이 그림 본연의 폭"이에요(강제로 비틀지 않음). 아래 drawImage는
  // bbox(알파 내용만, 여백 제외)를 이 크기로 그려요.
  const cs = contentSize(frame, srcBbox);
  const scale = getFrameScale(frame, poseName, srcBbox);
  const dw = cs.w * scale;
  const dh = cs.h * scale;

  // 바닥(기준점) 정렬용: 항상 idle 기준 고정 높이(groundY)를 바닥으로 삼아요 - 그래야 귀가
  // 접혀서(touched) 그림의 내용 높이가 줄어도 강아지가 커지거나 통째로 떠오르지 않고, 딱
  // 귀 부분만 접힌 것처럼 보여요. (아직 idle 기준값이 없으면 지금 프레임 자신의 절반 높이로
  // 잠깐 대체 - 로딩 초반에만 해당.)
  const ground = getGroundY();
  const groundHalfH = ground != null ? ground : dh / 2;
  const drawTop = groundHalfH - dh; // 로컬 좌표(캐릭터 중심 기준)에서 그림의 위쪽 y

  // smoothEye를 eyeTarget 쪽으로 매 프레임 조금씩(비율 0.18) 당겨서 - 커서가 휙 움직여도
  // 시선이 순간이동하지 않고 살짝 관성 있게 뒤따라가는 느낌을 줘요(gaze 연속 추적에서만 씀).
  const EYE_EASE = 0.18;
  smoothEye.x += (eyeTarget.x - smoothEye.x) * EYE_EASE;
  smoothEye.y += (eyeTarget.y - smoothEye.y) * EYE_EASE;

  // 아이들 바운스
  const idleBobSpeed = 650;
  const idleBobAmount = 4;
  const bob = Math.sin(t / idleBobSpeed) * idleBobAmount;

  // 드래그 스트레치 -> 스케일/스큐로 변환 (클램프)
  const sx = Math.max(-40, Math.min(40, stretch.x));
  const sy = Math.max(-40, Math.min(40, stretch.y));
  const stretchAmount = Math.sqrt(sx * sx + sy * sy);
  const scaleStretch = 1 + Math.min(stretchAmount, 40) / 220;
  const squash = 1 - Math.min(stretchAmount, 40) / 260;

  ctx.save();
  ctx.translate(CX, CY + bob);

  const angle = Math.atan2(sy, sx);
  ctx.rotate(angle);
  ctx.scale(squash + Math.min(stretchAmount, 40) / 90, scaleStretch);
  ctx.rotate(-angle);

  // 화면 위치에 따른 좌우 반전 - 드래그 스트레치 계산은 실제 화면 좌표 기준으로 이미 끝났으니,
  // 그리기 직전에만 반전해서 스트레치 방향 계산과 안 꼬이게 했어요.
  // (2026-10-22 추가) 타이핑 포즈 그림은 idle과 반대 방향 관례로 그려져 있어서(사용자 확인),
  // facingFlip을 그대로 쓰면 idle은 맞는데 타이핑만 거꾸로 보여요 - 타이핑일 때만 반전 여부를
  // 뒤집어서, idle이 왼쪽을 볼 때 타이핑도 같이 왼쪽을 보게 맞춰요.
  const poseFlip = (poseName === 'typing') ? !facingFlip : facingFlip;
  if (poseFlip) ctx.scale(-1, 1);

  // 가로 위치: 내용을 가운데 정렬하지 않고, "왼쪽 가장자리"를 항상 idle 기준 고정 위치
  // (getIdleLeftAnchorX)에 맞춰요. 실측해보니 거의 모든 견종에서 포즈가 바뀔 때 내용 폭이
  // 달라지는 변화는 왼쪽(꼬리 쪽)이 아니라 오른쪽(귀/다리 쪽)에서만 일어나요 - 왼쪽 가장자리를
  // 고정하면 그 그림 습관과 맞아떨어져서, 포즈가 바뀌어도 왼쪽은 전혀 안 흔들리고 오른쪽만
  // 자연스럽게 줄었다 늘었다 해요(이전엔 전체를 가운데 정렬해서 왼쪽도 같이 움직였던 게
  // "만지면 옆으로 쏠림" 버그의 원인이었어요).
  const leftAnchor = getIdleLeftAnchorX();
  // (2026-10-23 변경) 타이핑 중 캐릭터가 많이 움직인다는 피드백으로, center 정렬 대신
  // idle과 같은 "꼬리 쪽 고정 앵커" 방식으로 되돌렸어요. 단, 타이핑 그림은 idle과 반대
  // 방향 관례로 그려져 있어서 바로 위 poseFlip이 facingFlip의 반대값이에요(같은 화면 위치여도
  // 타이핑만 거울 적용 여부가 idle과 뒤집혀 있음) - 그래서 idle과 똑같은 leftAnchor를 그대로
  // 쓰면 거울이 한 번 더(또는 덜) 걸려서 꼬리가 반대쪽에 고정돼버려요(이전에 "몸 전체가
  // 휙 움직인다"고 느껴졌던 것도 이 뒤집힘 보정을 안 했기 때문으로 보여요). 그래서 타이핑만
  // 앵커 자체를 좌우로 한 번 반사(-(leftAnchor + dw))시켜서, poseFlip이 반대로 걸리는 걸
  // 상쇄하고 idle과 "같은 화면 쪽"에 꼬리가 고정되게 맞췄어요 - 모니터 왼쪽에 있으면 화면
  // 왼쪽 끝에, 오른쪽에 있으면 화면 오른쪽 끝에 꼬리가 고정되고, 키보드/몸통이 있는 반대쪽만
  // 늘었다 줄었다 해요.
  // 엎드리기(lying)는 옆으로 누운 전혀 다른 실루엣이라 꼬리 기준 자체가 안 맞아서 그대로 가운데 정렬 유지.
  const dx = (poseName === 'lying')
    ? -dw / 2
    : (poseName === 'typing')
      ? (leftAnchor != null ? -(leftAnchor + dw) : -dw / 2)
      : (leftAnchor != null ? leftAnchor : -dw / 2); // 로딩 초반(idle 아직 없음) 폴백

  if (gaze) {
    // base(얼굴 전체, 눈/코입 지운 상태)를 먼저 그리고, 그 위에 feature(눈/코입)를 커서 방향에
    // 비례하는 연속적인 px만큼 옮겨서 겹쳐 그려요 - 5장 중 하나로 딱딱 바뀌는 대신 눈이 부드럽게
    // 커서를 따라가요. 이동량 비율(26/900, 22/900)은 예전에 4방향 그림을 구울 때 썼던 것과 같은
    // 크기라서 그림체가 안 어색해요.
    // base 바운딩 박스(bbox)만 잘라서 그려요. feature(눈/코입)는 base랑 같은 캔버스 위에
    // 정확히 겹쳐야 하는 레이어라서, feature 자신의 bbox(눈만 있어서 훨씬 작음)가 아니라
    // base의 bbox를 그대로 소스 영역으로 써야 눈/코입이 얼굴 위 제자리에 그려져요.
    const baseBbox = frame.bbox;
    ctx.drawImage(gaze.base.canvas, baseBbox.x, baseBbox.y, baseBbox.w, baseBbox.h, dx, drawTop, dw, dh);
    const ex = Math.max(-1, Math.min(1, smoothEye.x));
    const ey = Math.max(-1, Math.min(1, smoothEye.y));
    let offX = ex * (26 / 900) * dw;
    const offY = ey * (22 / 900) * dh;
    if (facingFlip) offX = -offX; // 통째로 좌우 반전되는 좌표계 안이라, 반대로 미리 보정
    if (gaze.feature) {
      ctx.drawImage(gaze.feature.canvas, baseBbox.x, baseBbox.y, baseBbox.w, baseBbox.h, dx + offX, drawTop + offY, dw, dh);
    }
  } else {
    ctx.drawImage(frame.canvas, srcBbox.x, srcBbox.y, srcBbox.w, srcBbox.h, dx, drawTop, dw, dh);
  }

  ctx.restore();

  // 이름표/고정 메시지 - 드래그 스트레치(회전/찌그러짐)는 안 받고, 위아래 바운스(bob)만 같이
  // 움직이게 별도로 그려요(스트레치까지 같이 받으면 글자가 기울어져서 읽기 불편해서). 글자 자체는
  // 반전(facingFlip)도 안 받아요 - 텍스트가 뒤집혀 보이면 안 되니까.
  // 얼굴 위치(faceX/faceTopY)는 이름표/메시지를 실제로 보여줄지와 상관없이 매 프레임 계산해둬요 -
  // 머리 호버 판정(귀 젖힘 반응)에도 같이 쓰여서, 이름표도 고정 메시지도 없을 때조차 필요해요.
  const fa = getFaceAnchor();
  // face.json의 비율은 idle/center.png "전체 캔버스" 기준(0~1)이라, 지금 활성화된 포즈가
  // 뭐든 상관없이 항상 idle 자체의 고정 박스(ibox)를 기준으로 화면 좌표로 환산해요 - 그래야
  // 이름표/말풍선이 포즈가 바뀌어도(touched든 licking이든) 제자리에서 안 흔들려요.
  const ibox = getIdleFaceBox();
  // 가로 위치 = 양 눈 사이 가로 중심(face.json의 x). 캐릭터가 화면 오른쪽에 있어서 통째로
  // 좌우 반전(facingFlip)해서 그려질 때는, 이 부분은 반전 변환 바깥(ctx.restore() 이후)이라
  // fx를 직접 좌우로 뒤집어서 같이 맞춰줘요.
  let faceX = CX; // face.json/idle 기준값이 아직 없으면(하위 호환/로딩 초반) 캐릭터 가로 가운데
  let faceTopY = CY + bob + drawTop; // 마찬가지로 없으면 예전처럼 지금 그림 맨 위
  let faceBottomY = faceTopY + dh * 0.22;
  if (fa && ibox) {
    // face.json 비율(전체 캔버스 기준)을 raster 좌표로 바꾼 다음, bbox(내용만 잘라 그린 영역)
    // 안에서의 상대 위치로 다시 환산해서 화면 좌표를 구해요 - bbox 밖(예: 캔버스 여백 쪽)을
    // 가리키는 극단적인 face.json 값이라도 자연스럽게(박스 밖으로) 계산되니 안전해요.
    const fx = facingFlip ? 1 - fa.x : fa.x;
    const rxPos = fx * ibox.rasterW;
    faceX = CX + (-ibox.dw / 2 + (rxPos - ibox.bbox.x) * (ibox.dw / ibox.bbox.w));

    const ryTop = fa.headTopY * ibox.rasterH;
    faceTopY = CY + bob + (ibox.drawTop + (ryTop - ibox.bbox.y) * (ibox.dh / ibox.bbox.h));

    const ryBottom = fa.y * ibox.rasterH;
    faceBottomY = CY + bob + (ibox.drawTop + (ryBottom - ibox.bbox.y) * (ibox.dh / ibox.bbox.h));
  }
  headRegion = { faceX, topY: faceTopY, bottomY: faceBottomY, halfW: (ibox ? ibox.dw : dw) * 0.32 };

  // ---- 쓰다듬을 때(머리 호버) 작은 하트가 위로 떠오르며 사라지는 이펙트 ----
  // headHover인 동안 일정 간격(HEART_SPAWN_MS)마다 얼굴 근처에서 하트 하나씩 생기고, 위로
  // 흔들리며 떠오르다 옅어지며 사라져요(HEART_LIFE_MS). headHover가 꺼져도 이미 떠 있는
  // 하트는 끝까지 자연스럽게 사라지게 두고(뚝 끊기지 않게), 스트레치/반전 변환은 안 받아요
  // (이름표/말풍선과 같은 이유 - 하트가 기울거나 뒤집혀 보이면 이상하니까).
  if (headHover && t - lastHeartSpawn > HEART_SPAWN_MS) {
    lastHeartSpawn = t;
    hearts.push({
      x: faceX + (Math.random() - 0.5) * dw * 0.45,
      y: faceTopY + dh * 0.05,
      born: t,
      size: 18 + Math.random() * 8, // 크게 - 18~26px
      swayPhase: Math.random() * Math.PI * 2,
    });
  }
  if (hearts.length) {
    hearts = hearts.filter((h) => t - h.born < HEART_LIFE_MS);
    if (heartImg) {
      for (const h of hearts) {
        const age = (t - h.born) / HEART_LIFE_MS; // 0~1
        const riseY = h.y - age * 46; // 위로 떠오름
        const swayX = h.x + Math.sin(age * Math.PI * 2 + h.swayPhase) * 5;
        const alpha = 1 - age; // 올라가는 내내 투명도로 서서히 사라짐(끝에서 갑자기 사라지지 않게)
        const hw = h.size * (0.85 + age * 0.3);
        const hh = hw * (heartImg.naturalH / heartImg.naturalW);
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
        ctx.drawImage(heartImg.canvas, swayX - hw / 2, riseY - hh / 2, hw, hh);
        ctx.restore();
      }
    }
  }

  // 리마인더/뽀모도로 말풍선이 아직 노출 시간 안이면 고정 메시지보다 우선해서 보여줌 - 시간
  // 지나면 자동으로 꺼지고 원래(고정 메시지든 빈 화면이든)로 돌아가요.
  const isTransientBubble = Date.now() < transientMessageUntil;
  const showingMessage = isTransientBubble ? transientMessage : petMessage;
  const bubbleKind = isTransientBubble ? transientKind : null; // 'reminder' | null
  const popT = Math.max(0, Math.min(1, (Date.now() - transientPopStart) / REMINDER_POP_MS));
  const flashElapsedMs = Date.now() - transientPopStart;

  // 말풍선(고정/임시 메시지)은 머리 위에, 이름표는 캐릭터 아래(발밑)에 - 서로 자리가 겹치지
  // 않게 완전히 분리해서 배치해요.
  // (2026-10-22 추가) faceTopY는 항상 idle 기준 고정값이라 포즈가 바뀌어도 안 흔들리지만,
  // 거꾸로 "이번 포즈가 idle보다 실제로 더 위까지 그려지는" 경우(예: 타이핑 중 앞발을 더 높이
  // 드는 동작)는 반영을 못 해서 말풍선이랑 캐릭터가 겹칠 수 있어요(사용자 확인 - 버그 아니라
  // 포즈 특성). 실제 이번 프레임이 그려지는 맨 위(화면 좌표)도 같이 계산해서, 둘 중 더 위쪽
  // (작은 y) 기준으로 말풍선을 띄워요 - idle/대부분의 포즈는 두 값이 거의 같아서 원래처럼 안
  // 흔들리고, 캐릭터가 더 높이 올라가는 포즈에서만 말풍선도 같이 더 위로 비켜나요.
  const actualTopY = CY + bob + drawTop;
  const bubbleAnchorY = Math.min(faceTopY, actualTopY);
  if (showingMessage) drawMessageBubble(showingMessage, faceX, bubbleAnchorY - 6, bubbleKind, popT, flashElapsedMs);
  if (petName) {
    const nameTextY = CY + bob + groundHalfH + 20; // 항상 고정된 바닥선 기준 - 포즈 바뀌어도 이름표가 안 흔들림
    drawNameplate(petName, faceX, nameTextY);
  }

  requestAnimationFrame(render);
}

// 캐릭터 아래쪽(발밑)에 이름을 작은 알약 모양 배지로 표시 - textY는 글자 세로 중심의 화면 y좌표.
function drawNameplate(name, faceX, textY) {
  ctx.save();
  ctx.font = '16px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const padX = 11;
  const textWidth = ctx.measureText(name).width;
  const boxW = textWidth + padX * 2;
  const boxH = 26;
  const boxX = faceX - boxW / 2;
  const boxY = textY - boxH / 2;
  const radius = boxH / 2;

  ctx.beginPath();
  ctx.moveTo(boxX + radius, boxY);
  ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, radius);
  ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, radius);
  ctx.arcTo(boxX, boxY + boxH, boxX, boxY, radius);
  ctx.arcTo(boxX, boxY, boxX + boxW, boxY, radius);
  ctx.closePath();
  ctx.fillStyle = 'rgba(40, 34, 28, 0.68)';
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.fillText(name, faceX, textY + 1);
  ctx.restore();
}

// 고정 메시지 말풍선 - bottomY는 말풍선 꼬리 끝(머리를 가리키는 뾰족한 부분)의 화면 y좌표.
// 글자 수에 맞춰 줄 수 제한 없이 자동 줄바꿈해요(잘리는 부분 없이 전부 보여줌). 한글은 띄어쓰기가
// 없는 짧은 문구도 많아서 단어 단위가 아니라 글자 단위로 줄바꿈해요.
// kind가 'reminder'면(리마인더 알림) 그냥 텍스트만 바뀌면 눈에 잘 안 띄어서 - 아이콘을 붙이고,
// popT(0~1, 막 나타난 시점부터 REMINDER_POP_MS 동안 진행)로 통통 튀며 커지는 팝인 효과를 준 다음,
// 노출되는 내내(elapsedMs 기준, REMINDER_FLASH_PERIOD마다 한 바퀴) 배경색과 글자색이 코랄(#e2593f)과
// 흰색 사이에서 서로 자리를 바꿔가며(pulse=0: 흰 배경+코랄 글자, pulse=1: 코랄 배경+흰 글자)
// 반짝이게 해요 - 메시지만 바뀌는 것보다 훨씬 눈에 잘 띄어요.
function drawMessageBubble(text, x, bottomY, kind, popT, elapsedMs) {
  ctx.save();

  const isWarm = kind === 'reminder';

  if (isWarm && popT < 1) {
    // easeOutBack - 끝에서 살짝 넘치게 커졌다가 제자리로 돌아오는 "통통" 튀는 느낌
    const c1 = 1.70158, c3 = c1 + 1;
    const t = popT - 1;
    const scale = 1 + c3 * t * t * t + c1 * t * t;
    ctx.translate(x, bottomY);
    ctx.scale(scale, scale);
    ctx.translate(-x, -bottomY);
  }


  ctx.font = '15px -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const maxWidth = 200;
  // 줄 수 제한 없이 글자 수에 맞춰 전부 줄바꿈해서 보여줘요 - 잘리거나 "…"으로 생략되는 부분 없이.
  const lines = [];
  let line = '';
  for (const ch of text) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);

  const lineHeight = 20;
  const padX = 13;
  const padY = 10;
  const textMaxWidth = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW = textMaxWidth + padX * 2;
  const boxH = lines.length * lineHeight + padY * 2 - (lineHeight - 15);
  const tailH = 6;
  const boxY = bottomY - tailH - boxH;
  const boxX = x - boxW / 2;
  const radius = 10;

  // 박스(말풍선 몸통)와 꼬리(머리를 가리키는 뾰족한 부분)를 하나의 경로로 이어서 그려요 -
  // 예전엔 박스를 따로 채우기+테두리선을 그리고 나서 꼬리 삼각형을 그 위에 겹쳐 채웠는데, 그러면
  // 박스의 아래쪽 테두리선이 꼬리 양옆으로 계속 이어져서, 특히 테두리가 진한 색(코랄)일 때
  // 꼬리 옆에 선이 따로 떠 있는 것처럼 보이는 문제가 있었어요. 지금처럼 경로를 하나로 합치면
  // 테두리선이 꼬리를 따라 자연스럽게 이어지고, 중간에 끊기는 선이 안 생겨요.
  ctx.beginPath();
  ctx.moveTo(boxX + radius, boxY);
  ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, radius);
  ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, radius);
  ctx.lineTo(x + 6, boxY + boxH);
  ctx.lineTo(x, boxY + boxH + tailH);
  ctx.lineTo(x - 6, boxY + boxH);
  ctx.arcTo(boxX, boxY + boxH, boxX, boxY, radius);
  ctx.arcTo(boxX, boxY, boxX + boxW, boxY, radius);
  ctx.closePath();

  // 리마인더는 노출되는 내내 배경<->글자 색이 코랄(#e2593f)과 흰색 사이를 서로 뒤바뀌며
  // 반짝여요(sine 펄스, REMINDER_FLASH_PERIOD마다 한 바퀴) - pulse=0이면 흰 배경+코랄 글자,
  // pulse=1이면 코랄 배경+흰 글자.
  let bubbleFill = '#fff';
  let textColor = '#3a332c';
  let borderColor = 'rgba(0,0,0,0.12)';
  if (kind === 'reminder') {
    const pulse = (Math.sin((elapsedMs / REMINDER_FLASH_PERIOD) * Math.PI * 2) + 1) / 2; // 0~1
    const CORAL = [0xe2, 0x59, 0x3f];
    const r1 = Math.round(255 + (CORAL[0] - 255) * pulse);
    const g1 = Math.round(255 + (CORAL[1] - 255) * pulse);
    const b1 = Math.round(255 + (CORAL[2] - 255) * pulse);
    bubbleFill = `rgb(${r1}, ${g1}, ${b1})`;
    const r2 = Math.round(CORAL[0] + (255 - CORAL[0]) * pulse);
    const g2 = Math.round(CORAL[1] + (255 - CORAL[1]) * pulse);
    const b2 = Math.round(CORAL[2] + (255 - CORAL[2]) * pulse);
    textColor = `rgb(${r2}, ${g2}, ${b2})`;
    borderColor = '#e2593f';
  }
  ctx.fillStyle = bubbleFill;
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = isWarm ? 2 : 1;
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = textColor;
  lines.forEach((l, i) => {
    const ly = boxY + padY + i * lineHeight + lineHeight / 2 - 1;
    ctx.fillText(l, x, ly);
  });

  ctx.restore();
}

requestAnimationFrame(render);
