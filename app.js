'use strict';

const SEED_VERSION = 1;
const DB_NAME = 'room';
const DB_VERSION = 1;
const ZOOM_MIN = 0.1;
const ZOOM_MAX = 4;
const GRID = 48;

const REGIONS = [
  { id: 'xplorr', x: -60, y: -50, w: 1980, h: 1320, title: 'XPLORR', sub: 'capital raise' },
  { id: 'nosis', x: 2400, y: -280, w: 1480, h: 1080, title: 'NOSIS', sub: 'empty' },
  { id: 'qre', x: -1880, y: 280, w: 1480, h: 1080, title: 'QRE', sub: 'empty' },
];

const START = { x: 860, y: 520, scale: 0.68 };

const SEED = () => [
  {
    id: 'note-connect',
    type: 'note',
    x: 24, y: 36, w: 430, h: 168,
    title: 'Connect to see it',
    kicker: 'PRIVATE',
    body: 'Connect to see it.',
  },
  {
    id: 'link-site',
    type: 'link',
    x: 480, y: 524, w: 320, h: 176,
    title: 'Site',
    kicker: 'LIVE',
    links: [
      { href: 'https://xplorr.ai', label: 'xplorr.ai' },
      { href: 'https://nathanfowler.github.io/xplorr/', label: 'nathanfowler.github.io/xplorr' },
    ],
  },
  {
    id: 'doc-market',
    type: 'doc',
    x: 900, y: 816, w: 500, h: 300,
    title: 'Market comps',
    kicker: 'BRIEF · 19 AUG 2026',
    excerpt: 'Closest physical-sample peers are thin. Survey-drone comps are the crowded set investors will still use. No invented figures. Open to read the brief.',
    seedSrc: 'seed/xplorr-market-brief-2026-08-19.md',
  },
];

const viewport = document.getElementById('viewport');
const world = document.getElementById('world');
const zoomReadout = document.getElementById('zoom-readout');
const moreMenu = document.getElementById('more-menu');
const modal = document.getElementById('modal');
const modalBody = document.getElementById('modal-body');
const modalTitle = document.getElementById('modal-title');
const modalKicker = document.getElementById('modal-kicker');
const modalRawBtn = document.getElementById('modal-raw');
const confirmEl = document.getElementById('confirm');

const state = {
  items: [],
  camera: { ...START },
  selected: null,
  editing: null,
  space: false,
  pan: null,
  drag: null,
  modalItem: null,
  modalRaw: false,
  urls: new Map(),
};

let db = null;
let saveTimer = 0;
let camTimer = 0;

function uid(prefix) {
  return (prefix || 'i') + '-' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function screenToWorld(sx, sy) {
  const { x, y, scale } = state.camera;
  return {
    x: (sx - innerWidth / 2) / scale + x,
    y: (sy - innerHeight / 2) / scale + y,
  };
}

function applyCamera() {
  const { x, y, scale } = state.camera;
  const ox = innerWidth / 2 - x * scale;
  const oy = innerHeight / 2 - y * scale;
  world.style.transform = `translate(${ox}px, ${oy}px) scale(${scale})`;
  viewport.style.backgroundPosition = `${ox}px ${oy}px`;
  viewport.style.backgroundSize = `${GRID * scale}px ${GRID * scale}px`;
  zoomReadout.textContent = Math.round(scale * 100) + '%';
}

function persistCameraSoon() {
  clearTimeout(camTimer);
  camTimer = setTimeout(() => kvSet('camera', state.camera), 240);
}

function persistItemsSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistItemsNow, 80);
}

