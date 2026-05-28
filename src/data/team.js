export const TEAM_MEMBERS = [
  '의장_최재용',
  '의장_이정현',
  '의장_이경옥',
  '의장_김대성',
  '의장_최용덕',
  '의장_이명호',
  '의장_이재원',
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
  { id: 'bw', label: '항온수조/시험 소모품', type: 'consumable', canDelete: false },
  { id: 'etc', label: '일반 소모품', type: 'consumable', canDelete: false },
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

export const STORAGE_ZONES = [
  '제1군 인화성 액체',
  '제2군 자연발화성 물질',
  '제3군 산류',
  '제4군 산화성 물질',
  '제5군 염기성 물질',
  '제6군 독성/유해성 물질',
  '제7군 금속수소화물',
  '제8군 고체류',
  '보호구/소화기/구급함',
  '기타 보관구역',
];

export const MANAGEMENT_RULES = [
  {
    id: 'chemical-list',
    title: '화학물질 리스트 작성과 관리',
    issue: '입고일, 개봉일, 취급자 누락 방지',
    checklist: [
      '보유 중인 모든 화학물질을 리스트에 등록합니다.',
      '입고일자, 개봉일자, 취급자, 사용용도를 필수 관리 항목으로 둡니다.',
      '입고일자가 불명확한 경우 확인일자를 기록해 추적성을 유지합니다.',
    ],
  },
  {
    id: 'handling-label',
    title: '화학물질별 취급 라벨 부착',
    issue: '라벨 미부착과 사용기한 미확인 방지',
    checklist: [
      '시약병마다 입고일, 개봉일, 취급자, 비고가 포함된 취급 라벨을 부착합니다.',
      '개봉일 기준 사용기간을 앱에서 경고하고 라벨 출력 화면으로 바로 연결합니다.',
      '재고관리 미대상 시약도 식별 라벨 부착 상태를 확인합니다.',
    ],
  },
  {
    id: 'consumable-ledger',
    title: '소모품 대장 기반 출고 관리',
    issue: '중복 개봉과 재고 혼선 방지',
    checklist: [
      '소모품 대장 확인 후 추가 개봉 또는 구매를 결정합니다.',
      '개봉 제품은 전면 배치하여 우선 소진을 유도합니다.',
      '빈 용기는 즉시 폐기 요청하고 앱 기록에 반영합니다.',
    ],
  },
  {
    id: 'standard-container',
    title: '적정 용기와 보관구역 표준화',
    issue: '부적절 용기 사용과 식별 리스크 관리',
    checklist: [
      '뚜껑 없는 임시 용기 사용을 지양하고 표준 시약통을 확보합니다.',
      '성상과 위험도에 따라 산류, 염기류, 인화성 물질 등을 구분 보관합니다.',
      '보관구역과 위험도 정보를 앱에 남겨 폐기와 점검을 쉽게 만듭니다.',
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
};
