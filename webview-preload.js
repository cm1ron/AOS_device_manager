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