async function persistItemsNow() {
  if (!db) return;
  const tx = db.transaction('items', 'readwrite');
  tx.objectStore('items').clear();
  for (const item of state.items) tx.objectStore('items').put(item);
  await txDone(tx);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('items')) d.createObjectStore('items', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function kvGet(key) {
  return reqToPromise(db.transaction('kv').objectStore('kv').get(key));
}
function kvSet(key, value) {
  const tx = db.transaction('kv', 'readwrite');
  tx.objectStore('kv').put(value, key);
  return txDone(tx);
}
function blobGet(id) {
  return reqToPromise(db.transaction('blobs').objectStore('blobs').get(id));
}
function blobPut(id, blob) {
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put(blob, id);
  return txDone(tx);
}
function blobDel(id) {
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').delete(id);
  return txDone(tx);
}

function objectUrlFor(id, blob) {
  const prev = state.urls.get(id);
  if (prev) URL.revokeObjectURL(prev);
  const url = URL.createObjectURL(blob);
  state.urls.set(id, url);
  return url;
}

async function loadAllItems() {
  const tx = db.transaction('items');
  const all = await reqToPromise(tx.objectStore('items').getAll());
  return all || [];
}

async function seedIfNeeded() {
  const ver = await kvGet('seedVersion');
  const existing = await loadAllItems();
  if (ver === SEED_VERSION && existing.length) {
    state.items = existing;
    await hydrateBlobs(state.items);
    return;
  }
  if (existing.length) {
    state.items = existing;
    await hydrateBlobs(state.items);
    return;
  }
  await applySeed();
}

async function applySeed() {
  const items = SEED();
  await Promise.all(items.map(async (it) => {
    if (it.type === 'doc' && it.seedSrc) {
      try {
        const res = await fetch(it.seedSrc);
        if (res.ok) it.body = await res.text();
        else it.body = it.excerpt || '';
      } catch {
        it.body = it.excerpt || '';
      }
    }
    if (it.type === 'image' && it.seedSrc) {
      try {
        const res = await fetch(it.seedSrc);
        if (res.ok) {
          const blob = await res.blob();
          await blobPut(it.blobId || it.id, blob);
        }
      } catch { /* leave without blob; card still shows title */ }
    }
  }));
  state.items = items;
  await persistItemsNow();
  await kvSet('seedVersion', SEED_VERSION);
  await hydrateBlobs(state.items);
}

async function hydrateBlobs(items) {
  await Promise.all(items.map(async (it) => {
    if (!it.blobId) return;
    const blob = await blobGet(it.blobId);
    if (blob) objectUrlFor(it.blobId, blob);
  }));
}

async function resetSeed() {
  const tx1 = db.transaction(['items', 'blobs'], 'readwrite');
  tx1.objectStore('items').clear();
  tx1.objectStore('blobs').clear();
  await txDone(tx1);
  for (const url of state.urls.values()) URL.revokeObjectURL(url);
  state.urls.clear();
  state.selected = null;
  state.editing = null;
  closeModal();
  await kvSet('seedVersion', 0);
  await applySeed();
  state.camera = { ...START };
  applyCamera();
  persistCameraSoon();
  render();
}

function render() {
  const html = [];
  for (const r of REGIONS) {
    html.push(
      `<div class="region" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px">` +
      `<div class="region-label">${esc(r.id.toUpperCase())}</div>` +
      `<div class="region-title">${esc(r.title)}<span class="region-sub">${esc(r.sub)}</span></div>` +
      `</div>`
    );
  }
  for (const it of state.items) html.push(cardHtml(it));
  world.innerHTML = html;
  bindCards();
}

function cardHtml(it) {
  const sel = it.id === state.selected ? ' selected' : '';
  const drag = state.drag && state.drag.id === it.id ? ' dragging' : '';
  const style = `left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px`;
  const kicker = it.kicker
    ? `<div class="kicker">${esc(it.kicker)}${it.lockedBadge ? '<span class="lock">LOCKED</span>' : ''}</div>`
    : `<div class="kicker">${esc(kindLabel(it))}</div>`;

  if (it.type === 'image') {
    const src = (it.blobId && state.urls.get(it.blobId)) || it.seedSrc || '';
    return `<article class="card card-image${sel}${drag}" data-id="${esc(it.id)}" style="${style}">` +
      (src ? `<img alt="${esc(it.title || '')}" src="${esc(src)}">` : `<div class="excerpt">Image not cached yet.</div>`) +
      `<figcaption>${esc(it.caption || it.title || 'image')}</figcaption></article>`;
  }

  if (state.editing === it.id && it.type === 'note') {
    return `<article class="card card-note${sel}" data-id="${esc(it.id)}" style="${style}">` +
      kicker + `<h3>${esc(it.title || 'Note')}</h3>` +
      `<textarea class="edit" data-edit="${esc(it.id)}">${esc(it.body || '')}</textarea></article>`;
  }

  let body = '';
  if (it.type === 'link') {
    body = `<div class="links">${(it.links || []).map((l) =>
      `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.href)}</a>`
    ).join('')}</div>`;
  } else if (it.type === 'file') {
    body = `<div class="file-meta">${esc(it.mime || 'file')} · ${fmtSize(it.size || 0)}<br>double-click to download</div>`;
  } else if (it.type === 'doc' || it.type === 'deck') {
    body = `<div class="excerpt">${esc(it.excerpt || excerptOf(it.body))}</div>`;
  } else {
    body = `<div class="excerpt">${esc(it.body || '')}</div>`;
  }

  return `<article class="card card-${it.type}${sel}${drag}" data-id="${esc(it.id)}" style="${style}">` +
    kicker + `<h3>${esc(it.title || 'Untitled')}</h3>${body}</article>`;
}

