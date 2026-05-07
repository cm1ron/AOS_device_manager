// BVT 자동화 실행기: orca_slack/main.py 를 spawn 하고 stdin 자동 주입 + stdout 스트리밍
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function execAdb(args, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    execFile('adb', args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      if (err) reject(err); else resolve(stdout || '');
    });
  });
}

async function listAdbDevices() {
  try {
    const out = await execAdb(['devices']);
    return out.split('\n')
      .slice(1)
      .map((l) => l.trim())
      .filter((l) => l && /\sdevice$/.test(l))
      .map((l) => l.split(/\s+/)[0]);
  } catch { return []; }
}

// orca_slack 폴더 자동 탐지: 사용자가 자주 쓰는 위치들
function autoDetectOrcaSlack() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Desktop', 'autopy', 'orca_slack'),
    path.join(home, 'Documents', 'autopy', 'orca_slack'),
    path.join(home, 'autopy', 'orca_slack'),
    path.join(home, 'Desktop', 'orca_slack'),
    path.join(home, 'Documents', 'orca_slack'),
    path.join(home, 'orca_slack'),
    'C:\\autopy\\orca_slack',
    'D:\\autopy\\orca_slack',
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(path.join(p, 'main.py'))) return p;
    } catch {}
  }
  return null;
}

// fallback (main.py 파싱 실패 시)
const FALLBACK_SCENARIOS = [
  { id: 1, name: '온보딩 테스트', desc: '앱 실행 → 계정 생성 → 홈 진입' },
  { id: 99, name: '빠른 진입', desc: '자동 로그인 → 홈' },
];

