// 견종 목록 + 화면에 보여줄 한글 이름 - main.js / preload.js / onboarding-preload.js가 전부
// 이 파일 하나를 같이 보게 해서, 새 견종을 추가할 때 여기 한 곳만 고치면 되게 해뒀어요.
// 새 견종 그림을 추가할 땐: 1) assets/breeds/<견종>/ 폴더에 그림 넣기, 2) 아래 BREEDS 배열에
// 폴더 이름 추가, 3) BREED_LABELS에 화면에 보일 한글 이름 추가 - 이 세 가지만 하면 온보딩
// 선택 화면에도 자동으로 나타나요.
const BREEDS = [
  'maltese',
  'frenchbulldog',
  'golden',
  'labrador',
  'shepherd',
  'dachshund',
  'poodle',
  'doberman',
  'rottweiler',
  'bernese',
  'bulldog',
  'beagle',
  'schnauzer',
  'yorkshire',
  'corgi',
  'gsp',
  'cavalier',
  'canecorso',
  'pomeranian',
  'bichon',
  'husky',
  'chihuahua',
];

const BREED_LABELS = {
  maltese: '말티즈',
  frenchbulldog: '프렌치불독',
  golden: '골든리트리버',
  labrador: '래브라도',
  shepherd: '셰퍼드',
  dachshund: '닥스훈트',
  poodle: '푸들',
  doberman: '도베르만',
  rottweiler: '로트와일러',
  bernese: '버니즈 마운틴 독',
  bulldog: '불독',
  beagle: '비글',
  schnauzer: '슈나우저',
  yorkshire: '요크셔테리어',
  corgi: '웰시코기',
  gsp: '저먼 쇼트헤어드 포인터',
  cavalier: '카발리에 킹 찰스 스파니엘',
  canecorso: '케인코르소',
  pomeranian: '포메라니안',
  bichon: '비숑',
  husky: '허스키',
  chihuahua: '치와와',
};

module.exports = { BREEDS, BREED_LABELS };