function kindLabel(it) {
  if (it.type === 'note') return 'NOTE';
  if (it.type === 'doc') return 'MEMO';
  if (it.type === 'deck') return 'DECK';
  if (it.type === 'link') return 'LINK';
  if (it.type === 'file') return 'FILE';
  if (it.type === 'image') return 'IMAGE';
  return (it.type || '').toUpperCase();
}

function excerptOf(text) {
  if (!text) return '';
  return String(text).replace(/^#+\s+/gm, '').trim().slice(0, 220);
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function bindCards() {
  for (const el of world.querySelectorAll('.card')) {
    el.addEventListener('pointerdown', onCardDown);
    el.addEventListener('dblclick', onCardDbl);
  }
  const ta = world.querySelector('textarea.edit');
  if (ta) {
    ta.focus();
    ta.addEventListener('pointerdown', (e) => e.stopPropagation());
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        finishEdit();
        e.preventDefault();
      }
      e.stopPropagation();
    });
    ta.addEventListener('input', () => {
      const it = find(state.editing);
      if (it) it.body = ta.value;
    });
    ta.addEventListener('blur', () => finishEdit());
  }
}

function find(id) { return state.items.find((x) => x.id === id); }

function select(id) {
  state.selected = id;
  render();
}

function finishEdit() {
  if (!state.editing) return;
  state.editing = null;
  persistItemsSoon();
  render();
}