// orca_slack/main.py 의 AVAILABLE_TESTS / DEV_TESTS 를 정규식으로 파싱
function parseScenariosFromMainPy(orcaPath) {
  try {
    const main = path.join(orcaPath, 'main.py');
    if (!fs.existsSync(main)) return null;
    const src = fs.readFileSync(main, 'utf8');
    const out = [];
    // 두 블록 모두 처리
    ['AVAILABLE_TESTS', 'DEV_TESTS'].forEach((blockName) => {
      const blockRe = new RegExp(`${blockName}\\s*=\\s*\\[([\\s\\S]*?)\\n\\]`);
      const m = src.match(blockRe);
      if (!m) return;
      const body = m[1];
      // 각 dict 블록을 잘라서 id/name/description 뽑기
      const itemRe = /\{\s*([\s\S]*?)\s*\},?/g;
      let im;
      while ((im = itemRe.exec(body)) !== null) {
        const it = im[1];
        const id = (it.match(/["']id["']\s*:\s*(\d+)/) || [])[1];
        const name = (it.match(/["']name["']\s*:\s*["']([^"']+)["']/) || [])[1];
        const desc = (it.match(/["']description["']\s*:\s*["']([^"']+)["']/) || [])[1] || '';
        const required = /["']required["']\s*:\s*True/.test(it);
        if (id && name) out.push({ id: Number(id), name, desc, required });
      }
    });
    if (!out.length) return null;
    // 중복 제거 (id 기준)
    const seen = new Set();
    return out.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  } catch (e) {
    return null;
  }
}

function listScenarios(orcaPath) {
  if (orcaPath) {
    const parsed = parseScenariosFromMainPy(orcaPath);
    if (parsed && parsed.length) return parsed;
  }
  // orcaPath 없으면 자동 탐지 시도
  const auto = autoDetectOrcaSlack();
  if (auto) {
    const parsed = parseScenariosFromMainPy(auto);
    if (parsed && parsed.length) return parsed;
  }
  return FALLBACK_SCENARIOS;
}

class BvtRunner {
  constructor(window) {
    this.window = window;
    this.proc = null;
    this.startedAt = 0;
    this.exitCode = null;
  }

  isRunning() { return !!this.proc; }

  async start({ orcaPath, pythonCmd, deviceUdid, deviceName, testIds, options }) {
    if (this.proc) throw new Error('이미 실행 중입니다');
    if (!orcaPath || !fs.existsSync(path.join(orcaPath, 'main.py'))) {
      throw new Error(`orca_slack 경로가 잘못됐습니다: ${orcaPath}`);
    }
    if (!testIds || !testIds.length) throw new Error('테스트를 1개 이상 선택하세요');

    // config.py 의 DEVICES 에 udid 가 없으면 자동 등록
    if (deviceUdid) {
      try {
        const added = ensureDeviceInConfig(orcaPath, deviceUdid, deviceName);
        if (added) this._send('info', `${added.updated ? '✎ config.py 디바이스 이름 갱신' : '✚ config.py 에 디바이스 추가됨'}: ${added.name} (${added.udid})\n`);
      } catch (e) {
        this._send('stderr', `[config.py 갱신 경고] ${e.message}\n`);
      }
    }

    // main.py 가 ANDROID_SERIAL 을 안 봐서, 선택한 디바이스 외 무선 연결을 임시 disconnect
    // (USB 디바이스는 disconnect 안 됨 → 그대로 둠. 실수 방지)
    this._disconnectedWireless = [];
    try {
      const list = await listAdbDevices();
      const others = list.filter((s) => s !== deviceUdid && /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(s));
      for (const ip of others) {
        try {
          await execAdb(['disconnect', ip]);
          this._disconnectedWireless.push(ip);
          this._send('info', `↘ 임시 disconnect: ${ip}\n`);
        } catch {}
      }
    } catch {}

    const py = pythonCmd || 'python';
    const env = { ...process.env };
    if (deviceUdid) env.ANDROID_SERIAL = deviceUdid;
    if (options && options.noSlack) env.SLACK_DISABLED = '1';
    if (options && options.noVideo) env.VIDEO_DISABLED = '1';
    // Windows cp949 → UTF-8 강제 (한글/✓ 같은 문자 깨짐 방지)
    env.PYTHONIOENCODING = 'utf-8';
    env.PYTHONUTF8 = '1';
    env.PYTHONLEGACYWINDOWSSTDIO = '0';

    this.startedAt = Date.now();
    this.exitCode = null;

    this.proc = spawn(py, ['-u', 'main.py'], {
      cwd: orcaPath,
      env,
      shell: false,
      windowsHide: true,
    });

    this._send('info', `▶ ${py} main.py (cwd: ${orcaPath})`);
    if (deviceUdid) this._send('info', `   ANDROID_SERIAL=${deviceUdid}`);

    // 메뉴 자동 응답:
    //   - 디바이스 선택 프롬프트 (ANDROID_SERIAL 있으면 보통 자동)
    //   - 메인 메뉴 "선택:" → 8 (순서 지정 실행)
    //   - "실행 순서 입력" → testCsv
    //   - "테스트 번호 입력" 도 같은 답으로
    // 항목들은 순서 무관하게 매칭되면 즉시 응답 + 한번만 사용.
    const testCsv = testIds.join(',');
    // 통합 큐: 모든 prompt 를 동시 감시. 메인메뉴 응답은 "처음에는 8(순서지정), 두번째부터 0(종료)" 동작
    this._mainMenuShots = 0;
    this._stdinQueue = [
      { wait: /디바이스 선택.*\(1-\d+\)\s*:\s*$/m, send: '1', once: true },
      { wait: /디바이스 번호 선택\s*:\s*$/m, send: '1', once: true },
      { wait: /실행 순서 입력[^\n]*:\s*$/m, send: testCsv, once: true },
      { wait: /테스트 번호 입력[^\n]*:\s*$/m, send: testCsv, once: true },
      { wait: /Enter[를을]?\s*눌러[^\n]*(?:메뉴|돌아)/m, send: '', once: true },
      // 메인 메뉴는 여러 번 등장할 수 있음. 첫 번째는 8, 이후는 0(종료)
      { wait: /(^|\n)\s*선택\s*:\s*$/m, send: () => (this._mainMenuShots++ === 0 ? '8' : '0'), once: false, dedupe: true },
    ];
    this._buffer = '';
    this._lastSentSig = '';

    this.proc.stdout.on('data', (chunk) => this._onOutput('stdout', chunk));
    this.proc.stderr.on('data', (chunk) => this._onOutput('stderr', chunk));

    this.proc.on('error', (err) => {
      this._send('stderr', `[spawn error] ${err.message}\n`);
      this._cleanup(-1);
    });
    this.proc.on('exit', (code, signal) => {
      this.exitCode = code;
      this._send('info', `\n✓ 종료 (exit code=${code}, signal=${signal || 'null'}, 경과: ${this._elapsed()}s)\n`);
      this._cleanup(code);
    });
  }

  _onOutput(stream, chunk) {
    const text = chunk.toString('utf8');
    this._buffer += text;
    this._send(stream, text);

    if (!this.proc || !this.proc.stdin.writable) return;
    const tail = this._buffer.slice(-800);

    if (this._stdinQueue && this._stdinQueue.length) {
      for (let i = 0; i < this._stdinQueue.length; i++) {
        const item = this._stdinQueue[i];
        if (!item.wait.test(tail)) continue;
        const send = typeof item.send === 'function' ? item.send() : item.send;
        // 같은 prompt 에 대한 중복 응답 방지 (dedupe: 같은 응답이 직전과 같으면 skip)
        const sig = `${item.wait.source}|${send}`;
        if (item.dedupe && this._lastSentSig === sig) continue;
        try {
          this.proc.stdin.write(send + '\n');
          this._send('info', `[자동입력] ${send || '<Enter>'}\n`);
          this._lastSentSig = sig;
        } catch {}
        if (item.once !== false) this._stdinQueue.splice(i, 1);
        this._buffer = '';
        break;
      }
    }

    if (this._buffer.length > 8000) this._buffer = this._buffer.slice(-2000);
  }

  // 사용자가 직접 stdin 보낼 때
  sendStdin(text) {
    if (this.proc && this.proc.stdin.writable) {
      try { this.proc.stdin.write(text); return true; } catch { return false; }
    }
    return false;
  }

  stop() {
    if (!this.proc) return false;
    const pid = this.proc.pid;
    try { this.proc.stdin && this.proc.stdin.end(); } catch {}
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
      } else {
        this.proc.kill('SIGTERM');
      }
    } catch {}
    // 안전망: 3초 후에도 살아있으면 SIGKILL
    setTimeout(() => {
      try {
        if (this.proc) {
          this.proc.kill('SIGKILL');
          // exit 이벤트가 안 와도 강제 cleanup
          this._cleanup(-2);
        }
      } catch {}
    }, 3000);
    return true;
  }

  _cleanup(code) {
    this.proc = null;
    // 임시 disconnect 했던 무선 디바이스 복구
    if (this._disconnectedWireless && this._disconnectedWireless.length) {
      const ips = this._disconnectedWireless.slice();
      this._disconnectedWireless = [];
      (async () => {
        for (const ip of ips) {
          try {
            await execAdb(['connect', ip]);
            this._send('info', `↗ 재연결: ${ip}\n`);
          } catch {}
        }
      })();
    }
    this._send('exit', { code, elapsed: this._elapsed() });
  }

  _elapsed() {
    return ((Date.now() - this.startedAt) / 1000).toFixed(1);
  }

  _send(kind, payload) {
    try {
      if (this.window && !this.window.isDestroyed()) {
        this.window.webContents.send('bvt:event', { kind, payload });
      }
    } catch {}
  }
}

// orca_slack/config.py 의 DEVICES 리스트에 udid 가 없으면 추가.
// 무선(IP:PORT) 형식이면 자동 감지하여 이름에 "(무선)" 표기.
function ensureDeviceInConfig(orcaPath, udid, deviceName) {
  if (!udid) return null;
  const cfgPath = path.join(orcaPath, 'config.py');
  if (!fs.existsSync(cfgPath)) return null;
  let src = fs.readFileSync(cfgPath, 'utf8');

  const isWireless = /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(udid);
  const baseName = (deviceName || (isWireless ? `Device-${udid.split(':')[0]}` : `Device-${udid.slice(-6)}`)).replace(/["']/g, '');
  const name = isWireless && !/무선/.test(baseName) ? `${baseName}(무선)` : baseName;
  const entry = `    {"name": "${name}", "udid": "${udid}"},`;

  // 이미 같은 udid 라인이 있으면: 이름이 다를 때만 갱신
  const escUdid = udid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lineRe = new RegExp(`^[ \\t]*\\{[^}\\n]*["']udid["']\\s*:\\s*["']${escUdid}["'][^}\\n]*\\},?[ \\t]*$`, 'm');
  const existing = src.match(lineRe);
  if (existing) {
    if (existing[0].includes(`"name": "${name}"`)) return null; // 이름까지 동일 → skip
    if (deviceName) {
      // 사용자가 의미 있는 이름을 줬을 때만 갱신 (자동 fallback 이름이면 기존 보존)
      const isAutoName = /^Device-/.test(name);
      if (isAutoName) return null;
      try { fs.writeFileSync(cfgPath + '.bak', fs.readFileSync(cfgPath)); } catch {}
      src = src.replace(lineRe, entry);
      fs.writeFileSync(cfgPath, src, 'utf8');
      return { name, udid, updated: true };
    }
    return null;
  }

  // 새 항목 추가
  const blockRe = /^(DEVICES\s*=\s*\[)([\s\S]*?)(\n\])/m;
  const m = src.match(blockRe);
  if (!m) return null;
  const newBlock = `${m[1]}\n${entry}${m[2]}${m[3]}`;
  src = src.replace(blockRe, newBlock);

  try { fs.writeFileSync(cfgPath + '.bak', fs.readFileSync(cfgPath)); } catch {}
  fs.writeFileSync(cfgPath, src, 'utf8');
  return { name, udid };
}

module.exports = { BvtRunner, autoDetectOrcaSlack, listScenarios, FALLBACK_SCENARIOS, ensureDeviceInConfig };
