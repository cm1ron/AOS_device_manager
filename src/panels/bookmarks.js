// Jira / Confluence 즐겨찾기 드로어
// 헤더의 ⭐ 버튼 → 우측 사이드 드로어 토글
// 드로어 안: [+ 현재 페이지 추가] / 목록 (클릭=이동, × 삭제, ✎ 이름변경)
(function () {
  function key(site) { return `bookmarks.${site}`; }
  function load(site) {
    try { return JSON.parse(localStorage.getItem(key(site)) || '[]'); }
    catch { return []; }
  }
  function save(site, list) {
    try { localStorage.setItem(key(site), JSON.stringify(list)); } catch {}
  }
  function getWebview(site) { return document.getElementById(`${site}-webview`); }
  function getUrlLabel(site) { return document.getElementById(`${site}-url-label`); }
  function navigate(site, url) {
    const wv = getWebview(site);
    if (!wv) return;
    try {
      const p = wv.loadURL(url);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { wv.src = url; }
    const lbl = getUrlLabel(site);
    if (lbl) lbl.textContent = url;
  }

  function ensureDrawer(site) {
    let drawer = document.getElementById(`bookmark-drawer-${site}`);
    if (drawer) return drawer;
    const wv = getWebview(site);
    if (!wv || !wv.parentElement) return null;
    drawer = document.createElement('aside');
    drawer.id = `bookmark-drawer-${site}`;
    drawer.className = 'bookmark-drawer';
    drawer.style.cssText = `
      width: 280px; flex: 0 0 280px;
      background: #1e1e2e; color: #cdd6f4;
      border-left: 1px solid #313244;
      display: none; flex-direction: column;
      box-shadow: -4px 0 16px rgba(0,0,0,0.3);
    `;
    drawer.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #313244">
        <span style="font-size:13px;font-weight:600">⭐ 즐겨찾기</span>
        <div style="flex:1"></div>
        <button class="bm-add btn btn-sm btn-primary" title="현재 페이지 추가">+ 추가</button>
        <button class="bm-close btn btn-sm" title="닫기">×</button>
      </div>
      <div class="bm-list" style="flex:1;overflow-y:auto;padding:6px"></div>
    `;
    wv.parentElement.appendChild(drawer);
    drawer.querySelector('.bm-close').addEventListener('click', () => closeDrawer(site));
    drawer.querySelector('.bm-add').addEventListener('click', (e) => addCurrent(site, e.currentTarget));
    return drawer;
  }

  function renderList(site) {
    const drawer = document.getElementById(`bookmark-drawer-${site}`);
    if (!drawer) return;
    const listEl = drawer.querySelector('.bm-list');
    listEl.innerHTML = '';
    const list = load(site);
    if (!list.length) {
      listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#7f849c;font-size:12px">아직 즐겨찾기가 없습니다.<br>+ 추가 로 현재 페이지를 등록하세요.</div>';
      return;
    }
    list.forEach((bm, idx) => {
      const item = document.createElement('div');
      item.className = 'bm-item';
      item.style.cssText = `
        display:flex;align-items:center;gap:6px;
        padding:8px 10px;border:1px solid transparent;border-radius:6px;
        cursor:pointer;margin-bottom:4px;
      `;
      item.innerHTML = `
        <div style="flex:1;min-width:0">
          <div class="bm-name" style="font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
          <div class="bm-url" style="font-size:10px;color:#7f849c;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
        </div>
        <button class="bm-rename" title="이름 변경" style="background:transparent;color:#7f849c;border:none;cursor:pointer;padding:2px 4px;font-size:12px">✎</button>
        <button class="bm-del" title="삭제" style="background:transparent;color:#f38ba8;border:none;cursor:pointer;padding:2px 6px;font-size:14px">×</button>
      `;
      item.querySelector('.bm-name').textContent = bm.name;
      item.querySelector('.bm-url').textContent = bm.url;
      item.addEventListener('mouseenter', () => { item.style.background = '#313244'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'transparent'; });
      item.addEventListener('click', (e) => {
        if (e.target.closest('.bm-del') || e.target.closest('.bm-rename')) return;
        navigate(site, bm.url);
      });
      item.querySelector('.bm-del').addEventListener('click', (e) => {
        e.stopPropagation();
        const arr = load(site); arr.splice(idx, 1); save(site, arr); renderList(site);
      });
      item.querySelector('.bm-rename').addEventListener('click', (e) => {
        e.stopPropagation();
        showInputPopover(e.currentTarget, bm.name, '이름 변경', (newName) => {
          const arr = load(site); arr[idx].name = newName; save(site, arr); renderList(site);
        });
      });
      listEl.appendChild(item);
    });
  }

  function openDrawer(site) {
    const d = ensureDrawer(site);
    if (!d) return;
    d.style.display = 'flex';
    renderList(site);
  }
  function closeDrawer(site) {
    const d = document.getElementById(`bookmark-drawer-${site}`);
    if (d) d.style.display = 'none';
  }

  function addCurrent(site, anchor) {
    const wv = getWebview(site);
    if (!wv) return;
    let url = '';
    try { url = wv.getURL() || wv.src || ''; } catch { url = wv.src || ''; }
    if (!url) return;
    const defaultName = (() => {
      try {
        const u = new URL(url);
        const last = u.pathname.split('/').filter(Boolean).pop() || '';
        return decodeURIComponent(last) || u.hostname;
      } catch { return 'page'; }
    })();
    showInputPopover(anchor, defaultName, '즐겨찾기 이름', (name) => {
      const list = load(site);
      list.push({ name, url });
      save(site, list);
      renderList(site);
    });
  }

  function showInputPopover(anchor, defaultValue, placeholder, onSubmit) {
    document.querySelectorAll('.bookmark-popover').forEach((el) => el.remove());
    const pop = document.createElement('div');
    pop.className = 'bookmark-popover';
    pop.style.cssText = `
      position: fixed; z-index: 10001;
      background: #11111b; color: #cdd6f4;
      border: 1px solid #45475a; border-radius: 6px;
      padding: 6px; box-shadow: 0 6px 18px rgba(0,0,0,0.45);
      display: flex; gap: 4px; align-items: center;
    `;
    pop.innerHTML = `
      <input type="text" placeholder="${placeholder}" style="background:#1e1e2e;color:#cdd6f4;border:1px solid #313244;border-radius:4px;padding:4px 6px;width:200px;outline:none;font-size:12px">
      <button class="bp-ok" style="background:#89b4fa;color:#1e1e2e;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;font-weight:600;font-size:12px">OK</button>
    `;
    document.body.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    pop.style.top = (r.bottom + 4) + 'px';
    let left = r.left;
    const pw = 280;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    pop.style.left = Math.max(8, left) + 'px';
    const input = pop.querySelector('input');
    const ok = pop.querySelector('.bp-ok');
    input.value = defaultValue || '';
    input.focus(); input.select();
    const submit = () => {
      const v = input.value.trim();
      cleanup();
      if (v) onSubmit(v);
    };
    const cleanup = () => { pop.remove(); document.removeEventListener('mousedown', onDoc, true); };
    const onDoc = (e) => { if (!pop.contains(e.target)) cleanup(); };
    setTimeout(() => document.addEventListener('mousedown', onDoc, true), 0);
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); cleanup(); }
    });
  }

  function init() {
    document.querySelectorAll('.bookmark-toggle').forEach((btn) => {
      const site = btn.dataset.site;
      btn.addEventListener('click', () => {
        const d = document.getElementById(`bookmark-drawer-${site}`);
        if (d && d.style.display === 'flex') closeDrawer(site);
        else openDrawer(site);
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
