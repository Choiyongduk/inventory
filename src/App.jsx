import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  FileText,
  FlaskConical,
  Home,
  Layers,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  Trash2,
  UserRound,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  addMovementLog,
  deleteChemical,
  deleteConsumableItem,
  deleteMovementLog,
  exportCollectionCounts,
  saveChemical,
  saveConsumableItem,
  saveEquipment,
  saveTeamSettings,
  subscribeInventory,
} from './firebase';
import {
  BUILTIN_CONSUMABLE_CATS,
  CHEMICAL_CATEGORIES,
  DEFAULT_SETTINGS,
  MANAGEMENT_RULES,
  STORAGE_KEYS,
  STORAGE_ZONES,
  TEAM_MEMBERS,
} from './data/team';
import {
  addDays,
  applyQuantityDelta,
  calculateInsights,
  daysUntil,
  downloadJson,
  filterInventory,
  formatDate,
  formatNumber,
  makeMovementPayload,
  normalizeInventory,
  quantityText,
  STATUS_META,
  todayKey,
} from './lib/inventory';

const NAV_ITEMS = [
  { id: 'dashboard', label: '대시보드', icon: Home },
  { id: 'inventory', label: '재고', icon: Boxes },
  { id: 'ledger', label: '대장', icon: ClipboardList },
  { id: 'labels', label: '라벨', icon: Tag },
  { id: 'settings', label: '설정', icon: Settings },
];

const TYPE_FILTERS = [
  { id: 'all', label: '전체' },
  { id: 'chemical', label: '화학물질' },
  { id: 'consumable', label: '소모품' },
  { id: 'equipment', label: 'CI 부품' },
];

const STATUS_FILTERS = [
  { id: 'all', label: '전체 상태' },
  { id: 'critical', label: '긴급' },
  { id: 'warning', label: '주의' },
  { id: 'ok', label: '정상' },
];

function useLocalStorageState(key, initialValue) {
  const [value, setValue] = useState(() => {
    try {
      return window.localStorage.getItem(key) || initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      if (value) window.localStorage.setItem(key, value);
    } catch {
      // localStorage can be disabled in some embedded browsers.
    }
  }, [key, value]);

  return [value, setValue];
}

