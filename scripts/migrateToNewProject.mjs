// 재고관리 데이터 이전: team-equipment-scheduler → 새 전용 Firebase 프로젝트
// inventory_* 컬렉션을 문서 ID 그대로 복사합니다. (장비 스케쥴러 데이터는 건드리지 않음)
//
// 실행 전:
//   1) 새 Firebase 프로젝트 생성 → Firestore Database 만들기(테스트 모드로 시작)
//   2) 웹 앱 추가 후 firebaseConfig 복사 → 아래 NEW_CONFIG에 붙여넣기
//   3) node scripts/migrateToNewProject.mjs
//   4) 이전이 끝나면 보안 규칙(firestore.rules)을 적용해 잠그세요.
import { initializeApp } from 'firebase/app';
import { collection, doc, getDocs, getFirestore, writeBatch } from 'firebase/firestore';

// 기존(원본) 프로젝트 — 그대로 두세요.
const OLD_CONFIG = {
  apiKey: 'AIzaSyBA1A3_JNLEvrp1PhjAhg3-sWCvPtOaTpE',
  authDomain: 'team-equipment-scheduler.firebaseapp.com',
  projectId: 'team-equipment-scheduler',
  storageBucket: 'team-equipment-scheduler.firebasestorage.app',
  messagingSenderId: '562135839911',
  appId: '1:562135839911:web:337c16e1cff7d716fdd782',
};

// ▼▼▼ 새 프로젝트 firebaseConfig ▼▼▼
const NEW_CONFIG = {
  apiKey: 'AIzaSyC2O0461bVf0jlqwZykQyF0Wwwn9Clp7dc',
  authDomain: 'fiti-inventory.firebaseapp.com',
  projectId: 'fiti-inventory',
  storageBucket: 'fiti-inventory.firebasestorage.app',
  messagingSenderId: '308634166032',
  appId: '1:308634166032:web:8de520d69164a24390fb95',
};
// ▲▲▲ ----------------------------------------- ▲▲▲

const COLLECTIONS = [
  'inventory_chemicals',
  'inventory_ci',
  'inventory_consumable_items',
  'inventory_consumable_cats',
  'inventory_logs',
  'inventory_settings',
];

async function run() {
  if (!NEW_CONFIG.projectId) {
    console.error('NEW_CONFIG 를 먼저 채워주세요 (새 프로젝트의 firebaseConfig).');
    process.exit(1);
  }
  const oldDb = getFirestore(initializeApp(OLD_CONFIG, 'old'));
  const newDb = getFirestore(initializeApp(NEW_CONFIG, 'new'));

  for (const name of COLLECTIONS) {
    const snap = await getDocs(collection(oldDb, name));
    let batch = writeBatch(newDb);
    let pending = 0;
    for (const d of snap.docs) {
      batch.set(doc(newDb, name, d.id), d.data());
      pending += 1;
      if (pending >= 400) { await batch.commit(); batch = writeBatch(newDb); pending = 0; }
    }
    if (pending > 0) await batch.commit();
    console.log(`${name}: ${snap.size}건 복사 완료`);
  }
  console.log('데이터 이전이 모두 끝났습니다. 이제 firestore.rules 로 잠그세요.');
  process.exit(0);
}

run().catch((err) => { console.error('오류:', err); process.exit(1); });