function onCardDown(e) {
  if (e.button === 1 || state.space) return;
  if (e.target.closest('a, textarea, button, input')) return;
  const id = e.currentTarget.dataset.id;
  const it = find(id);
  if (!it) return;
  e.stopPropagation();
  e.preventDefault();
  state.selected = id;
  const start = { x: e.clientX, y: e.clientY, ox: it.x, oy: it.y, moved: false };
  state.drag = { id, ...start };
  e.currentTarget.setPointerCapture(e.pointerId);
  render();

  const move = (ev) => {
    const dx = (ev.clientX - start.x) / state.camera.scale;
    const dy = (ev.clientY - start.y) / state.camera.scale;
    if (!start.moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
    start.moved = true;
    it.x = start.ox + dx;
    it.y = start.oy + dy;
    const node = world.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (node) {
      node.style.left = it.x + 'px';
      node.style.top = it.y + 'px';
      node.classList.add('dragging');
    }
  };
  const up = () => {
    viewport.releasePointerCapture?.(e.pointerId);
    viewport.removeEventListener('pointermove', move);
    viewport.removeEventListener('pointerup', up);
    state.drag = null;
    if (start.moved) persistItemsSoon();
    render();
  };
  viewport.addEventListener('pointermove', move);
  viewport.addEventListener('pointerup', up);
}

function onCardDbl(e) {
  if (e.target.closest('a')) return;
  const it = find(e.currentTarget.dataset.id);
  if (!it) return;
  e.preventDefault();
  e.stopPropagation();
  if (it.type === 'note') {
    state.editing = it.id;
    render();
    return;
  }
  openItem(it);
}

async function openItem(it) {
  state.modalItem = it;
  state.modalRaw = false;
  modal.hidden = false;
  modalKicker.textContent = kindLabel(it);
  modalTitle.textContent = it.title || '';
  modalRawBtn.hidden = !(it.type === 'doc' || it.type === 'note');
  modalRawBtn.textContent = 'Raw';
  await fillModal(it);
}

async function fillModal(it) {
  modalBody.className = '';
  if (state.modalRaw && (it.body || it.seedSrc)) {
    modalBody.className = 'raw';
    modalBody.textContent = it.body || '';
    return;
  }
  if (it.type === 'doc' || it.type === 'note') {
    if (!it.body && it.seedSrc) {
      try {
        const res = await fetch(it.seedSrc);
        if (res.ok) {
          it.body = await res.text();
          persistItemsSoon();
        }
      } catch { /* keep empty */ }
    }
    modalBody.className = 'prose';
    modalBody.innerHTML = renderMarkdown(it.body || it.excerpt || '');
    return;
  }
  if (it.type === 'image') {
    const src = (it.blobId && state.urls.get(it.blobId)) || it.seedSrc || '';
    modalBody.innerHTML = src
      ? `<img class="lightbox-img" alt="${esc(it.title || '')}" src="${esc(src)}">`
      : '<p>No image bytes in this browser yet.</p>';
    return;
  }
  if (it.type === 'deck') {
    const figs = [];
    for (const s of it.slides || []) {
      const match = state.items.find((x) => x.seedSrc === s.src);
      const src = (match && match.blobId && state.urls.get(match.blobId)) || s.src;
      figs.push(`<figure><img src="${esc(src)}" alt="${esc(s.caption)}"><figcaption>${esc(s.caption)}</figcaption></figure>`);
    }
    modalBody.innerHTML = `<p class="excerpt" style="color:var(--muted);font-family:var(--ui-sans)"></p><div class="slides">${figs.join('')}</div>`;
    return;
  }
  if (it.type === 'link') {
    modalBody.innerHTML = `<div class="links">${(it.links || []).map((l) =>
      `<a href="${esc(l.href)}" target="_blank" rel="noopener noreferrer">${esc(l.label || l.href)}</a>`
    ).join('')}</div>`;
    return;
  }
  if (it.type === 'file' && it.blobId) {
    const blob = await blobGet(it.blobId);
    if (blob) {
      const url = objectUrlFor(it.blobId, blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = it.title || 'file';
      a.click();
    }
    closeModal();
    return;
  }
  modalBody.textContent = it.body || '';
}

function closeModal() {
  modal.hidden = true;
  state.modalItem = null;
  modalBody.innerHTML = '';
}

function addNoteAt(wx, wy) {
  const it = {
    id: uid('note'),
    type: 'note',
    x: wx - 160,
    y: wy - 40,
    w: 340,
    h: 240,
    title: 'Note',
    kicker: 'NOTE',
    body: '',
  };
  state.items.push(it);
  state.selected = it.id;
  state.editing = it.id;
  persistItemsSoon();
  render();
}

function addLinkAt(wx, wy) {
  const href = prompt('URL');
  if (!href) return;
  let url = href.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let label = url.replace(/^https?:\/\//i, '');
  try { label = new URL(url).hostname + (new URL(url).pathname === '/' ? '' : new URL(url).pathname); } catch { /* keep */ }
  const it = {
    id: uid('link'),
    type: 'link',
    x: wx - 140,
    y: wy - 30,
    w: 320,
    h: 150,
    title: 'Link',
    kicker: 'LINK',
    links: [{ href: url, label }],
  };
  state.items.push(it);
  state.selected = it.id;
  persistItemsSoon();
  render();
}

async function addFilesAt(files, wx, wy) {
  let x = wx - 20;
  let y = wy - 20;
  for (const file of files) {
    const id = uid('file');
    if (file.type.startsWith('image/')) {
      await blobPut(id, file);
      objectUrlFor(id, file);
      state.items.push({
        id, type: 'image', x, y, w: 360, h: 240,
        title: file.name, caption: file.name, mime: file.type, size: file.size, blobId: id,
      });
    } else if (/\.(md|markdown|txt)$/i.test(file.name) || file.type.startsWith('text/')) {
      const text = await file.text();
      const isMd = /\.(md|markdown)$/i.test(file.name);
      state.items.push({
        id, type: isMd ? 'doc' : 'note', x, y, w: 400, h: 280,
        title: file.name, kicker: isMd ? 'DOC' : 'NOTE',
        body: text, excerpt: excerptOf(text), mime: file.type, size: file.size,
      });
    } else {
      await blobPut(id, file);
      state.items.push({
        id, type: 'file', x, y, w: 300, h: 150,
        title: file.name, kicker: 'FILE', mime: file.type || 'application/octet-stream', size: file.size, blobId: id,
      });
    }
    x += 36;
    y += 28;
  }
  persistItemsSoon();
  render();
}

function deleteSelected() {
  if (!state.selected || state.editing) return;
  const it = find(state.selected);
  if (!it) return;
  state.items = state.items.filter((x) => x.id !== it.id);
  if (it.blobId) blobDel(it.blobId);
  if (it.blobId && state.urls.has(it.blobId)) {
    URL.revokeObjectURL(state.urls.get(it.blobId));
    state.urls.delete(it.blobId);
  }
  state.selected = null;
  persistItemsSoon();
  render();
}

function startPan(e) {
  state.pan = { x: e.clientX, y: e.clientY, cx: state.camera.x, cy: state.camera.y };
  viewport.classList.add('panning', 'active');
}

function onPointerMove(e) {
  if (!state.pan) return;
  const s = state.camera.scale;
  state.camera.x = state.pan.cx - (e.clientX - state.pan.x) / s;
  state.camera.y = state.pan.cy - (e.clientY - state.pan.y) / s;
  applyCamera();
}

function endPan() {
  if (!state.pan) return;
  state.pan = null;
  viewport.classList.remove('active');
  if (!state.space) viewport.classList.remove('panning');
  persistCameraSoon();
}

function zoomAt(sx, sy, factor) {
  const before = screenToWorld(sx, sy);
  state.camera.scale = clamp(state.camera.scale * factor, ZOOM_MIN, ZOOM_MAX);
  const after = screenToWorld(sx, sy);
  state.camera.x += before.x - after.x;
  state.camera.y += before.y - after.y;
  applyCamera();
  persistCameraSoon();
}

function animateTo(x, y, scale) {
  const a = { ...state.camera };
  const b = { x, y, scale };
  const t0 = performance.now();
  const dur = 280;
  function step(now) {
    const t = clamp((now - t0) / dur, 0, 1);
    const e = 1 - Math.pow(1 - t, 3);
    state.camera.x = a.x + (b.x - a.x) * e;
    state.camera.y = a.y + (b.y - a.y) * e;
    state.camera.scale = a.scale + (b.scale - a.scale) * e;
    applyCamera();
    if (t < 1) requestAnimationFrame(step);
    else persistCameraSoon();
  }
  requestAnimationFrame(step);
}

function regionCamera(id) {
  const r = REGIONS.find((x) => x.id === id);
  if (!r) return null;
  const pad = 80;
  const vw = Math.max(innerWidth, 320);
  const vh = Math.max(innerHeight, 240);
  const sx = (vw - pad) / r.w;
  const sy = (vh - pad) / r.h;
  return {
    x: r.x + r.w / 2,
    y: r.y + r.h / 2,
    scale: clamp(Math.min(sx, sy), ZOOM_MIN, 1.2),
  };
}

function fitRegion(id, animate) {
  const cam = regionCamera(id);
  if (!cam) return;
  document.querySelectorAll('.jumps button').forEach((b) => b.classList.toggle('on', b.dataset.jump === id));
  if (animate) animateTo(cam.x, cam.y, cam.scale);
  else {
    state.camera = { ...cam };
    applyCamera();
  }
}

function jumpRegion(id) {
  fitRegion(id, true);
}

function renderMarkdown(src) {
  const lines = String(src || '').replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let i = 0;
  let list = null;
  function closeList() {
    if (list) { html += list === 'ol' ? '</ol>' : '</ul>'; list = null; }
  }
  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[\s(])\*([^*]+)\*/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return s;
  }
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      closeList();
      const buf = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++; }
      html += `<pre><code>${esc(buf.join('\n'))}</code></pre>`;
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-/.test(lines[i + 1])) {
      closeList();
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      html += tableHtml(rows, inline);
      continue;
    }
    if (/^---+$/.test(line.trim()) || /^<!--/.test(line)) {
      closeList();
      if (/^---+$/.test(line.trim())) html += '<hr>';
      i++;
      continue;
    }
    const hm = /^(#{1,4})\s+(.*)$/.exec(line);
    if (hm) {
      closeList();
      html += `<h${hm[1].length}>${inline(hm[2])}</h${hm[1].length}>`;
      i++;
      continue;
    }
    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    if (ul) {
      if (list !== 'ul') { closeList(); html += '<ul>'; list = 'ul'; }
      html += `<li>${inline(ul[1])}</li>`;
      i++;
      continue;
    }
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ol) {
      if (list !== 'ol') { closeList(); html += '<ol>'; list = 'ol'; }
      html += `<li>${inline(ol[1])}</li>`;
      i++;
      continue;
    }
    if (line.startsWith('> ')) {
      closeList();
      html += `<blockquote><p>${inline(line.slice(2))}</p></blockquote>`;
      i++;
      continue;
    }
    if (!line.trim()) { closeList(); i++; continue; }
    closeList();
    html += `<p>${inline(line)}</p>`;
    i++;
  }
  closeList();
  return html || '<p></p>';
}