export default function App() {
  const [currentUser, setCurrentUser] = useLocalStorageState(STORAGE_KEYS.currentUser, '');
  const [activeView, setActiveView] = useLocalStorageState(STORAGE_KEYS.viewMode, 'dashboard');
  const [chemicals, setChemicals] = useState([]);
  const [ciEquip, setCiEquip] = useState([]);
  const [consumables, setConsumables] = useState([]);
  const [customCats, setCustomCats] = useState([]);
  const [logs, setLogs] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [online, setOnline] = useState(() => navigator.onLine);
  const [selectedItem, setSelectedItem] = useState(null);
  const [newItemOpen, setNewItemOpen] = useState(false);
  const [labelKey, setLabelKey] = useState('');

  useEffect(() => {
    const cleanup = subscribeInventory({
      onChemicals: (rows) => {
        setChemicals(rows);
        setLoading(false);
      },
      onCi: (rows) => setCiEquip(rows),
      onConsumables: (rows) => setConsumables(rows),
      onCats: (rows) => setCustomCats(rows),
      onLogs: (rows) => setLogs(rows),
      onSettings: (row) => setSettings({ ...DEFAULT_SETTINGS, ...row }),
      onError: (err) => {
        console.error(err);
        setError(err.message || 'Firebase 연결 오류가 발생했습니다.');
        setLoading(false);
      },
    });
    return cleanup;
  }, []);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const inventory = useMemo(
    () => normalizeInventory({ chemicals, consumables, ciEquip, customCats, settings }),
    [chemicals, consumables, ciEquip, customCats, settings],
  );

  const insights = useMemo(() => calculateInsights(inventory, logs), [inventory, logs]);
  const categories = useMemo(() => [...BUILTIN_CONSUMABLE_CATS, ...customCats], [customCats]);

  useEffect(() => {
    if (!labelKey && inventory.length) setLabelKey(inventory[0].key);
  }, [inventory, labelKey]);

  async function handleMovement({ item, direction, amount, unit, memo }) {
    if (!currentUser) return;
    const next = applyQuantityDelta(item, direction, amount, unit);
    const log = makeMovementPayload({ item, direction, amount, unit, handler: currentUser, memo });

    if (item.type === 'chemical') await saveChemical(next);
    if (item.type === 'consumable') await saveConsumableItem(next);
    if (item.type === 'equipment') await saveEquipment(next);
    await addMovementLog(log);
    setSelectedItem(null);
  }

  async function handleSaveItem(itemType, payload) {
    if (itemType === 'chemical') await saveChemical(payload);
    if (itemType === 'consumable') await saveConsumableItem(payload);
    if (itemType === 'equipment') await saveEquipment(payload);
    setSelectedItem(null);
  }

  async function handleDeleteItem(item) {
    if (!window.confirm(`'${item.name}' 항목을 삭제할까요?`)) return;
    if (item.type === 'chemical') await deleteChemical(item.source);
    if (item.type === 'consumable') await deleteConsumableItem(item.source);
    setSelectedItem(null);
  }

  async function handleCreateItem(form) {
    if (form.type === 'chemical') {
      const nextId = Math.max(0, ...chemicals.map((item) => Number(item.id || 0))) + 1;
      await saveChemical({
        id: nextId,
        name: form.name,
        handler: form.handler || currentUser || '-',
        purpose: form.purpose || '-',
        qty: quantityText(form.qty || 0, form.unit || 'EA'),
        cat: form.cat || '기타',
        purchased: form.purchased || todayKey(),
        opened: form.opened || '-',
        disposed: form.disposed || (form.opened ? addDays(form.opened, 365) : '-'),
        msds: form.msds || '',
        storageZone: form.storageZone || '',
        hazardClass: form.hazardClass || '',
      });
      await addMovementLog({
        item: form.name,
        itemType: 'chemical',
        action: 'add',
        qty: quantityText(form.qty || 0, form.unit || 'EA'),
        handler: currentUser,
        memo: '신규 등록',
        time: new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        isoDate: todayKey(),
      });
    } else {
      const nextId = Math.max(0, ...consumables.map((item) => Number(item.id || 0))) + 1;
      await saveConsumableItem({
        id: nextId,
        catId: form.catId || 'etc',
        n: form.name,
        cat: form.cat || '',
        qty: Number(form.qty || 0),
        unit: form.unit || 'EA',
        purpose: form.purpose || '',
        code: form.code || '',
        spec: form.spec || '',
        location: form.location || '',
      });
      await addMovementLog({
        item: form.name,
        itemType: 'consumable',
        action: 'add',
        qty: quantityText(form.qty || 0, form.unit || 'EA'),
        handler: currentUser,
        memo: '신규 등록',
        time: new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        isoDate: todayKey(),
      });
    }
    setNewItemOpen(false);
  }

  async function handleExport() {
    const counts = await exportCollectionCounts();
    downloadJson(`fiti_inventory_${todayKey()}.json`, {
      exportedAt: new Date().toISOString(),
      counts,
      chemicals,
      consumables,
      ciEquip,
      customCats,
      logs,
      settings,
    });
  }

  if (!currentUser) {
    return <UserGate onSelect={setCurrentUser} />;
  }

  const activeMeta = NAV_ITEMS.find((item) => item.id === activeView) || NAV_ITEMS[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">FITI</div>
          <div>
            <strong>의장소재팀</strong>
            <span>재고관리 콘솔</span>
          </div>
        </div>
        <nav className="sidebar-nav" aria-label="주 메뉴">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              className={`nav-item ${activeView === item.id ? 'active' : ''}`}
              onClick={() => setActiveView(item.id)}
            >
              <item.icon size={18} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <StatusDot online={online} />
          <span>{online ? 'Firebase 실시간 동기화' : '오프라인 모드'}</span>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div>
            <span className="eyebrow">FITI Testing & Research Institute</span>
            <h1>{activeMeta.label}</h1>
          </div>
          <div className="topbar-actions">
            <button className="icon-text ghost" onClick={() => setActiveView('settings')}>
              <UserRound size={18} />
              <span>{currentUser}</span>
            </button>
            <button className="icon-text primary" onClick={() => setNewItemOpen(true)}>
              <Plus size={18} />
              <span>신규 등록</span>
            </button>
          </div>
        </header>

        {error && (
          <div className="inline-alert red">
            <AlertTriangle size={18} />
            <span>{error}</span>
            <button onClick={() => setError('')} aria-label="오류 닫기"><X size={16} /></button>
          </div>
        )}

        {loading ? (
          <LoadingState />
        ) : (
          <>
            {activeView === 'dashboard' && (
              <DashboardView
                insights={insights}
                inventory={inventory}
                logs={logs}
                online={online}
                onOpenItem={setSelectedItem}
                onOpenLabels={(item) => {
                  setLabelKey(item.key);
                  setActiveView('labels');
                }}
              />
            )}
            {activeView === 'inventory' && (
              <InventoryView
                inventory={inventory}
                insights={insights}
                onOpenItem={setSelectedItem}
                onOpenLabels={(item) => {
                  setLabelKey(item.key);
                  setActiveView('labels');
                }}
                onCreate={() => setNewItemOpen(true)}
              />
            )}
            {activeView === 'ledger' && (
              <LedgerView logs={logs} currentUser={currentUser} onDeleteLog={deleteMovementLog} />
            )}
            {activeView === 'labels' && (
              <LabelsView inventory={inventory} labelKey={labelKey} onChangeLabelKey={setLabelKey} />
            )}
            {activeView === 'settings' && (
              <SettingsView
                currentUser={currentUser}
                settings={settings}
                setCurrentUser={setCurrentUser}
                onSaveSettings={saveTeamSettings}
                onExport={handleExport}
              />
            )}
          </>
        )}
      </main>

      <nav className="mobile-nav" aria-label="모바일 메뉴">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={activeView === item.id ? 'active' : ''}
            onClick={() => setActiveView(item.id)}
          >
            <item.icon size={19} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <InventoryDrawer
        item={selectedItem}
        currentUser={currentUser}
        categories={categories}
        onClose={() => setSelectedItem(null)}
        onMove={handleMovement}
        onSave={handleSaveItem}
        onDelete={handleDeleteItem}
      />

      {newItemOpen && (
        <NewItemModal
          currentUser={currentUser}
          categories={categories}
          onClose={() => setNewItemOpen(false)}
          onSubmit={handleCreateItem}
        />
      )}
    </div>
  );
}

