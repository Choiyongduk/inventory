import { memo, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import {
  AlertTriangle, ArrowLeft, ArrowLeftRight, Bell, Boxes, Camera, Check, ChevronDown, ClipboardList,
  Download, FlaskConical, Home, Layers, Minus, Package, Pencil, Plus, Printer, Search, Settings, Star,
  Tag, Trash2, UserRound, Wifi, WifiOff, X,
} from 'lucide-react';
import {
  addMovementLog, deleteChemical, deleteConsumableItem, deleteMovementLog,
  removeMember, requestMembership, saveChemical,
  saveConsumableItem, saveEquipment, saveTeamSettings, sendReset, setMemberName, setMemberStatus,
  signInWithEmail, signInWithGoogle, signOutUser, signUpWithEmail,
  subscribeInventory, watchAuth, watchMember, watchMembers,
} from './firebase';
import {
  ADMIN_EMAILS, BUILTIN_CONSUMABLE_CATS, CHEMICAL_CATEGORIES, DEFAULT_SETTINGS, MANAGEMENT_RULES,
  STORAGE_KEYS, STORAGE_ZONES, TEAM_MEMBERS,
} from './data/team';
import {
  addDays, applyQuantityDelta, daysUntil, downloadCsv, filterInventory, formatDate,
  formatNumber, makeMovementPayload, normalizeInventory, quantityText, todayKey,
} from './lib/inventory';

const NAV_ITEMS = [
  { id: 'home', label: '홈', icon: Home },
  { id: 'stock', label: '재고', icon: Boxes },
  { id: 'ledger', label: '기록', icon: ClipboardList },
  { id: 'settings', label: '설정', icon: Settings },
];

const CAT_LABEL = { chemical: '약품', consumable: '일반 소모품', equipment: '장비 소모품' };

// 상태 표시 문구
function friendlyPin(item) {
  if (item.status === 'critical') {
    if ((item.reason || '').includes('폐기')) return '폐기일 경과';
    return '재고 없음';
  }
  if (item.status === 'warning') {
    if ((item.reason || '').includes('폐기')) return item.reason; // 폐기 D-21
    if ((item.reason || '').includes('라벨')) return '라벨 정보 누락';
    return '재고 부족';
  }
  return '사용 가능';
}

function stepFor(unit) {
  return ['L', 'kg', 'mL', 'g', 'ml'].includes(unit) ? 0.5 : 1;
}

// 촬영/선택한 사진을 캔버스로 축소·압축해 dataURL로 변환합니다 (Firestore 1MB 제한 대비).
function readImageResized(file, maxSize = 1024, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function lastActivity(item, logs) {
  const hit = logs.find((l) => l.itemKey === item.key || l.item === item.name);
  if (!hit) return item.owner && item.owner !== '-' ? `${item.owner}` : '기록 없음';
  const verb = hit.action === 'use' ? '출고' : '입고';
  const who = (hit.handler || '-').replace(/^의장_/, '');
  return `${who} · ${hit.time || hit.isoDate} ${verb}`;
}

function itemHistory(item, logs) {
  return logs.filter((l) => l.itemKey === item.key || l.item === item.name).slice(0, 6);
}

function useLocalStorageState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try { return window.localStorage.getItem(key) || initialValue; } catch { return initialValue; }
  });
  useEffect(() => {
    try { if (value) window.localStorage.setItem(key, value); } catch { /* noop */ }
  }, [key, value]);
  return [value, setValue];
}