function tableHtml(rows, inline) {
  const cells = (row) => row.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  const head = cells(rows[0]);
  let bodyRows = rows.slice(1);
  if (bodyRows[0] && /^\s*\|?\s*:?-/.test(bodyRows[0])) bodyRows = bodyRows.slice(1);
  let out = '<table><thead><tr>' + head.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>';
  for (const r of bodyRows) {
    out += '<tr>' + cells(r).map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>';
  }
  return out + '</tbody></table>';
}

function onWheel(e) {
  e.preventDefault();
  if (e.ctrlKey) {
    zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.92 : 1.08);
    return;
  }
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
    state.camera.x += (e.shiftKey ? e.deltaY : e.deltaX) / state.camera.scale;
    state.camera.y += (e.shiftKey ? 0 : e.deltaY) / state.camera.scale;
    applyCamera();
    persistCameraSoon();
    return;
  }
  zoomAt(e.clientX, e.clientY, e.deltaY > 0 ? 0.92 : 1.08);
}

function bindUi() {
  viewport.addEventListener('wheel', onWheel, { passive: false });
  viewport.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.card')) return;
    if (e.button === 1 || state.space || e.button === 0) {
      if (e.button === 0 && !state.space && e.target.closest('.card')) return;
      if (e.button === 0 && !state.space) {
        state.selected = null;
        finishEdit();
        startPan(e);
        render();
        return;
      }
      e.preventDefault();
      startPan(e);
    }
  });
  viewport.addEventListener('pointermove', onPointerMove);
  viewport.addEventListener('pointerup', endPan);
  viewport.addEventListener('pointercancel', endPan);
  viewport.addEventListener('dblclick', (e) => {
    if (e.target.closest('.card')) return;
    const w = screenToWorld(e.clientX, e.clientY);
    addNoteAt(w.x, w.y);
  });

  window.addEventListener('dragover', (e) => { e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    const w = screenToWorld(e.clientX, e.clientY);
    addFilesAt(files, w.x, w.y);
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !inField(e)) {
      e.preventDefault();
      state.space = true;
      viewport.classList.add('space', 'panning');
    }
    if (e.key === 'Escape') {
      if (!modal.hidden) { closeModal(); return; }
      if (!confirmEl.hidden) { confirmEl.hidden = true; return; }
      if (state.editing) { finishEdit(); return; }
      state.selected = null;
      moreMenu.hidden = true;
      render();
    }
    if (inField(e)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selected) {
      e.preventDefault();
      deleteSelected();
    }
    if (e.key === 'n' || e.key === 'N') {
      const w = screenToWorld(innerWidth / 2, innerHeight / 2);
      addNoteAt(w.x, w.y);
    }
    if (e.key === '0' || e.key === 'f' || e.key === 'F') jumpRegion('xplorr');
    if (e.key === '1') jumpRegion('xplorr');
    if (e.key === '2') jumpRegion('nosis');
    if (e.key === '3') jumpRegion('qre');
    if (e.key === '?' || (e.shiftKey && e.key === '/')) showHelp();
    if (e.key === '+' || e.key === '=') zoomAt(innerWidth / 2, innerHeight / 2, 1.12);
    if (e.key === '-' || e.key === '_') zoomAt(innerWidth / 2, innerHeight / 2, 0.9);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') {
      state.space = false;
      if (!state.pan) viewport.classList.remove('space', 'panning');
    }
  });
  window.addEventListener('resize', applyCamera);
  window.addEventListener('blur', () => { state.space = false; endPan(); });

  document.getElementById('btn-note').onclick = () => {
    const w = screenToWorld(innerWidth / 2, innerHeight / 2);
    addNoteAt(w.x, w.y);
  };
  document.getElementById('btn-link').onclick = () => {
    const w = screenToWorld(innerWidth / 2, innerHeight / 2);
    addLinkAt(w.x, w.y);
  };
  document.getElementById('btn-fit').onclick = () => jumpRegion('xplorr');
  document.getElementById('btn-more').onclick = (e) => {
    e.stopPropagation();
    moreMenu.hidden = !moreMenu.hidden;
    document.getElementById('btn-more').setAttribute('aria-expanded', String(!moreMenu.hidden));
  };
  document.getElementById('btn-help').onclick = () => { moreMenu.hidden = true; showHelp(); };
  document.getElementById('btn-reset').onclick = () => {
    moreMenu.hidden = true;
    confirmEl.hidden = false;
    const input = document.getElementById('reset-typed');
    input.value = '';
    document.getElementById('reset-go').disabled = true;
    input.focus();
  };
  document.getElementById('reset-typed').addEventListener('input', (e) => {
    document.getElementById('reset-go').disabled = e.target.value.trim() !== 'RESET';
  });
  document.getElementById('reset-cancel').onclick = () => { confirmEl.hidden = true; };
  document.getElementById('reset-form').onsubmit = async (e) => {
    e.preventDefault();
    if (document.getElementById('reset-typed').value.trim() !== 'RESET') return;
    confirmEl.hidden = true;
    await resetSeed();
  };
  confirmEl.querySelector('.modal-back').onclick = () => { confirmEl.hidden = true; };

  document.querySelectorAll('.jumps button').forEach((b) => {
    b.onclick = () => jumpRegion(b.dataset.jump);
  });
  document.getElementById('modal-close').onclick = closeModal;
  modal.querySelector('.modal-back').onclick = closeModal;
  modalRawBtn.onclick = async () => {
    state.modalRaw = !state.modalRaw;
    modalRawBtn.textContent = state.modalRaw ? 'Rendered' : 'Raw';
    if (state.modalItem) await fillModal(state.modalItem);
  };
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#more-menu, #btn-more')) moreMenu.hidden = true;
  });
}