function UserGate({ onSelect }) {
  return (
    <div className="user-gate">
      <div className="gate-card">
        <div className="brand-mark large">FITI</div>
        <span className="eyebrow">Inventory Operations Console</span>
        <h1>의장소재팀 재고관리</h1>
        <p>사용자를 선택하면 개인 즐겨찾기와 출고 기록 담당자가 자동으로 적용됩니다.</p>
        <div className="member-grid">
          {TEAM_MEMBERS.map((member) => (
            <button key={member} onClick={() => onSelect(member)}>
              <span>{member.slice(-3)}</span>
              {member}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function DashboardView({ insights, inventory, logs, online, onOpenItem, onOpenLabels }) {
  const urgent = inventory.filter((item) => item.status !== 'ok').slice(0, 8);
  const recent = logs.slice(0, 6);

  return (
    <div className="view-stack">
      <section className="dashboard-hero">
        <div>
          <span className="eyebrow">실시간 운영 현황</span>
          <h2>시험 재료, 소모품, 시약을 한 화면에서 통제합니다.</h2>
          <p>PDF 관리방안의 리스트, 라벨, 대장, 보관구역 요구사항을 Firestore 데이터 흐름에 맞춰 반영했습니다.</p>
        </div>
        <div className="sync-card">
          <StatusDot online={online} />
          <strong>{online ? '온라인 동기화 중' : '오프라인'}</strong>
          <span>Firestore 컬렉션 6개 모니터링</span>
        </div>
      </section>

      <section className="kpi-grid">
        <KpiCard icon={Boxes} label="전체 관리 항목" value={formatNumber(insights.total)} sub={`${insights.chemicals}개 화학물질`} />
        <KpiCard icon={Bell} label="주의/긴급" value={formatNumber(insights.warning + insights.critical)} tone="amber" sub={`긴급 ${insights.critical}건`} />
        <KpiCard icon={ClipboardList} label="오늘 입출고" value={formatNumber(insights.todayLogs)} tone="blue" sub={`이번달 출고 ${insights.monthOut}건`} />
        <KpiCard icon={ShieldCheck} label="라벨 관리율" value={`${insights.labelScore}%`} tone="green" sub="입고일/취급자 기준" />
      </section>

      <section className="two-column">
        <Panel title="업무 우선순위" icon={AlertTriangle} action={<span className="panel-count">{urgent.length}건</span>}>
          {urgent.length ? (
            <div className="priority-list">
              {urgent.map((item) => (
                <button key={item.key} className="priority-row" onClick={() => onOpenItem(item)}>
                  <StatusPill status={item.status} label={item.reason} />
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.typeLabel} · {item.category} · {item.qtyText}</span>
                  </div>
                  {item.type === 'chemical' && (
                    <button className="mini-action" onClick={(event) => { event.stopPropagation(); onOpenLabels(item); }}>
                      <Tag size={14} />
                    </button>
                  )}
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={CheckCircle2} title="긴급 조치가 없습니다" text="현재 임계치 기준으로 안정적인 상태입니다." />
          )}
        </Panel>

        <Panel title="최근 입출고" icon={CalendarClock}>
          {recent.length ? (
            <div className="log-list compact">
              {recent.map((log) => <LogRow key={log._docId || `${log.item}-${log.time}`} log={log} />)}
            </div>
          ) : (
            <EmptyState icon={ClipboardList} title="아직 기록이 없습니다" text="재고 이동을 저장하면 대장에 자동 누적됩니다." />
          )}
        </Panel>
      </section>

      <Panel title="관리방안 반영 체크" icon={ShieldCheck}>
        <div className="rules-grid">
          {MANAGEMENT_RULES.map((rule) => (
            <article className="rule-card" key={rule.id}>
              <span>{rule.issue}</span>
              <h3>{rule.title}</h3>
              <ul>
                {rule.checklist.map((item) => <li key={item}>{item}</li>)}
              </ul>
            </article>
          ))}
        </div>
      </Panel>

      <section className="two-column">
        <Panel title="출고 빈도 TOP 5" icon={BarChart3}>
          {insights.topUsed.length ? (
            <div className="bar-list">
              {insights.topUsed.map((item) => (
                <div className="bar-row" key={item.name}>
                  <span>{item.name}</span>
                  <div><i style={{ width: `${Math.min(100, item.count * 18)}%` }} /></div>
                  <strong>{item.count}회</strong>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={BarChart3} title="출고 패턴 수집 중" text="출고 기록이 쌓이면 자주 쓰는 항목이 자동으로 보입니다." />
          )}
        </Panel>
        <Panel title="운영 품질 지표" icon={Database}>
          <div className="quality-grid">
            <QualityMetric label="정상 항목" value={insights.ok} total={insights.total} tone="green" />
            <QualityMetric label="주의 항목" value={insights.warning} total={insights.total} tone="amber" />
            <QualityMetric label="긴급 항목" value={insights.critical} total={insights.total} tone="red" />
          </div>
        </Panel>
      </section>
    </div>
  );
}

function InventoryView({ inventory, insights, onOpenItem, onOpenLabels, onCreate }) {
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const rows = useMemo(() => filterInventory(inventory, { query, type, status }), [inventory, query, type, status]);

  return (
    <div className="view-stack">
      <section className="toolbar-panel">
        <div className="toolbar-title">
          <SlidersHorizontal size={18} />
          <strong>재고 검색과 필터</strong>
          <span>{formatNumber(rows.length)} / {formatNumber(insights.total)}건</span>
        </div>
        <div className="search-field">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="품명, 담당자, 용도, 품목코드, 보관구역 검색" />
        </div>
        <div className="filter-row">
          <SegmentedControl value={type} options={TYPE_FILTERS} onChange={setType} />
          <SegmentedControl value={status} options={STATUS_FILTERS} onChange={setStatus} />
          <button className="icon-text primary" onClick={onCreate}><PackagePlus size={18} />신규 등록</button>
        </div>
      </section>

      <section className="inventory-table-card">
        <div className="table-head">
          <span>상태</span>
          <span>품목</span>
          <span>분류/용도</span>
          <span>수량</span>
          <span>담당</span>
          <span>관리</span>
        </div>
        {rows.length ? rows.map((item) => (
          <div className="table-row" key={item.key} onClick={() => onOpenItem(item)}>
            <span><StatusPill status={item.status} label={item.reason} /></span>
            <span className="item-name-cell">
              <ItemIcon type={item.type} />
              <strong>{item.name}</strong>
              <small>{item.typeLabel}</small>
            </span>
            <span>
              <strong>{item.category}</strong>
              <small>{item.purpose}</small>
            </span>
            <span className="mono qty-cell">{item.qtyText}</span>
            <span>{item.owner}</span>
            <span className="row-actions">
              <button className="mini-action" onClick={(event) => { event.stopPropagation(); onOpenLabels(item); }} title="라벨">
                <Tag size={15} />
              </button>
              <button className="mini-action" onClick={(event) => { event.stopPropagation(); onOpenItem(item); }} title="수정">
                <Pencil size={15} />
              </button>
            </span>
          </div>
        )) : (
          <EmptyState icon={Search} title="검색 결과가 없습니다" text="필터를 줄이거나 다른 검색어를 입력해보세요." />
        )}
      </section>
    </div>
  );
}

function LedgerView({ logs, currentUser, onDeleteLog }) {
  const [action, setAction] = useState('all');
  const [owner, setOwner] = useState('all');
  const filtered = logs.filter((log) => {
    const actionOk = action === 'all' || log.action === action;
    const ownerOk = owner === 'all' || (owner === 'me' ? log.handler === currentUser : log.handler === owner);
    return actionOk && ownerOk;
  });
  const owners = Array.from(new Set(logs.map((log) => log.handler).filter(Boolean))).sort();

  return (
    <div className="view-stack">
      <section className="toolbar-panel ledger-toolbar">
        <div className="toolbar-title">
          <ClipboardList size={18} />
          <strong>입출고 대장</strong>
          <span>{formatNumber(filtered.length)}건</span>
        </div>
        <div className="filter-row">
          <SegmentedControl
            value={action}
            options={[{ id: 'all', label: '전체' }, { id: 'add', label: '입고' }, { id: 'use', label: '출고' }]}
            onChange={setAction}
          />
          <select className="select" value={owner} onChange={(event) => setOwner(event.target.value)}>
            <option value="all">전체 담당자</option>
            <option value="me">나만 보기</option>
            {owners.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
          <button className="icon-text ghost" onClick={() => window.print()}><Printer size={18} />인쇄</button>
        </div>
      </section>

      <Panel title="대장 기록" icon={FileText}>
        {filtered.length ? (
          <div className="log-list">
            {filtered.map((log) => (
              <LogRow
                key={log._docId || `${log.item}-${log.time}`}
                log={log}
                canDelete={log.handler === currentUser}
                onDelete={() => onDeleteLog(log)}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon={ClipboardList} title="조건에 맞는 기록이 없습니다" text="필터를 변경하거나 재고 이동을 먼저 저장하세요." />
        )}
      </Panel>
    </div>
  );
}

function LabelsView({ inventory, labelKey, onChangeLabelKey }) {
  const selected = inventory.find((item) => item.key === labelKey) || inventory[0];
  const labelItems = inventory.filter((item) => item.type !== 'equipment');

  return (
    <div className="label-layout">
      <Panel title="라벨 대상" icon={QrCode}>
        <div className="search-stack">
          {labelItems.map((item) => (
            <button
              key={item.key}
              className={`label-target ${selected?.key === item.key ? 'active' : ''}`}
              onClick={() => onChangeLabelKey(item.key)}
            >
              <ItemIcon type={item.type} />
              <span>
                <strong>{item.name}</strong>
                <small>{item.typeLabel} · {item.qtyText}</small>
              </span>
              <StatusPill status={item.status} label={item.reason} />
            </button>
          ))}
        </div>
      </Panel>
      <Panel
        title="출력 미리보기"
        icon={Tag}
        action={<button className="icon-text primary" onClick={() => window.print()}><Printer size={17} />라벨 출력</button>}
      >
        {selected ? <LabelPreview item={selected} /> : <EmptyState icon={Tag} title="라벨 대상이 없습니다" text="먼저 화학물질 또는 소모품을 등록하세요." />}
      </Panel>
    </div>
  );
}

function SettingsView({ currentUser, settings, setCurrentUser, onSaveSettings, onExport }) {
  const [draft, setDraft] = useState(settings);

  useEffect(() => setDraft(settings), [settings]);

  return (
    <div className="view-stack settings-view">
      <section className="two-column">
        <Panel title="사용자" icon={UserRound}>
          <div className="profile-card">
            <div className="avatar-lg">{currentUser.slice(-3)}</div>
            <div>
              <span>현재 담당자</span>
              <strong>{currentUser}</strong>
            </div>
          </div>
          <div className="member-grid small">
            {TEAM_MEMBERS.map((member) => (
              <button key={member} className={member === currentUser ? 'active' : ''} onClick={() => setCurrentUser(member)}>
                {member}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="팀 공통 임계치" icon={Bell}>
          <div className="form-grid one">
            <label>
              <span>화학물질 폐기 경고 D-day</span>
              <input type="number" min="1" max="365" value={draft.disposalDays || 90} onChange={(event) => setDraft({ ...draft, disposalDays: Number(event.target.value) })} />
            </label>
            <label>
              <span>저재고 임계치</span>
              <input type="number" min="0" max="100" value={draft.lowQty ?? 1} onChange={(event) => setDraft({ ...draft, lowQty: Number(event.target.value) })} />
            </label>
            <label>
              <span>라벨 기본 사용기간</span>
              <input type="number" min="30" max="1825" value={draft.labelGraceDays || 365} onChange={(event) => setDraft({ ...draft, labelGraceDays: Number(event.target.value) })} />
            </label>
          </div>
          <button className="icon-text primary full" onClick={() => onSaveSettings(draft)}><Save size={18} />팀 설정 저장</button>
        </Panel>
      </section>

      <Panel title="데이터와 운영 기준" icon={Database}>
        <div className="settings-actions">
          <button className="icon-text ghost" onClick={onExport}><Download size={18} />JSON 백업 다운로드</button>
          <button className="icon-text ghost" onClick={() => window.print()}><Printer size={18} />현재 화면 인쇄</button>
        </div>
        <div className="rules-grid compact-rules">
          {MANAGEMENT_RULES.map((rule) => (
            <article className="rule-card" key={rule.id}>
              <span>{rule.issue}</span>
              <h3>{rule.title}</h3>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function InventoryDrawer({ item, currentUser, categories, onClose, onMove, onSave, onDelete }) {
  const [tab, setTab] = useState('move');
  const [edit, setEdit] = useState(null);

  useEffect(() => {
    if (!item) return;
    if (item.type === 'equipment') {
      const part = item.source;
      setEdit({ ...part, have: item.qty, need: item.need });
    } else {
      setEdit({ ...item.source });
    }
    setTab('move');
  }, [item]);

  if (!item) return null;

  function updateEdit(field, value) {
    setEdit((current) => ({ ...current, [field]: value }));
  }

  function handleSave() {
    if (item.type === 'chemical') onSave('chemical', edit);
    if (item.type === 'consumable') onSave('consumable', { ...edit, catId: edit.catId || item.catId });
    if (item.type === 'equipment') {
      const equipment = { ...item.equipment, parts: [...(item.equipment.parts || [])] };
      equipment.parts[item.partIndex] = { ...equipment.parts[item.partIndex], ...edit };
      onSave('equipment', equipment);
    }
  }

  return (
    <div className="drawer-backdrop" onMouseDown={onClose}>
      <aside className="drawer" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <StatusPill status={item.status} label={item.reason} />
            <h2>{item.name}</h2>
            <span>{item.typeLabel} · {item.category}</span>
          </div>
          <button className="icon-only" onClick={onClose} aria-label="닫기"><X size={20} /></button>
        </header>

        <div className="drawer-tabs">
          <button className={tab === 'move' ? 'active' : ''} onClick={() => setTab('move')}>입출고</button>
          <button className={tab === 'info' ? 'active' : ''} onClick={() => setTab('info')}>정보 수정</button>
          <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>점검</button>
        </div>

        {tab === 'move' && (
          <MovementForm item={item} currentUser={currentUser} onSubmit={onMove} />
        )}

        {tab === 'info' && edit && (
          <div className="drawer-body">
            {item.type === 'chemical' && (
              <ChemicalEditor edit={edit} updateEdit={updateEdit} />
            )}
            {item.type === 'consumable' && (
              <ConsumableEditor edit={edit} updateEdit={updateEdit} categories={categories} />
            )}
            {item.type === 'equipment' && (
              <EquipmentPartEditor edit={edit} updateEdit={updateEdit} />
            )}
            <div className="drawer-actions">
              <button className="icon-text primary" onClick={handleSave}><Save size={18} />저장</button>
              {item.type !== 'equipment' && <button className="icon-text danger" onClick={() => onDelete(item)}><Trash2 size={18} />삭제</button>}
            </div>
          </div>
        )}

        {tab === 'audit' && (
          <div className="drawer-body audit-list">
            <AuditItem ok={item.status !== 'critical'} label="긴급 상태 확인" detail={item.reason} />
            <AuditItem ok={item.qty > 0} label="보유 수량" detail={item.qtyText} />
            {item.type === 'chemical' && (
              <>
                <AuditItem ok={item.purchased && item.purchased !== '-'} label="입고일자" detail={formatDate(item.purchased)} />
                <AuditItem ok={item.owner && item.owner !== '-'} label="취급자" detail={item.owner || '미기록'} />
                <AuditItem ok={Boolean(item.storageZone || item.category)} label="보관구역" detail={item.storageZone || item.category} />
                <AuditItem ok={Boolean(item.msds)} label="MSDS" detail={item.msds || '등록 필요'} />
              </>
            )}
            {item.type === 'consumable' && (
              <AuditItem ok={Boolean(item.location || item.code)} label="식별 정보" detail={item.location || item.code || '위치/품목코드 등록 권장'} />
            )}
          </div>
        )}
      </aside>
    </div>
  );
}

function MovementForm({ item, currentUser, onSubmit }) {
  const [direction, setDirection] = useState('out');
  const [amount, setAmount] = useState(1);
  const [unit, setUnit] = useState(item.unit || 'EA');
  const [memo, setMemo] = useState('');

  useEffect(() => {
    setUnit(item.unit || 'EA');
    setAmount(1);
    setMemo('');
  }, [item]);

  return (
    <div className="drawer-body">
      <div className="stock-summary">
        <span>현재 수량</span>
        <strong className="mono">{item.qtyText}</strong>
      </div>
      <div className="direction-toggle">
        <button className={direction === 'out' ? 'active out' : ''} onClick={() => setDirection('out')}>출고</button>
        <button className={direction === 'in' ? 'active in' : ''} onClick={() => setDirection('in')}>입고</button>
      </div>
      <div className="form-grid two">
        <label>
          <span>수량</span>
          <input type="number" min="0" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} />
        </label>
        <label>
          <span>단위</span>
          <input value={unit} onChange={(event) => setUnit(event.target.value)} />
        </label>
      </div>
      <label className="field-block">
        <span>메모</span>
        <textarea rows="4" value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="시험번호, 목적, 비고를 입력하세요." />
      </label>
      <button
        className={`icon-text full ${direction === 'out' ? 'danger' : 'success'}`}
        onClick={() => onSubmit({ item, direction, amount: Number(amount), unit, memo, handler: currentUser })}
      >
        {direction === 'out' ? <Package size={18} /> : <PackagePlus size={18} />}
        {direction === 'out' ? '출고 저장' : '입고 저장'}
      </button>
    </div>
  );
}

function ChemicalEditor({ edit, updateEdit }) {
  return (
    <div className="form-grid one">
      <label><span>약품명</span><input value={edit.name || ''} onChange={(event) => updateEdit('name', event.target.value)} /></label>
      <div className="form-grid two tight">
        <label><span>분류</span><select value={edit.cat || '기타'} onChange={(event) => updateEdit('cat', event.target.value)}>{CHEMICAL_CATEGORIES.map((cat) => <option key={cat}>{cat}</option>)}</select></label>
        <label><span>취급자</span><select value={edit.handler || '-'} onChange={(event) => updateEdit('handler', event.target.value)}><option>-</option>{TEAM_MEMBERS.map((member) => <option key={member}>{member}</option>)}</select></label>
      </div>
      <div className="form-grid two tight">
        <label><span>수량</span><input value={edit.qty || ''} onChange={(event) => updateEdit('qty', event.target.value)} /></label>
        <label><span>위험도</span><input value={edit.hazardClass || ''} onChange={(event) => updateEdit('hazardClass', event.target.value)} placeholder="예: 부식성, 인화성" /></label>
      </div>
      <div className="form-grid three tight">
        <label><span>입고일</span><input type="date" value={edit.purchased !== '-' ? edit.purchased || '' : ''} onChange={(event) => updateEdit('purchased', event.target.value || '-')} /></label>
        <label><span>개봉일</span><input type="date" value={edit.opened !== '-' ? edit.opened || '' : ''} onChange={(event) => { updateEdit('opened', event.target.value || '-'); if (event.target.value && (!edit.disposed || edit.disposed === '-')) updateEdit('disposed', addDays(event.target.value, 365)); }} /></label>
        <label><span>폐기예정</span><input type="date" value={edit.disposed !== '-' ? edit.disposed || '' : ''} onChange={(event) => updateEdit('disposed', event.target.value || '-')} /></label>
      </div>
      <label><span>보관구역</span><select value={edit.storageZone || ''} onChange={(event) => updateEdit('storageZone', event.target.value)}><option value="">선택</option>{STORAGE_ZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
      <label><span>사용용도</span><textarea rows="3" value={edit.purpose || ''} onChange={(event) => updateEdit('purpose', event.target.value)} /></label>
      <label><span>MSDS URL/파일명</span><input value={edit.msds || ''} onChange={(event) => updateEdit('msds', event.target.value)} /></label>
    </div>
  );
}

function ConsumableEditor({ edit, updateEdit, categories }) {
  return (
    <div className="form-grid one">
      <label><span>품명</span><input value={edit.n || ''} onChange={(event) => updateEdit('n', event.target.value)} /></label>
      <div className="form-grid two tight">
        <label><span>카테고리</span><select value={edit.catId || 'etc'} onChange={(event) => updateEdit('catId', event.target.value)}>{categories.filter((cat) => cat.type !== 'equipment').map((cat) => <option key={cat.id} value={cat.id}>{cat.label}</option>)}</select></label>
        <label><span>세부 분류</span><input value={edit.cat || ''} onChange={(event) => updateEdit('cat', event.target.value)} /></label>
      </div>
      <div className="form-grid three tight">
        <label><span>수량</span><input type="number" value={edit.qty ?? 0} onChange={(event) => updateEdit('qty', Number(event.target.value))} /></label>
        <label><span>단위</span><input value={edit.unit || 'EA'} onChange={(event) => updateEdit('unit', event.target.value)} /></label>
        <label><span>품목코드</span><input value={edit.code || ''} onChange={(event) => updateEdit('code', event.target.value)} /></label>
      </div>
      <label><span>규격</span><input value={edit.spec || ''} onChange={(event) => updateEdit('spec', event.target.value)} /></label>
      <label><span>위치</span><input value={edit.location || ''} onChange={(event) => updateEdit('location', event.target.value)} placeholder="예: 시약장 하단 노란 파일 옆" /></label>
      <label><span>용도/비고</span><textarea rows="3" value={edit.purpose || ''} onChange={(event) => updateEdit('purpose', event.target.value)} /></label>
    </div>
  );
}

function EquipmentPartEditor({ edit, updateEdit }) {
  return (
    <div className="form-grid one">
      <label><span>부품명</span><input value={edit.n || ''} onChange={(event) => updateEdit('n', event.target.value)} /></label>
      <div className="form-grid three tight">
        <label><span>필요 수량</span><input type="number" value={edit.need ?? 0} onChange={(event) => updateEdit('need', Number(event.target.value))} /></label>
        <label><span>보유 수량</span><input type="number" value={edit.have ?? 0} onChange={(event) => updateEdit('have', Number(event.target.value))} /></label>
        <label><span>단가</span><input type="number" value={edit.price ?? 0} onChange={(event) => updateEdit('price', Number(event.target.value))} /></label>
      </div>
      <label><span>품목코드</span><input value={edit.code || ''} onChange={(event) => updateEdit('code', event.target.value)} /></label>
      <label><span>Serial</span><input value={edit.serial || ''} onChange={(event) => updateEdit('serial', event.target.value)} /></label>
    </div>
  );
}

function NewItemModal({ currentUser, categories, onClose, onSubmit }) {
  const [form, setForm] = useState({
    type: 'chemical',
    name: '',
    qty: 1,
    unit: 'EA',
    handler: currentUser,
    cat: '기타',
    catId: 'etc',
    purchased: todayKey(),
    opened: '',
    disposed: '',
    purpose: '',
    storageZone: '',
  });

  function setField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function submit() {
    if (!form.name.trim()) return;
    onSubmit(form);
  }

  return (
    <div className="drawer-backdrop modal-backdrop" onMouseDown={onClose}>
      <section className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <span className="eyebrow">New Inventory</span>
            <h2>신규 항목 등록</h2>
          </div>
          <button className="icon-only" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="drawer-body">
          <SegmentedControl
            value={form.type}
            options={[{ id: 'chemical', label: '화학물질' }, { id: 'consumable', label: '소모품' }]}
            onChange={(value) => setField('type', value)}
          />
          <div className="form-grid one">
            <label><span>품명</span><input autoFocus value={form.name} onChange={(event) => setField('name', event.target.value)} /></label>
            <div className="form-grid two tight">
              <label><span>수량</span><input type="number" min="0" value={form.qty} onChange={(event) => setField('qty', Number(event.target.value))} /></label>
              <label><span>단위</span><input value={form.unit} onChange={(event) => setField('unit', event.target.value)} /></label>
            </div>
            {form.type === 'chemical' ? (
              <>
                <div className="form-grid two tight">
                  <label><span>분류</span><select value={form.cat} onChange={(event) => setField('cat', event.target.value)}>{CHEMICAL_CATEGORIES.map((cat) => <option key={cat}>{cat}</option>)}</select></label>
                  <label><span>취급자</span><select value={form.handler} onChange={(event) => setField('handler', event.target.value)}>{TEAM_MEMBERS.map((member) => <option key={member}>{member}</option>)}</select></label>
                </div>
                <div className="form-grid three tight">
                  <label><span>입고일</span><input type="date" value={form.purchased} onChange={(event) => setField('purchased', event.target.value)} /></label>
                  <label><span>개봉일</span><input type="date" value={form.opened} onChange={(event) => { setField('opened', event.target.value); if (event.target.value) setField('disposed', addDays(event.target.value, 365)); }} /></label>
                  <label><span>폐기예정</span><input type="date" value={form.disposed} onChange={(event) => setField('disposed', event.target.value)} /></label>
                </div>
                <label><span>보관구역</span><select value={form.storageZone} onChange={(event) => setField('storageZone', event.target.value)}><option value="">선택</option>{STORAGE_ZONES.map((zone) => <option key={zone}>{zone}</option>)}</select></label>
              </>
            ) : (
              <>
                <div className="form-grid two tight">
                  <label><span>카테고리</span><select value={form.catId} onChange={(event) => setField('catId', event.target.value)}>{categories.filter((cat) => cat.type !== 'equipment').map((cat) => <option key={cat.id} value={cat.id}>{cat.label}</option>)}</select></label>
                  <label><span>세부 분류</span><input value={form.cat} onChange={(event) => setField('cat', event.target.value)} /></label>
                </div>
                <label><span>위치</span><input value={form.location || ''} onChange={(event) => setField('location', event.target.value)} /></label>
                <label><span>품목코드</span><input value={form.code || ''} onChange={(event) => setField('code', event.target.value)} /></label>
              </>
            )}
            <label><span>사용용도/비고</span><textarea rows="3" value={form.purpose} onChange={(event) => setField('purpose', event.target.value)} /></label>
          </div>
          <button className="icon-text primary full" onClick={submit}><Plus size={18} />등록</button>
        </div>
      </section>
    </div>
  );
}

function LabelPreview({ item }) {
  const code = item.key.replace(/[^a-zA-Z0-9]/g, '').slice(-12).toUpperCase();
  const expireLeft = item.type === 'chemical' ? daysUntil(item.disposed) : null;

  return (
    <div className="label-print-area">
      <div className="label-card-preview">
        <div className="label-topline">
          <strong>{item.type === 'chemical' ? '화학물질 취급 라벨' : '소모품 관리 라벨'}</strong>
          <span>FITI 의장소재팀</span>
        </div>
        <h2>{item.name}</h2>
        <div className="label-grid">
          <span>관리코드</span><strong className="mono">{code}</strong>
          <span>분류</span><strong>{item.category}</strong>
          <span>수량</span><strong>{item.qtyText}</strong>
          <span>취급자</span><strong>{item.owner || '-'}</strong>
          <span>입고일자</span><strong>{formatDate(item.purchased)}</strong>
          <span>개봉일자</span><strong>{formatDate(item.opened)}</strong>
          <span>폐기예정</span><strong>{formatDate(item.disposed)}</strong>
          <span>보관구역</span><strong>{item.storageZone || item.location || '-'}</strong>
        </div>
        <div className="label-bottom">
          <div className="pseudo-qr" aria-label={`관리코드 ${code}`}>{code}</div>
          <div>
            <StatusPill status={item.status} label={item.reason} />
            <p>{item.purpose || '사용 목적 미기록'}</p>
            {expireLeft !== null && <small>{expireLeft < 0 ? `폐기기한 ${Math.abs(expireLeft)}일 초과` : `폐기 D-${expireLeft}`}</small>}
          </div>
        </div>
      </div>
    </div>
  );
}

function LogRow({ log, canDelete = false, onDelete }) {
  const out = log.action === 'use';
  return (
    <div className="log-row">
      <div className={`log-icon ${out ? 'out' : 'in'}`}>{out ? '-' : '+'}</div>
      <div>
        <strong>{log.item}</strong>
        <span>{log.handler || '-'} · {log.memo || '메모 없음'}</span>
      </div>
      <div className="log-side">
        <StatusPill status={out ? 'critical' : 'ok'} label={`${out ? '출고' : '입고'} ${log.qty}`} />
        <small>{log.time || log.isoDate}</small>
      </div>
      {canDelete && <button className="mini-action" onClick={onDelete}><Trash2 size={14} /></button>}
    </div>
  );
}

function KpiCard({ icon: Icon, label, value, sub, tone = 'neutral' }) {
  return (
    <article className={`kpi-card ${tone}`}>
      <div className="kpi-icon"><Icon size={20} /></div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </article>
  );
}

function QualityMetric({ label, value, total, tone }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div className="quality-row">
      <div><span>{label}</span><strong>{formatNumber(value)}건</strong></div>
      <div className="quality-bar"><i className={tone} style={{ width: `${pct}%` }} /></div>
      <small>{pct}%</small>
    </div>
  );
}

function Panel({ title, icon: Icon, action, children }) {
  return (
    <section className="panel-card">
      <header className="panel-header">
        <div><Icon size={18} /><h2>{title}</h2></div>
        {action}
      </header>
      {children}
    </section>
  );
}

function SegmentedControl({ value, options, onChange }) {
  return (
    <div className="segmented">
      {options.map((option) => (
        <button key={option.id} className={value === option.id ? 'active' : ''} onClick={() => onChange(option.id)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function StatusPill({ status, label }) {
  const meta = STATUS_META[status] || STATUS_META.info;
  return <span className={`status-pill ${meta.tone}`}>{label || meta.label}</span>;
}

function StatusDot({ online }) {
  return online ? <Wifi className="status-dot online" size={17} /> : <WifiOff className="status-dot offline" size={17} />;
}

function ItemIcon({ type }) {
  if (type === 'chemical') return <FlaskConical size={18} />;
  if (type === 'equipment') return <Layers size={18} />;
  return <Package size={18} />;
}

function EmptyState({ icon: Icon, title, text }) {
  return (
    <div className="empty-state">
      <Icon size={34} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="loading-state">
      <div className="loader" />
      <strong>Firebase 데이터를 불러오는 중입니다</strong>
      <span>화학물질, 소모품, CI 부품, 입출고 대장을 동기화하고 있습니다.</span>
    </div>
  );
}

function AuditItem({ ok, label, detail }) {
  return (
    <div className={`audit-item ${ok ? 'ok' : 'warn'}`}>
      {ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
      <div><strong>{label}</strong><span>{detail}</span></div>
    </div>
  );
}
