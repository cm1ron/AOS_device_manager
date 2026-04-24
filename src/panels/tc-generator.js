(function () {
  function bind(prefix) {
    const wv = document.getElementById(`${prefix}-webview`);
    const reload = document.getElementById(`${prefix}-reload`);
    const back = document.getElementById(`${prefix}-back`);
    const fwd = document.getElementById(`${prefix}-forward`);
    const ext = document.getElementById(`${prefix}-open-external`);
    const urlLabel = document.getElementById(`${prefix}-url-label`);
    if (!wv) return;

    wv.addEventListener('did-navigate', (e) => { if (urlLabel && e && e.url) urlLabel.textContent = e.url; });
    wv.addEventListener('did-navigate-in-page', (e) => { if (urlLabel && e && e.url) urlLabel.textContent = e.url; });
    wv.addEventListener('console-message', (e) => {
      if (e && e.message) console.log(`[${prefix}-wv]`, e.message);
    });

    reload && reload.addEventListener('click', () => { try { wv.reload(); } catch {} });
    back && back.addEventListener('click', () => { try { if (wv.canGoBack()) wv.goBack(); } catch {} });
    fwd && fwd.addEventListener('click', () => { try { if (wv.canGoForward()) wv.goForward(); } catch {} });
    ext && ext.addEventListener('click', () => {
      try { require('electron').shell.openExternal(wv.getURL()); } catch {
        window.open(wv.getURL(), '_blank');
      }
    });
  }

  async function attachPreloadAndLoad() {
    let preloadUrl = '';
    try { preloadUrl = await window.api.getWebviewPreloadPath(); } catch (e) {
      console.warn('[tc-gen] preload path 가져오기 실패', e);
    }
    console.log('[tc-gen] preload URL =', preloadUrl);
    ['tc-webview', 'orca-webview'].forEach((id) => {
      const wv = document.getElementById(id);
      if (!wv) return;
      const src = wv.getAttribute('data-src');
      const part = wv.getAttribute('data-partition');
      if (part) wv.setAttribute('partition', part);
      if (preloadUrl) wv.setAttribute('preload', preloadUrl);
      console.log('[tc-gen] webview', id, 'partition=', part, 'src=', src);
      if (src) wv.setAttribute('src', src);
    });
  }

  function init() {
    bind('tc');
    bind('orca');
    attachPreloadAndLoad();
    try {
      localStorage.removeItem('tc-dark-mode');
      localStorage.removeItem('orca-dark-mode');
    } catch {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
