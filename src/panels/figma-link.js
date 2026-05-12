// Figma 다중 링크 패널
// - 사용자가 Figma 파일 URL 입력 → REST API 로 페이지/프레임 트리 가져옴
// - 체크박스로 N개 선택 → 각 노드별 ?node-id=... URL 생성 → 클립보드 복사
// - PAT 토큰은 localStorage 에 저장
(function () {
  const TOKEN_KEY = 'figma-link:token';
  const URL_KEY = 'figma-link:last-url';

  const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } };
  const setToken = (v) => { try { localStorage.setItem(TOKEN_KEY, v || ''); } catch {} };
  const getLastUrl = () => { try { return localStorage.getItem(URL_KEY) || ''; } catch { return ''; } };
  const setLastUrl = (v) => { try { localStorage.setItem(URL_KEY, v || ''); } catch {} };

  const toast = (msg, type) => {
    try { if (typeof App !== 'undefined' && App.toast) { App.toast(msg, type || 'info'); return; } } catch {}
    if (window.App && window.App.toast) window.App.toast(msg, type || 'info');
  };

  // 파일 URL 에서 file_key 파싱 (/design/{KEY}/... 또는 /file/{KEY}/...)
  function parseFileKey(url) {
    if (!url) return null;
    const m = url.match(/figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
    return m ? m[1] : null;
  }
  // ?node-id=...&... 에서 시작 노드 (선택 사항)
  function parseStartNodeId(url) {
    try {
      const u = new URL(url);
      return u.searchParams.get('node-id') || '';
    } catch { return ''; }
  }
  // Figma 의 node-id 는 URL 인코딩 시 ":" → "-" 로 표기 (예: 1:23 → 1-23)
  function nodeIdToParam(id) { return String(id).replace(/:/g, '-'); }

  // 메모리 캐시 (세션 중) + sessionStorage (창 닫기 전까지)
  const CACHE_TTL_MS = 30 * 60 * 1000; // 30분
  function cacheGet(key) {
    try {
      const raw = sessionStorage.getItem('figma-link:cache:' + key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || (Date.now() - obj.t) > CACHE_TTL_MS) return null;
      return obj.v;
    } catch { return null; }
  }
  function cacheSet(key, value) {
    try {
      sessionStorage.setItem('figma-link:cache:' + key, JSON.stringify({ t: Date.now(), v: value }));
    } catch {}
  }

  async function figmaGet(url, token, { retries = 2, onRetry = null } = {}) {
    let attempt = 0;
    let lastErr = null;
    while (attempt <= retries) {
      const res = await fetch(url, { headers: { 'X-Figma-Token': token } });
      if (res.ok) return res.json();
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);
        const waitSec = retryAfter > 0 ? retryAfter : Math.min(60, Math.pow(2, attempt + 1) * 5); // 10s, 20s, 40s ...
        if (attempt >= retries) {
          const t = await res.text().catch(() => '');
          throw new Error(`Figma API 429 (Rate limit). 잠시 후 다시 시도하세요. ${t || ''}`.trim());
        }
        if (onRetry) onRetry(waitSec, attempt + 1, retries);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        attempt++;
        continue;
      }
      const t = await res.text().catch(() => '');
      lastErr = new Error(`Figma API ${res.status}: ${t || res.statusText}`);
      throw lastErr;
    }
    if (lastErr) throw lastErr;
  }

  async function fetchFile(fileKey, token, depth = 3, onRetry = null) {
    const cacheKey = `file:${fileKey}:d${depth}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}?depth=${depth}`;
    const data = await figmaGet(url, token, { retries: 2, onRetry });
    cacheSet(cacheKey, data);
    return data;
  }
  async function fetchComments(fileKey, token, onRetry = null) {
    const cacheKey = `cmt:${fileKey}`;
    const cached = cacheGet(cacheKey);
    if (cached) return cached;
    const url = `https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/comments`;
    try {
      const data = await figmaGet(url, token, { retries: 1, onRetry });
      cacheSet(cacheKey, data);
      return data;
    } catch (e) {
      // 코멘트 실패는 트리는 뜨도록 무시
      return { comments: [], _error: e.message };
    }
  }
  // 응답을 { nodeId: [comment, ...] } 로 그룹핑
  function groupCommentsByNode(commentsResp) {
    const map = new Map();
    const all = (commentsResp && commentsResp.comments) || [];
    for (const c of all) {
      const nid = c && c.client_meta && c.client_meta.node_id;
      if (!nid) continue;
      if (!map.has(nid)) map.set(nid, []);
      map.get(nid).push(c);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    }
    return map;
  }

  // 트리 노드 → 평탄화 (parent/depth 정보 유지, 페이지별로 묶을 수 있게)
  // CANVAS(페이지) → 그 아래 FRAME/SECTION/COMPONENT/COMPONENT_SET/GROUP 까지 1~2단
  // 캔버스에 그려진 위치 (위→아래, 좌→우) 순으로 정렬해서 나열.
  // 같은 행으로 간주하는 Y 허용 오차(px) — 살짝 어긋난 프레임도 같은 줄로 묶음
  const ROW_TOLERANCE = 50;
  function sortByCanvasPosition(nodes) {
    return nodes.slice().sort((a, b) => {
      const ay = a._y, by = b._y, ax = a._x, bx = b._x;
      if (Math.abs(ay - by) > ROW_TOLERANCE) return ay - by;
      return ax - bx;
    });
  }
  function buildList(document) {
    const out = [];
    const pages = document.children || [];
    for (const page of pages) {
      out.push({ id: page.id, name: page.name, type: page.type, depth: 0, pageId: page.id, parentId: null });
      const frames = (page.children || []).map((fr) => ({
        id: fr.id, name: fr.name, type: fr.type, depth: 1, pageId: page.id, parentId: page.id,
        _x: (fr.absoluteBoundingBox && fr.absoluteBoundingBox.x) || 0,
        _y: (fr.absoluteBoundingBox && fr.absoluteBoundingBox.y) || 0,
        _children: fr.children || [],
      }));
      for (const fr of sortByCanvasPosition(frames)) {
        out.push({ id: fr.id, name: fr.name, type: fr.type, depth: 1, pageId: page.id, parentId: page.id });
        const subs = (fr._children || [])
          .filter((c) => /^(FRAME|SECTION|COMPONENT|COMPONENT_SET|GROUP)$/.test(c.type))
          .map((sub) => ({
            id: sub.id, name: sub.name, type: sub.type, depth: 2, pageId: page.id, parentId: fr.id,
            _x: (sub.absoluteBoundingBox && sub.absoluteBoundingBox.x) || 0,
            _y: (sub.absoluteBoundingBox && sub.absoluteBoundingBox.y) || 0,
          }));
        for (const sub of sortByCanvasPosition(subs)) {
          out.push({ id: sub.id, name: sub.name, type: sub.type, depth: 2, pageId: page.id, parentId: fr.id });
        }
      }
    }
    return out;
  }

  function typeBadge(type) {
    const map = {
      CANVAS: ['Page', '#a78bfa'],
      FRAME: ['Frame', '#60a5fa'],
      SECTION: ['Section', '#34d399'],
      COMPONENT: ['Comp', '#f472b6'],
      COMPONENT_SET: ['Comp Set', '#f472b6'],
      GROUP: ['Group', '#9ca3af'],
    };
    const [label, color] = map[type] || [type, '#9ca3af'];
    return `<span style="font-size:9px;padding:1px 6px;border-radius:3px;background:${color}22;color:${color};margin-right:6px;font-weight:600">${label}</span>`;
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function buildLinks(fileKey, fileName, items) {
    return items.map((it) => {
      const safeName = encodeURIComponent(fileName || 'file');
      const nodeParam = nodeIdToParam(it.id);
      // figma.com/design/{KEY}/{NAME}?node-id={NODE} 형식 (현재 Figma 표준 URL)
      const url = `https://www.figma.com/design/${fileKey}/${safeName}?node-id=${nodeParam}`;
      return { name: it.name, type: it.type, url };
    });
  }

  let _state = {
    fileKey: null,
    fileName: '',
    items: [],
    selected: new Set(),
    rendered: false,
    enabledPages: new Set(),
    collapsedPages: new Set(),
    framesOnly: false,
    commentsByNode: new Map(),
    chunkIndex: 0,
  };

  function renderPanel() {
    if (_state.rendered) return;
    _state.rendered = true;
    const panel = document.getElementById('panel-figma-link');
    if (!panel) return;

    const lastUrl = getLastUrl();
    panel.innerHTML = `
      <div class="figma-panel">
        <div class="figma-toolbar">
          <span class="figma-title">🎨 Figma Link Generator</span>
          <span style="flex:1"></span>
          <button class="btn btn-sm" id="figma-cache-clear" title="캐시 비우기 (강제 새로고침)">🗑 Cache</button>
          <button class="btn btn-sm" id="figma-token-btn" title="Personal Access Token 설정">⚙️ Token</button>
        </div>

        <div class="figma-input-row">
          <input type="text" id="figma-file-url" class="input" placeholder="Figma 파일 URL 붙여넣기 (예: https://www.figma.com/design/XXXX/MyFile)" style="flex:1">
          <button class="btn btn-sm btn-primary" id="figma-load-btn">불러오기</button>
        </div>

        <div class="figma-status" id="figma-status"></div>

        <div class="figma-body">
          <div class="figma-pages-wrap">
            <div class="figma-pages-head">
              <span style="font-size:11px;color:var(--text-muted);font-weight:600">📄 Pages</span>
              <span style="flex:1"></span>
              <button class="btn btn-xs" id="figma-pages-all" title="모든 페이지 표시">All</button>
              <button class="btn btn-xs" id="figma-pages-none" title="모두 끄기">None</button>
            </div>
            <div class="figma-pages" id="figma-pages">
              <div class="figma-empty" style="font-size:11px">파일을 먼저 불러와주세요.</div>
            </div>
          </div>
          <div class="figma-tree-wrap">
            <div class="figma-tree-head">
              <button class="btn btn-xs" id="figma-select-all">전체 선택</button>
              <button class="btn btn-xs" id="figma-select-none">전체 해제</button>
              <button class="btn btn-xs" id="figma-select-frames">Frame 만 선택</button>
              <label class="figma-toggle" title="Section / Frame 만 표시 (자잘한 Group/Component 숨김)">
                <input type="checkbox" id="figma-frames-only"> <span>큰 영역만</span>
              </label>
              <span style="flex:1"></span>
              <span class="figma-count" id="figma-count">0 / 0</span>
            </div>
            <div class="figma-tree" id="figma-tree">
              <div class="figma-empty">파일 URL 을 입력하고 <b>불러오기</b> 를 눌러주세요.</div>
            </div>
          </div>

          <div class="figma-result-wrap">
            <div class="figma-result-head">
              <span style="font-size:12px;color:var(--text-muted)">생성된 링크</span>
              <span style="flex:1"></span>
              <label class="figma-toggle" title="N개씩 잘라서 한 번에 한 묶음씩 복사">
                <span>분할</span>
                <select id="figma-chunk-size" class="input" style="padding:2px 4px;font-size:11px;height:24px">
                  <option value="0">없음</option>
                  <option value="10">10</option>
                  <option value="20">20</option>
                  <option value="30" selected>30</option>
                  <option value="50">50</option>
                  <option value="100">100</option>
                </select>
              </label>
              <button class="btn btn-sm" id="figma-copy-chunk" title="다음 묶음 복사">📋 다음 묶음 복사</button>
              <button class="btn btn-sm" id="figma-copy-all">📋 전체 복사</button>
              <button class="btn btn-sm" id="figma-copy-md">📝 마크다운 복사</button>
            </div>
            <div class="figma-result" id="figma-result">
              <div class="figma-empty">선택된 노드의 링크가 여기 표시됩니다.</div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('figma-file-url').value = lastUrl;
    bindEvents();
  }

  function bindEvents() {
    const $ = (s) => document.querySelector(s);
    $('#figma-token-btn').addEventListener('click', showTokenDialog);
    $('#figma-cache-clear').addEventListener('click', () => {
      try {
        const keys = [];
        for (let i = 0; i < sessionStorage.length; i++) {
          const k = sessionStorage.key(i);
          if (k && k.startsWith('figma-link:cache:')) keys.push(k);
        }
        keys.forEach((k) => sessionStorage.removeItem(k));
        toast(`캐시 ${keys.length}개 비움`, 'success');
      } catch (e) { toast('캐시 비우기 실패: ' + e.message, 'error'); }
    });
    $('#figma-load-btn').addEventListener('click', () => loadFile($('#figma-file-url').value));
    $('#figma-file-url').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); loadFile($('#figma-file-url').value); }
    });
    $('#figma-select-all').addEventListener('click', () => selectAll(true));
    $('#figma-select-none').addEventListener('click', () => selectAll(false));
    $('#figma-select-frames').addEventListener('click', () => {
      _state.selected.clear();
      for (const it of _state.items) {
        if (it.type === 'FRAME' && _state.enabledPages.has(it.pageId)) _state.selected.add(it.id);
      }
      renderTree();
      renderResult();
    });
    $('#figma-copy-all').addEventListener('click', () => copyResult('plain'));
    $('#figma-copy-md').addEventListener('click', () => copyResult('markdown'));
    $('#figma-copy-chunk').addEventListener('click', () => copyNextChunk());
    $('#figma-chunk-size').addEventListener('change', () => { _state.chunkIndex = 0; updateChunkButtonLabel(); });
    $('#figma-pages-all').addEventListener('click', () => {
      _state.enabledPages = new Set(_state.items.filter((i) => i.type === 'CANVAS').map((i) => i.id));
      renderPages(); renderTree(); renderResult();
    });
    $('#figma-pages-none').addEventListener('click', () => {
      _state.enabledPages.clear();
      _state.selected.clear();
      renderPages(); renderTree(); renderResult();
    });
    $('#figma-frames-only').addEventListener('change', (e) => {
      _state.framesOnly = e.currentTarget.checked;
      renderTree();
    });
  }

  function fmtDate(s) {
    if (!s) return '';
    try {
      const d = new Date(s);
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch { return s; }
  }

  function showCommentsDialog(nodeId) {
    const node = _state.items.find((i) => i.id === nodeId);
    const cmts = _state.commentsByNode.get(nodeId) || [];
    if (!cmts.length) return;
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000';
    const itemsHtml = cmts.map((c) => {
      const name = (c.user && c.user.handle) || (c.user && c.user.email) || 'unknown';
      const resolved = c.resolved_at ? `<span style="color:var(--green);font-size:10px;margin-left:6px">✓ resolved</span>` : '';
      const msg = escHtml(c.message || '').replace(/\n/g, '<br>');
      const figmaUrl = _state.fileKey
        ? `https://www.figma.com/design/${_state.fileKey}/${encodeURIComponent(_state.fileName || 'file')}?node-id=${nodeIdToParam(nodeId)}#${encodeURIComponent(c.id)}`
        : '#';
      return `
        <div style="border-bottom:1px solid var(--border);padding:10px 0">
          <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-muted);margin-bottom:4px">
            <b style="color:var(--text)">${escHtml(name)}</b>
            <span>${escHtml(fmtDate(c.created_at))}</span>
            ${resolved}
            <span style="flex:1"></span>
            <a href="#" data-figma-url="${escHtml(figmaUrl)}" style="color:var(--accent)">Figma 에서 열기 ↗</a>
          </div>
          <div style="font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-word">${msg}</div>
        </div>
      `;
    }).join('');
    overlay.innerHTML = `
      <div style="background:var(--bg-secondary);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:18px;width:560px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column">
        <h3 style="margin:0 0 4px 0;font-size:14px">💬 ${escHtml(node ? node.name : nodeId)} <span style="color:var(--text-muted);font-size:11px;font-weight:400">· ${cmts.length}개</span></h3>
        <div style="overflow:auto;margin-top:8px;flex:1">${itemsHtml}</div>
        <div style="display:flex;justify-content:flex-end;margin-top:12px">
          <button class="btn btn-sm" id="figma-cmt-close">닫기</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#figma-cmt-close').addEventListener('click', () => overlay.remove());
    overlay.querySelectorAll('a[data-figma-url]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        try { window.api.openExternal(a.getAttribute('data-figma-url')); } catch {}
      });
    });
  }

  function showTokenDialog() {
    const cur = getToken();
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000';
    overlay.innerHTML = `
      <div style="background:var(--bg-secondary);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:18px;width:520px;max-width:92vw">
        <h3 style="margin:0 0 12px 0;font-size:16px">🎨 Figma Personal Access Token</h3>
        <p style="font-size:11px;color:var(--text-muted);margin:0 0 12px 0;line-height:1.5">
          토큰은 이 PC 의 localStorage 에만 저장됩니다.<br>
          발급: <a href="#" id="figma-open-token-page" style="color:var(--accent)">https://www.figma.com/settings/tokens</a><br>
          권장 권한: <code>file_content:read</code> (필수), <code>file_metadata:read</code> (선택)
        </p>
        <input id="figma-token-input" type="password" class="input" placeholder="figd_xxxxxxxx..." style="width:100%;margin-bottom:14px">
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-sm" id="figma-token-cancel">취소</button>
          <button class="btn btn-sm btn-primary" id="figma-token-save">저장</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    const close = () => overlay.remove();
    overlay.querySelector('#figma-token-input').value = cur;
    overlay.querySelector('#figma-open-token-page').addEventListener('click', (e) => {
      e.preventDefault();
      try { window.api.openExternal('https://www.figma.com/settings/tokens'); } catch {}
    });
    overlay.querySelector('#figma-token-cancel').addEventListener('click', close);
    overlay.querySelector('#figma-token-save').addEventListener('click', () => {
      const v = overlay.querySelector('#figma-token-input').value.trim();
      setToken(v);
      toast('Figma 토큰 저장 완료', 'success');
      close();
    });
  }

  async function loadFile(url) {
    const token = getToken();
    if (!token) { toast('먼저 ⚙️ Token 으로 Figma PAT 를 설정해주세요', 'error'); showTokenDialog(); return; }
    const fileKey = parseFileKey(url);
    if (!fileKey) { toast('올바른 Figma 파일 URL 이 아닙니다', 'error'); return; }

    setLastUrl(url);
    const status = document.getElementById('figma-status');
    const loadBtn = document.getElementById('figma-load-btn');
    if (loadBtn) loadBtn.disabled = true;
    status.innerHTML = '<i>불러오는 중...</i>';
    const tree = document.getElementById('figma-tree');
    tree.innerHTML = '<div class="figma-empty">불러오는 중...</div>';
    document.getElementById('figma-result').innerHTML = '<div class="figma-empty">선택된 노드의 링크가 여기 표시됩니다.</div>';

    const onRetry = (waitSec, attempt, max) => {
      status.innerHTML = `<span style="color:var(--yellow,#facc15)">⏳ Rate limit · ${waitSec}초 후 재시도 (${attempt}/${max})...</span>`;
    };

    try {
      const [data, commentsResp] = await Promise.all([
        fetchFile(fileKey, token, 3, onRetry),
        fetchComments(fileKey, token, onRetry),
      ]);
      _state.fileKey = fileKey;
      _state.fileName = data.name || 'file';
      _state.items = buildList(data.document || {});
      _state.commentsByNode = groupCommentsByNode(commentsResp);
      _state.selected.clear();
      _state.collapsedPages.clear();
      _state.enabledPages = new Set(_state.items.filter((i) => i.type === 'CANVAS').map((i) => i.id));

      const startNode = parseStartNodeId(url);
      if (startNode) {
        const startId = startNode.replace(/-/g, ':');
        if (_state.items.some((i) => i.id === startId)) _state.selected.add(startId);
      }

      const commentTotal = (commentsResp && commentsResp.comments) ? commentsResp.comments.length : 0;
      status.innerHTML = `<span style="color:var(--green)">✓ ${escHtml(_state.fileName)}</span> · ${_state.items.length} 노드 · 💬 ${commentTotal}개 코멘트`;
      renderPages();
      renderTree();
      renderResult();
    } catch (e) {
      status.innerHTML = `<span style="color:var(--red)">✗ ${escHtml(e.message)}</span>`;
      tree.innerHTML = '<div class="figma-empty">불러오기 실패</div>';
    } finally {
      if (loadBtn) loadBtn.disabled = false;
    }
  }

  function selectAll(on) {
    _state.selected.clear();
    if (on) {
      for (const it of _state.items) {
        if (!_state.enabledPages.has(it.pageId)) continue;
        if (it.type === 'CANVAS') continue;
        if (_state.framesOnly && !/^(FRAME|SECTION)$/.test(it.type)) continue;
        _state.selected.add(it.id);
      }
    }
    renderTree();
    renderResult();
  }

  function renderPages() {
    const wrap = document.getElementById('figma-pages');
    if (!wrap) return;
    const pages = _state.items.filter((i) => i.type === 'CANVAS');
    if (!pages.length) {
      wrap.innerHTML = '<div class="figma-empty" style="font-size:11px">페이지 없음</div>';
      return;
    }
    wrap.innerHTML = pages.map((p) => {
      const on = _state.enabledPages.has(p.id) ? 'checked' : '';
      const childCount = _state.items.filter((i) => i.pageId === p.id && i.type !== 'CANVAS').length;
      return `
        <label class="figma-page-item">
          <input type="checkbox" data-page="${escHtml(p.id)}" ${on}>
          <span class="figma-page-name">${escHtml(p.name)}</span>
          <span class="figma-page-cnt">${childCount}</span>
        </label>
      `;
    }).join('');
    wrap.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const id = e.currentTarget.getAttribute('data-page');
        if (e.currentTarget.checked) {
          _state.enabledPages.add(id);
        } else {
          _state.enabledPages.delete(id);
          for (const it of _state.items) {
            if (it.pageId === id) _state.selected.delete(it.id);
          }
        }
        renderTree();
        renderResult();
      });
    });
  }

  function pruneSelectionToVisible() {
    for (const id of Array.from(_state.selected)) {
      const it = _state.items.find((x) => x.id === id);
      if (!it || !_state.enabledPages.has(it.pageId)) _state.selected.delete(id);
    }
  }

  function visibleItems() {
    return _state.items.filter((it) => {
      if (!_state.enabledPages.has(it.pageId)) return false;
      if (it.type === 'CANVAS') return true;
      // 페이지가 접혀있으면 자식 숨김
      if (_state.collapsedPages.has(it.pageId)) return false;
      if (_state.framesOnly && !/^(FRAME|SECTION)$/.test(it.type)) return false;
      return true;
    });
  }

  function renderTree() {
    const wrap = document.getElementById('figma-tree');
    if (!_state.items.length) {
      wrap.innerHTML = '<div class="figma-empty">노드가 없습니다.</div>';
      return;
    }
    const list = visibleItems();
    if (!list.length) {
      wrap.innerHTML = '<div class="figma-empty">표시할 노드가 없습니다. 좌측에서 페이지를 켜주세요.</div>';
      document.getElementById('figma-count').textContent = `${_state.selected.size} / ${_state.items.length}`;
      return;
    }
    const html = list.map((it) => {
      const checked = _state.selected.has(it.id) ? 'checked' : '';
      const indent = it.depth * 16;
      const cmts = _state.commentsByNode.get(it.id) || [];
      const cmtBadge = cmts.length
        ? `<button class="figma-cmt-badge" data-cmt-id="${escHtml(it.id)}" title="코멘트 ${cmts.length}개 보기">💬 ${cmts.length}</button>`
        : '';
      if (it.type === 'CANVAS') {
        const collapsed = _state.collapsedPages.has(it.id);
        const arrow = collapsed ? '▶' : '▼';
        return `
          <div class="figma-node figma-node-page" style="padding-left:${8 + indent}px">
            <button class="figma-collapse" data-page="${escHtml(it.id)}" title="${collapsed ? '펼치기' : '접기'}">${arrow}</button>
            <input type="checkbox" data-id="${escHtml(it.id)}" ${checked}>
            ${typeBadge(it.type)}
            <span class="figma-node-name">${escHtml(it.name)}</span>
            ${cmtBadge}
          </div>
        `;
      }
      return `
        <label class="figma-node" style="padding-left:${8 + indent}px">
          <input type="checkbox" data-id="${escHtml(it.id)}" ${checked}>
          ${typeBadge(it.type)}
          <span class="figma-node-name">${escHtml(it.name)}</span>
          ${cmtBadge}
        </label>
      `;
    }).join('');
    wrap.innerHTML = html;
    wrap.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        if (e.currentTarget.checked) _state.selected.add(id); else _state.selected.delete(id);
        _state.chunkIndex = 0;
        document.getElementById('figma-count').textContent = `${_state.selected.size} / ${_state.items.length}`;
        renderResult();
      });
    });
    wrap.querySelectorAll('.figma-cmt-badge').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        showCommentsDialog(b.getAttribute('data-cmt-id'));
      });
    });
    wrap.querySelectorAll('.figma-collapse').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const id = b.getAttribute('data-page');
        if (_state.collapsedPages.has(id)) _state.collapsedPages.delete(id);
        else _state.collapsedPages.add(id);
        renderTree();
      });
    });
    document.getElementById('figma-count').textContent = `${_state.selected.size} / ${_state.items.length}`;
  }

  function renderResult() {
    pruneSelectionToVisible();
    const wrap = document.getElementById('figma-result');
    const items = _state.items.filter((it) => _state.selected.has(it.id) && _state.enabledPages.has(it.pageId));
    if (!items.length) {
      wrap.innerHTML = '<div class="figma-empty">선택된 노드의 링크가 여기 표시됩니다.</div>';
      return;
    }
    const links = buildLinks(_state.fileKey, _state.fileName, items);
    wrap.innerHTML = links.map((l) => `
      <div class="figma-result-row">
        ${typeBadge(l.type)}
        <span class="figma-result-name">${escHtml(l.name)}</span>
        <a href="#" class="figma-result-url" data-url="${escHtml(l.url)}" title="외부 브라우저로 열기">${escHtml(l.url)}</a>
        <button class="btn btn-xs figma-row-copy" data-url="${escHtml(l.url)}" title="이 링크만 복사">📋</button>
      </div>
    `).join('');
    wrap.querySelectorAll('.figma-result-url').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        try { window.api.openExternal(a.dataset.url); } catch {}
      });
    });
    wrap.querySelectorAll('.figma-row-copy').forEach((b) => {
      b.addEventListener('click', async (e) => {
        e.stopPropagation();
        try { await navigator.clipboard.writeText(b.dataset.url); toast('복사 완료', 'success'); }
        catch (err) { toast('복사 실패: ' + err.message, 'error'); }
      });
    });
    updateChunkButtonLabel();
  }

  function getChunkSize() {
    const el = document.getElementById('figma-chunk-size');
    return el ? parseInt(el.value, 10) || 0 : 0;
  }
  function getSelectedItemsOrdered() {
    pruneSelectionToVisible();
    return _state.items.filter((it) => _state.selected.has(it.id) && _state.enabledPages.has(it.pageId));
  }
  function updateChunkButtonLabel() {
    const btn = document.getElementById('figma-copy-chunk');
    if (!btn) return;
    const size = getChunkSize();
    const items = getSelectedItemsOrdered();
    if (!size || !items.length) {
      btn.textContent = '📋 다음 묶음 복사';
      btn.disabled = !items.length || !size;
      return;
    }
    const total = Math.ceil(items.length / size);
    const cur = _state.chunkIndex % total;
    const from = cur * size + 1;
    const to = Math.min(items.length, (cur + 1) * size);
    btn.disabled = false;
    btn.textContent = `📋 ${from}~${to} 복사 (${cur + 1}/${total})`;
  }
  async function copyNextChunk() {
    const size = getChunkSize();
    const items = getSelectedItemsOrdered();
    if (!size) { toast('분할 크기를 선택하세요', 'info'); return; }
    if (!items.length) { toast('선택된 노드가 없습니다', 'info'); return; }
    const total = Math.ceil(items.length / size);
    const cur = _state.chunkIndex % total;
    const slice = items.slice(cur * size, (cur + 1) * size);
    const links = buildLinks(_state.fileKey, _state.fileName, slice);
    const text = links.map((l) => l.url).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast(`${slice.length}개 복사됨 (${cur + 1}/${total} 묶음)`, 'success');
      _state.chunkIndex = (cur + 1) % total;
      updateChunkButtonLabel();
    } catch (e) { toast('복사 실패: ' + e.message, 'error'); }
  }

  async function copyResult(format) {
    pruneSelectionToVisible();
    const items = _state.items.filter((it) => _state.selected.has(it.id) && _state.enabledPages.has(it.pageId));
    if (!items.length) { toast('선택된 노드가 없습니다', 'info'); return; }
    const links = buildLinks(_state.fileKey, _state.fileName, items);
    let text;
    if (format === 'markdown') {
      text = links.map((l) => `- [${l.name}](${l.url})`).join('\n');
    } else {
      text = links.map((l) => l.url).join('\n');
    }
    try {
      await navigator.clipboard.writeText(text);
      toast(`${links.length}개 링크 복사 완료`, 'success');
    } catch (e) {
      toast('복사 실패: ' + e.message, 'error');
    }
  }

  // 패널이 활성화될 때 초기 렌더 (lazy)
  function observePanelActivation() {
    const panel = document.getElementById('panel-figma-link');
    if (!panel) return;
    const ob = new MutationObserver(() => {
      if (panel.classList.contains('active')) renderPanel();
    });
    ob.observe(panel, { attributes: true, attributeFilter: ['class'] });
    if (panel.classList.contains('active')) renderPanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observePanelActivation);
  } else {
    observePanelActivation();
  }
})();
