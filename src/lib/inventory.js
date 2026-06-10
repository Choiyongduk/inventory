import { BUILTIN_CONSUMABLE_CATS, DEFAULT_SETTINGS } from '../data/team';

export const STATUS_META = {
  ok: { label: '정상', tone: 'green' },
  warning: { label: '주의', tone: 'amber' },
  critical: { label: '긴급', tone: 'red' },
  info: { label: '확인', tone: 'blue' },
};

export function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function parseDate(value) {
  if (!value || value === '-') return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysUntil(value) {
  const date = parseDate(value);
  if (!date) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((date.getTime() - today.getTime()) / 86400000);
}

export function addDays(value, days) {
  const date = parseDate(value) || new Date();
  date.setDate(date.getDate() + days);
  return todayKey(date);
}

export function parseQuantity(value) {
  if (typeof value === 'number') return { amount: value, unit: 'EA', text: `${value} EA` };
  const text = String(value ?? '0 EA').trim();
  const amountMatch = text.match(/-?\d+(?:\.\d+)?/);
  const amount = amountMatch ? Number(amountMatch[0]) : 0;
  const unitMatch = text.match(/[a-zA-Z가-힣%]+$/);
  const unit = unitMatch ? unitMatch[0] : 'EA';
  return { amount, unit, text };
}

export function quantityText(amount, unit = 'EA') {
  const clean = Number.isInteger(Number(amount)) ? Number(amount) : Number(amount).toFixed(2);
  return `${clean} ${unit}`;
}

export function formatDate(value) {
  return value && value !== '-' ? value : '미기록';
}

export function formatNumber(value) {
  return new Intl.NumberFormat('ko-KR').format(Number(value || 0));
}

export function makeCategoryMap(customCats = []) {
  return [...BUILTIN_CONSUMABLE_CATS, ...customCats].reduce((acc, cat) => {
    acc[cat.id] = cat;
    return acc;
  }, {});
}

function chemicalStatus(item, settings) {
  const qty = parseQuantity(item.qty);
  const disposalDays = settings.disposalDays ?? DEFAULT_SETTINGS.disposalDays;
  const lowQty = settings.lowQty ?? DEFAULT_SETTINGS.lowQty;
  const left = daysUntil(item.disposed);
  const missingRequired = !item.purchased || item.purchased === '-' || !item.handler || item.handler === '-';

  if (qty.amount <= 0) return { status: 'critical', reason: '재고 없음' };
  if (left !== null && left < 0) return { status: 'critical', reason: `폐기 ${Math.abs(left)}일 초과` };
  if (left !== null && left <= disposalDays) return { status: 'warning', reason: `폐기 D-${left}` };
  if (qty.amount <= lowQty) return { status: 'warning', reason: '저재고' };
  if (missingRequired) return { status: 'warning', reason: '라벨 정보 확인' };
  return { status: 'ok', reason: '사용 가능' };
}

function consumableStatus(item, settings) {
  const qty = Number(item.qty ?? 0);
  const lowQty = settings.lowQty ?? DEFAULT_SETTINGS.lowQty;
  if (qty <= 0) return { status: 'critical', reason: '재고 없음' };
  if (qty <= lowQty) return { status: 'warning', reason: '보충 필요' };
  return { status: 'ok', reason: '사용 가능' };
}

function equipmentStatus(part) {
  const have = Number(part.have ?? 0);
  const need = Number(part.need ?? 0);
  if (need > 0 && have <= 0) return { status: 'critical', reason: '필수 부품 없음' };
  if (need > 0 && have < need) return { status: 'warning', reason: `필요 ${need - have}개 부족` };
  return { status: 'ok', reason: '확보' };
}

export function normalizeInventory({ chemicals = [], consumables = [], ciEquip = [], customCats = [], settings = DEFAULT_SETTINGS }) {
  const catMap = makeCategoryMap(customCats);
  const chemicalRows = chemicals.map((chemical) => {
    const qty = parseQuantity(chemical.qty);
    const status = chemicalStatus(chemical, settings);
    return {
      key: `chemical:${chemical._docId || chemical.id}`,
      type: 'chemical',
      typeLabel: '약품',
      source: chemical,
      docId: chemical._docId,
      id: chemical.id,
      name: chemical.name || '이름 없음',
      category: chemical.cat || '기타',
      qty: qty.amount,
      unit: qty.unit,
      qtyText: chemical.qty || quantityText(qty.amount, qty.unit),
      owner: chemical.handler || '-',
      purpose: chemical.purpose || '-',
      purchased: chemical.purchased || '-',
      opened: chemical.opened || '-',
      disposed: chemical.disposed || '-',
      msds: chemical.msds || '',
      storageZone: chemical.storageZone || '',
      hazardClass: chemical.hazardClass || '',
      note: chemical.note || '',
      photo: chemical.photo || '',
      ...status,
    };
  });

  const consumableRows = consumables.map((item) => {
    const status = consumableStatus(item, settings);
    const cat = catMap[item.catId] || { label: item.catId || '일반 소모품' };
    return {
      key: `consumable:${item._docId || item.catId + ':' + item.id}`,
      type: 'consumable',
      typeLabel: '일반 소모품',
      source: item,
      docId: item._docId,
      id: item.id,
      catId: item.catId || 'etc',
      name: item.n || '이름 없음',
      category: item.cat || cat.label,
      qty: Number(item.qty ?? 0),
      unit: item.unit || 'EA',
      qtyText: `${Number(item.qty ?? 0)} ${item.unit || 'EA'}`,
      owner: item.handler || '-',
      purpose: item.purpose || item.cat || '-',
      code: item.code || '',
      spec: item.spec || '',
      location: item.location || '',
      photo: item.photo || '',
      ...status,
    };
  });

  const equipmentRows = ciEquip.flatMap((equipment) =>
    (equipment.parts || []).map((part, partIndex) => {
      const status = equipmentStatus(part);
      return {
        key: `equipment:${equipment._docId || equipment.id}:${partIndex}`,
        type: 'equipment',
        typeLabel: '장비 소모품',
        source: part,
        equipment,
        parentDocId: equipment._docId,
        partIndex,
        id: `${equipment.id}-${partIndex}`,
        name: part.n || '부품명 없음',
        category: equipment.name || 'CI 장비',
        qty: Number(part.have ?? 0),
        need: Number(part.need ?? 0),
        unit: 'EA',
        qtyText: `${Number(part.have ?? 0)} / 필요 ${Number(part.need ?? 0)} EA`,
        owner: equipment.lamp || '-',
        purpose: part.code || '-',
        code: part.code || '',
        serial: part.serial || '-',
        price: Number(part.price ?? 0),
        photo: part.photo || '',
        ...status,
      };
    }),
  );

  return [...chemicalRows, ...consumableRows, ...equipmentRows].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2, ok: 3 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return a.name.localeCompare(b.name, 'ko');
  });
}

