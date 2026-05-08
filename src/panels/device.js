const APP_PKGS = ['com.overdare.overdare.dev', 'com.overdare.overdare'];

const SAMSUNG_MODEL_NAMES = {
  // Galaxy S25
  'SM-S931': 'Galaxy S25', 'SM-S936': 'Galaxy S25+', 'SM-S938': 'Galaxy S25 Ultra',
  // Galaxy S24
  'SM-S921': 'Galaxy S24', 'SM-S926': 'Galaxy S24+', 'SM-S928': 'Galaxy S24 Ultra', 'SM-S721': 'Galaxy S24 FE',
  // Galaxy S23
  'SM-S911': 'Galaxy S23', 'SM-S916': 'Galaxy S23+', 'SM-S918': 'Galaxy S23 Ultra', 'SM-S711': 'Galaxy S23 FE',
  // Galaxy S22
  'SM-S901': 'Galaxy S22', 'SM-S906': 'Galaxy S22+', 'SM-S908': 'Galaxy S22 Ultra',
  // Galaxy S21
  'SM-G991': 'Galaxy S21', 'SM-G996': 'Galaxy S21+', 'SM-G998': 'Galaxy S21 Ultra', 'SM-G781': 'Galaxy S21 FE',
  // Galaxy S20
  'SM-G981': 'Galaxy S20', 'SM-G986': 'Galaxy S20+', 'SM-G988': 'Galaxy S20 Ultra', 'SM-G780': 'Galaxy S20 FE',
  // Galaxy Note
  'SM-N980': 'Galaxy Note20', 'SM-N981': 'Galaxy Note20', 'SM-N985': 'Galaxy Note20 Ultra', 'SM-N986': 'Galaxy Note20 Ultra',
  'SM-N970': 'Galaxy Note10', 'SM-N971': 'Galaxy Note10', 'SM-N975': 'Galaxy Note10+', 'SM-N976': 'Galaxy Note10+',
  // Galaxy Z Fold
  'SM-F956': 'Galaxy Z Fold6', 'SM-F946': 'Galaxy Z Fold5', 'SM-F936': 'Galaxy Z Fold4',
  'SM-F926': 'Galaxy Z Fold3', 'SM-F916': 'Galaxy Z Fold2', 'SM-F900': 'Galaxy Z Fold',
  // Galaxy Z Flip
  'SM-F741': 'Galaxy Z Flip6', 'SM-F731': 'Galaxy Z Flip5', 'SM-F721': 'Galaxy Z Flip4',
  'SM-F711': 'Galaxy Z Flip3', 'SM-F700': 'Galaxy Z Flip',
  // Galaxy A
  'SM-A566': 'Galaxy A56', 'SM-A556': 'Galaxy A55', 'SM-A546': 'Galaxy A54', 'SM-A536': 'Galaxy A53',
  'SM-A525': 'Galaxy A52', 'SM-A336': 'Galaxy A33', 'SM-A235': 'Galaxy A23', 'SM-A135': 'Galaxy A13',
  'SM-A736': 'Galaxy A73', 'SM-A536B': 'Galaxy A53',
};

function getSamsungMarketName(model) {
  if (!model) return null;
  const base = model.replace(/[A-Z]$/, '').toUpperCase();
  return SAMSUNG_MODEL_NAMES[base] || SAMSUNG_MODEL_NAMES[model.substring(0, 7).toUpperCase()] || null;
}

