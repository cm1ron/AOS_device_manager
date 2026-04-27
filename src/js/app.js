const App = {
  currentDevice: null,
  currentPanel: 'device',
  deviceAliases: {},

  init() {
    this.setupTheme();
    this.setupNav();
    this.setupDeviceSelector();
    this.setupWireless();
    this.setupRenameModal();
    this.loadDevices();

    if (window.api.onWirelessAutoReconnect) {
      window.api.onWirelessAutoReconnect((results) => {
        const ok = results.filter((r) => r.success).map((r) => r.address);
        const fail = results.filter((r) => !r.success).map((r) => r.address);
        if (ok.length) this.toast(`무선 자동 재연결 성공: ${ok.join(', ')}`, 'success');
        if (fail.length) this.toast(`무선 자동 재연결 실패: ${fail.join(', ')}`, 'info');
        if (ok.length) this.loadDevices();
      });
    }
  },

  setupTheme() {
    const saved = localStorage.getItem('app-theme') || 'dark';
    this.applyTheme(saved);
    const btn = document.getElementById('theme-toggle-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        const next = (document.documentElement.getAttribute('data-theme') === 'light') ? 'dark' : 'light';
        this.applyTheme(next);
        localStorage.setItem('app-theme', next);
      });
    }
  },

  applyTheme(theme) {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    const dark = document.getElementById('theme-icon-dark');
    const light = document.getElementById('theme-icon-light');
    if (dark && light) {
      if (theme === 'light') { dark.style.display = 'none'; light.style.display = ''; }
      else { dark.style.display = ''; light.style.display = 'none'; }
    }
  },

  setupNav() {
    document.querySelectorAll('.nav-btn[data-panel]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.switchPanel(btn.dataset.panel);
      });
    });
  },

  switchPanel(name) {
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelector(`.nav-btn[data-panel="${name}"]`).classList.add('active');
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    document.getElementById(`panel-${name}`).classList.add('active');
    this.currentPanel = name;

    if (name === 'apps' && this.currentDevice && typeof AppsPanel !== 'undefined' && !AppsPanel.packages.length) {
      AppsPanel.loadPackages();
    }
  },

  setupDeviceSelector() {
    const sel = document.getElementById('device-selector');
    sel.addEventListener('change', () => {
      this.currentDevice = sel.value || null;
      this.onDeviceChanged();
    });
    window.api.onDevicesChanged((devices) => this.updateDeviceList(devices));

    const renameBtn = document.getElementById('rename-device-btn');
    if (renameBtn) {
      renameBtn.addEventListener('click', () => {
        if (!this.currentDevice) return this.toast('디바이스를 먼저 선택하세요', 'error');
        this.renameDevice(this.currentDevice);
      });
    }
  },

  async loadDevices() {
    if (window.api.getDeviceAliases) {
      try { this.deviceAliases = await window.api.getDeviceAliases(); } catch {}
    }
    const devices = await window.api.getDevices();
    this.updateDeviceList(devices);
  },

  formatDeviceLabel(d) {
    const alias = this.deviceAliases && this.deviceAliases[d.serial];
    if (alias) return `${alias} (${d.serial})`;
    return `${d.model} (${d.serial})`;
  },

  renameDevice(serial) {
    const modal = document.getElementById('rename-modal');
    const input = document.getElementById('rename-input');
    const serialEl = document.getElementById('rename-serial');
    if (!modal || !input || !serialEl) return;
    const current = (this.deviceAliases && this.deviceAliases[serial]) || '';
    serialEl.textContent = serial;
    input.value = current;
    modal.style.display = 'flex';
    setTimeout(() => { input.focus(); input.select(); }, 50);
    this._renameTargetSerial = serial;
  },

  setupRenameModal() {
    const modal = document.getElementById('rename-modal');
    const input = document.getElementById('rename-input');
    if (!modal || !input) return;
    const close = () => { modal.style.display = 'none'; this._renameTargetSerial = null; };
    const save = async () => {
      const serial = this._renameTargetSerial;
      if (!serial) return close();
      const value = input.value;
      if (window.api.setDeviceAlias) {
        this.deviceAliases = await window.api.setDeviceAlias(serial, value);
        this.loadDevices();
        this.renderRememberedWireless();
        this.toast(value.trim() ? `별칭 저장: ${value.trim()}` : '별칭 제거됨', 'success');
      }
      close();
    };
    document.getElementById('rename-cancel').addEventListener('click', close);
    document.getElementById('rename-save').addEventListener('click', save);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') save();
      else if (e.key === 'Escape') close();
    });
  },

  updateDeviceList(devices) {
    const sel = document.getElementById('device-selector');
    const dot = document.getElementById('status-dot');
    const prev = sel.value;

    sel.innerHTML = '';
    if (!devices.length) {
      sel.innerHTML = '<option value="">디바이스를 연결해주세요...</option>';
      dot.classList.add('disconnected');
      this.currentDevice = null;
      this.onDeviceChanged();
      return;
    }

    const unique = devices.filter(d => !d.serial.startsWith('adb-'));

    dot.classList.remove('disconnected');
    unique.forEach((d) => {
      const opt = document.createElement('option');
      opt.value = d.serial;
      opt.textContent = this.formatDeviceLabel(d);
      sel.appendChild(opt);
    });

    if (prev && unique.find((d) => d.serial === prev)) {
      sel.value = prev;
    } else if (unique.length) {
      sel.value = unique[0].serial;
    }
    this.currentDevice = sel.value;
    this.onDeviceChanged();
  },

  onDeviceChanged() {
    if (typeof MirrorInspector !== 'undefined') {
      try { MirrorInspector.cleanupForDeviceSwitch(); } catch (e) { console.warn(e); }
    }
    if (typeof LogcatPanel !== 'undefined' && LogcatPanel.running) {
      try { LogcatPanel.toggle(); } catch (e) {}
    }
    if (typeof DevicePanel !== 'undefined') DevicePanel.refresh();
    if (typeof AppsPanel !== 'undefined') {
      AppsPanel.packages = [];
      if (this.currentDevice && this.currentPanel === 'apps') {
        AppsPanel.loadPackages();
      }
    }
  },

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  },

  async renderRememberedWireless() {
    if (!window.api.getRememberedWireless) return;
    const section = document.getElementById('remembered-wireless-section');
    const listEl = document.getElementById('remembered-wireless-list');
    if (!section || !listEl) return;
    const list = await window.api.getRememberedWireless();
    if (!list || !list.length) {
      section.style.display = 'none';
      listEl.innerHTML = '';
      return;
    }
    section.style.display = '';
    listEl.innerHTML = '';
    list.forEach((item) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center;justify-content:space-between;padding:4px 8px;background:var(--bg-hover);color:var(--text-primary);border:1px solid var(--border);border-radius:4px;font-size:12px';
      const alias = this.deviceAliases && this.deviceAliases[item.address];
      const label = document.createElement('span');
      label.textContent = alias ? `${alias} — ${item.address}` : item.address;
      label.style.cssText = 'flex:1;font-family:monospace';
      const renameBtn = document.createElement('button');
      renameBtn.className = 'btn btn-sm';
      renameBtn.textContent = '이름';
      renameBtn.title = '별칭 변경';
      renameBtn.addEventListener('click', () => this.renameDevice(item.address, item.address));
      const reconnectBtn = document.createElement('button');
      reconnectBtn.className = 'btn btn-sm';
      reconnectBtn.textContent = '재연결';
      reconnectBtn.addEventListener('click', async () => {
        const status = document.getElementById('wireless-status');
        status.textContent = `${item.address} 연결 중...`;
        status.style.color = 'var(--text-muted)';
        const r = await window.api.connectWireless(item.address);
        if (r.success) {
          status.textContent = '무선 연결 성공!';
          status.style.color = 'var(--green)';
          this.toast(`무선 연결 성공: ${item.address}`, 'success');
          this.wirelessAddress = item.address;
          document.getElementById('wireless-disconnect-btn').style.display = '';
          document.getElementById('wireless-modal').style.display = 'none';
          this.loadDevices();
        } else {
          status.textContent = `연결 실패: ${r.output}`;
          status.style.color = 'var(--red)';
          this.toast('연결 실패', 'error');
        }
      });
      const forgetBtn = document.createElement('button');
      forgetBtn.className = 'btn btn-sm';
      forgetBtn.textContent = '잊기';
      forgetBtn.addEventListener('click', async () => {
        await window.api.forgetWireless(item.address);
        this.renderRememberedWireless();
      });
      row.appendChild(label);
      row.appendChild(renameBtn);
      row.appendChild(reconnectBtn);
      row.appendChild(forgetBtn);
      listEl.appendChild(row);
    });
  },

  setupWireless() {
    const modal = document.getElementById('wireless-modal');
    const status = document.getElementById('wireless-status');

    document.getElementById('wireless-connect-btn').addEventListener('click', () => {
      modal.style.display = 'flex';
      this.renderRememberedWireless();
    });
    document.getElementById('wireless-modal-close').addEventListener('click', () => {
      modal.style.display = 'none';
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.style.display = 'none';
    });

    document.getElementById('wireless-fix-port').addEventListener('click', async () => {
      if (!this.currentDevice) return this.toast('연결된 디바이스가 없습니다 (USB 또는 무선)', 'error');
      const isWireless = this.currentDevice.includes(':');
      status.textContent = isWireless
        ? '무선 연결로 5555 포트 고정 중... (잠시 끊겼다 재연결됩니다)'
        : '5555 포트로 고정 중... (tcpip → IP 조회 → connect)';
      status.style.color = 'var(--text-muted)';
      const result = await window.api.setupFixedPort(this.currentDevice);
      if (result.success) {
        status.textContent = `✅ 고정 완료! ${result.address}로 연결되었습니다. 다음부터 자동 재연결됩니다.`;
        status.style.color = 'var(--green)';
        this.toast(`5555 포트 고정 성공: ${result.address}`, 'success');
        this.wirelessAddress = result.address;
        document.getElementById('wireless-disconnect-btn').style.display = '';
        this.renderRememberedWireless();
        this.loadDevices();
        setTimeout(() => { modal.style.display = 'none'; }, 1500);
      } else {
        const stepMsg = { ip: 'IP 조회 실패', tcpip: 'tcpip 모드 전환 실패', connect: '연결 실패', exception: '오류' }[result.step] || '실패';
        status.textContent = `❌ ${stepMsg}: ${result.output}`;
        status.style.color = 'var(--red)';
        this.toast(stepMsg, 'error');
      }
    });

    document.getElementById('wireless-auto-ip').addEventListener('click', async () => {
      if (!this.currentDevice) return this.toast('USB로 연결된 디바이스가 없습니다', 'error');
      this.toast('IP 조회 중...', 'info');
      const ip = await window.api.getWifiIp(this.currentDevice);
      if (ip) {
        document.getElementById('pair-address').value = ip + ':';
        document.getElementById('connect-address').value = ip + ':5555';
        document.getElementById('pair-address').focus();
        const pairInput = document.getElementById('pair-address');
        pairInput.setSelectionRange(pairInput.value.length, pairInput.value.length);
        status.textContent = `IP: ${ip} — 디바이스 화면에서 페어링 포트와 코드를 확인하세요`;
        status.style.color = 'var(--green)';
        this.toast(`IP 자동 입력 완료 (연결용: ${ip}:5555)`, 'success');
      } else {
        this.toast('Wi-Fi IP를 가져올 수 없습니다. USB 연결을 확인해주세요', 'error');
      }
    });

    document.getElementById('pair-btn').addEventListener('click', async () => {
      const address = document.getElementById('pair-address').value.trim();
      const code = document.getElementById('pair-code').value.trim();
      if (!address || !code) return this.toast('IP:Port와 페어링 코드를 입력해주세요', 'error');

      status.textContent = '페어링 중...';
      status.style.color = 'var(--text-muted)';
      const result = await window.api.pairDevice(address, code);
      if (result.success) {
        status.textContent = '페어링 성공! 아래에서 연결해주세요.';
        status.style.color = 'var(--green)';
        this.toast('페어링 성공', 'success');
      } else {
        status.textContent = `페어링 실패: ${result.output}`;
        status.style.color = 'var(--red)';
        this.toast('페어링 실패', 'error');
      }
    });

    document.getElementById('connect-btn').addEventListener('click', async () => {
      const address = document.getElementById('connect-address').value.trim();
      if (!address) return this.toast('IP:Port를 입력해주세요', 'error');

      status.textContent = '연결 중...';
      status.style.color = 'var(--text-muted)';
      const result = await window.api.connectWireless(address);
      if (result.success) {
        status.textContent = '무선 연결 성공!';
        status.style.color = 'var(--green)';
        this.toast('무선 연결 성공', 'success');
        this.wirelessAddress = address;
        document.getElementById('wireless-disconnect-btn').style.display = '';
        modal.style.display = 'none';
        this.renderRememberedWireless();
      } else {
        status.textContent = `연결 실패: ${result.output}`;
        status.style.color = 'var(--red)';
        this.toast('연결 실패', 'error');
      }
    });

    document.getElementById('wireless-disconnect-btn').addEventListener('click', async () => {
      await window.api.disconnectWireless(this.wirelessAddress || '');
      this.wirelessAddress = null;
      document.getElementById('wireless-disconnect-btn').style.display = 'none';
      this.toast('무선 연결 해제됨', 'info');
    });
  },

  formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  },
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
  if (typeof DevicePanel !== 'undefined') DevicePanel.init();
});
