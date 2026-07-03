import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  initializeFirestore,
  limit,
  onSnapshot,
  orderBy,
  persistentLocalCache,
  persistentMultipleTabManager,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';

// 통합 플랫폼(uijang-platform) Firebase. 재고관리는 이 공용 백엔드로 이전됨.
// 로그인/승인/담당자 이름은 공용 users/{uid} 문서에서 관리(모든 모듈에서 이름 동일).
export const firebaseConfig = {
  apiKey: 'AIzaSyDKF1RZwITu2A8c4QOYLaOWb1_DRzU3Obw',
  authDomain: 'uijang-platform.firebaseapp.com',
  projectId: 'uijang-platform',
  storageBucket: 'uijang-platform.firebasestorage.app',
  messagingSenderId: '718519199006',
  appId: '1:718519199006:web:e33066936d33678616150f',
};

export const app = initializeApp(firebaseConfig);
// 오프라인 퍼시스턴스: 연결이 끊겨도 기록이 로컬에 보관됐다가 자동으로 동기화됩니다.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// 인증: 구글 로그인. 세션은 브라우저에 저장돼 한 번 로그인하면 자동 로그인됩니다.
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => { /* 비지원 환경 무시 */ });
const googleProvider = new GoogleAuthProvider();

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// ── 공용 계정(users/{uid}) 기반 멤버십 ──
// 통합 플랫폼의 users 문서를 재고관리가 쓰던 member 형태로 변환.
// name = displayName → 포털/모든 모듈에서 동일한 이름. status/role/allowedModules 로 접근 판단.
function mapUser(uid, data = {}) {
  return {
    uid,
    id: uid,
    name: data.displayName || data.name || '',
    displayName: data.displayName || '',
    email: data.email || '',
    status: data.status || 'pending',
    role: data.role || '',
    allowedModules: data.allowedModules || [],
  };
}
// 이름은 접두어 없이 저장(예: '최용덕') — 포털/타 모듈과 동일하게 표시되도록.
const stripPrefix = (n) => (n || '').replace(/^의장_/, '').trim();

export function watchMember(uid, callback, onError) {
  return onSnapshot(
    doc(db, 'users', uid),
    (snap) => callback(snap.exists() ? mapUser(uid, snap.data()) : null),
    onError,
  );
}
export function watchMembers(callback, onError) {
  return onSnapshot(
    collection(db, 'users'),
    (snap) => callback(snap.docs.map((d) => mapUser(d.id, d.data()))),
    onError,
  );
}
export async function requestMembership(user, name, approved = false) {
  await setDoc(doc(db, 'users', user.uid), {
    email: user.email || '',
    displayName: stripPrefix(name) || user.displayName || '',
    department: '의장소재팀',
    role: approved ? 'team-admin' : 'team-user',
    status: approved ? 'approved' : 'pending',
    allowedModules: [],
    createdAt: serverTimestamp(),
  }, { merge: true });
}
export async function setMemberStatus(uid, status) {
  const patch = { status, updatedAt: serverTimestamp() };
  if (status === 'approved') patch.approvedAt = serverTimestamp();
  await setDoc(doc(db, 'users', uid), patch, { merge: true });
}
export async function setMemberName(uid, name) {
  await setDoc(doc(db, 'users', uid), { displayName: stripPrefix(name), updatedAt: serverTimestamp() }, { merge: true });
}
export async function removeMember(uid) {
  await deleteDoc(doc(db, 'users', uid));
}
export function signInWithGoogle() {
  return signInWithPopup(auth, googleProvider);
}
export function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
export function signUpWithEmail(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}
export function sendReset(email) {
  return sendPasswordResetEmail(auth, email);
}
export function signOutUser() {
  return signOut(auth);
}

export const COLLECTIONS = {
  chemicals: 'inventory_chemicals',
  ci: 'inventory_ci',
  consumableCats: 'inventory_consumable_cats',
  consumableItems: 'inventory_consumable_items',
  logs: 'inventory_logs',
  settings: 'inventory_settings',
  members: 'members',
};

const mapSnapshot = (snapshot) => snapshot.docs.map((docSnap) => ({ _docId: docSnap.id, ...docSnap.data() }));

