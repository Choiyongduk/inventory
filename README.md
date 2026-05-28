# FITI 의장소재팀 재고관리

React + Vite + Firebase Firestore 기반의 의장소재팀 재고관리 콘솔입니다.

## 핵심 방향

- 단일 `index.html` 구조를 React/Vite 프로젝트로 전환
- 기존 Firebase 프로젝트와 Firestore 컬렉션 유지
- 화학물질, 소모품, CI 장비 부품을 하나의 운영 콘솔에서 통합 관리
- 세미나 자료의 관리방안 반영: 입고일, 개봉일, 취급자, 사용용도, 취급 라벨, 소모품 대장, 중복 개봉 방지, 보관구역 추적

## 실행

```bash
npm install
npm run dev
```

## 빌드

```bash
npm run build
npm run preview
```

## Firebase Hosting 배포

```bash
npm run build
firebase deploy
```

## Firestore 컬렉션

- `inventory_chemicals`: 화학물질
- `inventory_ci`: CI 장비와 부품
- `inventory_consumable_cats`: 소모품 커스텀 카테고리
- `inventory_consumable_items`: 소모품 항목
- `inventory_logs`: 입출고 대장
- `inventory_settings/team`: 팀 공통 임계치

## 주요 화면

- 대시보드: 긴급/주의 항목, 라벨 관리율, 최근 입출고, 운영 품질 지표
- 재고: 통합 검색, 유형/상태 필터, 입출고, 정보 수정
- 대장: 담당자와 입출고 구분별 필터, 인쇄
- 라벨: 화학물질 취급 라벨과 소모품 관리 라벨 출력
- 설정: 사용자 선택, 팀 공통 임계치, JSON 백업
