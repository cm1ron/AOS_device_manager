// Webview 내부 Ctrl+F 검색바
// main 프로세스에서 Ctrl+F 감지 → webview:find-open(webContentsId) 수신
// 입력 → window.api.webview.find(id, text)
// 결과 → webview:find-result 로 매치 정보 수신
(function () {
  if (!window.api || !window.api.webview) return;

  let bar, input, info, btnPrev, btnNext, btnClose;
  let activeId = null;

  function build() {
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'webview-find-bar';
    bar.style.cssText = `
      position: fixed; top: 12px; right: 16px; z-index: 10000;
      display: none; align-items: center; gap: 6px;
      background: #1e1e2e; color: #cdd6f4;
      border: 1px solid #45475a; border-radius: 6px;
      padding: 6px 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.35);
      font-size: 12px;
    `;
    bar.innerHTML = `
      <input type="text" placeholder="페이지에서 검색..." style="background:#11111b;color:#cdd6f4;border:1px solid #313244;border-radius:4px;padding:4px 6px;width:200px;outline:none">
      <span class="wf-info" style="color:#7f849c;min-width:50px;text-align:center">0/0</span>
      <button class="wf-prev" title="이전 (Shift+Enter)" style="background:#313244;color:#cdd6f4;border:none;border-radius:4px;padding:4px 8px;cursor:pointer">↑</button>
      <button class="wf-next" title="다음 (Enter)" style="background:#313244;color:#cdd6f4;border:none;border-radius:4px;padding:4px 8px;cursor:pointer">↓</button>
      <button class="wf-close" title="닫기 (Esc)" style="background:transparent;color:#cdd6f4;border:none;font-size:16px;cursor:pointer;padding:0 4px">×</button>
    `;
    document.body.appendChild(bar);
    input = bar.querySelector('input');
    info = bar.querySelector('.wf-info');
    btnPrev = bar.querySelector('.wf-prev');
    btnNext = bar.querySelector('.wf-next');
    btnClose = bar.querySelector('.wf-close');

    let lastText = '';
    const doFind = (forward = true) => {
      const text = input.value;
      if (!text) { info.textContent = '0/0'; window.api.webview.stopFind(activeId); return; }
      const opts = text === lastText ? { findNext: true, forward } : { findNext: false, forward };
      lastText = text;
      window.api.webview.find(activeId, text, opts);
    };

    input.addEventListener('input', () => doFind(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doFind(!e.shiftKey); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    btnPrev.addEventListener('click', () => doFind(false));
    btnNext.addEventListener('click', () => doFind(true));
    btnClose.addEventListener('click', close);
  }

  function open(id) {
    build();
    activeId = id;
    bar.style.display = 'inline-flex';
    input.focus();
    input.select();
  }
  function close() {
    if (!bar) return;
    bar.style.display = 'none';
    if (activeId != null) {
      try { window.api.webview.stopFind(activeId); } catch {}
    }
  }

  window.api.webview.onFindOpen((id) => open(id));
  window.api.webview.onFindClose(() => close());
  window.api.webview.onFindResult(({ result }) => {
    if (!info || !result) return;
    if (result.matches != null) {
      info.textContent = `${result.activeMatchOrdinal || 0}/${result.matches}`;
    }
  });

  // 페이지 자체 Ctrl+F 도 잡아서(웹뷰 외부 패널에서도 동일 UI 제공)
  // 단, 입력 폼에 포커스되어 있을 땐 무시
  document.addEventListener('keydown', (e) => {
    const isCtrlF = (e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F') && !e.shiftKey;
    if (!isCtrlF) return;
    // webview 가 활성 상태이고, 그 webview 의 webContentsId 알 수 있으면 open
    const activePanel = document.querySelector('.panel.active');
    if (!activePanel) return;
    const wv = activePanel.querySelector('webview');
    if (!wv) return;
    e.preventDefault();
    try { open(wv.getWebContentsId()); } catch { /* webview 가 아직 ready 아님 */ }
  });
})();
