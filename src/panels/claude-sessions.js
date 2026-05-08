// Claude resume command capture drawer
// 터미널에 'claude --resume <uuid>' 가 나오면 그걸 잡아서 localStorage 에 저장
(function () {
  const STORE_KEY = 'claude.resume.history.v1';
  const MAX = 50;

  const drawer = document.getElementById('claude-drawer');
  const body = document.getElementById('claude-drawer-body');
  const btnOpen = document.getElementById('terminal-claude-btn');
  const btnClose = document.getElementById('claude-drawer-close');
  const btnRefresh = document.getElementById('claude-drawer-refresh');
  if (!drawer || !btnOpen) return;

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); } catch { return []; }
  }
  function save(list) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(list.slice(0, MAX))); } catch {}
  }

  function add(uuid, cwd) {
    if (!uuid) return;
    const list = load().filter((x) => x.id !== uuid);
    list.unshift({ id: uuid, cwd: cwd || '', mtime: Date.now() });
    save(list);
    if (drawer.style.display !== 'none') render();
  }

  // window.terminal 이 알려주는 매 출력 청크에서 패턴 감지
  // 패턴: "claude --resume <uuid>"  (uuid: 8-4-4-4-12 hex)
  const RX = /claude\s+--resume\s+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;
  window.captureClaudeResume = function (text, cwd) {
    if (!text) return;
    let m;
    while ((m = RX.exec(text)) !== null) add(m[1], cwd);
  };

  window.addClaudeResume = function (uuid, cwd) { add(uuid, cwd); };

  function normPath(p) {
    return (p || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }

  // cwd 목록을 받아 각 cwd 의 최근 claude 세션을 자동 스탬프 저장.
  window.autoStampClaudeSessions = async function (cwds) {
    try {
      if (!Array.isArray(cwds) || !cwds.length) return 0;
      if (!window.api || !window.api.listClaudeSessions) return 0;
      const res = await window.api.listClaudeSessions(200);
      if (!res || !res.ok || !Array.isArray(res.sessions)) return 0;
      const wanted = new Set(cwds.filter(Boolean).map(normPath));
      const seenCwd = new Set();
      let n = 0;
      for (const s of res.sessions) {
        const np = normPath(s.projectPath);
        if (!wanted.has(np)) continue;
        if (seenCwd.has(np)) continue;
        seenCwd.add(np);
        add(s.id, s.projectPath);
        n++;
      }
      return n;
    } catch { return 0; }
  };

  function fmtTime(ms) {
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function shortPath(p) { return !p ? '' : (p.length > 44 ? '…' + p.slice(-44) : p); }

  function render() {
    const list = load();
    if (!list.length) {
      body.innerHTML = '<div class="claude-empty">저장된 resume 명령이 없습니다.<br><small>터미널에서 claude 실행 후 Ctrl+C 하면 자동으로 캡처됩니다.</small></div>';
      return;
    }
    body.innerHTML = '';
    for (const s of list) {
      const el = document.createElement('div');
      el.className = 'claude-session';
      el.title = `클릭하면 명령 복사\n\nclaude --resume ${s.id}`;
      el.innerHTML = `
        <button class="claude-session-del" title="삭제">✕</button>
        <div class="claude-session-preview"></div>
        <div class="claude-session-meta">
          <span>${fmtTime(s.mtime)}</span>
          <span class="claude-session-project"></span>
        </div>
      `;
      el.querySelector('.claude-session-preview').textContent = `claude --resume ${s.id}`;
      el.querySelector('.claude-session-project').textContent = shortPath(s.cwd);
      el.addEventListener('click', async () => {
        const cmd = `claude --resume ${s.id}`;
        const showToast = (msg, type) => {
          try {
            if (typeof App !== 'undefined' && App.toast) { App.toast(msg, type || 'success'); return; }
          } catch {}
          if (window.App && window.App.toast) { window.App.toast(msg, type || 'success'); return; }
          if (window.toast) window.toast(msg, type);
        };
        try {
          await navigator.clipboard.writeText(cmd);
          showToast('복사 완료', 'success');
        } catch (e) {
          showToast('복사 실패: ' + e.message, 'error');
        }
      });
      const removeItem = () => {
        const list2 = load().filter((x) => x.id !== s.id);
        save(list2);
        render();
      };
      el.querySelector('.claude-session-del').addEventListener('click', (e) => {
        e.stopPropagation();
        removeItem();
      });
      // 우클릭 → 삭제 (기존 동작 유지)
      el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        removeItem();
      });
      body.appendChild(el);
    }
  }

  function open() { drawer.style.display = 'flex'; render(); }
  function close() { drawer.style.display = 'none'; }

  // 기본적으로 열어둔 상태로 시작 (이미 display:flex)
  render();

  btnOpen.addEventListener('click', () => {
    if (drawer.style.display === 'none' || !drawer.style.display) open(); else close();
  });
  btnClose.addEventListener('click', close);
  btnRefresh.addEventListener('click', render);
})();
