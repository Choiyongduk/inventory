import { initializeApp } from 'firebase/app';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
} from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: 'AIzaSyBA1A3_JNLEvrp1PhjAhg3-sWCvPtOaTpE',
  authDomain: 'team-equipment-scheduler.firebaseapp.com',
  projectId: 'team-equipment-scheduler',
  storageBucket: 'team-equipment-scheduler.firebasestorage.app',
  messagingSenderId: '562135839911',
  appId: '1:562135839911:web:337c16e1cff7d716fdd782',
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export const COLLECTIONS = {
  chemicals: 'inventory_chemicals',
  ci: 'inventory_ci',
  consumableCats: 'inventory_consumable_cats',
  consumableItems: 'inventory_consumable_items',
  logs: 'inventory_logs',
  settings: 'inventory_settings',
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

export async function addMovementLog(log) {
  await addDoc(collection(db, COLLECTIONS.logs), {
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
