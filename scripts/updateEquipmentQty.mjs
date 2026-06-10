// 장비 소모품(CI) 필요/보유 수량을 PDF(2026 2/4분기, 업데이트 2026-04-22) 기준으로 갱신.
// 품목코드·SERIAL·단가 등 나머지 필드는 보존하고 need/have만 수정합니다.
// 실행: node scripts/updateEquipmentQty.mjs
import { initializeApp } from 'firebase/app';
import { collection, doc, getDocs, getFirestore, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBA1A3_JNLEvrp1PhjAhg3-sWCvPtOaTpE',
  authDomain: 'team-equipment-scheduler.firebaseapp.com',
  projectId: 'team-equipment-scheduler',
  storageBucket: 'team-equipment-scheduler.firebasestorage.app',
  messagingSenderId: '562135839911',
  appId: '1:562135839911:web:337c16e1cff7d716fdd782',
};
const db = getFirestore(initializeApp(firebaseConfig));
const COLLECTION = 'inventory_ci';

// docId → { 부품명: [need, have] }  (PDF 고정 필요수량 / 현재 보유수량)
const QTY = {
  ci_1: { // Ci3000 르노내광
    'Xenon lamp': [1, 2],
    'Outer Filter SODALIME': [2, 1],
    'Inner Filter TYPE S(BS)': [10, 8],
    'Demineralized Filter': [1, 1],
  },
  ci_2: { // Ci4000 중앙
    'Xenon lamp': [3, 4],
    'Outer Filter SODALIME': [2, 3],
    'Outer Filter BOROSILICATE': [2, 0],
    'Inner Filter TYPE S(BS)': [10, 13],
    'Inner Filter QUARTZ': [0, 3],
    'Demineralized Filter': [2, 2],
  },
  ci_3: { // Ci4000 창가  (※ PDF 병합셀로 불확실 — 확인 필요)
    'Xenon lamp': [3, 4],
    'Outer Filter CIRA(SODALIME)': [2, 3],
    'Inner Filter BOROSILICATE': [10, 13],
    'Demineralized Filter': [2, 2],
  },
  ci_4: { // Ci4400 현대내후
    'Xenon lamp': [1, 4],
    'Outer Filter QUARTZ': [1, 6],
    'Inner Filter RIGHT LIGHT': [1, 3],
    'Inner Filter BOROSILICATE': [0, 0],
    'Demineralized Filter': [1, 1],
  },
  ci_5: { // Ci5000 현대내광1
    'Xenon lamp': [3, 2],
    'Outer Filter SODALIME': [3, 5],
    'Outer Filter BOROSILICATE': [1, 2],
    'Outer Filter QUARTZ': [1, 5],
    'Inner Filter TYPE S(BS)': [12, 13],
    'Inner Filter RIGHT LIGHT': [0, 1],
    'Demineralized Filter': [2, 2],
  },
  ci_6: { // Ci5000 현대내광2  (※ PDF 병합셀로 불확실 — 확인 필요)
    'Xenon lamp': [3, 2],
    'Outer Filter SODALIME': [3, 5],
    'Outer Filter BOROSILICATE': [1, 2],
    'Inner Filter TYPE S(BS)': [12, 13],
    'Demineralized Filter': [2, 2],
  },
};

async function run() {
  const snap = await getDocs(collection(db, COLLECTION));
  for (const d of snap.docs) {
    const data = d.data();
    const map = QTY[d.id];
    if (!map) { console.log(`건너뜀(매핑 없음): ${d.id} ${data.name}`); continue; }
    const parts = (data.parts || []).map((p) => {
      const hit = map[p.n];
      if (!hit) { console.log(`  · 미매칭 부품 유지: ${data.name} / ${p.n}`); return p; }
      return { ...p, need: hit[0], have: hit[1] };
    });
    await setDoc(doc(db, COLLECTION, d.id), { parts, updatedAt: new Date() }, { merge: true });
    console.log(`갱신 완료: ${data.name} (${parts.length}개 부품)`);
  }
  console.log('모든 장비 수량 갱신이 완료되었습니다.');
  process.exit(0);
}

run().catch((err) => { console.error('오류:', err); process.exit(1); });
