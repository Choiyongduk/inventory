export const TEAM_MEMBERS = [
  '의장_최재용',
  '의장_이정현',
  '의장_이경옥',
  '의장_김대성',
  '의장_최용덕',
  '의장_이명호',
  '의장_이진원',
  '의장_최원혁',
  '의장_이보윤',
  '의장_장병석',
  '의장_김동현',
  '의장_곽현준',
  '의장_김효빈',
  '의장_임정연',
  '의장_최준호',
];

export const BUILTIN_CONSUMABLE_CATS = [
  { id: 'bw', label: '시험 소모품', type: 'consumable', canDelete: false },
  { id: 'office', label: '사무용품', type: 'consumable', canDelete: false },
  { id: 'etc', label: '기타 소모품', type: 'consumable', canDelete: false },
  { id: 'ci', label: 'CI 장비 부품', type: 'equipment', canDelete: false },
];

export const CHEMICAL_CATEGORIES = [
  '산류',
  '염류',
  '알칼리류',
  '인산염류',
  '중금속염',
  '중금속산화물',
  '글리콜류',
  '오일/부동액',
  '세정제류',
  '선크림류',
  '기타',
];

// 시험실 목록 (구 '보관구역')
export const STORAGE_ZONES = [
  '표준재료1실',
  '표준재료2실',
  '내후환경시험실',
  '내환경시험실',
  '내구평가시험실',
  '비석시험실',
  '염수분무시험실',
  '연소성시험실',
];

export const MANAGEMENT_RULES = [
  {
    id: 'chemical-list',
    title: '약품 리스트 작성·관리',
    issue: '입고일·개봉일·취급자 누락 방지',
    checklist: [
      '보유 중인 모든 약품을 리스트에 등록하고, 재고량과 대장 기록을 항상 일치시킵니다.',
      '입고일자·개봉일자·취급자·사용용도를 필수 관리 항목으로 둡니다.',
      '입고일자가 불명확한 경우 확인일자를 기록해 추적성을 유지합니다.',
    ],
  },
  {
    id: 'handling-label',
    title: '약품별 취급 라벨 부착',
    issue: '라벨 미부착·사용기한 미확인 방지',
    checklist: [
      '시약병마다 입고일·개봉일·취급자·비고가 포함된 취급 라벨을 부착합니다.',
      '유효기간은 입고 후 3년, 개봉 후 1년을 기준으로 관리합니다.',
      '재고관리 미대상 시약도 식별 라벨 부착 상태를 확인합니다.',
    ],
  },
  {
    id: 'consumable-ledger',
    title: '소모품 대장 기반 출고 관리',
    issue: '중복 개봉·재고 혼선 방지',
    checklist: [
      '사용량은 폐기·완전 소진 시에만 기재합니다.',
      "보유량은 '새 제품 수 / 개봉 제품 잔여 수'로 기록합니다. (예: 2/1)",
      '개봉 제품은 전면 배치해 우선 소진하고, 빈 용기는 즉시 폐기 요청합니다.',
    ],
  },
  {
    id: 'standard-container',
    title: '적정 용기·보관구역 표준화',
    issue: '부적절 용기 사용·식별 리스크 관리',
    checklist: [
      '뚜껑 없는 임시 용기를 지양하고 표준 시약통을 사용합니다.',
      '성상·위험도에 따라 산성·염기성·산화성·인화성 물질 등을 구분 보관합니다.',
      '직사광선을 피하고 통제구역(잠금)에 보관하며, 보관구역 정보를 앱에 남깁니다.',
    ],
  },
  {
    id: 'msds',
    title: 'MSDS 확보 및 비치',
    issue: '취급 주의·응급조치 정보 미비 방지',
    checklist: [
      '관리 약품별 MSDS(물질안전보건자료)를 확보합니다.',
      '주의사항·응급조치 정보를 작업자가 쉽게 확인하도록 비치합니다.',
      '물질의 특성·성상에 따라 취급 방법을 세분화합니다.',
    ],
  },
];

export const DEFAULT_SETTINGS = {
  disposalDays: 90,
  lowQty: 1,
  labelGraceDays: 365,
};

export const STORAGE_KEYS = {
  currentUser: 'fiti.inventory.currentUser',
  viewMode: 'fiti.inventory.viewMode',
  favorites: 'fiti.inventory.favorites',
};