export default function App() {
  const [authUser, setAuthUser] = useState(undefined); // undefined=확인중, null=로그아웃
  const [member, setMember] = useState(undefined); // undefined=확인중, null=없음, obj=멤버문서
  const [allMembers, setAllMembers] = useState([]); // 관리자용 전체 멤버 목록
  const [activeView, setActiveView] = useLocalStorageState(STORAGE_KEYS.viewMode, 'home');
  const currentUser = member?.name || ''; // 담당자 = 로그인 계정에 고정된 이름
  const [favRaw, setFavRaw] = useLocalStorageState(STORAGE_KEYS.favorites, '[]');
  const [chemicals, setChemicals] = useState([]);
  const [ciEquip, setCiEquip] = useState([]);
  const [consumables, setConsumables] = useState([]);
  const [customCats, setCustomCats] = useState([]);
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [selectedKey, setSelectedKey] = useState('');
  const [listMode, setListMode] = useState('all');
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [labelKey, setLabelKey] = useState('');
  const [stockAttention, setStockAttention] = useState(false);
  const [toast, setToast] = useState(null); // { msg, undo? }
  const [deepLinked, setDeepLinked] = useState(false);

  useEffect(() => watchAuth(setAuthUser), []);

  const isAdmin = !!authUser && ADMIN_EMAILS.includes(authUser.email || '');
  const access = isAdmin || member?.status === 'approved';

  // 로그인 사용자의 멤버십 문서 구독
  useEffect(() => {
    if (!authUser) { setMember(undefined); return undefined; }
    return watchMember(authUser.uid, setMember, () => setMember(null));
  }, [authUser]);

  // 이름 등록(가입 시 본인 이름 1회 선택 → 계정에 고정)
  async function submitName(name) {
    if (!authUser) return;
    if (member) await setMemberName(authUser.uid, name);
    else await requestMembership(authUser, name, isAdmin);
  }

  // 관리자는 전체 멤버 목록 구독 (승인 관리용)
  useEffect(() => {
    if (!isAdmin) { setAllMembers([]); return undefined; }
    return watchMembers(setAllMembers, () => {});
  }, [isAdmin]);

  useEffect(() => {
    if (!access) return undefined;
    const cleanup = subscribeInventory({
      onChemicals: (rows) => { setChemicals(rows); setLoading(false); },
      onCi: (rows) => setCiEquip(rows),
      onConsumables: (rows) => setConsumables(rows),
      onCats: (rows) => setCustomCats(rows),
      onLogs: (rows) => setLogs(rows),
      onSettings: (row) => setSettings({ ...DEFAULT_SETTINGS, ...row }),
      onError: (err) => { setError(err.message || 'Firebase 연결 오류가 발생했습니다.'); setLoading(false); },
    });
    return cleanup;
  }, [access]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // 편집 가능한 목록: 설정에 저장된 게 있으면 그걸, 없으면 기본값(+기존 커스텀)을 사용.
  // 한 번 편집하면 전체 목록이 설정에 '실체화'되어 그 뒤로는 기본값까지 수정/삭제 가능.
  const categories = useMemo(
    () => settings.consumableCats
      || [...BUILTIN_CONSUMABLE_CATS, ...customCats].map((c) => ({ id: c.id, label: c.label, type: c.type || 'consumable' })),
    [settings.consumableCats, customCats],
  );
  const allZones = useMemo(
    () => settings.zones || [...STORAGE_ZONES, ...(settings.customZones || [])],
    [settings.zones, settings.customZones],
  );
  const allChemCats = useMemo(
    () => settings.chemCats || [...CHEMICAL_CATEGORIES, ...(settings.customChemCats || [])],
    [settings.chemCats, settings.customChemCats],
  );
  const teamMembers = useMemo(() => settings.team || TEAM_MEMBERS, [settings.team]);

  const inventory = useMemo(
    () => normalizeInventory({ chemicals, consumables, ciEquip, customCats: categories, settings }),
    [chemicals, consumables, ciEquip, categories, settings],
  );

  // 드롭다운 새 항목 추가 (선택값 반환 → 즉시 선택)
  async function addZone(label) { await saveTeamSettings({ zones: [...allZones, label] }); return label; }
  function renameZone(oldV, newV) { return saveTeamSettings({ zones: allZones.map((z) => (z === oldV ? newV : z)) }); }
  function deleteZone(z) { return saveTeamSettings({ zones: allZones.filter((x) => x !== z) }); }

  async function addChemCat(label) { await saveTeamSettings({ chemCats: [...allChemCats, label] }); return label; }
  function renameChemCat(oldV, newV) { return saveTeamSettings({ chemCats: allChemCats.map((c) => (c === oldV ? newV : c)) }); }
  function deleteChemCat(c) { return saveTeamSettings({ chemCats: allChemCats.filter((x) => x !== c) }); }

  async function addCategory(label) {
    const id = `cat_${Date.now()}`;
    await saveTeamSettings({ consumableCats: [...categories, { id, label, type: 'consumable' }] });
    return id;
  }
  function renameCategory(id, label) {
    return saveTeamSettings({ consumableCats: categories.map((c) => (c.id === id ? { ...c, label } : c)) });
  }
  function deleteCategory(id) {
    return saveTeamSettings({ consumableCats: categories.filter((c) => c.id !== id) });
  }

  // 팀원 명단(입사/퇴사 반영) — 의장_ 접두사 자동 부여
  const withPrefix = (n) => (n.startsWith('의장_') ? n : `의장_${n}`);
  async function addTeamMember(name) { const v = withPrefix(name); await saveTeamSettings({ team: [...teamMembers, v] }); return v; }
  function renameTeamMember(oldV, newV) { return saveTeamSettings({ team: teamMembers.map((m) => (m === oldV ? withPrefix(newV) : m)) }); }
  function removeTeamMember(name) { return saveTeamSettings({ team: teamMembers.filter((m) => m !== name) }); }

  async function addEquipment(name) {
    const nextId = Math.max(0, ...ciEquip.map((e) => Number(e.id || 0))) + 1;
    await saveEquipment({ id: nextId, name, lamp: '', order: nextId, parts: [] });
    return `ci_${nextId}`;
  }
  const attention = useMemo(() => inventory.filter((it) => it.status !== 'ok'), [inventory]);
  const selected = useMemo(() => inventory.find((it) => it.key === selectedKey) || null, [inventory, selectedKey]);
  const favorites = useMemo(() => { try { return JSON.parse(favRaw) || []; } catch { return []; } }, [favRaw]);

  function toggleFavorite(key) {
    setFavRaw(JSON.stringify(favorites.includes(key) ? favorites.filter((k) => k !== key) : [...favorites, key]));
  }

  useEffect(() => {
    if (!labelKey && inventory.length) setLabelKey(inventory[0].key);
  }, [inventory, labelKey]);

  // 라벨 QR을 스캔하면 ?item=<key> 로 들어와 해당 품목 시트가 바로 열립니다.
  useEffect(() => {
    if (deepLinked || !inventory.length) return;
    const k = new URLSearchParams(window.location.search).get('item');
    if (k && inventory.some((it) => it.key === k)) setSelectedKey(k);
    setDeepLinked(true);
  }, [inventory, deepLinked]);

  function flash(message, undo = null) {
    setToast({ msg: message, undo });
    window.clearTimeout(flash._t);
    flash._t = window.setTimeout(() => setToast(null), undo ? 6000 : 2000);
  }

  async function handleMovement({ item, direction, amount, unit, memo }) {
    if (!currentUser) return;
    const next = applyQuantityDelta(item, direction, amount, unit);
    const log = makeMovementPayload({ item, direction, amount, unit, handler: currentUser, memo });
    if (item.type === 'chemical') await saveChemical(next);
    if (item.type === 'consumable') await saveConsumableItem(next);
    if (item.type === 'equipment') await saveEquipment(next);
    const ref = await addMovementLog(log);
    flash(
      `${item.name} ${direction === 'out' ? '출고' : '입고'} 기록이 완료되었습니다`,
      { itemKey: item.key, direction, amount, unit, logId: ref?.id },
    );
    setSelectedKey('');
  }

  async function handleUndo(undo) {
    const item = inventory.find((it) => it.key === undo.itemKey);
    if (!item) { flash('변경된 항목이라 되돌릴 수 없습니다'); return; }
    const reverse = undo.direction === 'out' ? 'in' : 'out';
    const next = applyQuantityDelta(item, reverse, undo.amount, undo.unit);
    if (item.type === 'chemical') await saveChemical(next);
    if (item.type === 'consumable') await saveConsumableItem(next);
    if (item.type === 'equipment') await saveEquipment(next);
    if (undo.logId) await deleteMovementLog({ _docId: undo.logId });
    flash('되돌렸습니다');
  }

  async function handleSaveItem(itemType, payload) {
    if (itemType === 'chemical') await saveChemical(payload);
    if (itemType === 'consumable') await saveConsumableItem({ ...payload, catId: payload.catId });
    if (itemType === 'equipment') await saveEquipment(payload);
    flash('저장되었습니다');
    setSelectedKey('');
  }

  async function handleDeleteItem(item) {
    if (!window.confirm(`'${item.name}' 항목을 삭제하시겠습니까?`)) return;
    if (item.type === 'chemical') await deleteChemical(item.source);
    if (item.type === 'consumable') await deleteConsumableItem(item.source);
    if (item.type === 'equipment') {
      const equipment = { ...item.equipment, parts: (item.equipment.parts || []).filter((_, i) => i !== item.partIndex) };
      await saveEquipment(equipment);
    }
    setSelectedKey('');
  }

  async function handleCreateItem(form) {
    const ts = new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    if (form.type === 'chemical') {
      const nextId = Math.max(0, ...chemicals.map((it) => Number(it.id || 0))) + 1;
      await saveChemical({
        id: nextId, name: form.name, handler: form.handler || currentUser || '-', purpose: form.purpose || '-',
        qty: quantityText(form.qty || 0, form.unit || 'EA'), cat: form.cat || '기타',
        purchased: form.purchased || todayKey(), opened: form.opened || '-',
        disposed: form.disposed || (form.opened ? addDays(form.opened, 365) : '-'),
        storageZone: form.storageZone || '', photo: form.photo || '',
      });
    } else if (form.type === 'equipment') {
      const eq = ciEquip.find((e) => e._docId === form.equipId);
      if (!eq) { flash('장비를 선택하세요'); return; }
      const newPart = {
        n: form.name, need: Number(form.need || 0), have: Number(form.qty || 0),
        code: form.code || '', serial: form.serial || '', price: 0,
      };
      await saveEquipment({ ...eq, parts: [...(eq.parts || []), newPart] });
    } else {
      const nextId = Math.max(0, ...consumables.map((it) => Number(it.id || 0))) + 1;
      await saveConsumableItem({
        id: nextId, catId: form.catId || 'etc', n: form.name, cat: form.cat || '',
        qty: Number(form.qty || 0), unit: form.unit || 'EA', purpose: form.purpose || '',
        code: form.code || '', location: form.location || '', photo: form.photo || '',
      });
    }
    await addMovementLog({
      item: form.name, itemType: form.type, action: 'add',
      qty: quantityText(form.qty || 0, form.unit || 'EA'), handler: currentUser,
      memo: '신규 등록', time: ts, isoDate: todayKey(),
    });
    flash('새 품목이 등록되었습니다');
    setNewItemOpen(false);
  }

  function handleExportInventory() {
    const typeKo = { chemical: '약품', consumable: '일반 소모품', equipment: '장비 소모품' };
    const headers = ['구분', '품명', '분류', '수량', '단위', '필요수량', '담당자', '시험실/위치', '용도', '입고일', '개봉일', '폐기예정', '품목코드', '비고', '상태'];
    const rows = inventory.map((it) => [
      typeKo[it.type] || it.type,
      it.name,
      it.category,
      round(it.qty),
      it.unit,
      it.type === 'equipment' ? it.need : '',
      it.type === 'chemical' ? (it.owner || '').replace(/^의장_/, '') : '',
      it.storageZone || it.location || '',
      it.purpose && it.purpose !== '-' ? it.purpose : '',
      it.type === 'chemical' ? formatDate(it.purchased) : '',
      it.type === 'chemical' ? formatDate(it.opened) : '',
      it.type === 'chemical' ? formatDate(it.disposed) : '',
      it.code || '',
      it.note || (it.type === 'equipment' ? it.serial : '') || '',
      it.reason || '',
    ]);
    downloadCsv(`FITI_재고목록_${todayKey()}.csv`, headers, rows);
  }

  function handleExportLogs() {
    const headers = ['날짜', '시간', '품목', '구분', '수량', '담당자', '메모'];
    const rows = logs.map((l) => [
      l.isoDate || '', l.time || '', l.item,
      l.action === 'use' ? '출고' : (l.action === 'add' ? '입고' : l.action),
      l.qty, (l.handler || '').replace(/^의장_/, ''), l.memo || '',
    ]);
    downloadCsv(`FITI_입출고기록_${todayKey()}.csv`, headers, rows);
  }

  function openLabelFor(item) { setLabelKey(item.key); setSelectedKey(''); setActiveView('labels'); }
  function openAttention() { setStockAttention(true); setActiveView('stock'); }

  if (authUser === undefined) return <AuthLoading />;
  if (!authUser) return <AuthGate />;
  if (member === undefined) return <AuthLoading />;
  if (!member || !member.name) {
    return <NameGate roster={teamMembers} takenNames={allMembers.filter((m) => m.uid !== authUser.uid).map((m) => m.name)} onSubmit={submitName} onSignOut={() => signOutUser()} />;
  }
  if (!access) {
    return <AccessScreen email={authUser.email} name={member.name} rejected={member.status === 'rejected'} onSignOut={() => signOutUser()} />;
  }

  return (
    <div className="app-shell">
      <DesktopRail
        active={activeView}
        currentUser={currentUser}
        online={online}
        onNav={(id) => { setStockAttention(false); setActiveView(id); }}
        onNew={() => setNewItemOpen(true)}
      />

      <main className="main">
        <MobileHeader
          currentUser={currentUser}
          attentionCount={attention.length}
          onHome={() => { setStockAttention(false); setActiveView('home'); }}
          onBell={openAttention}
          onNew={() => setNewItemOpen(true)}
        />

        {error && (
          <div className="alert error">
            <div className="tape" />
            <div><b>연결 오류가 발생했습니다</b><span>{error}</span></div>
            <button onClick={() => setError('')} aria-label="닫기"><X size={16} /></button>
          </div>
        )}

        {!online && (
          <div className="offline-strip">
            <WifiOff size={14} />오프라인 상태입니다 — 기록은 저장되며 연결 시 자동으로 동기화됩니다.
          </div>
        )}

        <div className="scroll">
          {loading ? <LoadingState /> : (
            <>
              {activeView === 'home' && (
                <HomeView
                  currentUser={currentUser}
                  inventory={inventory}
                  logs={logs}
                  favorites={favorites}
                  onOpen={setSelectedKey}
                  onOpenList={(mode) => { setListMode(mode); setActiveView('list'); }}
                />
              )}
              {activeView === 'list' && (
                <ListView
                  mode={listMode}
                  inventory={inventory}
                  logs={logs}
                  favorites={favorites}
                  onOpen={setSelectedKey}
                  onBack={() => setActiveView('home')}
                />
              )}
              {activeView === 'stock' && (
                <StockView
                  inventory={inventory}
                  logs={logs}
                  attentionOnly={stockAttention}
                  setAttentionOnly={setStockAttention}
                  onOpen={setSelectedKey}
                  onNew={() => setNewItemOpen(true)}
                />
              )}
              {activeView === 'ledger' && (
                <LedgerView inventory={inventory} logs={logs} currentUser={currentUser} onDeleteLog={deleteMovementLog} />
              )}
              {activeView === 'labels' && (
                <LabelsView inventory={inventory} labelKey={labelKey} onChangeLabelKey={setLabelKey} />
              )}
              {activeView === 'settings' && (
                <SettingsView
                  currentUser={currentUser} settings={settings} authEmail={authUser?.email || ''}
                  isAdmin={isAdmin} members={allMembers}
                  onApproveMember={(uid) => setMemberStatus(uid, 'approved')}
                  onRejectMember={(uid) => setMemberStatus(uid, 'rejected')}
                  onRemoveMember={(uid) => { if (window.confirm('이 회원의 접근을 완전히 삭제할까요?')) removeMember(uid); }}
                  onRenameMember={(uid, name) => setMemberName(uid, name.startsWith('의장_') ? name : `의장_${name}`)}
                  catItems={categories.filter((c) => c.type !== 'equipment')} zoneItems={allZones} chemCatItems={allChemCats} teamItems={teamMembers}
                  onAddCategory={addCategory} onRenameCategory={renameCategory} onDeleteCategory={deleteCategory}
                  onAddZone={addZone} onRenameZone={renameZone} onDeleteZone={deleteZone}
                  onAddChemCat={addChemCat} onRenameChemCat={renameChemCat} onDeleteChemCat={deleteChemCat}
                  onAddTeamMember={addTeamMember} onRenameTeamMember={renameTeamMember} onRemoveTeamMember={removeTeamMember}
                  onSaveSettings={saveTeamSettings}
                  onExportInventory={handleExportInventory} onExportLogs={handleExportLogs}
                  onSignOut={() => signOutUser()}
                />
              )}
            </>
          )}
        </div>
      </main>

      <BottomTabs active={activeView} onNav={(id) => { setStockAttention(false); setActiveView(id); }} />

      {selected && (
        <QuickLogSheet
          key={selected.key}
          item={selected}
          logs={logs}
          categories={categories}
          teamMembers={teamMembers}
          zones={allZones}
          chemCats={allChemCats}
          onAddZone={addZone}
          onAddChemCat={addChemCat}
          onAddCategory={addCategory}
          isFav={favorites.includes(selected.key)}
          onToggleFav={() => toggleFavorite(selected.key)}
          onClose={() => setSelectedKey('')}
          onMove={handleMovement}
          onSave={handleSaveItem}
          onDelete={handleDeleteItem}
          onOpenLabel={openLabelFor}
        />
      )}

      {newItemOpen && (
        <NewItemModal
          currentUser={currentUser} categories={categories} equipmentList={ciEquip}
          teamMembers={teamMembers} zones={allZones} chemCats={allChemCats}
          onAddZone={addZone} onAddChemCat={addChemCat} onAddCategory={addCategory} onAddEquipment={addEquipment}
          onClose={() => setNewItemOpen(false)} onSubmit={handleCreateItem}
        />
      )}

      {toast && (
        <div className="toast show">
          <Check size={16} className="ok" />{toast.msg}
          {toast.undo && (
            <button className="toast-undo" onClick={() => handleUndo(toast.undo)}>되돌리기</button>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ gate */
function AuthLoading() {
  return (
    <div className="gate">
      <div className="gate-card" style={{ textAlign: 'center' }}>
        <div className="brand-mark large" style={{ margin: '0 auto 14px' }}>FITI</div>
        <div className="loader" style={{ margin: '10px auto' }} />
        <p style={{ margin: 0 }}>로그인 상태를 확인하고 있습니다…</p>
      </div>
    </div>
  );
}

function authMsg(code) {
  return {
    'auth/invalid-email': '이메일 형식이 올바르지 않습니다.',
    'auth/missing-password': '비밀번호를 입력하세요.',
    'auth/user-not-found': '등록되지 않은 이메일입니다.',
    'auth/wrong-password': '비밀번호가 일치하지 않습니다.',
    'auth/invalid-credential': '이메일 또는 비밀번호가 올바르지 않습니다.',
    'auth/email-already-in-use': '이미 가입된 이메일입니다. 로그인해 주세요.',
    'auth/weak-password': '비밀번호는 6자 이상이어야 합니다.',
    'auth/too-many-requests': '시도가 많습니다. 잠시 후 다시 시도해 주세요.',
    'auth/popup-closed-by-user': '로그인 창이 닫혔습니다. 다시 시도해 주세요.',
    'auth/unauthorized-domain': '이 도메인이 Firebase에 등록되지 않았습니다. 관리자에게 문의해 주세요.',
    'auth/operation-not-allowed': '해당 로그인 방식이 비활성화되어 있습니다. 관리자에게 문의해 주세요.',
  }[code] || `오류가 발생했습니다. (${code || '알 수 없음'})`;
}

function AuthGate() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup'
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError(''); setInfo('');
    if (!email.trim() || !pw) { setError('이메일과 비밀번호를 입력하세요.'); return; }
    setBusy(true);
    try {
      if (mode === 'signup') await signUpWithEmail(email.trim(), pw);
      else await signInWithEmail(email.trim(), pw);
    } catch (err) { setError(authMsg(err?.code)); } finally { setBusy(false); }
  }
  async function reset() {
    setError(''); setInfo('');
    if (!email.trim()) { setError('재설정할 이메일을 먼저 입력하세요.'); return; }
    try { await sendReset(email.trim()); setInfo('비밀번호 재설정 메일을 보냈습니다. 메일함을 확인하세요.'); }
    catch (err) { setError(authMsg(err?.code)); }
  }
  async function google() {
    setError(''); setInfo('');
    try { await signInWithGoogle(); } catch (err) { setError(authMsg(err?.code)); }
  }

  return (
    <div className="gate">
      <form className="gate-card" onSubmit={submit}>
        <div className="brand-mark large">FITI</div>
        <span className="eyebrow">의장소재팀 재고관리</span>
        <h1>{mode === 'signup' ? '회원가입' : '로그인'}</h1>
        <p>{mode === 'signup'
          ? '이메일과 비밀번호(6자 이상)로 가입하세요. 가입 후 관리자 승인이 필요합니다.'
          : '가입한 이메일과 비밀번호로 로그인하세요. 한 번 로그인하면 다음부터 자동 로그인됩니다.'}</p>
        <div className="form-grid" style={{ marginBottom: 14 }}>
          <label><span>이메일</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" /></label>
          <label><span>비밀번호</span><input type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={pw} onChange={(e) => setPw(e.target.value)} placeholder="비밀번호 (6자 이상)" /></label>
        </div>
        <button className="btn primary full" type="submit" disabled={busy}>{mode === 'signup' ? '회원가입' : '로그인'}</button>
        {error && <p style={{ color: 'var(--crit)', marginTop: 12 }}>{error}</p>}
        {info && <p style={{ color: 'var(--ok)', marginTop: 12 }}>{info}</p>}
        <div className="auth-alt">
          {mode === 'login' ? (
            <>
              <button type="button" className="linkbtn" onClick={() => { setMode('signup'); setError(''); setInfo(''); }}>회원가입</button>
              <button type="button" className="linkbtn" onClick={reset}>비밀번호 찾기</button>
            </>
          ) : (
            <button type="button" className="linkbtn" onClick={() => { setMode('login'); setError(''); setInfo(''); }}>이미 계정이 있어요 · 로그인</button>
          )}
        </div>
        <div className="auth-divider"><span>또는</span></div>
        <button type="button" className="btn ghost full" onClick={google}>구글 계정으로 로그인</button>
      </form>
    </div>
  );
}

function AccessScreen({ email, name, rejected = false, onSignOut }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="brand-mark large">FITI</div>
        <span className="eyebrow">의장소재팀 재고관리</span>
        <h1>{rejected ? '접근이 거부되었습니다' : '승인 대기 중'}</h1>
        <p>
          {rejected
            ? '관리자가 접근을 허용하지 않았습니다. 필요하면 관리자에게 문의해 주세요.'
            : '가입 신청이 접수되었습니다. 관리자가 승인하면 바로 이용할 수 있습니다. (승인되면 이 화면이 자동으로 넘어갑니다.)'}
        </p>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 18px' }}>
          {name ? `${name.replace(/^의장_/, '')} · ` : ''}{email}
        </p>
        <button className="btn ghost full" onClick={onSignOut}>다른 계정으로 로그인 / 로그아웃</button>
      </div>
    </div>
  );
}

function NameGate({ roster = TEAM_MEMBERS, takenNames = [], onSubmit, onSignOut }) {
  const [busy, setBusy] = useState(false);
  async function pick(m) {
    if (busy) return;
    setBusy(true);
    try { await onSubmit(m); } catch { setBusy(false); }
  }
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="brand-mark large">FITI</div>
        <span className="eyebrow">의장소재팀 재고관리</span>
        <h1>본인 이름 선택</h1>
        <p>입출고 기록에 표시될 본인 이름을 선택하세요. 한 번 선택하면 계정에 고정되며, 변경은 관리자에게 요청해야 합니다.</p>
        <div className="member-grid">
          {roster.map((m) => {
            const taken = takenNames.includes(m);
            return (
              <button key={m} disabled={taken || busy} onClick={() => pick(m)}>
                <span>{m.slice(-3)}</span>{m.replace(/^의장_/, '')}{taken ? ' · 사용중' : ''}
              </button>
            );
          })}
        </div>
        <button className="btn ghost full" style={{ marginTop: 14 }} onClick={onSignOut}>로그아웃</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ chrome */
function DesktopRail({ active, currentUser, online, onNav, onNew }) {
  return (
    <aside className="rail">
      <button className="brand-block" onClick={() => onNav('home')} aria-label="홈으로 이동">
        <div className="brand-mark">FITI</div>
        <div><strong>의장소재팀</strong><span>재고</span></div>
      </button>
      <button className="btn primary full" onClick={onNew}><Plus size={17} />새 품목</button>
      <nav className="rail-nav">
        {NAV_ITEMS.map((it) => (
          <button key={it.id} className={`rail-item ${active === it.id ? 'on' : ''}`} onClick={() => onNav(it.id)}>
            <it.icon size={18} /><span>{it.label}</span>
          </button>
        ))}
      </nav>
      <div className="rail-foot">
        <div className="who"><div className="av">{currentUser.slice(-3)}</div>
          <div><b>{currentUser.replace(/^의장_/, '')}</b><span>{online ? '동기화 중' : '오프라인'}</span></div></div>
        {online ? <Wifi size={16} className="dot-on" /> : <WifiOff size={16} className="dot-off" />}
      </div>
    </aside>
  );
}

function MobileHeader({ currentUser, attentionCount, onHome, onBell, onNew }) {
  return (
    <header className="mtop">
      <button className="mtop-brand" onClick={onHome} aria-label="홈으로 이동">
        <div className="brand-mark sm">FITI</div>
        <div><b>{currentUser.replace(/^의장_/, '')}님</b><span>의장소재팀 · 시험</span></div>
      </button>
      <div className="mtop-actions">
        <button className="round" onClick={onNew} aria-label="새 품목"><Plus size={19} /></button>
        <button className="round" onClick={onBell} aria-label="확인할 항목">
          <Bell size={18} />{attentionCount > 0 && <span className="dot" />}
        </button>
      </div>
    </header>
  );
}

function BottomTabs({ active, onNav }) {
  return (
    <nav className="tabs" aria-label="메뉴">
      {NAV_ITEMS.map((it) => (
        <button key={it.id} className={active === it.id ? 'on' : ''} onClick={() => onNav(it.id)}>
          <it.icon size={20} /><span>{it.label}</span>
        </button>
      ))}
    </nav>
  );
}

/* ------------------------------------------------------------------ home */
function HomeView({ currentUser, inventory, logs, favorites, onOpen, onOpenList }) {
  const [q, setQ] = useState('');
  const name = currentUser.replace(/^의장_/, '');
  const today = todayKey();

  const lowCount = useMemo(() => inventory.filter((it) => it.status !== 'ok').length, [inventory]);
  const favCount = useMemo(() => inventory.filter((it) => favorites.includes(it.key)).length, [inventory, favorites]);
  const todayCount = useMemo(() => logs.filter((l) => (l.isoDate || '').startsWith(today)).length, [logs, today]);
  const searchList = useMemo(() => filterInventory(inventory, { query: q }), [inventory, q]);

  const cards = [
    { id: 'all', label: '총 재고', value: inventory.length, unit: '개', icon: Boxes, tone: 'ink' },
    { id: 'low', label: '부족 재고', value: lowCount, unit: '개', icon: AlertTriangle, tone: lowCount ? 'warn' : 'ok' },
    { id: 'today', label: '오늘 입출고', value: todayCount, unit: '건', icon: ArrowLeftRight, tone: 'ink' },
    { id: 'fav', label: '즐겨찾기', value: favCount, unit: '개', icon: Star, tone: 'fav' },
  ];

  return (
    <div className="view">
      <div className="hello">{name}님, 안녕하세요.<small>카드를 눌러 재고 현황을 확인하세요.</small></div>

      <SearchBar value={q} onChange={setQ} placeholder="품명 검색 (초성 검색 지원 — 예: ㅇㅅㅌ)" />

      {q ? (
        <>
          <div className="label" style={{ marginTop: 16 }}>검색 결과</div>
          <ItemList items={searchList} logs={logs} onOpen={onOpen} />
        </>
      ) : (
        <>
          <div className="stat-grid">
            {cards.map((c) => (
              <button key={c.id} className={`stat-card tone-${c.tone}`} onClick={() => onOpenList(c.id)}>
                <div className="stat-ic"><c.icon size={17} /></div>
                <div className="stat-num">{formatNumber(c.value)}<small>{c.unit}</small></div>
                <div className="stat-label">{c.label}</div>
              </button>
            ))}
          </div>

          <div className="label" style={{ marginTop: 22 }}>시약·소모품 관리 지침</div>
          <GuidePanel />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ 관리 지침 */
function GuidePanel() {
  const [open, setOpen] = useState(''); // 기본은 모두 닫힘
  return (
    <div className="guide">
      {MANAGEMENT_RULES.map((rule, idx) => {
        const isOpen = open === rule.id;
        return (
          <div key={rule.id} className={`guide-item ${isOpen ? 'on' : ''}`}>
            <button className="guide-head" onClick={() => setOpen(isOpen ? '' : rule.id)} aria-expanded={isOpen}>
              <div className="guide-no">{idx + 1}</div>
              <div className="guide-tt"><b>{rule.title}</b><span>{rule.issue}</span></div>
              <ChevronDown size={18} className="guide-caret" style={{ transform: isOpen ? 'rotate(180deg)' : '' }} />
            </button>
            {isOpen && (
              <ul className="guide-list">
                {rule.checklist.map((c, i) => (
                  <li key={i}><Check size={15} />{c}</li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ list (card 상세) */
function ListView({ mode, inventory, logs, favorites, onOpen, onBack }) {
  const today = todayKey();
  const meta = {
    all: { title: '총 재고', sub: '등록된 전체 품목입니다.' },
    low: { title: '부족 재고', sub: '재고가 부족하거나 확인이 필요한 품목입니다.' },
    today: { title: '오늘 입출고', sub: '오늘 기록된 입출고 내역입니다.' },
    fav: { title: '즐겨찾기', sub: '별표로 등록한 품목입니다.' },
  }[mode] || { title: '목록', sub: '' };

  const items = useMemo(() => {
    if (mode === 'low') return inventory.filter((it) => it.status !== 'ok');
    if (mode === 'fav') return inventory.filter((it) => favorites.includes(it.key));
    return inventory;
  }, [mode, inventory, favorites]);
  const todayLogs = useMemo(() => logs.filter((l) => (l.isoDate || '').startsWith(today)), [logs, today]);

  return (
    <div className="view">
      <div className="list-head">
        <button className="back-btn" onClick={onBack} aria-label="홈으로"><ArrowLeft size={19} /></button>
        <div><div className="vhead">{meta.title}</div><p className="vsub">{meta.sub}</p></div>
      </div>

      {mode === 'today' ? (
        todayLogs.length ? (
          <div className="hist">
            {todayLogs.map((l) => <LogRow key={l._docId || `${l.item}-${l.time}`} log={l} onOpen={() => onOpen(l.itemKey)} />)}
          </div>
        ) : <EmptyState title="오늘 입출고 기록이 없습니다" text="품목을 선택해 첫 기록을 남겨보세요." />
      ) : items.length ? (
        <InventoryBrowser baseItems={items} logs={logs} onOpen={onOpen} />
      ) : mode === 'fav' ? (
        <EmptyState title="즐겨찾기가 없습니다" text="품목을 열고 별표(★)를 눌러 즐겨찾기에 추가하세요." />
      ) : mode === 'low' ? (
        <EmptyState title="부족한 재고가 없습니다" text="현재 모든 품목이 정상 상태입니다." />
      ) : (
        <EmptyState title="등록된 품목이 없습니다" text="새 품목을 추가해 보세요." />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ stock */
const TYPE_FILTERS = [
  { id: 'all', label: '전체' }, { id: 'chemical', label: '약품' },
  { id: 'consumable', label: '일반 소모품' }, { id: 'equipment', label: '장비 소모품' },
];

function StockView({ inventory, logs, attentionOnly, setAttentionOnly, onOpen, onNew }) {
  const base = useMemo(
    () => (attentionOnly ? inventory.filter((it) => it.status !== 'ok') : inventory),
    [inventory, attentionOnly],
  );
  return (
    <div className="view">
      <div className="vhead-row">
        <div><div className="vhead">전체 재고</div><p className="vsub">약품·일반 소모품·장비 소모품을 한곳에서 관리합니다.</p></div>
        <button className="btn ghost only-wide" onClick={onNew}><Plus size={16} />새 품목</button>
      </div>
      <InventoryBrowser
        baseItems={base}
        logs={logs}
        onOpen={onOpen}
        filterExtra={(
          <button className={`pill-toggle ${attentionOnly ? 'on' : ''}`} onClick={() => setAttentionOnly(!attentionOnly)}>
            확인 필요만
          </button>
        )}
      />
    </div>
  );
}

// 검색 + 구분 필터(전체/약품/일반 소모품/장비 소모품) + 장비 드릴다운. 선반·홈 카드에서 공통 사용.
function InventoryBrowser({ baseItems, logs, onOpen, filterExtra = null }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');
  const [equipKey, setEquipKey] = useState('');
  const equipMode = type === 'equipment';

  const equipGroups = useMemo(() => {
    const map = new Map();
    baseItems.filter((it) => it.type === 'equipment').forEach((it) => {
      const key = it.equipment?._docId || it.category;
      if (!map.has(key)) map.set(key, { key, name: it.category, lamp: it.owner, items: [] });
      map.get(key).items.push(it);
    });
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }, [baseItems]);
  const selectedEquip = equipGroups.find((g) => g.key === equipKey) || null;

  const list = useMemo(() => filterInventory(baseItems, { query: q, type }), [baseItems, q, type]);
  const equipParts = useMemo(
    () => (selectedEquip ? filterInventory(selectedEquip.items, { query: q }) : []),
    [selectedEquip, q],
  );

  function changeType(t) { setType(t); setEquipKey(''); }

  return (
    <>
      <SearchBar value={q} onChange={setQ} placeholder="품명·용도·시험실 검색" />
      <div className="filter-row">
        <Segmented value={type} options={TYPE_FILTERS} onChange={changeType} />
        {filterExtra}
      </div>

      {equipMode ? (
        selectedEquip ? (
          <>
            <button className="equip-back" onClick={() => setEquipKey('')}><ArrowLeft size={16} />장비 목록</button>
            <div className="equip-title"><Layers size={18} /><b>{selectedEquip.name}</b>
              {selectedEquip.lamp && selectedEquip.lamp !== '-' && <span>{selectedEquip.lamp}</span>}</div>
            <div className="count">{formatNumber(equipParts.length)}개 소모품</div>
            <ItemList items={equipParts} logs={logs} onOpen={onOpen} />
          </>
        ) : (
          <EquipGrid groups={equipGroups} query={q} onPick={setEquipKey} />
        )
      ) : (
        <>
          <div className="count">{formatNumber(list.length)}개</div>
          <ItemList items={list} logs={logs} onOpen={onOpen} />
        </>
      )}
    </>
  );
}

function EquipGrid({ groups, query, onPick }) {
  const q = query.trim().toLowerCase();
  const list = q ? groups.filter((g) => g.name.toLowerCase().includes(q)) : groups;
  if (!list.length) return <EmptyState title="장비가 없습니다" text="장비 소모품 데이터를 먼저 등록하세요." />;
  return (
    <div className="equip-grid">
      {list.map((g) => {
        const attn = g.items.filter((it) => it.status !== 'ok').length;
        const crit = g.items.some((it) => it.status === 'critical');
        return (
          <button key={g.key} className="equip-card" onClick={() => onPick(g.key)}>
            <div className="equip-ic"><Layers size={19} /></div>
            <div className="equip-body">
              <b>{g.name}</b>
              <span>소모품 {g.items.length}종{g.lamp && g.lamp !== '-' ? ` · ${g.lamp}` : ''}</span>
            </div>
            {attn > 0
              ? <span className={`equip-pin ${crit ? 'crit' : 'warn'}`}>확인 {attn}</span>
              : <span className="equip-pin ok">정상</span>}
            <ChevronDown className="go" size={18} style={{ transform: 'rotate(-90deg)' }} />
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ ledger */
function LedgerView({ inventory, logs, currentUser, onDeleteLog }) {
  const [view, setView] = useState('log'); // 'log' | 'register'
  const [scope, setScope] = useState('me');
  const today = todayKey();
  const filtered = logs.filter((l) => (scope === 'all' ? true : l.handler === currentUser));
  const groups = filtered.reduce((acc, l) => {
    const day = (l.isoDate || '').slice(0, 10) || '기타';
    (acc[day] = acc[day] || []).push(l);
    return acc;
  }, {});
  const days = Object.keys(groups).sort().reverse();

  return (
    <div className="view">
      <div className="vhead-row">
        <div><div className="vhead">{view === 'register' ? '소모품 대장' : (scope === 'me' ? '내 기록' : '팀 전체 기록')}</div>
          <p className="vsub">{view === 'register' ? '입출고 기록으로 자동 작성되는 소모품 대장입니다.' : '입출고 내역이 시간순으로 기록됩니다.'}</p></div>
        {view === 'log' && <button className="btn ghost only-wide" onClick={() => window.print()}><Printer size={16} />인쇄</button>}
      </div>

      <Segmented value={view} options={[{ id: 'log', label: '입출고 기록' }, { id: 'register', label: '소모품 대장' }]} onChange={setView} />

      {view === 'register' ? (
        <ConsumableLedger inventory={inventory} logs={logs} />
      ) : (
        <>
          <div className="filter-row">
            <Segmented value={scope} options={[{ id: 'me', label: '나만' }, { id: 'all', label: '팀 전체' }]} onChange={setScope} />
          </div>
          {days.length ? days.map((day) => (
            <div key={day}>
              <div className="day">{day === today ? '오늘' : day}</div>
              <div className="hist">
                {groups[day].map((l) => (
                  <LogRow key={l._docId || `${l.item}-${l.time}`} log={l}
                    canDelete={l.handler === currentUser} onDelete={() => onDeleteLog(l)} />
                ))}
              </div>
            </div>
          )) : (
            <EmptyState title="기록이 없습니다" text="홈에서 품목을 선택하여 기록을 시작하세요." />
          )}
        </>
      )}
    </div>
  );
}

/* 소모품 대장 (FITI-P006-01-01) — 입출고 기록으로 자동 작성 */
function ledgerQtyNum(text) {
  const m = String(text ?? '').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

function ConsumableLedger({ inventory, logs }) {
  const [sel, setSel] = useState('');
  const selected = inventory.find((it) => it.key === sel) || null;

  if (selected) {
    return (
      <div>
        <div className="ledger-actions">
          <button className="equip-back" onClick={() => setSel('')}><ArrowLeft size={16} />품목 목록</button>
          <button className="btn primary" onClick={() => window.print()}><Printer size={16} />이 대장 인쇄</button>
        </div>
        <div className="ledger-print-area">
          <LedgerSheet item={selected} logs={logs} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="ledger-hint">품목을 선택하면 입출고 기록으로 대장이 자동 작성됩니다. 검색·분류 후 한 건씩 인쇄하세요.</p>
      <InventoryBrowser baseItems={inventory} logs={logs} onOpen={setSel} />
    </div>
  );
}

function LedgerSheet({ item, logs }) {
  const rows = logs
    .filter((l) => l.itemKey === item.key || l.item === item.name)
    .slice()
    .sort((a, b) => (a.isoDate || '').localeCompare(b.isoDate || '') || (a.time || '').localeCompare(b.time || ''));

  const net = rows.reduce((s, l) => s + (l.action === 'use' ? -ledgerQtyNum(l.qty) : ledgerQtyNum(l.qty)), 0);
  const opening = Math.round((Number(item.qty || 0) - net) * 100) / 100;

  const entries = [];
  let bal = opening;
  if (opening !== 0 || rows.length === 0) {
    entries.push({ date: item.purchased && item.purchased !== '-' ? item.purchased : '', buy: opening > 0 ? opening : '', use: '', bal: opening, memo: '기초 재고', who: '' });
  }
  rows.forEach((l) => {
    const amt = ledgerQtyNum(l.qty);
    bal = Math.round((bal + (l.action === 'use' ? -amt : amt)) * 100) / 100;
    entries.push({
      date: l.isoDate || '',
      buy: l.action === 'use' ? '' : amt,
      use: l.action === 'use' ? amt : '',
      bal,
      memo: l.memo || (l.action === 'add' ? '입고' : ''),
      who: (l.handler || '').replace(/^의장_/, ''),
    });
  });
  const MIN_ROWS = 15;
  while (entries.length < MIN_ROWS) entries.push(null);

  return (
    <div className="ledger-sheet">
      <h2 className="ledger-title">소 모 품 대 장</h2>
      <div className="ledger-no">No</div>
      <table className="ledger-table">
        <colgroup>
          <col style={{ width: '14%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} />
          <col style={{ width: '12%' }} /><col style={{ width: '22%' }} /><col style={{ width: '14%' }} /><col style={{ width: '14%' }} />
        </colgroup>
        <tbody>
          <tr className="hrow">
            <th colSpan="2">품 명</th><th colSpan="2">규 격</th><th>단 위</th><th colSpan="2">용 도</th>
          </tr>
          <tr className="vrow">
            <td colSpan="2">{item.name}</td>
            <td colSpan="2">{item.spec || item.code || ''}</td>
            <td>{item.unit}</td>
            <td colSpan="2">{item.purpose && item.purpose !== '-' ? item.purpose : item.category}</td>
          </tr>
          <tr className="hrow">
            <th rowSpan="2">년월일</th><th rowSpan="2">구입량</th><th rowSpan="2">사용량</th>
            <th rowSpan="2">보유량</th><th rowSpan="2">비 고</th><th colSpan="2">확 인</th>
          </tr>
          <tr className="hrow"><th>작 성</th><th>승 인</th></tr>
          {entries.map((e, i) => (
            <tr key={i}>
              <td>{e?.date}</td><td>{e?.buy}</td><td>{e?.use}</td><td>{e == null ? '' : e.bal}</td>
              <td className="memo">{e?.memo}</td><td>{e?.who}</td><td></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="ledger-docno">FITI-P006-01-01(Rev.0)</div>
    </div>
  );
}

/* ------------------------------------------------------------------ labels */
function LabelsView({ inventory, labelKey, onChangeLabelKey }) {
  const targets = inventory.filter((it) => it.type !== 'equipment');
  const selected = inventory.find((it) => it.key === labelKey) || targets[0];
  return (
    <div className="view label-layout">
      <div>
        <div className="vhead">라벨</div>
        <p className="vsub">시약병·소모품용 라벨입니다. 항목을 선택하면 우측에 미리보기가 표시됩니다.</p>
        <div className="rows" style={{ marginTop: 10 }}>
          {targets.map((it) => (
            <button key={it.key} className={`row ${selected?.key === it.key ? 'sel' : ''}`} onClick={() => onChangeLabelKey(it.key)}>
              <div className={`edge cat-${it.type}`} />
              <div className="body"><b>{it.name}</b><div className="meta">{CAT_LABEL[it.type]} · {it.qtyText}</div></div>
              <span className={`pin ${pinTone(it.status)}`}>{friendlyPin(it)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="label-panel">
        <div className="label-panel-head">
          <b>미리보기</b>
          <button className="btn primary" onClick={() => window.print()}><Printer size={16} />라벨 출력</button>
        </div>
        {selected ? <LabelPreview item={selected} /> : <EmptyState title="라벨 대상이 없습니다" text="약품 또는 소모품을 먼저 등록하세요." />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ settings */
function SettingsView({ currentUser, settings, authEmail, isAdmin, members = [], onApproveMember, onRejectMember, onRemoveMember, onRenameMember, catItems = [], zoneItems = [], chemCatItems = [], teamItems = [], onAddCategory, onRenameCategory, onDeleteCategory, onAddZone, onRenameZone, onDeleteZone, onAddChemCat, onRenameChemCat, onDeleteChemCat, onAddTeamMember, onRenameTeamMember, onRemoveTeamMember, onSaveSettings, onExportInventory, onExportLogs, onSignOut }) {
  const reassign = (m) => {
    const next = window.prompt('지정할 이름(예: 의장_이진원)', m.name || '');
    if (next && next.trim()) onRenameMember(m.uid, next.trim());
  };
  const [draft, setDraft] = useState(settings);
  useEffect(() => setDraft(settings), [settings]);
  const pending = members.filter((m) => m.status === 'pending');
  const approved = members.filter((m) => m.status === 'approved');
  const rejected = members.filter((m) => m.status === 'rejected');
  return (
    <div className="view">
      <div className="vhead">설정</div>
      <p className="vsub">담당자와 팀 공통 기준을 설정합니다.</p>

      {isAdmin && (
        <div className="card">
          <div className="card-title">회원 관리 (관리자)</div>
          <div className="label" style={{ marginTop: 0 }}>승인 대기 {pending.length}</div>
          {pending.length ? (
            <div className="member-list">
              {pending.map((m) => (
                <div key={m.uid} className="member-row">
                  <div className="member-info"><b>{m.name ? m.name.replace(/^의장_/, '') : (m.displayName || '(이름 미지정)')}</b><span>{m.email}</span></div>
                  <div className="member-acts">
                    <button className="mini" onClick={() => reassign(m)}>이름</button>
                    <button className="mini ok" onClick={() => onApproveMember(m.uid)}>승인</button>
                    <button className="mini no" onClick={() => onRejectMember(m.uid)}>거절</button>
                  </div>
                </div>
              ))}
            </div>
          ) : <p className="vsub" style={{ margin: '0 0 6px' }}>대기 중인 신청이 없습니다.</p>}

          <div className="label">승인된 회원 {approved.length}</div>
          <div className="member-list">
            {approved.map((m) => (
              <div key={m.uid} className="member-row">
                <div className="member-info"><b>{m.name ? m.name.replace(/^의장_/, '') : (m.displayName || '(이름 미지정)')}</b><span>{m.email}</span></div>
                <div className="member-acts">
                  <button className="mini" onClick={() => reassign(m)}>이름</button>
                  <button className="mini no" onClick={() => onRemoveMember(m.uid)}>접근 해제</button>
                </div>
              </div>
            ))}
            {!approved.length && <p className="vsub" style={{ margin: 0 }}>아직 승인된 회원이 없습니다.</p>}
          </div>
          {rejected.length > 0 && (
            <>
              <div className="label">거절됨 {rejected.length}</div>
              <div className="member-list">
                {rejected.map((m) => (
                  <div key={m.uid} className="member-row">
                    <div className="member-info"><b>{m.displayName || '(이름 없음)'}</b><span>{m.email}</span></div>
                    <div className="member-acts">
                      <button className="mini ok" onClick={() => onApproveMember(m.uid)}>승인</button>
                      <button className="mini no" onClick={() => onRemoveMember(m.uid)}>삭제</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-title">담당자</div>
        <div className="profile">
          <div className="av lg">{currentUser.slice(-3)}</div>
          <div><span>내 담당자 이름 (계정 고정)</span><strong>{currentUser.replace(/^의장_/, '')}</strong></div>
        </div>
        <p className="vsub" style={{ margin: 0 }}>입출고 기록은 이 이름으로 남습니다. 이름 변경이 필요하면 관리자에게 요청하세요.</p>
      </div>

      <div className="card">
        <div className="card-title">팀 공통 기준</div>
        <div className="form-grid">
          <label><span>약품 폐기 경고 (개봉 후 일수)</span>
            <input type="number" min="1" max="365" value={draft.disposalDays || 90}
              onChange={(e) => setDraft({ ...draft, disposalDays: Number(e.target.value) })} /></label>
          <label><span>저재고 기준 (이하면 알림)</span>
            <input type="number" min="0" max="100" value={draft.lowQty ?? 1}
              onChange={(e) => setDraft({ ...draft, lowQty: Number(e.target.value) })} /></label>
        </div>
        <button className="btn primary full" onClick={() => onSaveSettings(draft)}>저장</button>
      </div>

      {isAdmin && (
        <div className="card">
          <div className="card-title">팀원 관리 (관리자)</div>
          <p className="vsub" style={{ marginTop: 0 }}>입사 시 추가, 퇴사 시 삭제하세요. 명단은 본인 이름 선택·취급자에 사용됩니다.</p>
          <TagManager
            label="팀원 명단"
            items={teamItems.map((m) => ({ key: m, label: m.replace(/^의장_/, '') }))}
            onAdd={onAddTeamMember} onRename={onRenameTeamMember} onDelete={onRemoveTeamMember}
            addText="+ 팀원 추가" empty="팀원 없음"
          />
        </div>
      )}

      <div className="card">
        <div className="card-title">분류·시험실 관리</div>
        <p className="vsub" style={{ marginTop: 0 }}>추가(+)·이름 변경(✎)·삭제(×)가 모두 가능합니다. 기본 항목도 편집됩니다.</p>
        <TagManager label="소모품 카테고리" items={catItems.map((c) => ({ key: c.id, label: c.label }))} onAdd={onAddCategory} onRename={onRenameCategory} onDelete={onDeleteCategory} empty="카테고리 없음" />
        <TagManager label="시험실" items={zoneItems.map((z) => ({ key: z, label: z }))} onAdd={onAddZone} onRename={onRenameZone} onDelete={onDeleteZone} empty="시험실 없음" />
        <TagManager label="약품 분류" items={chemCatItems.map((c) => ({ key: c, label: c }))} onAdd={onAddChemCat} onRename={onRenameChemCat} onDelete={onDeleteChemCat} empty="분류 없음" />
      </div>

      <div className="card">
        <div className="card-title">데이터 내보내기</div>
        <p className="vsub" style={{ marginTop: 0 }}>엑셀에서 바로 열리는 CSV로 내려받습니다. 보고·감사용으로 활용하세요.</p>
        <div className="settings-actions">
          <button className="btn ghost" onClick={onExportInventory}><Download size={16} />재고 목록 (엑셀)</button>
          <button className="btn ghost" onClick={onExportLogs}><Download size={16} />입출고 기록 (엑셀)</button>
          <button className="btn ghost" onClick={() => window.print()}><Printer size={16} />화면 인쇄</button>
        </div>
      </div>

      <div className="card">
        <div className="card-title">계정</div>
        <div className="profile">
          <div><span>로그인 계정</span><strong style={{ fontSize: 15 }}>{authEmail || '-'}</strong></div>
        </div>
        <button className="btn ghost full" onClick={onSignOut}>로그아웃</button>
      </div>
    </div>
  );
}

function TagManager({ label, items, onRename, onDelete, onAdd, addText = '+ 추가', empty }) {
  function rename(it) {
    const next = window.prompt('새 이름을 입력하세요', it.label);
    if (next && next.trim() && next.trim() !== it.label) onRename(it.key, next.trim());
  }
  function add() {
    const v = window.prompt('새 항목 이름을 입력하세요');
    if (v && v.trim()) onAdd(v.trim());
  }
  return (
    <div className="tagmgr">
      <div className="label" style={{ marginTop: 6 }}>{label}</div>
      <div className="tag-chips">
        {items.map((it) => (
          <span key={it.key} className="tag-chip">
            {it.label}
            {onRename && <button onClick={() => rename(it)} aria-label="이름 변경"><Pencil size={12} /></button>}
            <button onClick={() => { if (window.confirm(`'${it.label}' 항목을 삭제할까요?`)) onDelete(it.key); }} aria-label="삭제"><X size={13} /></button>
          </span>
        ))}
        {onAdd && <button className="tag-add" onClick={add}>{addText}</button>}
        {!items.length && !onAdd && <p className="vsub" style={{ margin: 0 }}>{empty}</p>}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ quick-log */
function QuickLogSheet({ item, logs, categories, teamMembers, zones, chemCats, onAddZone, onAddChemCat, onAddCategory, isFav, onToggleFav, onClose, onMove, onSave, onDelete, onOpenLabel }) {
  const [mode, setMode] = useState(item.qty <= 0 ? 'in' : 'out');
  const step = stepFor(item.unit);
  const [amount, setAmount] = useState(step);
  const [memo, setMemo] = useState('');
  const [showDetail, setShowDetail] = useState(false);
  const [editing, setEditing] = useState(false);
  const [edit, setEdit] = useState(null);
  const presets = [step, step * 2, step * 4].map((v) => round(v));
  const history = itemHistory(item, logs);
  const over = mode === 'out' && Number(amount || 0) > Number(item.qty || 0);

  useEffect(() => {
    if (item.type === 'equipment') setEdit({ ...item.source, have: item.qty, need: item.need });
    else setEdit({ ...item.source });
  }, [item]);

  function bump(d) { setAmount((a) => round(Math.max(0, Number(a || 0) + d * step))); }
  function commit() {
    const amt = Number(amount || 0);
    if (amt <= 0 || over) return;
    onMove({ item, direction: mode, amount: amt, unit: item.unit, memo });
  }
  function saveEdit() {
    if (item.type === 'equipment') {
      const equipment = { ...item.equipment, parts: [...(item.equipment.parts || [])] };
      equipment.parts[item.partIndex] = { ...equipment.parts[item.partIndex], ...edit };
      onSave('equipment', equipment);
    } else {
      onSave(item.type, edit);
    }
  }

  return (
    <div className="scrim show" onMouseDown={onClose}>
      <section className="sheet show" onMouseDown={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="sheet-scroll">
          <div className="sh-head">
            <div className={`ic cat-${item.type}`}><ItemIcon type={item.type} size={22} /></div>
            <div><b>{item.name}</b><div className="meta">{CAT_LABEL[item.type]} · {item.category} · 마지막: {lastActivity(item, logs)}</div></div>
            <button className={`sh-fav ${isFav ? 'on' : ''}`} onClick={onToggleFav} aria-label={isFav ? '즐겨찾기 해제' : '즐겨찾기 추가'}>
              <Star size={18} />
            </button>
            <button className="sh-close" onClick={onClose} aria-label="닫기"><X size={17} /></button>
          </div>

          <div className="readout"><span className="k">남은 양</span>
            <span className="v">{round(item.qty)}<small>{item.unit}</small></span></div>

          <div className="toggle">
            <button className={`out ${mode === 'out' ? 'on' : ''}`} onClick={() => setMode('out')}><Minus size={16} />출고</button>
            <button className={`in ${mode === 'in' ? 'on' : ''}`} onClick={() => setMode('in')}><Plus size={16} />입고</button>
          </div>

          <div className="stepper">
            <button onClick={() => bump(-1)} aria-label="줄이기"><Minus size={22} /></button>
            <div className="amt"><input value={amount} inputMode="decimal"
              onChange={(e) => setAmount(e.target.value)} /><span>{item.unit}</span></div>
            <button onClick={() => bump(1)} aria-label="늘리기"><Plus size={22} /></button>
          </div>
          <div className="presets">
            {presets.map((v) => <button key={v} onClick={() => setAmount(v)}>{v} {item.unit}</button>)}
          </div>

          {over && (
            <div className="over-warn">
              현재 재고({round(item.qty)} {item.unit})보다 많습니다.
              <button onClick={() => setAmount(round(item.qty))}>재고 전량 {round(item.qty)} {item.unit}</button>
            </div>
          )}

          <textarea className="memo" rows="2" value={memo} onChange={(e) => setMemo(e.target.value)}
            placeholder="시험번호·메모 (선택) — 예: 24-시험-0412" />

          <button className="more" onClick={() => setShowDetail((s) => !s)}>
            <span>상세 정보 — 폐기일·시험실·이력</span>
            <ChevronDown size={18} style={{ transform: showDetail ? 'rotate(180deg)' : '', transition: 'transform .2s' }} />
          </button>

          {showDetail && (
            <div className="detail">
              {!editing ? (
                <>
                  {item.photo && (
                    <div className="item-photo"><img src={item.photo} alt={`${item.name} 사진`} loading="lazy" decoding="async" /></div>
                  )}
                  <SpecList item={item} />
                  <div className="label" style={{ margin: '14px 2px 8px' }}>입출고 이력</div>
                  {history.length ? (
                    <div className="hist">
                      {history.map((l) => <LogRow key={l._docId || `${l.item}-${l.time}`} log={l} compact />)}
                    </div>
                  ) : <EmptyState small title="이력이 없습니다" text="첫 기록을 남겨보세요." />}
                </>
              ) : (
                <div className="edit-block">
                  {edit && item.type === 'chemical' && <ChemicalEditor edit={edit} set={(f, v) => setEdit((c) => ({ ...c, [f]: v }))} teamMembers={teamMembers} chemCats={chemCats} zones={zones} onAddChemCat={onAddChemCat} onAddZone={onAddZone} />}
                  {edit && item.type === 'consumable' && <ConsumableEditor edit={edit} set={(f, v) => setEdit((c) => ({ ...c, [f]: v }))} categories={categories} onAddCategory={onAddCategory} />}
                  {edit && item.type === 'equipment' && <EquipmentEditor edit={edit} set={(f, v) => setEdit((c) => ({ ...c, [f]: v }))} />}
                  <div className="dbtns">
                    <button onClick={() => setEditing(false)}>취소</button>
                    <button className="dark" onClick={saveEdit}><Check size={16} />저장</button>
                  </div>
                  {item.type !== 'equipment' && (
                    <button className="del" onClick={() => onDelete(item)}><Trash2 size={15} />이 품목 삭제</button>
                  )}
                </div>
              )}
            </div>
          )}

          {!editing && (
            <>
              <button className={`confirm ${mode === 'in' ? 'in' : ''}`} onClick={commit} disabled={over}>
                {over ? '재고 부족' : mode === 'out' ? '출고 기록' : '입고 기록'}
              </button>
              <div className="quick-acts">
                <button onClick={() => { setShowDetail(true); setEditing(true); }}><Pencil size={16} />정보 수정</button>
                <button className="danger" onClick={() => onDelete(item)}><Trash2 size={16} />삭제</button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function SpecList({ item }) {
  let rows = [];
  if (item.type === 'chemical') {
    rows = [
      ['입고일', formatDate(item.purchased)], ['개봉일', formatDate(item.opened)],
      ['폐기예정', disposalText(item)], ['시험실', item.storageZone || '미지정'],
      ['취급자', item.owner], ['위험도', item.hazardClass || '미지정'], ['사용용도', item.purpose || '미기록'],
      ['비고', item.note || '-'],
    ];
  } else if (item.type === 'consumable') {
    rows = [
      ['품목코드', item.code || '미입력'], ['규격', item.spec || '미입력'],
      ['위치', item.location || '미입력'], ['용도', item.purpose || '미기록'],
    ];
  } else {
    rows = [
      ['장비', item.category], ['필요/보유', `${item.need} / ${item.qty}`],
      ['품목코드', item.code || '-'], ['Serial', item.serial || '-'],
    ];
  }
  return (
    <dl className="spec">
      {rows.map(([k, v]) => {
        const warn = String(v).includes('지났') || v === '미지정' || v === '미입력' || v === '미기록';
        return <div key={k} className="spec-row"><dt>{k}</dt><dd className={warn ? 'warnv' : ''}>{v}</dd></div>;
      })}
    </dl>
  );
}

function disposalText(item) {
  const left = daysUntil(item.disposed);
  if (left === null) return formatDate(item.disposed);
  if (left < 0) return `${Math.abs(left)}일 경과`;
  return `D-${left} (${item.disposed})`;
}

/* ------------------------------------------------------------------ editors */
function ChemicalEditor({ edit, set, teamMembers = TEAM_MEMBERS, chemCats = CHEMICAL_CATEGORIES, zones = STORAGE_ZONES, onAddChemCat, onAddZone }) {
  return (
    <div className="form-grid">
      <label><span>약품명</span><input value={edit.name || ''} onChange={(e) => set('name', e.target.value)} /></label>
      <div className="grid-2">
        <label><span>분류</span><SelectAddable value={edit.cat || '기타'} onChange={(v) => set('cat', v)} options={chemCats} onAdd={onAddChemCat} addLabel="+ 새 분류 추가" /></label>
        <label><span>취급자</span><select value={edit.handler || '-'} onChange={(e) => set('handler', e.target.value)}><option>-</option>{teamMembers.map((m) => <option key={m}>{m}</option>)}</select></label>
      </div>
      <div className="grid-2">
        <label><span>수량</span><input value={edit.qty || ''} onChange={(e) => set('qty', e.target.value)} /></label>
        <label><span>위험도</span><input value={edit.hazardClass || ''} onChange={(e) => set('hazardClass', e.target.value)} placeholder="예: 부식성" /></label>
      </div>
      <div className="grid-3">
        <label><span>입고일</span><input type="date" value={edit.purchased !== '-' ? edit.purchased || '' : ''} onChange={(e) => set('purchased', e.target.value || '-')} /></label>
        <label><span>개봉일</span><input type="date" value={edit.opened !== '-' ? edit.opened || '' : ''} onChange={(e) => { set('opened', e.target.value || '-'); if (e.target.value && (!edit.disposed || edit.disposed === '-')) set('disposed', addDays(e.target.value, 365)); }} /></label>
        <label><span>폐기예정</span><input type="date" value={edit.disposed !== '-' ? edit.disposed || '' : ''} onChange={(e) => set('disposed', e.target.value || '-')} /></label>
      </div>
      <label><span>시험실</span><SelectAddable value={edit.storageZone || ''} onChange={(v) => set('storageZone', v)} options={zones} placeholder="선택" onAdd={onAddZone} addLabel="+ 새 시험실 추가" /></label>
      <label><span>사용용도</span><textarea rows="2" value={edit.purpose || ''} onChange={(e) => set('purpose', e.target.value)} /></label>
      <label><span>비고</span><input value={edit.note || ''} onChange={(e) => set('note', e.target.value)} placeholder="예: 라벨 미부착, 폐기 확인" /></label>
      <PhotoField value={edit.photo || ''} onChange={(v) => set('photo', v)} />
    </div>
  );
}

function ConsumableEditor({ edit, set, categories, onAddCategory }) {
  return (
    <div className="form-grid">
      <label><span>품명</span><input value={edit.n || ''} onChange={(e) => set('n', e.target.value)} /></label>
      <div className="grid-2">
        <label><span>카테고리</span><SelectAddable value={edit.catId || 'etc'} onChange={(v) => set('catId', v)} options={categories.filter((c) => c.type !== 'equipment').map((c) => ({ value: c.id, label: c.label }))} onAdd={onAddCategory} addLabel="+ 새 카테고리 추가" /></label>
        <label><span>세부 분류</span><input value={edit.cat || ''} onChange={(e) => set('cat', e.target.value)} /></label>
      </div>
      <div className="grid-3">
        <label><span>수량</span><input type="number" value={edit.qty ?? 0} onChange={(e) => set('qty', Number(e.target.value))} /></label>
        <label><span>단위</span><input value={edit.unit || 'EA'} onChange={(e) => set('unit', e.target.value)} /></label>
        <label><span>품목코드</span><input value={edit.code || ''} onChange={(e) => set('code', e.target.value)} /></label>
      </div>
      <label><span>위치</span><input value={edit.location || ''} onChange={(e) => set('location', e.target.value)} placeholder="예: 시약장 하단" /></label>
      <label><span>용도·비고</span><textarea rows="2" value={edit.purpose || ''} onChange={(e) => set('purpose', e.target.value)} /></label>
      <PhotoField value={edit.photo || ''} onChange={(v) => set('photo', v)} />
    </div>
  );
}

function EquipmentEditor({ edit, set }) {
  return (
    <div className="form-grid">
      <label><span>부품명</span><input value={edit.n || ''} onChange={(e) => set('n', e.target.value)} /></label>
      <div className="grid-3">
        <label><span>필요</span><input type="number" value={edit.need ?? 0} onChange={(e) => set('need', Number(e.target.value))} /></label>
        <label><span>보유</span><input type="number" value={edit.have ?? 0} onChange={(e) => set('have', Number(e.target.value))} /></label>
        <label><span>단가</span><input type="number" value={edit.price ?? 0} onChange={(e) => set('price', Number(e.target.value))} /></label>
      </div>
      <label><span>품목코드</span><input value={edit.code || ''} onChange={(e) => set('code', e.target.value)} /></label>
    </div>
  );
}

/* 사진 촬영/선택 입력 (등록·수정 공통) */
function PhotoField({ value, onChange }) {
  async function handle(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { onChange(await readImageResized(file)); } catch { /* 변환 실패 시 무시 */ }
    e.target.value = '';
  }
  return (
    <div className="photo-field">
      <span>사진</span>
      {value ? (
        <div className="photo-preview">
          <img src={value} alt="품목 사진" />
          <button type="button" className="photo-remove" onClick={() => onChange('')} aria-label="사진 삭제"><X size={15} /></button>
        </div>
      ) : (
        <div className="photo-actions">
          <label className="photo-btn">
            <Camera size={17} />촬영
            <input type="file" accept="image/*" capture="environment" onChange={handle} hidden />
          </label>
          <label className="photo-btn ghost">
            <Plus size={16} />앨범에서 선택
            <input type="file" accept="image/*" onChange={handle} hidden />
          </label>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ new item */
function NewItemModal({ currentUser, categories, equipmentList = [], teamMembers = TEAM_MEMBERS, zones = [], chemCats = [], onAddZone, onAddChemCat, onAddCategory, onAddEquipment, onClose, onSubmit }) {
  const [form, setForm] = useState({
    type: 'chemical', name: '', qty: 1, unit: 'EA', handler: currentUser, cat: '기타',
    catId: 'etc', purchased: todayKey(), opened: '', disposed: '', purpose: '', storageZone: '',
    location: '', code: '', photo: '', need: 1, serial: '', equipId: equipmentList[0]?._docId || '',
  });
  const set = (f, v) => setForm((c) => ({ ...c, [f]: v }));
  function submit() {
    if (!form.name.trim()) return;
    if (form.type === 'equipment' && !form.equipId) return;
    onSubmit(form);
  }
  const isEquip = form.type === 'equipment';
  return (
    <div className="scrim show modal" onMouseDown={onClose}>
      <section className="modal-card" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sh-head">
          <div className="modal-head-tt"><span className="eyebrow">새로 등록</span><b>품목 추가</b></div>
          <button className="sh-close" onClick={onClose} aria-label="닫기"><X size={18} /></button>
        </div>
        <div className="modal-body">
          <Segmented
            value={form.type}
            options={[{ id: 'chemical', label: '약품' }, { id: 'consumable', label: '일반 소모품' }, { id: 'equipment', label: '장비 소모품' }]}
            onChange={(v) => set('type', v)}
          />
          <div className="form-grid">
            {isEquip && (
              <label><span>장비 선택</span>
                <SelectAddable
                  value={form.equipId} onChange={(v) => set('equipId', v)}
                  options={equipmentList.map((eq) => ({ value: eq._docId, label: eq.name }))}
                  placeholder={equipmentList.length ? null : '등록된 장비 없음'}
                  onAdd={onAddEquipment} addLabel="+ 새 장비 추가"
                />
              </label>
            )}
            <label><span>{isEquip ? '소모품명 (예: Outer Filter QUARTZ)' : '품명'}</span><input autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} /></label>
            {isEquip ? (
              <>
                <div className="grid-2">
                  <label><span>필요 수량</span><input type="number" min="0" value={form.need} onChange={(e) => set('need', Number(e.target.value))} /></label>
                  <label><span>보유 수량</span><input type="number" min="0" value={form.qty} onChange={(e) => set('qty', Number(e.target.value))} /></label>
                </div>
                <div className="grid-2">
                  <label><span>품목코드</span><input value={form.code} onChange={(e) => set('code', e.target.value)} /></label>
                  <label><span>SERIAL</span><input value={form.serial} onChange={(e) => set('serial', e.target.value)} /></label>
                </div>
              </>
            ) : (
              <div className="grid-2">
                <label><span>수량</span><input type="number" min="0" value={form.qty} onChange={(e) => set('qty', Number(e.target.value))} /></label>
                <label><span>단위</span><input value={form.unit} onChange={(e) => set('unit', e.target.value)} /></label>
              </div>
            )}
            {form.type === 'chemical' && (
              <>
                <div className="grid-2">
                  <label><span>분류</span><SelectAddable value={form.cat} onChange={(v) => set('cat', v)} options={chemCats} onAdd={onAddChemCat} addLabel="+ 새 분류 추가" /></label>
                  <label><span>취급자</span><select value={form.handler} onChange={(e) => set('handler', e.target.value)}>{teamMembers.map((m) => <option key={m}>{m}</option>)}</select></label>
                </div>
                <div className="grid-2">
                  <label><span>입고일</span><input type="date" value={form.purchased} onChange={(e) => set('purchased', e.target.value)} /></label>
                  <label><span>개봉일</span><input type="date" value={form.opened} onChange={(e) => { set('opened', e.target.value); if (e.target.value) set('disposed', addDays(e.target.value, 365)); }} /></label>
                </div>
                <label><span>시험실</span><SelectAddable value={form.storageZone} onChange={(v) => set('storageZone', v)} options={zones} placeholder="선택" onAdd={onAddZone} addLabel="+ 새 시험실 추가" /></label>
              </>
            )}
            {form.type === 'consumable' && (
              <>
                <div className="grid-2">
                  <label><span>카테고리</span><SelectAddable value={form.catId} onChange={(v) => set('catId', v)} options={categories.filter((c) => c.type !== 'equipment').map((c) => ({ value: c.id, label: c.label }))} onAdd={onAddCategory} addLabel="+ 새 카테고리 추가" /></label>
                  <label><span>품목코드</span><input value={form.code} onChange={(e) => set('code', e.target.value)} /></label>
                </div>
                <label><span>위치</span><input value={form.location} onChange={(e) => set('location', e.target.value)} /></label>
              </>
            )}
            <label><span>용도·비고</span><textarea rows="2" value={form.purpose} onChange={(e) => set('purpose', e.target.value)} /></label>
            <PhotoField value={form.photo} onChange={(v) => set('photo', v)} />
          </div>
          <button className="confirm" onClick={submit}>등록</button>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ label */
function LabelPreview({ item }) {
  const code = item.key.replace(/[^a-zA-Z0-9]/g, '').slice(-12).toUpperCase();
  const left = item.type === 'chemical' ? daysUntil(item.disposed) : null;
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    // 폰 카메라로 찍으면 이 품목의 기록 시트가 바로 열리는 링크를 QR에 담습니다.
    const link = `${window.location.origin}${window.location.pathname}?item=${encodeURIComponent(item.key)}`;
    QRCode.toDataURL(link, { margin: 1, width: 220, errorCorrectionLevel: 'M' })
      .then(setQrUrl)
      .catch(() => setQrUrl(''));
  }, [item.key]);

  return (
    <div className="label-print-area">
      <div className="label-card">
        <div className="label-top"><strong>{item.type === 'chemical' ? '약품 취급 라벨' : '소모품 관리 라벨'}</strong><span>FITI 의장소재팀</span></div>
        <h2>{item.name}</h2>
        <div className="label-grid">
          <span>관리코드</span><strong className="mono">{code}</strong>
          <span>분류</span><strong>{item.category}</strong>
          <span>수량</span><strong>{item.qtyText}</strong>
          <span>취급자</span><strong>{item.owner || '-'}</strong>
          <span>입고일</span><strong>{formatDate(item.purchased)}</strong>
          <span>개봉일</span><strong>{formatDate(item.opened)}</strong>
          <span>폐기예정</span><strong>{formatDate(item.disposed)}</strong>
          <span>시험실</span><strong>{item.storageZone || item.location || '-'}</strong>
        </div>
        <div className="label-bottom">
          {qrUrl
            ? <img className="qr-img" src={qrUrl} alt={`QR — 찍으면 ${item.name} 기록 화면이 열려요`} />
            : <div className="qr" aria-label={`관리코드 ${code}`}>{code}</div>}
          <div><p>{item.purpose || '사용 목적 미기록'}</p>
            <p className="qr-hint">휴대폰 카메라로 스캔하면 기록 화면이 열립니다.</p>
            {left !== null && <small>{left < 0 ? `폐기기한 ${Math.abs(left)}일 지남` : `폐기 D-${left}`}</small>}</div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ shared bits */
const ItemList = memo(function ItemList({ items, logs, onOpen }) {
  // 품목별 최신 로그를 한 번만 색인 (행마다 전체 로그를 스캔하지 않도록)
  const latest = useMemo(() => {
    const m = new Map();
    for (const l of logs) {
      if (l.itemKey && !m.has(`k:${l.itemKey}`)) m.set(`k:${l.itemKey}`, l);
      if (l.item && !m.has(`n:${l.item}`)) m.set(`n:${l.item}`, l);
    }
    return m;
  }, [logs]);
  if (!items.length) return <EmptyState title="검색 결과가 없습니다" text="다른 검색어로 시도해 보세요." />;
  return (
    <div className="rows">
      {items.map((it) => {
        const hit = latest.get(`k:${it.key}`) || latest.get(`n:${it.name}`);
        const owner = it.owner && it.owner !== '-' ? it.owner.replace(/^의장_/, '') : '';
        const incharge = owner || (hit ? (hit.handler || '').replace(/^의장_/, '') : '') || '미지정';
        return (
          <button key={it.key} className={`row with-thumb s-${it.status}`} onClick={() => onOpen(it.key)}>
            <div className={`edge cat-${it.type}`} />
            <div className={`row-thumb cat-${it.type}`}>
              {it.photo
                ? <img src={it.photo} alt="" loading="lazy" decoding="async" />
                : <span className="ic"><ItemIcon type={it.type} size={18} /></span>}
            </div>
            <div className="body">
              <b>{it.name}</b>
              <div className="meta"><span className={`tag cat-${it.type}`}>{CAT_LABEL[it.type]}</span>담당: {incharge}</div>
            </div>
            <div className="stock">
              <span className="q">{round(it.qty)}</span> <span className="u">{it.unit}</span>
              <div><span className={`pin ${pinTone(it.status)}`}>{friendlyPin(it)}</span></div>
            </div>
          </button>
        );
      })}
    </div>
  );
});

function LogRow({ log, canDelete = false, onDelete, onOpen, compact = false }) {
  const out = log.action === 'use';
  const who = (log.handler || '-').replace(/^의장_/, '');
  const clickable = typeof onOpen === 'function';
  return (
    <div className={`hi ${clickable ? 'tap' : ''}`} onClick={clickable ? onOpen : undefined}>
      <div className={`b ${out ? 'out' : 'in'}`}>{out ? '−' : '+'}</div>
      <div><b>{log.item}</b><span>{compact ? `${who} · ${log.time || log.isoDate}` : (log.memo || '메모 없음')}</span></div>
      <div className="hi-side">
        <span className="q">{out ? '−' : '+'}{log.qty}</span>
        {!compact && <small>{who} · {log.time || log.isoDate}</small>}
      </div>
      {canDelete && <button className="hi-del" onClick={(e) => { e.stopPropagation(); onDelete(); }} aria-label="삭제"><Trash2 size={14} /></button>}
    </div>
  );
}

function SearchBar({ value, onChange, placeholder }) {
  return (
    <div className="search">
      <Search size={19} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete="off" />
    </div>
  );
}

function Segmented({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? 'on' : ''} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

// 옵션 목록 + 맨 아래 "+ 새 항목 추가". options는 문자열 배열 또는 {value,label} 배열.
function SelectAddable({ value, onChange, options, onAdd, placeholder, addLabel = '+ 새 항목 추가' }) {
  async function handle(e) {
    const v = e.target.value;
    if (v === '__add__') {
      const name = window.prompt('새 항목 이름을 입력하세요');
      if (name && name.trim() && onAdd) {
        const picked = await onAdd(name.trim());
        if (picked != null) onChange(picked);
      }
      return;
    }
    onChange(v);
  }
  return (
    <select value={value} onChange={handle}>
      {placeholder != null && <option value="">{placeholder}</option>}
      {options.map((o) => (typeof o === 'string'
        ? <option key={o} value={o}>{o}</option>
        : <option key={o.value} value={o.value}>{o.label}</option>))}
      {onAdd && <option value="__add__">{addLabel}</option>}
    </select>
  );
}

function ItemIcon({ type, size = 18 }) {
  if (type === 'chemical') return <FlaskConical size={size} />;
  if (type === 'equipment') return <Layers size={size} />;
  return <Package size={size} />;
}

function EmptyState({ title, text, small = false }) {
  return (
    <div className={`empty ${small ? 'sm' : ''}`}>
      <b>{title}</b><span>{text}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading">
      <div className="loader" />
      <strong>재고를 불러오는 중입니다</strong>
      <span>약품·소모품·부품·기록을 동기화하고 있습니다.</span>
    </div>
  );
}

function pinTone(status) { return status === 'critical' ? 'crit' : status === 'warning' ? 'warn' : 'ok'; }
function round(n) { const x = Number(n || 0); return Number.isInteger(x) ? x : Math.round(x * 100) / 100; }
