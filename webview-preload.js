const BACKUP_KEY = '__persisted_session_v1__';

console.log('[webview-preload] loaded at', location.href);

function backup() {
  try {
    const dump = {};
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k === BACKUP_KEY) continue;
      dump[k] = sessionStorage.getItem(k);
    }
    localStorage.setItem(BACKUP_KEY, JSON.stringify(dump));
  } catch (e) {}
}

function restore() {
  try {
    const saved = localStorage.getItem(BACKUP_KEY);
    if (!saved) {
      console.log('[webview-preload] no backup to restore');
      return;
    }
    const data = JSON.parse(saved);
    let count = 0;
    for (const k in data) {
      if (sessionStorage.getItem(k) === null) {
        sessionStorage.setItem(k, data[k]);
        count++;
      }
    }
    console.log('[webview-preload] restored', count, 'keys from backup');
  } catch (e) { console.warn('[webview-preload] restore failed', e); }
}

restore();

try {
  const proto = Storage.prototype;
  const origSet = proto.setItem;
  const origRemove = proto.removeItem;
  const origClear = proto.clear;

  proto.setItem = function (k, v) {
    const r = origSet.call(this, k, v);
    if (this === sessionStorage && k !== BACKUP_KEY) backup();
    return r;
  };
  proto.removeItem = function (k) {
    const r = origRemove.call(this, k);
    if (this === sessionStorage && k !== BACKUP_KEY) backup();
    return r;
  };
  proto.clear = function () {
    const r = origClear.call(this);
    if (this === sessionStorage) backup();
    return r;
  };
} catch (e) {}

window.addEventListener('beforeunload', backup);
window.addEventListener('pagehide', backup);
setInterval(backup, 3000);

// overdare 사이트의 쿠키 동의 배너 자동 자동 dismiss / 숨김.
// 사이트가 매 세션마다 다시 띄우는 동의 배너를 사용자에게 안 보이게 함.
function hideCookieBanners() {
  try {
    const host = location.hostname || '';
    if (!/overdare\.com$|ovdr\.io$/i.test(host)) return;
    // 텍스트로 배너를 찾아 숨기기 (DOM 구조에 의존 안 함)
    const banners = [];
    document.querySelectorAll('div, section, aside, footer').forEach((el) => {
      if (el.children.length > 6 || el.offsetHeight > 400) return;
      const t = (el.innerText || '').trim();
      if (!t) return;
      if (/cookie/i.test(t) && /(accept|settings|essential|consent)/i.test(t)) {
        banners.push(el);
      }
    });
    banners.forEach((b) => { try { b.style.display = 'none'; } catch (e) {} });
  } catch (e) {}
}
function startBannerHider() {
  hideCookieBanners();
  // SPA 이동 후에도 다시 떴을 수 있으니 주기 체크 (10초간)
  let n = 0;
  const t = setInterval(() => {
    hideCookieBanners();
    if (++n > 50) clearInterval(t);
  }, 200);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startBannerHider, { once: true });
} else {
  startBannerHider();
}
// URL 변경(SPA navigation) 시에도 다시 시도
try {
  const _push = history.pushState;
  const _replace = history.replaceState;
  history.pushState = function () { const r = _push.apply(this, arguments); startBannerHider(); return r; };
  history.replaceState = function () { const r = _replace.apply(this, arguments); startBannerHider(); return r; };
  window.addEventListener('popstate', startBannerHider);
} catch (e) {}