function inField(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

function showHelp() {
  state.modalItem = { type: 'doc', title: 'Keys', body: helpText() };
  state.modalRaw = false;
  modal.hidden = false;
  modalKicker.textContent = 'ROOM';
  modalTitle.textContent = 'Keys';
  modalRawBtn.hidden = true;
  modalBody.className = 'prose';
  modalBody.innerHTML = renderMarkdown(helpText());
}

function helpText() {
  return [
    '# Room',
    'Infinite canvas. Things stay where you put them.',
    '',
    '- Wheel — zoom toward cursor',
    '- Pinch / ctrl-wheel — zoom',
    '- Shift-wheel or sideways scroll — pan',
    '- Space-drag, middle-drag, or drag empty canvas — pan',
    '- Drop files on the canvas — they land under the cursor',
    '- Double-click empty space or N — note',
    '- Double-click a note — edit. Esc or click away saves',
    '- Double-click a memo, deck, or image — open',
    '- Delete / Backspace — remove selected',
    '- 1 Xplorr · 2 Nosis · 3 QRE · F / 0 fit Xplorr',
    '',
    'Layout and uploaded file bytes live in this browser (IndexedDB). First visit seeds the Xplorr raise cluster. Reset seed is under ⋯ and needs you to type RESET.',
  ].join('\n');
}

async function main() {
  bindUi();
  try {
    db = await openDb();
    await seedIfNeeded();
  } catch (err) {
    console.warn('Room storage unavailable, running without persistence', err);
    state.items = SEED();
  }
  fitRegion('xplorr', false);
  render();
  requestAnimationFrame(() => {
    fitRegion('xplorr', false);
  });
}

main();
