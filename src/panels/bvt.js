// BVT 자동화 테스트 패널
const BvtPanel = {
  scenarios: [],
  selectedDevice: null,
  selectedTests: new Set(),
  startedAt: 0,
  elapsedTimer: null,
  initialized: false,

  async init() {
    if (this.initialized) return;
    this.initialized = true;

    const cfg = this._loadConfig();
    this.scenarios = await window.api.bvt.listScenarios(cfg.orcaPath);
    this._renderScenarios();
    this._bindButtons();
    this._loadOptions();
    this._loadConfig();

    window.api.bvt.onEvent((ev) => this._onEvent(ev));

    // 초기 디바이스 갱신
    this.refreshDevices();
  },

  async refreshScenarios() {
    const cfg = this._loadConfig();
    this.scenarios = await window.api.bvt.listScenarios(cfg.orcaPath);
    this._renderScenarios();
    if (window.App && App.toast) App.toast(`시나리오 ${this.scenarios.length}개 로드됨`, 'success');
  },

  _renderScenarios() {
    const root = document.getElementById('bvt-tests');
    root.innerHTML = '';
    this.scenarios.forEach((s) => {
      const wrap = document.createElement('label');
      wrap.className = 'bvt-test-item';
      const tag = s.required ? '<span class="bvt-test-required">필수</span>' : '';
      wrap.innerHTML = `
        <input type="checkbox" data-tid="${s.id}" ${this.selectedTests.has(s.id) ? 'checked' : ''}>
        <div class="bvt-test-main">
          <div class="bvt-test-name">${s.id}. ${s.name}${tag}</div>
          ${s.desc ? `<div class="bvt-test-desc">${s.desc}</div>` : ''}
        </div>
        <span class="bvt-test-meta">id:${s.id}</span>
      `;
      const cb = wrap.querySelector('input');
      cb.addEventListener('change', () => {
        if (cb.checked) this.selectedTests.add(s.id);
        else this.selectedTests.delete(s.id);
        this._saveOptions();
      });
      root.appendChild(wrap);
    });
  },

  async refreshDevices() {
    const list = document.getElementById('bvt-device-list');
    let devices = (window.App && App.devices) || [];
    if (!devices.length) {
      try { devices = await window.api.getDevices(); } catch {}
      if (Array.isArray(devices) && window.App) App.devices = devices;
    }
    const countEl = document.getElementById('bvt-device-count');
    if (!devices || !devices.length) {
      list.innerHTML = '<div class="bvt-empty">디바이스를 먼저 연결하세요 <button class="bvt-icon-btn" id="bvt-refresh-dev" title="새로고침" style="margin-left:6px">↻</button></div>';
      const btn = document.getElementById('bvt-refresh-dev');
      if (btn) btn.addEventListener('click', () => this.refreshDevices());
      if (countEl) countEl.textContent = '';
      this.selectedDevice = null;
      return;
    }
    if (countEl) countEl.textContent = `${devices.length}개 연결됨`;
    list.innerHTML = '';
    devices.forEach((d, idx) => {
      const wrap = document.createElement('label');
      wrap.className = 'bvt-device-item';
      const alias = (App.deviceAliases && App.deviceAliases[d.serial]) || d.model;
      wrap.innerHTML = `
        <input type="radio" name="bvt-device" value="${d.serial}" ${this.selectedDevice === d.serial || (!this.selectedDevice && idx === 0) ? 'checked' : ''}>
        <span><b>${alias}</b></span>
        <span class="bvt-dev-meta">${d.serial}</span>
      `;
      const r = wrap.querySelector('input');
      r.addEventListener('change', () => { if (r.checked) this.selectedDevice = d.serial; });
      if (r.checked) this.selectedDevice = d.serial;
      list.appendChild(wrap);
    });
  },

  _bindButtons() {
    document.getElementById('bvt-run').addEventListener('click', () => this.run());
    document.getElementById('bvt-stop').addEventListener('click', () => this.stop());
    document.getElementById('bvt-settings').addEventListener('click', () => this.showSettings());
    document.getElementById('bvt-presets').addEventListener('click', () => this.showPresets());
    const refreshBtn = document.getElementById('bvt-refresh-tests');
    if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshScenarios());
    document.getElementById('bvt-console-clear').addEventListener('click', () => {
      document.getElementById('bvt-console').textContent = '';
    });
    document.getElementById('bvt-console-copy').addEventListener('click', () => {
      const text = document.getElementById('bvt-console').textContent;
      navigator.clipboard.writeText(text).then(() => {
        if (window.App && App.toast) App.toast('콘솔 내용 복사됨', 'success');
      });
    });

    ['bvt-opt-no-slack', 'bvt-opt-no-video', 'bvt-opt-mirror'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => this._saveOptions());
    });
  },

  _loadConfig() {
    const cfg = JSON.parse(localStorage.getItem('bvt-config') || '{}');
    return cfg;
  },

  _saveConfig(cfg) {
    localStorage.setItem('bvt-config', JSON.stringify(cfg));
  },

  _loadOptions() {
    try {
      const opt = JSON.parse(localStorage.getItem('bvt-options') || '{}');
      if (opt.tests) {
        opt.tests.forEach((tid) => {
          this.selectedTests.add(tid);
          const cb = document.querySelector(`#bvt-tests input[data-tid="${tid}"]`);
          if (cb) cb.checked = true;
        });
      }
      ['noSlack', 'noVideo', 'mirror'].forEach((k) => {
        const id = `bvt-opt-${k === 'noSlack' ? 'no-slack' : (k === 'noVideo' ? 'no-video' : 'mirror')}`;
        const el = document.getElementById(id);
        if (el && typeof opt[k] === 'boolean') el.checked = opt[k];
      });
    } catch {}
  },

  _saveOptions() {
    const opt = {
      tests: Array.from(this.selectedTests),
      noSlack: document.getElementById('bvt-opt-no-slack').checked,
      noVideo: document.getElementById('bvt-opt-no-video').checked,
      mirror: document.getElementById('bvt-opt-mirror').checked,
    };
    localStorage.setItem('bvt-options', JSON.stringify(opt));
  },

  async run() {
    let cfg = this._loadConfig();
    if (!cfg.orcaPath) {
      const detected = await window.api.bvt.detectOrca();
      if (detected) {
        cfg.orcaPath = detected;
        this._saveConfig(cfg);
        this._appendConsole('info', `📁 orca_slack 자동 탐지: ${detected}\n`);
      } else {
        if (window.App && App.toast) App.toast('orca_slack 폴더 경로를 먼저 설정하세요 (⚙️ 설정)', 'error');
        this.showSettings();
        return;
      }
    }

    if (!this.selectedDevice) {
      await this.refreshDevices();
    }
    if (!this.selectedDevice) {
      if (window.App && App.toast) App.toast('디바이스를 선택하세요', 'error');
      this._appendConsole('stderr', '❌ 디바이스가 선택되지 않았습니다. 좌측 디바이스 목록에서 선택하세요.\n');
      return;
    }
    if (!this.selectedTests.size) {
      if (window.App && App.toast) App.toast('테스트를 1개 이상 선택하세요', 'error');
      return;
    }

    const devices = (window.App && App.devices) || [];
    const dev = devices.find((d) => d.serial === this.selectedDevice);
    const isWireless = /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(this.selectedDevice);
    const userAlias = (window.App && App.deviceAliases && App.deviceAliases[this.selectedDevice]) || '';
    const model = (dev && dev.model) || '';
    let alias = userAlias || model;
    if (alias && isWireless && !/무선/.test(alias)) alias = `${alias}(무선)`;
    if (!alias) alias = isWireless ? `Device-${this.selectedDevice.split(':')[0]}(무선)` : `Device-${this.selectedDevice.slice(-6)}`;
    const opts = {
      orcaPath: cfg.orcaPath,
      pythonCmd: cfg.pythonCmd || 'python',
      deviceUdid: this.selectedDevice,
      deviceName: alias,
      testIds: Array.from(this.selectedTests),
      options: {
        noSlack: document.getElementById('bvt-opt-no-slack').checked,
        noVideo: document.getElementById('bvt-opt-no-video').checked,
      },
    };

    document.getElementById('bvt-console').textContent = '';
    this._appendConsole('info', `🤖 BVT 자동화 시작 — 디바이스: ${this.selectedDevice}, 테스트: ${opts.testIds.join(',')}\n`);

    // scrcpy 자동 시작
    if (document.getElementById('bvt-opt-mirror').checked) {
      this._appendConsole('info', '🎥 scrcpy 미러링 시작 시도...\n');
      try {
        if (window.MirrorInspector && MirrorInspector.startScrcpy) {
          await MirrorInspector.startScrcpy(this.selectedDevice);
        } else if (window.api.startScrcpy) {
          await window.api.startScrcpy(this.selectedDevice);
        }
      } catch (e) {
        this._appendConsole('stderr', `scrcpy 시작 실패: ${e.message}\n`);
      }
    }

    const r = await window.api.bvt.start(opts);
    if (!r.success) {
      this._appendConsole('stderr', `❌ ${r.error}\n`);
      if (window.App && App.toast) App.toast(`실행 실패: ${r.error}`, 'error');
      return;
    }
    this._setRunning(true);
  },

  async stop() {
    const r = await window.api.bvt.stop();
    if (!r.success) {
      if (window.App && App.toast) App.toast(r.error || '중단 실패', 'error');
    }
  },

  _setRunning(running) {
    document.getElementById('bvt-run').style.display = running ? 'none' : '';
    document.getElementById('bvt-stop').style.display = running ? '' : 'none';
    const pill = document.getElementById('bvt-status-pill');
    if (running) {
      pill.textContent = '실행 중';
      pill.className = 'bvt-status-pill running';
      this.startedAt = Date.now();
      this._startElapsed();
    } else {
      this._stopElapsed();
    }
    // 자동화 중엔 디바이스를 점유하는 인스펙터 버튼들 비활성화
    this._toggleInspectorButtons(running);
  },

  _toggleInspectorButtons(disable) {
    const ids = [
      'scrcpy-toggle', 'mirror-toggle', 'mirror-screenshot',
      'record-toggle', 'inspector-refresh', 'pull-all-logs',
      'wireless-connect-btn', 'wireless-disconnect-btn',
    ];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.disabled = disable;
      el.style.opacity = disable ? '0.45' : '';
      el.style.cursor = disable ? 'not-allowed' : '';
      el.title = disable ? '자동화 실행 중에는 사용할 수 없습니다' : (el.dataset._origTitle || el.title);
      if (disable && !el.dataset._origTitle) el.dataset._origTitle = el.title;
    });
  },

  _startElapsed() {
    this._stopElapsed();
    const el = document.getElementById('bvt-elapsed');
    const tick = () => {
      const s = Math.floor((Date.now() - this.startedAt) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      el.textContent = `(${mm}:${ss})`;
    };
    tick();
    this.elapsedTimer = setInterval(tick, 1000);
  },

  _stopElapsed() {
    if (this.elapsedTimer) { clearInterval(this.elapsedTimer); this.elapsedTimer = null; }
  },

  _onEvent({ kind, payload }) {
    if (kind === 'exit') {
      this._setRunning(false);
      const ok = payload.code === 0;
      const pill = document.getElementById('bvt-status-pill');
      pill.textContent = ok ? `완료 (${payload.elapsed}s)` : `실패 (code=${payload.code})`;
      pill.className = 'bvt-status-pill ' + (ok ? 'running' : 'error');
      if (window.App && App.toast) {
        App.toast(ok ? `✅ BVT 완료 (${payload.elapsed}s)` : `❌ BVT 실패 (code=${payload.code})`, ok ? 'success' : 'error');
      }
      // 자동으로 scrcpy 종료 (자동화 시작 시 켰던 경우)
      try {
        if (document.getElementById('bvt-opt-mirror').checked) {
          if (window.MirrorInspector && MirrorInspector.stopScrcpy) MirrorInspector.stopScrcpy();
          else if (window.api && window.api.stopScrcpy) window.api.stopScrcpy();
        }
      } catch {}
      return;
    }
    this._appendConsole(kind, typeof payload === 'string' ? payload : String(payload));
  },

  _appendConsole(kind, text) {
    const c = document.getElementById('bvt-console');
    if (!c) return;
    const span = document.createElement('span');
    if (kind === 'stderr') span.className = 'bvt-console-line-stderr';
    else if (kind === 'info') span.className = 'bvt-console-line-info';
    span.textContent = text;
    c.appendChild(span);
    // auto scroll
    c.scrollTop = c.scrollHeight;
  },

  showSettings() {
    const cfg = this._loadConfig();
    const html = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <h3 style="margin:0;font-size:16px;flex:1">⚙️ BVT 설정</h3>
        <button class="btn btn-sm bvt-cfg-cancel">×</button>
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin:0 0 12px">orca_slack 폴더와 Python 경로를 설정합니다.</p>
      <label style="font-size:12px;display:block;margin-bottom:4px">orca_slack 폴더 경로</label>
      <div style="display:flex;gap:6px;margin-bottom:10px">
        <input id="bvt-cfg-orca" class="input" type="text" style="flex:1" placeholder="C:\\Users\\you\\Desktop\\autopy\\orca_slack">
        <button class="btn btn-sm" id="bvt-cfg-detect">자동 탐지</button>
      </div>
      <label style="font-size:12px;display:block;margin-bottom:4px">Python 명령</label>
      <input id="bvt-cfg-python" class="input" type="text" style="width:100%;margin-bottom:14px" placeholder="python (또는 venv 절대경로)">
      <div id="bvt-cfg-status" style="font-size:11px;color:var(--text-muted);min-height:16px;margin-bottom:10px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-sm bvt-cfg-cancel">취소</button>
        <button class="btn btn-sm btn-primary bvt-cfg-save">저장</button>
      </div>
    `;
    const { box, close } = this._modal(html, 520);
    const $ = (s) => box.querySelector(s);
    $('#bvt-cfg-orca').value = cfg.orcaPath || '';
    $('#bvt-cfg-python').value = cfg.pythonCmd || 'python';
    box.querySelectorAll('.bvt-cfg-cancel').forEach((b) => b.addEventListener('click', close));
    $('#bvt-cfg-detect').addEventListener('click', async () => {
      const detected = await window.api.bvt.detectOrca();
      if (detected) {
        $('#bvt-cfg-orca').value = detected;
        $('#bvt-cfg-status').innerHTML = `<span style="color:var(--green)">✓ 자동 탐지: ${detected}</span>`;
      } else {
        $('#bvt-cfg-status').innerHTML = `<span style="color:var(--red)">✗ 일반 위치에서 못 찾음. 직접 입력하세요.</span>`;
      }
    });
    $('.bvt-cfg-save').addEventListener('click', () => {
      const newCfg = {
        orcaPath: $('#bvt-cfg-orca').value.trim(),
        pythonCmd: $('#bvt-cfg-python').value.trim() || 'python',
      };
      this._saveConfig(newCfg);
      close();
      if (window.App && App.toast) App.toast('BVT 설정 저장됨', 'success');
    });
  },

  showPresets() {
    const presets = JSON.parse(localStorage.getItem('bvt-presets') || '[]');
    const list = presets.map((p, i) =>
      `<div style="display:flex;align-items:center;gap:6px;padding:6px;border:1px solid var(--border);border-radius:4px;margin-bottom:4px">
        <span style="flex:1;font-size:12px"><b>${p.name}</b> <span style="color:var(--text-muted);font-size:11px">— 디바이스: ${p.deviceUdid || '미지정'} / 테스트: ${(p.testIds || []).join(',') || '없음'}</span></span>
        <button class="btn btn-sm bvt-pre-load" data-i="${i}">불러오기</button>
        <button class="btn btn-sm bvt-pre-del" data-i="${i}">삭제</button>
      </div>`
    ).join('') || '<div style="font-size:11px;color:var(--text-muted);padding:8px">저장된 프리셋이 없습니다.</div>';

    const html = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <h3 style="margin:0;font-size:16px;flex:1">⭐ 프리셋</h3>
        <button class="btn btn-sm bvt-pre-cancel">×</button>
      </div>
      <div style="margin-bottom:12px">${list}</div>
      <div style="border-top:1px solid var(--border);padding-top:12px">
        <label style="font-size:12px;display:block;margin-bottom:4px">현재 설정을 새 프리셋으로 저장</label>
        <div style="display:flex;gap:6px">
          <input id="bvt-pre-name" class="input" type="text" style="flex:1" placeholder="예: 온보딩+빠른진입 (S22U)">
          <button class="btn btn-sm btn-primary bvt-pre-save">저장</button>
        </div>
      </div>
    `;
    const { box, close } = this._modal(html, 560);
    box.querySelectorAll('.bvt-pre-cancel').forEach((b) => b.addEventListener('click', close));
    box.querySelectorAll('.bvt-pre-load').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.i);
      const p = presets[i];
      if (!p) return;
      // 적용
      this.selectedTests = new Set(p.testIds || []);
      document.querySelectorAll('#bvt-tests input[type="checkbox"]').forEach((cb) => {
        cb.checked = this.selectedTests.has(Number(cb.dataset.tid));
      });
      if (p.deviceUdid) {
        const r = document.querySelector(`#bvt-device-list input[value="${p.deviceUdid}"]`);
        if (r) { r.checked = true; this.selectedDevice = p.deviceUdid; }
      }
      ['noSlack', 'noVideo', 'mirror'].forEach((k) => {
        const id = `bvt-opt-${k === 'noSlack' ? 'no-slack' : (k === 'noVideo' ? 'no-video' : 'mirror')}`;
        const el = document.getElementById(id);
        if (el && typeof p[k] === 'boolean') el.checked = p[k];
      });
      this._saveOptions();
      close();
      if (window.App && App.toast) App.toast(`프리셋 "${p.name}" 적용됨`, 'success');
    }));
    box.querySelectorAll('.bvt-pre-del').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.i);
      presets.splice(i, 1);
      localStorage.setItem('bvt-presets', JSON.stringify(presets));
      close();
      this.showPresets();
    }));
    box.querySelector('.bvt-pre-save').addEventListener('click', () => {
      const name = box.querySelector('#bvt-pre-name').value.trim();
      if (!name) { if (window.App && App.toast) App.toast('프리셋 이름을 입력하세요', 'error'); return; }
      presets.push({
        name,
        deviceUdid: this.selectedDevice,
        testIds: Array.from(this.selectedTests),
        noSlack: document.getElementById('bvt-opt-no-slack').checked,
        noVideo: document.getElementById('bvt-opt-no-video').checked,
        mirror: document.getElementById('bvt-opt-mirror').checked,
      });
      localStorage.setItem('bvt-presets', JSON.stringify(presets));
      close();
      if (window.App && App.toast) App.toast(`프리셋 "${name}" 저장됨`, 'success');
    });
  },

  _modal(innerHtml, width = 520) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999';
    const box = document.createElement('div');
    box.style.cssText = `background:var(--bg-secondary);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:18px;width:${width}px;max-width:92vw;max-height:88vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,0.5)`;
    box.innerHTML = innerHtml;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    return { overlay, box, close };
  },
};

window.BvtPanel = BvtPanel;
document.addEventListener('DOMContentLoaded', () => {
  // 패널 처음 진입 시 init
  const tryInit = () => {
    if (document.getElementById('panel-bvt')) BvtPanel.init();
  };
  tryInit();
});