const DevicePanel = {
  appInfo: null,
  detectedPkg: null,
  _appInfoBound: false,

  init() {
    if (!this._appInfoBound) {
      this._appInfoBound = true;
      this.setupAppInfoButton();
    }
  },

  async refresh() {
    this.detectedPkg = null;
    this.appInfo = null;
    if (App.currentDevice) {
      try { await window.api.crashRestartMonitor(App.currentDevice); } catch {}
    }
    const serverEl = document.getElementById('app-info-server');
    const unrealEl = document.getElementById('app-info-unreal');
    const appVerEl = document.getElementById('app-info-appver');
    const rnVerEl = document.getElementById('app-info-rnver');
    if (serverEl) serverEl.textContent = '-';
    if (unrealEl) unrealEl.textContent = '-';
    if (appVerEl) appVerEl.textContent = '-';
    if (rnVerEl) rnVerEl.textContent = '-';
    if (serverEl) serverEl.style.color = '';
    if (unrealEl) unrealEl.style.color = '';
    if (appVerEl) appVerEl.style.color = '';
    if (rnVerEl) rnVerEl.style.color = '';
    const copyBtn = document.getElementById('copy-app-info');
    if (copyBtn) copyBtn.style.display = 'none';

    const container = document.getElementById('device-info-content');
    if (!App.currentDevice) {
      container.innerHTML = '<p style="color:var(--text-muted)">디바이스를 선택하면 정보가 표시됩니다.</p>';
      return;
    }

    container.innerHTML = '<div class="loading-spinner"></div>';
    try {
      const info = await window.api.getDeviceInfo(App.currentDevice);
      container.innerHTML = this.renderInfo(info);
      this.renderDeviceVisual(info);
      document.querySelectorAll('#device-info-content .copyable, #device-visual .copyable').forEach((el) => {
        el.addEventListener('click', () => {
          const v = el.getAttribute('data-copy');
          if (!v) return;
          navigator.clipboard.writeText(v);
          App.toast('복사됨', 'info');
        });
      });
      this.loadLocales();
    } catch (e) {
      container.innerHTML = `<p style="color:var(--red)">정보 조회 실패: ${e.message}</p>`;
    }
  },

  renderDeviceVisual(info) {
    const el = document.getElementById('device-visual');
    if (!el) return;
    const model = info.model || 'Device';
    const marketName = info.marketName || getSamsungMarketName(info.model) || '';
    const android = info.androidVersion || '';
    const res = info.resolution || '';

    const bat = info.batteryLevel != null ? info.batteryLevel : null;
    const charging = info.batteryStatus === 'Charging';
    const batColor = bat == null ? '#555' : bat > 50 ? '#2DB400' : bat > 20 ? '#f5a623' : '#e64553';
    const batW = bat != null ? Math.max(1, Math.round(bat / 100 * 18)) : 0;

    const storage = info.storage;
    const storePct = storage ? Math.round(storage.used / storage.total * 100) : null;
    const storeColor = storePct == null ? '#555' : storePct > 80 ? '#e64553' : storePct > 60 ? '#f5a623' : '#89b4fa';
    const storeW = storePct != null ? Math.max(1, Math.round(storePct / 100 * 60)) : 0;

    const batLabel = bat != null ? `${bat}%${charging ? ' ⚡' : ''}` : '-';
    const storeLabel = storage ? `${App.formatBytes(storage.used * 1024)} / ${App.formatBytes(storage.total * 1024)}` : '-';

    const netBadgeMap = {
      WIFI:     { label: 'Wi-Fi',    bg: 'rgba(45,180,0,0.18)',   color: '#4ade80' },
      LTE:      { label: 'LTE',      bg: 'rgba(59,130,246,0.18)', color: '#60a5fa' },
      MOBILE:   { label: 'LTE',      bg: 'rgba(59,130,246,0.18)', color: '#60a5fa' },
      '5G':     { label: '5G',       bg: 'rgba(168,85,247,0.18)', color: '#c084fc' },
      ETHERNET: { label: 'LAN',      bg: 'rgba(100,116,139,0.18)',color: '#94a3b8' },
    };
    const nb = info.networkType ? (netBadgeMap[info.networkType] || { label: info.networkType, bg: 'rgba(100,116,139,0.18)', color: '#94a3b8' }) : null;
    const netRow = (nb || info.wifiIp) ? `
      <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:6px;flex-wrap:wrap">
        ${nb ? `<span style="background:${nb.bg};color:${nb.color};padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;letter-spacing:0.5px">${nb.label}</span>` : ''}
        ${info.wifiIp ? `<span class="copyable" data-copy="${info.wifiIp}" title="클릭하여 복사" style="font-size:11px;color:var(--text-muted);font-family:monospace;border-bottom:1px dashed var(--border-color);cursor:pointer">${info.wifiIp}</span>` : ''}
      </div>` : '';

    el.innerHTML = `
      <div style="text-align:center;padding:16px 8px;">
        <svg viewBox="0 0 120 240" width="140" style="filter:drop-shadow(0 4px 16px rgba(0,0,0,0.45))">
          <rect x="10" y="5" width="100" height="225" rx="16" fill="#1a1a2e" stroke="#3a3a5c" stroke-width="2"/>
          <rect x="16" y="28" width="88" height="174" rx="4" fill="#0d1117"/>
          <rect x="42" y="12" width="36" height="8" rx="4" fill="#2a2a4a"/>
          <circle cx="60" cy="16" r="2" fill="#3a3a5c"/>
          <circle cx="60" cy="218" r="7" fill="none" stroke="#3a3a5c" stroke-width="1.5"/>
          <text x="60" y="50" text-anchor="middle" fill="#89b4fa" font-size="9" font-family="sans-serif" font-weight="bold">${model}</text>
          ${marketName ? `<text x="60" y="60" text-anchor="middle" fill="#6b7db3" font-size="7" font-family="sans-serif">${marketName}</text>` : ''}
          <rect x="48" y="63" width="24" height="12" rx="2" fill="none" stroke="#555" stroke-width="1.2"/>
          <rect x="72" y="66" width="2.5" height="6" rx="1" fill="#555"/>
          ${bat != null ? `<rect x="49.5" y="64.5" width="${Math.round(bat / 100 * 21)}" height="9" rx="1.5" fill="${batColor}"/>` : ''}
          ${charging ? `<text x="60" y="73" text-anchor="middle" fill="#fff" font-size="7" font-family="sans-serif">&#x26A1;</text>` : ''}
          <text x="60" y="86" text-anchor="middle" fill="${batColor}" font-size="8" font-family="sans-serif" font-weight="bold">${bat != null ? `${bat}%` : '-'}</text>
          ${charging ? `<text x="60" y="96" text-anchor="middle" fill="#f5a623" font-size="7" font-family="sans-serif">충전 중</text>` : ''}
          <line x1="24" y1="94" x2="96" y2="94" stroke="#2a2a4a" stroke-width="1"/>
          <text x="24" y="107" fill="#666" font-size="7" font-family="sans-serif">Storage</text>
          <rect x="24" y="111" width="72" height="6" rx="3" fill="#1e2030"/>
          ${storePct != null ? `<rect x="24" y="111" width="${Math.round(storePct / 100 * 72)}" height="6" rx="3" fill="${storeColor}"/>` : ''}
          <text x="60" y="126" text-anchor="middle" fill="#aaa" font-size="7" font-family="sans-serif">${storeLabel}</text>
          <line x1="24" y1="133" x2="96" y2="133" stroke="#2a2a4a" stroke-width="1"/>
          <text x="60" y="147" text-anchor="middle" fill="#666" font-size="8" font-family="sans-serif">Android ${android || '-'}</text>
          <text x="60" y="159" text-anchor="middle" fill="#444" font-size="7" font-family="sans-serif">${res || ''}</text>
        </svg>
        ${netRow}
      </div>`;
  },

  async loadLocales() {
    if (!App.currentDevice) return;
    const selectEl = document.getElementById('locale-select');
    const applyBtn = document.getElementById('locale-apply-btn');
    if (!selectEl) return;

    // 고정 프리셋 (ADB Change Language 앱으로 모든 디바이스에 적용 가능)
    const PRESET_LOCALES = [
      { code: 'ko-KR',  label: '한국어 (ko-KR)' },
      { code: 'es-MX',  label: 'Español México (es-MX)' },
      { code: 'pt-BR',  label: 'Português Brasil (pt-BR)' },
      { code: 'hi-IN',  label: 'हिन्दी (hi-IN)' },
      { code: 'en-US',  label: 'English US (en-US)' },
      { code: 'th-TH',  label: 'ภาษาไทย (th-TH)' },
    ];

    // 현재 디바이스 언어를 맨 위에 선택된 상태로
    let currentLocale = null;
    try {
      const locales = await window.api.getDeviceLocales(App.currentDevice);
      if (locales && locales.length > 0) currentLocale = locales[0];
    } catch { /* ignore */ }

    const options = [...PRESET_LOCALES];
    // 현재 로케일이 프리셋에 없으면 맨 위에 추가
    if (currentLocale && !options.find(l => l.code === currentLocale)) {
      options.unshift({ code: currentLocale, label: `${currentLocale} (현재)` });
    }
    selectEl.innerHTML = options.map(l =>
      `<option value="${l.code}"${currentLocale === l.code ? ' selected' : ''}>${l.label}</option>`
    ).join('');
    selectEl.disabled = false;

    if (applyBtn && !applyBtn._bound) {
      applyBtn._bound = true;
      applyBtn.addEventListener('click', async () => {
        const selected = selectEl.value;
        if (!selected) return;
        applyBtn.disabled = true;
        applyBtn.textContent = '적용 중...';
        const result = await window.api.setDeviceLocale(App.currentDevice, selected);
        applyBtn.disabled = false;
        applyBtn.textContent = '적용';
        if (result.success) {
          App.toast(`언어 변경됨: ${selected}`, 'success');
          selectEl.value = selected;
        } else {
          App.toast(`실패: ${result.error}`, 'error');
        }
      });
    }
  },

  setupAppInfoButton() {
    const btn = document.getElementById('fetch-app-info');
    const copyBtn = document.getElementById('copy-app-info');
    if (btn) {
      btn.addEventListener('click', () => this.fetchAppInfo());
    }
    if (copyBtn) {
      copyBtn.addEventListener('click', () => this.copyAppInfo());
    }
  },

  async detectPkg() {
    if (!App.currentDevice) return null;
    try {
      const fg = await window.api.getForegroundPkg(App.currentDevice);
      if (fg && APP_PKGS.includes(fg)) return fg;
    } catch {}
    const pkgs = await window.api.listPackages(App.currentDevice);
    const names = pkgs.map(p => p.name);
    for (const candidate of APP_PKGS) {
      if (names.includes(candidate)) return candidate;
    }
    return APP_PKGS[0];
  },

  async fetchAppInfo() {
    if (!App.currentDevice) return;
    const btn = document.getElementById('fetch-app-info');
    if (btn) {
      btn.textContent = '조회 중...';
      btn.disabled = true;
    }

    try {
      this.detectedPkg = await this.detectPkg();
      const pkg = this.detectedPkg;

      if (pkg) {
        try { await window.api.crashSetWatchedApp(pkg); } catch {}
      }

      const info = await window.api.getRunningAppInfo(App.currentDevice, pkg);
      info.buildType = pkg.endsWith('.dev') ? 'DEV' : 'RELEASE';
      this.appInfo = info;

      const serverEl = document.getElementById('app-info-server');
      const unrealEl = document.getElementById('app-info-unreal');
      const appVerEl = document.getElementById('app-info-appver');
      const rnVerEl = document.getElementById('app-info-rnver');

      if (serverEl) serverEl.textContent = info.server || '-';
      if (unrealEl) unrealEl.textContent = info.unrealVersion || '-';
      if (appVerEl) appVerEl.textContent = info.appVersion || '-';
      if (rnVerEl) rnVerEl.textContent = info.rnVersion || '-';

      const okColor = '#2DB400';
      if (serverEl && info.server) { serverEl.style.color = okColor; serverEl.style.fontWeight = '700'; }
      if (unrealEl && info.unrealVersion) { unrealEl.style.color = okColor; unrealEl.style.fontWeight = '700'; }
      if (appVerEl && info.appVersion) { appVerEl.style.color = okColor; appVerEl.style.fontWeight = '700'; }
      if (rnVerEl && info.rnVersion) { rnVerEl.style.color = okColor; rnVerEl.style.fontWeight = '700'; }

      const copyBtn = document.getElementById('copy-app-info');
      if (copyBtn) copyBtn.style.display = 'inline-block';
    } finally {
      if (btn) {
        btn.textContent = '앱 정보 조회';
        btn.disabled = false;
      }
    }
  },

  copyAppInfo() {
    if (!this.appInfo) return;
    const ver = this.appInfo.appVersion || '-';
    const rn = this.appInfo.rnVersion || '-';
    const text = `서버환경 : ${this.appInfo.server || '-'}\n언리얼버전 : ${this.appInfo.unrealVersion || '-'}\n앱버전 : ${ver}\nRN버전 : ${rn}`;
    navigator.clipboard.writeText(text);
    App.toast('앱 정보 복사됨', 'success');
  },

  renderInfo(info) {
    const storageHtml = '';

    return `
      <div class="card">
        <div class="card-title">기본 정보</div>
        <div class="info-grid">
          <div class="info-item"><label>모델</label><span>${info.model || '-'}${(info.marketName || getSamsungMarketName(info.model)) ? ` <span style="color:var(--text-muted);font-size:11px">(${info.marketName || getSamsungMarketName(info.model)})</span>` : ''}</span></div>
          <div class="info-item"><label>제조사</label><span>${info.manufacturer || '-'}</span></div>
          <div class="info-item"><label>브랜드</label><span>${info.brand || '-'}</span></div>
          <div class="info-item"><label>시리얼</label><span class="copyable" data-copy="${info.serial || ''}" title="클릭하여 복사">${info.serial || '-'}</span></div>
          <div class="info-item"><label>Android ID</label><span class="copyable" data-copy="${info.androidId || ''}" title="클릭하여 복사">${info.androidId || '-'}</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">시스템</div>
        <div class="info-grid">
          <div class="info-item"><label>Android</label><span>${info.androidVersion || '-'}</span></div>
          <div class="info-item"><label>API Level</label><span>${info.apiLevel || '-'}</span></div>
          <div class="info-item"><label>OneUI</label><span>${info.oneUiVersion ? (parseInt(info.oneUiVersion) / 10000).toFixed(1) : '-'}</span></div>
          <div class="info-item"><label>빌드 넘버</label><span>${info.buildNumber || '-'}</span></div>
          <div class="info-item"><label>보안 패치</label><span>${info.securityPatch || '-'}</span></div>
          <div class="info-item" style="grid-column:1/-1">
            <label>언어/지역</label>
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <select id="locale-select" class="input" style="flex:1;min-width:140px;max-width:240px;padding:3px 6px;height:28px"></select>
              <button class="btn btn-primary btn-sm" id="locale-apply-btn" style="height:28px;padding:0 10px">적용</button>
            </div>
          </div>
          <div class="info-item"><label>타임존</label><span>${info.timezone || '-'}</span></div>
          <div class="info-item"><label>디바이스 시각</label><span>${info.deviceTime || '-'}</span></div>
          <div class="info-item" style="grid-column:1/-1"><label>Fingerprint</label><span class="copyable" data-copy="${info.fingerprint || ''}" title="클릭하여 복사" style="font-size:11px;font-family:monospace;word-break:break-all">${info.fingerprint || '-'}</span></div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">하드웨어 / 그래픽</div>
        <div class="info-grid">
          <div class="info-item"><label>해상도</label><span>${info.resolution || '-'}</span></div>
          <div class="info-item"><label>DPI</label><span>${info.density || '-'}</span></div>
          <div class="info-item"><label>주사율</label><span>${info.refreshRate ? info.refreshRate + 'Hz' : '-'}</span></div>
          <div class="info-item"><label>CPU 칩셋</label><span>${info.chipset || '-'}</span></div>
          <div class="info-item"><label>CPU ABI</label><span>${info.cpuAbi || '-'}</span></div>
          <div class="info-item"><label>RAM</label><span>${info.ramTotalKb ? App.formatBytes(info.ramTotalKb * 1024) : '-'}</span></div>
          <div class="info-item"><label>RAM 가용</label><span>${info.ramAvailableKb ? App.formatBytes(info.ramAvailableKb * 1024) : '-'}</span></div>
          <div class="info-item" style="grid-column:1/-1"><label>GPU</label><span style="font-size:12px">${info.gpuRenderer || info.gpuEgl || '-'}</span></div>
        </div>
      </div>
    `;
  },
};