export function calculateInsights(inventory, logs) {
  const today = todayKey();
  const month = today.slice(0, 7);
  const chemicalRows = inventory.filter((item) => item.type === 'chemical');
  const labelReady = chemicalRows.filter((item) => item.purchased !== '미기록' && item.purchased !== '-' && item.owner !== '-').length;
  const score = chemicalRows.length ? Math.round((labelReady / chemicalRows.length) * 100) : 100;
  const todayLogs = logs.filter((log) => (log.isoDate || '').startsWith(today));
  const monthLogs = logs.filter((log) => (log.isoDate || '').startsWith(month));
  const activeUsers = new Set(monthLogs.map((log) => log.handler).filter(Boolean));
  const movementByItem = logs.reduce((acc, log) => {
    if (log.action === 'use') acc[log.item] = (acc[log.item] || 0) + 1;
    return acc;
  }, {});

  return {
    total: inventory.length,
    chemicals: chemicalRows.length,
    consumables: inventory.filter((item) => item.type === 'consumable').length,
    equipmentParts: inventory.filter((item) => item.type === 'equipment').length,
    critical: inventory.filter((item) => item.status === 'critical').length,
    warning: inventory.filter((item) => item.status === 'warning').length,
    ok: inventory.filter((item) => item.status === 'ok').length,
    todayLogs: todayLogs.length,
    monthIn: monthLogs.filter((log) => log.action === 'add').length,
    monthOut: monthLogs.filter((log) => log.action === 'use').length,
    activeUsers: activeUsers.size,
    labelScore: score,
    topUsed: Object.entries(movementByItem)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count })),
  };
}

const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

function choseongOf(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) out += CHOSEONG[Math.floor((code - 0xac00) / 588)];
    else out += ch;
  }
  return out;
}

// "ㅇㅅㅌ" → 아세톤. 초성만 친 검색어도, 일반 검색어도 매칭합니다.
export function koreanMatch(haystack, query) {
  const h = haystack.toLowerCase();
  const q = query.toLowerCase();
  if (h.includes(q)) return true;
  const isChoseongQuery = [...query].every((ch) => CHOSEONG.includes(ch) || ch === ' ');
  if (isChoseongQuery && query.trim()) return choseongOf(haystack).includes(query.replace(/\s/g, ''));
  return false;
}

export function filterInventory(inventory, { query = '', type = 'all', status = 'all' }) {
  const q = query.trim();
  return inventory.filter((item) => {
    const typeOk = type === 'all' || item.type === type;
    const statusOk = status === 'all' || item.status === status;
    const haystack = [item.name, item.category, item.owner, item.purpose, item.code, item.storageZone]
      .filter(Boolean)
      .join(' ');
    const queryOk = !q || koreanMatch(haystack, q);
    return typeOk && statusOk && queryOk;
  });
}

export function makeMovementPayload({ item, direction, amount, unit, handler, memo }) {
  const now = new Date();
  return {
    item: item.name,
    itemKey: item.key,
    itemType: item.type,
    action: direction === 'out' ? 'use' : 'add',
    qty: quantityText(amount, unit || item.unit),
    handler,
    memo: memo || '',
    time: `${now.getMonth() + 1}/${now.getDate()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
    isoDate: todayKey(now),
  };
}

export function applyQuantityDelta(item, direction, amount, unit) {
  const sign = direction === 'out' ? -1 : 1;
  const next = Math.max(0, Number(item.qty || 0) + sign * Number(amount || 0));
  if (item.type === 'chemical') {
    return { ...item.source, qty: quantityText(next, unit || item.unit) };
  }
  if (item.type === 'consumable') {
    return { ...item.source, qty: next, unit: unit || item.unit };
  }
  if (item.type === 'equipment') {
    const equipment = { ...item.equipment, parts: [...(item.equipment.parts || [])] };
    equipment.parts[item.partIndex] = { ...equipment.parts[item.partIndex], have: next };
    return equipment;
  }
  return item.source;
}

// 엑셀에서 바로 열리는 CSV (UTF-8 BOM 포함 → 한글 안 깨짐)
export function downloadCsv(filename, headers, rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
