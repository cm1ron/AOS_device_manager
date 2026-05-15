// Install App panel — OVERDARE builds (dev + shipping in two columns)
const VARIANT_PACKAGE = {
  dev: 'com.overdare.overdare.dev',
  shipping: 'com.overdare.overdare',
};

const CACHE_KEY = 'overdare:releases-cache';
const TAGS_KEY = 'overdare:release-tags'; // { [releaseId]: ['검증완료', '이슈있음', ...] }

function _readTags() {
  try { return JSON.parse(localStorage.getItem(TAGS_KEY) || '{}'); } catch { return {}; }
}
function _writeTags(m) {
  try { localStorage.setItem(TAGS_KEY, JSON.stringify(m)); } catch {}
}
function getTagsFor(releaseId) {
  return _readTags()[releaseId] || [];
}
function addTagFor(releaseId, tag) {
  const t = String(tag || '').trim().slice(0, 30);
  if (!t) return false;
  const m = _readTags();
  const list = m[releaseId] || [];
  if (list.includes(t)) return false;
  list.push(t);
  m[releaseId] = list;
  _writeTags(m);
  return true;
}
function removeTagFor(releaseId, tag) {
  const m = _readTags();
  const list = m[releaseId] || [];
  m[releaseId] = list.filter((x) => x !== tag);
  if (!m[releaseId].length) delete m[releaseId];
  _writeTags(m);
}
// 텍스트 → HSL 색상 (해시 기반, 항상 같은 태그는 같은 색)
function tagColor(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 70%, 45%)`;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const AppsPanel = {
  releases: { dev: [], shipping: [] },
  cachedAt: null,
  busy: false,
  installing: null, // `${variant}:${releaseId}` while installing
  installProgress: {}, // { serial: {percent, message, ok} } for current install
  devices: [],
  selectedSerials: new Set(),
  installedVersions: {}, // { serial: { 'com.overdare.overdare.dev': 'X', 'com.overdare.overdare': 'Y' } }

  init() {
    document.querySelectorAll('.overdare-col-refresh').forEach((btn) => {
      btn.addEventListener('click', () => this.refreshVariant(btn.dataset.variant));
    });
    document.getElementById('overdare-search').addEventListener('input', () => this.renderAll());

    document.getElementById('overdare-settings').addEventListener('click', () => this.openSettings());
    document.getElementById('overdare-settings-close').addEventListener('click', () => this.closeSettings());
    document.getElementById('overdare-settings-cancel').addEventListener('click', () => this.closeSettings());
    document.getElementById('overdare-settings-save').addEventListener('click', () => this.saveSettings());

    document.getElementById('overdare-devices-all').addEventListener('click', () => this.toggleSelectAllDevices());

    if (window.api && window.api.overdare && window.api.overdare.onProgress) {
      window.api.overdare.onProgress((p) => this.onProgress(p));
    }
    if (window.api && window.api.onDevicesChanged) {
      window.api.onDevicesChanged((devices) => this.updateDevices(devices));
    }

    this.loadCache();
    this.loadDevices();
  },

  async loadDevices() {
    try {
      const list = await window.api.getDevices();
      this.updateDevices(list || []);
    } catch {}
  },

  updateDevices(devices) {
    this.devices = devices || [];
    // 자동: 현재 단일 선택된 디바이스를 기본 체크 (selectedSerials가 비어 있을 때만)
    const validSerials = new Set(this.devices.map((d) => d.serial));
    for (const s of [...this.selectedSerials]) {
      if (!validSerials.has(s)) this.selectedSerials.delete(s);
    }
    if (this.selectedSerials.size === 0 && App.currentDevice && validSerials.has(App.currentDevice)) {
      this.selectedSerials.add(App.currentDevice);
    }
    this.renderDevices();
    this.refreshInstalledVersions();
  },

  async refreshInstalledVersions() {
    const targets = [...this.selectedSerials];
    if (!targets.length) {
      this.installedVersions = {};
      this.renderAll();
      return;
    }
    try {
      const res = await window.api.overdare.getInstalledVersions({ serials: targets });
      if (res && res.success) {
        this.installedVersions = res.versions || {};
        this.renderAll();
      }
    } catch {}
  },

  renderDevices() {
    const wrap = document.getElementById('overdare-devices-list');
    if (!wrap) return;
    const cnt = document.getElementById('overdare-devices-count');
    if (cnt) cnt.textContent = `${this.selectedSerials.size}/${this.devices.length}`;
    if (!this.devices.length) {
      wrap.innerHTML = '<span class="overdare-devices-empty">연결된 디바이스 없음</span>';
      return;
    }
    const aliases = (App && App.deviceAliases) || {};
    wrap.innerHTML = this.devices.map((d) => {
      const checked = this.selectedSerials.has(d.serial);
      const label = aliases[d.serial] || d.model || d.serial;
      return `
        <label class="overdare-device-row ${checked ? 'on' : ''}" data-serial="${d.serial}">
          <span class="overdare-device-info">
            <span class="overdare-device-name">${label}</span>
            <span class="overdare-device-serial">${d.serial}</span>
          </span>
          <span class="overdare-device-toggle">
            <input type="checkbox" data-serial="${d.serial}" ${checked ? 'checked' : ''}>
            <span class="overdare-toggle-track"><span class="overdare-toggle-thumb"></span></span>
          </span>
        </label>`;
    }).join('');
    wrap.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) this.selectedSerials.add(cb.dataset.serial);
        else this.selectedSerials.delete(cb.dataset.serial);
        const row = cb.closest('.overdare-device-row');
        if (row) row.classList.toggle('on', cb.checked);
        const cnt = document.getElementById('overdare-devices-count');
        if (cnt) cnt.textContent = `${this.selectedSerials.size}/${this.devices.length}`;
        this.refreshInstalledVersions();
      });
    });
  },

  toggleSelectAllDevices() {
    if (!this.devices.length) return;
    const allOn = this.devices.every((d) => this.selectedSerials.has(d.serial));
    this.selectedSerials.clear();
    if (!allOn) this.devices.forEach((d) => this.selectedSerials.add(d.serial));
    this.renderDevices();
    this.refreshInstalledVersions();
  },

  loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      this.releases.dev = Array.isArray(data.dev) ? data.dev : [];
      this.releases.shipping = Array.isArray(data.shipping) ? data.shipping : [];
      this.cachedAt = data.cachedAt || null;
      const cnt = (v) => document.getElementById(`overdare-count-${v}`);
      if (cnt('dev')) cnt('dev').textContent = String(this.releases.dev.length);
      if (cnt('shipping')) cnt('shipping').textContent = String(this.releases.shipping.length);
      this.renderAll();
      if (this.cachedAt) {
        const dt = new Date(this.cachedAt).toLocaleString();
        this.setStatus(`캐시 로드 (마지막 갱신: ${dt}) — 최신 빌드를 보려면 새로고침`);
      }
    } catch { /* ignore corrupt cache */ }
  },

  saveCache() {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        dev: this.releases.dev,
        shipping: this.releases.shipping,
        cachedAt: Date.now(),
      }));
    } catch { /* quota — ignore */ }
  },

  setStatus(msg) {
    const el = document.getElementById('overdare-status');
    if (el) el.textContent = msg || '';
  },

  openSettings() {
    document.getElementById('overdare-settings-modal').style.display = 'flex';
    window.api.overdare.getSettings().then((s) => {
      document.getElementById('overdare-token').value = s.token || '';
    });
  },
  closeSettings() {
    document.getElementById('overdare-settings-modal').style.display = 'none';
  },
  async saveSettings() {
    const token = document.getElementById('overdare-token').value.trim();
    await window.api.overdare.saveSettings({ token });
    this.closeSettings();
    App.toast('설정 저장됨', 'success');
  },

  async refreshVariant(variant) {
    if (!variant || !VARIANT_PACKAGE[variant]) return;
    if (this.busy) return App.toast('이미 진행 중입니다 (다른 작업 완료 대기)', 'info');
    const settings = await window.api.overdare.getSettings();
    if (!settings.token) {
      App.toast('먼저 GitHub PAT 를 설정해주세요', 'error');
      return this.openSettings();
    }
    this.busy = true;
    this.setStatus(`[${variant}] 빌드 목록 가져오는 중... (30~90초)`);
    const list = document.getElementById(`overdare-list-${variant}`);
    if (list) list.innerHTML = '<div class="overdare-loading">불러오는 중...</div>';
    const cnt = document.getElementById(`overdare-count-${variant}`);
    if (cnt) cnt.textContent = '...';
    const refreshBtn = document.querySelector(`.overdare-col-refresh[data-variant="${variant}"]`);
    if (refreshBtn) refreshBtn.disabled = true;

    let res;
    try {
      res = await window.api.overdare.listReleases({ token: settings.token, variant, pageSize: 30 });
    } catch (e) {
      res = { success: false, error: e.message };
    }
    this.busy = false;
    if (refreshBtn) refreshBtn.disabled = false;

    const ts = new Date().toLocaleTimeString();
    if (res.success) {
      this.releases[variant] = res.items || [];
      if (cnt) cnt.textContent = `${this.releases[variant].length}`;
      this.saveCache();
      this.setStatus(`✓ [${variant}] ${this.releases[variant].length}개 빌드 (${ts})`);
      this.renderColumn(variant);
    } else {
      if (cnt) cnt.textContent = '!';
      if (list) list.innerHTML = `<div class="overdare-empty">✗ ${res.error || '실패'}</div>`;
      this.setStatus(`✗ [${variant}] 실패: ${res.error || ''} (${ts})`);
    }
  },

  renderAll() {
    ['dev', 'shipping'].forEach((v) => this.renderColumn(v));
  },

  renderColumn(variant) {
    const list = document.getElementById(`overdare-list-${variant}`);
    if (!list) return;
    const filter = (document.getElementById('overdare-search').value || '').toLowerCase();
    const items = this.releases[variant].filter((r) => {
      if (!filter) return true;
      const tags = getTagsFor(r.releaseId).join(' ');
      return ((r.displayVersion || '') + ' ' + (r.buildVersion || '') + ' ' + (r.releaseNotes || '') + ' ' + tags).toLowerCase().includes(filter);
    });
    if (!items.length) {
      list.innerHTML = '<div class="overdare-empty">표시할 빌드가 없습니다.</div>';
      return;
    }
    list.innerHTML = items.map((r) => this.renderCard(r, variant)).join('');
    list.querySelectorAll('[data-action="install"]').forEach((btn) => {
      btn.addEventListener('click', () => this.installRelease(btn.dataset.variant, btn.dataset.releaseId));
    });
    list.querySelectorAll('[data-action="tag-remove"]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeTagFor(btn.dataset.releaseId, btn.dataset.tag);
        this.renderColumn(variant);
      });
    });
    list.querySelectorAll('[data-action="tag-add"]').forEach((btn) => {
      btn.addEventListener('click', () => this._showTagInput(btn.dataset.releaseId, variant));
    });
    list.querySelectorAll('[data-tag-input]').forEach((inp) => {
      const commit = (save) => {
        if (save && inp.value.trim()) {
          addTagFor(inp.dataset.releaseId, inp.value);
        }
        this._tagEditing = null;
        this.renderColumn(variant);
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commit(true); }
        else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
      });
      inp.addEventListener('blur', () => commit(true));
    });
  },

  _showTagInput(releaseId, variant) {
    this._tagEditing = `${variant}:${releaseId}`;
    this.renderColumn(variant);
    const inp = document.querySelector(`[data-tag-input][data-release-id="${releaseId}"]`);
    if (inp) inp.focus();
  },

  renderCard(r, variant) {
    const isInstalling = this.installing === `${variant}:${r.releaseId}`;
    const date = r.createTime ? new Date(r.createTime).toLocaleString() : '';
    const notes = (r.releaseNotes || '').replace(/[<>]/g, '');
    const aliases = (App && App.deviceAliases) || {};
    const pkg = VARIANT_PACKAGE[variant];
    const matched = [];
    for (const s of this.selectedSerials) {
      const installed = (this.installedVersions[s] || {})[pkg];
      if (!installed) continue;
      const dv = String(r.displayVersion || '').trim();
      const bv = String(r.buildVersion || '').trim();
      const inst = String(installed).trim();
      if (
        (dv && (inst === dv || inst.includes(dv) || dv.includes(inst))) ||
        (bv && inst.endsWith('.' + bv))
      ) {
        matched.push({ serial: s, label: aliases[s] || (this.devices.find((d) => d.serial === s)?.model) || s });
      }
    }
    const matchedHtml = matched.length
      ? `<span class="overdare-installed-tags" title="이 빌드가 설치된 디바이스">${matched.map((m) => `<span class="overdare-installed-tag" title="${m.serial}">✓ ${m.label}</span>`).join('')}</span>`
      : '';
    let progressBlock = '';
    if (isInstalling) {
      const rows = (this.installProgress && Object.keys(this.installProgress).length)
        ? Object.entries(this.installProgress).map(([s, p]) => {
            const label = aliases[s] || s;
            const cls = p.ok === false ? 'fail' : (p.ok === true ? 'done' : '');
            return `
              <div class="overdare-dev-progress ${cls}">
                <div class="dev-name">${label}</div>
                <div class="bar-wrap"><div class="bar" style="width:${Math.min(100, p.percent || 0)}%"></div></div>
                <div class="dev-msg">${(p.message || '').replace(/[<>]/g, '')}</div>
              </div>`;
          }).join('')
        : '<div class="overdare-dev-progress"><div class="dev-msg">준비 중...</div></div>';
      progressBlock = `<div class="overdare-multi-progress">${rows}</div>`;
    }
    const tags = getTagsFor(r.releaseId);
    const editing = this._tagEditing === `${variant}:${r.releaseId}`;
    const tagsHtml = tags.map((t) => `
      <span class="overdare-tag" style="background:${tagColor(t)}">
        <span class="t">${escapeHtml(t)}</span>
        <button class="x" data-action="tag-remove" data-release-id="${r.releaseId}" data-tag="${escapeHtml(t)}" title="삭제">×</button>
      </span>`).join('');
    const tagsBlock = `
      <div class="overdare-tags">
        ${tagsHtml}
        ${editing
          ? `<input class="overdare-tag-input" data-tag-input data-release-id="${r.releaseId}" placeholder="태그 입력 후 Enter" maxlength="30" />`
          : `<button class="overdare-tag-add" data-action="tag-add" data-release-id="${r.releaseId}" title="태그 추가">+ 태그</button>`}
      </div>`;
    return `
      <div class="overdare-card" data-release-id="${r.releaseId}">
        <div class="overdare-card-main">
          <div class="overdare-card-title">${r.displayVersion || '(no version)'}</div>
          <div class="overdare-card-meta">build ${r.buildVersion || '-'} · ${date}</div>
          ${notes ? `<div class="overdare-card-notes">${notes}</div>` : ''}
          ${tagsBlock}
          ${progressBlock}
        </div>
        <div class="overdare-card-actions">
          ${matchedHtml}
          <button class="btn btn-sm btn-primary" data-action="install" data-variant="${variant}" data-release-id="${r.releaseId}" ${isInstalling ? 'disabled' : ''}>
            ${isInstalling ? '설치 중...' : '설치'}
          </button>
        </div>
      </div>`;
  },

  async installRelease(variant, releaseId) {
    const targets = [...this.selectedSerials];
    if (!targets.length) return App.toast('설치할 디바이스를 선택해주세요', 'error');
    if (this.busy) return App.toast('이미 진행 중입니다', 'info');
    const release = (this.releases[variant] || []).find((r) => r.releaseId === releaseId);
    if (!release) return;
    const settings = await window.api.overdare.getSettings();
    if (!settings.token) return App.toast('GitHub PAT 미설정', 'error');

    this.busy = true;
    this.installing = `${variant}:${releaseId}`;
    this.installProgress = {};
    targets.forEach((s) => { this.installProgress[s] = { percent: 0, message: '대기 중...' }; });
    this.renderColumn(variant);

    this.setStatus(`[${variant}] 서명 URL 발급 중... (${release.displayVersion})`);
    const urlRes = await window.api.overdare.getDownloadUrl({ token: settings.token, variant, releaseId });
    if (!urlRes.success || !urlRes.binaryDownloadUri) {
      this.busy = false; this.installing = null; this.installProgress = {}; this.renderColumn(variant);
      this.setStatus(`✗ 다운로드 URL 실패: ${urlRes.error || 'no uri'}`);
      return App.toast(`URL 실패: ${urlRes.error || 'no uri'}`, 'error');
    }

    this.setStatus(`[${variant}] APK 다운로드 → ${targets.length}대 병렬 설치 중...`);
    const fileName = `overdare-${variant}-${release.buildVersion || release.releaseId}.apk`;
    const packageName = VARIANT_PACKAGE[variant];
    const res = await window.api.overdare.downloadAndInstall({
      serials: targets,
      downloadUri: urlRes.binaryDownloadUri,
      fileName,
      packageName,
    });
    this.busy = false;
    const okCnt = (res.perDevice || []).filter((r) => r.success).length;
    const failCnt = (res.perDevice || []).filter((r) => !r.success).length;
    if (res.success) {
      this.setStatus(`✓ 설치 완료: [${variant}] ${release.displayVersion} (${okCnt}대)`);
      App.toast(`설치 완료 (${okCnt}대)`, 'success');
    } else if (okCnt > 0) {
      this.setStatus(`⚠ 부분 성공: ${okCnt} / ${okCnt + failCnt}대 — ${res.error || ''}`);
      App.toast(`부분 성공: ${okCnt}/${okCnt + failCnt}대`, 'info');
    } else {
      this.setStatus(`✗ 설치 실패: ${res.error || ''}`);
      App.toast(`설치 실패: ${res.error || ''}`, 'error');
    }
    // 카드의 진행률은 잠깐 유지 후 정리
    setTimeout(() => {
      this.installing = null;
      this.installProgress = {};
      this.renderColumn(variant);
    }, 4000);
    // 설치된 버전 다시 조회 → 매칭 태그 갱신
    this.refreshInstalledVersions();
  },

  onProgress(p) {
    if (!p) return;
    if (p.stage === 'download') {
      if (p.message) this.setStatus(p.message);
      // 다운로드 중에는 모든 디바이스 카드 진행률을 같이 보여줌 (진행률은 0~30%로 매핑)
      if (this.installing && typeof p.percent === 'number') {
        Object.keys(this.installProgress).forEach((s) => {
          this.installProgress[s] = { ...this.installProgress[s], percent: Math.round(p.percent * 0.3), message: `다운로드 ${p.percent}%` };
        });
        this.repaintCurrentCard();
      }
      return;
    }
    if (p.stage === 'install' && p.serial && this.installing) {
      this.installProgress[p.serial] = {
        percent: typeof p.percent === 'number' ? p.percent : (this.installProgress[p.serial] || {}).percent || 0,
        message: p.message || '',
        ok: typeof p.ok === 'boolean' ? p.ok : undefined,
      };
      this.repaintCurrentCard();
      return;
    }
    if (p.message) this.setStatus(p.message);
  },

  repaintCurrentCard() {
    if (!this.installing) return;
    const [variant] = this.installing.split(':');
    this.renderColumn(variant);
  },
};

document.addEventListener('DOMContentLoaded', () => AppsPanel.init());