export function subscribeInventory({ onChemicals, onCi, onConsumables, onCats, onLogs, onSettings, onError }) {
  const unsubs = [];

  unsubs.push(
    onSnapshot(
      collection(db, COLLECTIONS.chemicals),
      (snapshot) => onChemicals(mapSnapshot(snapshot)),
      onError,
    ),
  );

  unsubs.push(
    onSnapshot(
      collection(db, COLLECTIONS.ci),
      (snapshot) => {
        const rows = mapSnapshot(snapshot).sort((a, b) => (a.order ?? a.id ?? 0) - (b.order ?? b.id ?? 0));
        onCi(rows);
      },
      onError,
    ),
  );

  unsubs.push(
    onSnapshot(
      collection(db, COLLECTIONS.consumableCats),
      (snapshot) => onCats(mapSnapshot(snapshot)),
      onError,
    ),
  );

  unsubs.push(
    onSnapshot(
      collection(db, COLLECTIONS.consumableItems),
      (snapshot) => onConsumables(mapSnapshot(snapshot)),
      onError,
    ),
  );

  unsubs.push(
    onSnapshot(
      query(collection(db, COLLECTIONS.logs), orderBy('createdAt', 'desc'), limit(800)),
      (snapshot) => onLogs(mapSnapshot(snapshot)),
      onError,
    ),
  );

  unsubs.push(
    onSnapshot(
      doc(db, COLLECTIONS.settings, 'team'),
      (snapshot) => onSettings(snapshot.exists() ? snapshot.data() : {}),
      onError,
    ),
  );

  return () => unsubs.forEach((unsubscribe) => unsubscribe());
}

export async function saveChemical(chemical) {
  const id = chemical._docId || `chem_${chemical.id}`;
  const payload = {
    id: chemical.id,
    name: chemical.name,
    handler: chemical.handler || '-',
    purpose: chemical.purpose || '-',
    qty: chemical.qty || '0 EA',
    cat: chemical.cat || '기타',
    purchased: chemical.purchased || '-',
    opened: chemical.opened || '-',
    disposed: chemical.disposed || '-',
    msds: chemical.msds || '',
    photo: chemical.photo || '',
    storageZone: chemical.storageZone || '',
    hazardClass: chemical.hazardClass || '',
    note: chemical.note || '',
    minQty: chemical.minQty === '' || chemical.minQty == null ? null : Number(chemical.minQty),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, COLLECTIONS.chemicals, id), payload, { merge: true });
}

export async function deleteChemical(chemical) {
  if (!chemical?._docId) return;
  await deleteDoc(doc(db, COLLECTIONS.chemicals, chemical._docId));
}

export async function saveConsumableItem(item) {
  const id = item._docId || `item_${item.catId || 'etc'}_${item.id || Date.now()}`;
  const payload = {
    catId: item.catId || 'etc',
    id: item.id,
    n: item.n,
    cat: item.cat || '',
    qty: Number(item.qty ?? 0),
    unit: item.unit || 'EA',
    purpose: item.purpose || '',
    code: item.code || '',
    spec: item.spec || '',
    photo: item.photo || '',
    location: item.location || '',
    minQty: item.minQty === '' || item.minQty == null ? null : Number(item.minQty),
    updatedAt: serverTimestamp(),
  };
  await setDoc(doc(db, COLLECTIONS.consumableItems, id), payload, { merge: true });
}

export async function deleteConsumableItem(item) {
  if (!item?._docId) return;
  await deleteDoc(doc(db, COLLECTIONS.consumableItems, item._docId));
}

export async function saveEquipment(equipment) {
  const id = equipment._docId || `ci_${equipment.id}`;
  await setDoc(
    doc(db, COLLECTIONS.ci, id),
    {
      id: equipment.id,
      name: equipment.name,
      lamp: equipment.lamp || '',
      order: equipment.order ?? equipment.id ?? 0,
      parts: equipment.parts || [],
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function saveConsumableCategory(category) {
  await setDoc(
    doc(db, COLLECTIONS.consumableCats, category.id),
    {
      label: category.label,
      type: category.type || 'consumable',
      canDelete: category.canDelete ?? true,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function deleteConsumableCategory(id) {
  await deleteDoc(doc(db, COLLECTIONS.consumableCats, id));
}

export async function addMovementLog(log) {
  return addDoc(collection(db, COLLECTIONS.logs), {
    ...log,
    createdAt: serverTimestamp(),
  });
}

export async function deleteMovementLog(log) {
  if (!log?._docId) return;
  await deleteDoc(doc(db, COLLECTIONS.logs, log._docId));
}

export async function saveTeamSettings(settings) {
  await setDoc(
    doc(db, COLLECTIONS.settings, 'team'),
    {
      ...settings,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function exportCollectionCounts() {
  const result = {};
  for (const [key, name] of Object.entries(COLLECTIONS)) {
    if (key === 'settings') continue;
    const snapshot = await getDocs(collection(db, name));
    result[key] = snapshot.size;
  }
  return result;
}

export async function seedBatch(documents) {
  const batch = writeBatch(db);
  documents.forEach(({ collectionName, id, data }) => {
    batch.set(doc(db, collectionName, id), data, { merge: true });
  });
  await batch.commit();
}
