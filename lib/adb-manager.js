const { execFile, spawn, execSync } = require('child_process');
const path = require('path');
const { resolveMarketName } = require('./device-names');
const isWin = process.platform === 'win32';

class AdbManager {
  constructor() {
    this.adbPath = 'adb';
    this.logcatProcess = null;
    this.screenRecordProcess = null;
    this.screenRecordSerial = null;
    this.screenRecordRemotePath = null;
    this._onScreenRecordExit = null;
    this.streamProcess = null;
    this._streamStopping = false;
  }

  async startH264Stream(serial, opts, onData, onMeta, onEnd) {
    this.stopH264Stream();
    this._streamStopping = false;
    const { size, bitRate = '4M' } = opts || {};
    const net = require('net');
    // 이전 세션 잔재 정리 (이전 screenrecord 가 timeout 으로 죽어있을 수 있음)
    try { await this._execText(['shell', 'pkill -f screenrecord; pkill -f "toybox nc"; pkill -f "nc -l"; true'], serial, { timeout: 2000 }); } catch {}

    const localPort = 27183 + Math.floor(Math.random() * 5000);
    const devicePort = 28100 + Math.floor(Math.random() * 5000);
    this._streamForwardPort = localPort;
    this._streamSerial = serial;

    try {
      await this._execText(['forward', `tcp:${localPort}`, `tcp:${devicePort}`], serial);
    } catch (e) {
      if (onEnd) onEnd();
      throw e;
    }

    if (onMeta) onMeta({ size, bitRate });

    const spawnRecorder = () => {
      if (this._streamStopping) return null;
      const sizeArg = size ? ` --size=${size}` : '';
      const shellCmd =
        `screenrecord --output-format=h264${sizeArg} --bit-rate=${bitRate} --time-limit=180 - ` +
        `| toybox nc -l -p ${devicePort} 2>/dev/null`;
      const proc = spawn(this.adbPath, [
        '-s', serial, 'shell', shellCmd,
      ], { detached: !isWin, windowsHide: true });
      this.streamProcess = proc;
      proc.stdout.on('data', () => {});
      proc.stderr.on('data', () => {});
      proc.on('close', () => {});
      proc.on('error', () => {});
      return proc;
    };

    const tryConnect = (retries) => {
      if (this._streamStopping) return;
      const sock = net.connect(localPort, '127.0.0.1');
      this._streamSocket = sock;
      sock.once('connect', () => {
        sock.on('data', (chunk) => {
          if (this._streamStopping) return;
          onData(chunk);
        });
        sock.on('close', () => {
          this._streamSocket = null;
          if (this._streamStopping) { if (onEnd) onEnd(); return; }
          spawnRecorder();
          setTimeout(() => tryConnect(50), 500);
        });
        sock.on('error', () => {});
      });
      sock.once('error', () => {
        try { sock.destroy(); } catch {}
        if (retries > 0 && !this._streamStopping) {
          setTimeout(() => tryConnect(retries - 1), 200);
        } else if (onEnd) {
          onEnd();
        }
      });
    };

    spawnRecorder();
    setTimeout(() => tryConnect(50), 500);
  }

  async getDeviceSize(serial) {
    const out = await this._execText(['shell', 'wm', 'size'], serial);
    const m = out && out.match(/(\d+)x(\d+)/);
    if (m) return { width: +m[1], height: +m[2] };
    throw new Error('cannot parse wm size');
  }

  async getDeviceRotation(serial) {
    try {
      const out = await this._execText(['shell', 'dumpsys', 'input', '|', 'grep', 'SurfaceOrientation'], serial);
      const m = out && out.match(/SurfaceOrientation:\s*(\d+)/);
      if (m) return parseInt(m[1], 10);
    } catch {}
    try {
      const out = await this._execText(['shell', 'settings', 'get', 'system', 'user_rotation'], serial);
      const v = parseInt((out || '').trim(), 10);
      if (!isNaN(v)) return v;
    } catch {}
    return 0;
  }

  stopH264Stream() {
    this._streamStopping = true;
    if (this._streamSocket) {
      try { this._streamSocket.removeAllListeners('data'); } catch {}
      try { this._streamSocket.destroy(); } catch {}
      this._streamSocket = null;
    }
    if (this.streamProcess) {
      const p = this.streamProcess;
      this.streamProcess = null;
      try { p.stdout && p.stdout.removeAllListeners('data'); } catch {}
      try { p.stdout && p.stdout.pause(); } catch {}
      try { p.kill('SIGTERM'); } catch {}
      try {
        if (isWin) {
          execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' });
        } else {
          process.kill(-p.pid, 'SIGKILL');
        }
      } catch {}
    }
    if (this._streamForwardPort && this._streamSerial) {
      const port = this._streamForwardPort;
      const serial = this._streamSerial;
      this._streamForwardPort = null;
      this._streamSerial = null;
      this._execText(['forward', '--remove', `tcp:${port}`], serial).catch(() => {});
      this._execText(['shell', 'pkill -f screenrecord; pkill -f "toybox nc"; pkill -f "nc -l"'], serial).catch(() => {});
    }
  }

  _exec(args, serial) {
    return new Promise((resolve, reject) => {
      const fullArgs = serial ? ['-s', serial, ...args] : args;
      execFile(this.adbPath, fullArgs, { maxBuffer: 1024 * 1024 * 10, encoding: 'buffer' }, (err, stdout, stderr) => {
        if (err && !stdout.length) {
          reject(new Error(stderr ? stderr.toString() : err.message));
          return;
        }
        resolve(stdout);
      });
    });
  }

  _execText(args, serial, opts = {}) {
    return new Promise((resolve, reject) => {
      const fullArgs = serial ? ['-s', serial, ...args] : args;
      const maxBuf = opts.maxBuffer || 1024 * 1024 * 10;
      const timeout = opts.timeout || 0;
      execFile(this.adbPath, fullArgs, { maxBuffer: maxBuf, timeout }, (err, stdout, stderr) => {
        if (err && !stdout) {
          reject(new Error(stderr || err.message));
          return;
        }
        resolve(stdout);
      });
    });
  }

  async getDevices() {
    try {
      const output = await this._execText(['devices', '-l']);
      const lines = output.trim().split('\n').slice(1);
      return lines
        .filter((l) => l.trim() && l.includes('device'))
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          const serial = parts[0];
          const props = {};
          parts.slice(2).forEach((p) => {
            const [k, v] = p.split(':');
            if (k && v) props[k] = v;
          });
          return { serial, model: props.model || 'Unknown', product: props.product || '', device: props.device || '' };
        });
    } catch {
      return [];
    }
  }

  async getDeviceInfo(serial) {
    const propMap = {
      'ro.product.model': 'model',
      'ro.product.manufacturer': 'manufacturer',
      'ro.build.version.release': 'androidVersion',
      'ro.build.version.sdk': 'apiLevel',
      'ro.build.display.id': 'buildNumber',
      'ro.product.brand': 'brand',
      'ro.serialno': 'serialNumber',
      'ro.build.fingerprint': 'fingerprint',
      'ro.product.cpu.abi': 'cpuAbi',
      'ro.hardware': 'hardware',
      'ro.board.platform': 'boardPlatform',
      'ro.build.version.oneui': 'oneUiVersion',
      'ro.build.version.security_patch': 'securityPatch',
      'persist.sys.locale': 'locale',
      'persist.sys.timezone': 'timezone',
      'ro.hardware.egl': 'gpuEgl',
      'ro.product.marketname': 'marketName',
      'ro.config.marketing_name': 'marketName2',
    };

    const info = { serial };
    try {
      const output = await this._execText(['shell', 'getprop'], serial);
      for (const line of output.split('\n')) {
        const match = line.match(/\[(.+?)\]:\s*\[(.+?)\]/);
        if (match && propMap[match[1]]) {
          info[propMap[match[1]]] = match[2];
        }
      }
    } catch { /* ignore */ }

    // 상품명: marketname 우선, 없으면 marketing_name, 그래도 없으면 정적 매핑 fallback
    if (!info.marketName && info.marketName2) info.marketName = info.marketName2;
    delete info.marketName2;
    if (!info.marketName) {
      const fallback = resolveMarketName(info);
      if (fallback) info.marketName = fallback;
    }

    // CPU 칩셋: ro.board.platform 우선, 없으면 ro.hardware
    if (!info.chipset) {
      if (info.boardPlatform && info.boardPlatform.length > 1) {
        info.chipset = info.boardPlatform;
      } else if (info.hardware && info.hardware.length > 1) {
        info.chipset = info.hardware;
      }
    }

    try {
      const size = await this._execText(['shell', 'wm', 'size'], serial);
      const m = size.match(/(\d+x\d+)/);
      if (m) info.resolution = m[1];
    } catch { /* ignore */ }

    try {
      const aid = await this._execText(['shell', 'settings', 'get', 'secure', 'android_id'], serial);
      const v = (aid || '').trim();
      if (v && v !== 'null') info.androidId = v;
    } catch { /* ignore */ }

    try {
      const battery = await this._execText(['shell', 'dumpsys', 'battery'], serial);
      const level = battery.match(/level:\s*(\d+)/);
      const status = battery.match(/status:\s*(\d+)/);
      if (level) info.batteryLevel = parseInt(level[1]);
      const statusMap = { 2: 'Charging', 3: 'Discharging', 4: 'Not charging', 5: 'Full' };
      if (status) info.batteryStatus = statusMap[status[1]] || 'Unknown';
    } catch { /* ignore */ }

    try {
      const df = await this._execText(['shell', 'df', '/data'], serial);
      const lines = df.trim().split('\n');
      if (lines.length > 1) {
        const parts = lines[1].trim().split(/\s+/);
        if (parts.length >= 4) {
          const total = parseInt(parts[1]);
          const used = parseInt(parts[2]);
          const available = parseInt(parts[3]);
          info.storage = { total, used, available };
        }
      }
    } catch { /* ignore */ }

    try {
      const density = await this._execText(['shell', 'wm', 'density'], serial);
      const m = density.match(/(\d+)/);
      if (m) info.density = parseInt(m[1]);
    } catch { /* ignore */ }

    try {
      const meminfo = await this._execText(['shell', 'cat', '/proc/meminfo'], serial);
      const total = meminfo.match(/MemTotal:\s+(\d+)\s*kB/);
      const avail = meminfo.match(/MemAvailable:\s+(\d+)\s*kB/);
      if (total) info.ramTotalKb = parseInt(total[1]);
      if (avail) info.ramAvailableKb = parseInt(avail[1]);
    } catch { /* ignore */ }

    try {
      const display = await this._execText(['shell', 'dumpsys', 'display'], serial);
      const fps = display.match(/refreshRate=(\d+\.?\d*)/);
      if (fps) info.refreshRate = Math.round(parseFloat(fps[1]));
    } catch { /* ignore */ }

    try {
      const sf = await this._execText(['shell', 'dumpsys', 'SurfaceFlinger'], serial);
      const gpu = sf.match(/GLES:\s*([^\n]+)/);
      if (gpu) info.gpuRenderer = gpu[1].trim();
    } catch { /* ignore */ }

    try {
      const ip = await this._execText(['shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0'], serial);
      const m = ip.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
      if (m) info.wifiIp = m[1];
    } catch { /* ignore */ }

    try {
      // wifiIp가 이미 있으면 Wi-Fi 연결 확정
      if (info.wifiIp) {
        info.networkType = 'WIFI';
      } else {
        // Wi-Fi 상태 직접 확인
        const wifiState = await this._execText(['shell', 'dumpsys', 'wifi'], serial);
        if (/Wi-Fi is enabled|mNetworkInfo.*CONNECTED|mWifiInfo.*SSID/i.test(wifiState) &&
            /state: CONNECTED/i.test(wifiState)) {
          info.networkType = 'WIFI';
        } else {
          // 모바일 데이터 확인
          const tel = await this._execText(['shell', 'dumpsys', 'telephony.registry'], serial);
          if (/mDataConnectionState=2/.test(tel)) {
            info.networkType = 'MOBILE';
          }
        }
      }
    } catch { /* ignore */ }

    try {
      const date = await this._execText(['shell', 'date'], serial);
      const v = (date || '').trim();
      if (v) info.deviceTime = v;
    } catch { /* ignore */ }

    return info;
  }

  async installApk(serial, apkPath) {
    try {
      const output = await this._execText(['install', '-r', '-d', apkPath], serial);
      return { success: output.includes('Success'), output: output.trim() };
    } catch (e) {
      return { success: false, output: e.message };
    }
  }

  async listPackages(serial, filter) {
    try {
      const args = ['shell', 'pm', 'list', 'packages', '-3', '--user', '0'];
      if (filter) args.push(filter);
      const output = await this._execText(args, serial);
      const pkgs = output
        .trim()
        .split('\n')
        .filter((l) => l.startsWith('package:'))
        .map((l) => l.replace('package:', '').trim())
        .sort();

      const results = await Promise.all(pkgs.map(async (pkg) => {
        const ver = await this.getPackageVersion(serial, pkg);
        return { name: pkg, version: ver };
      }));
      return results;
    } catch {
      return [];
    }
  }

  async getPackageVersion(serial, pkg) {
    try {
      const output = await this._execText(['shell', 'dumpsys', 'package', pkg], serial);
      const m = output.match(/versionName=(.+)/);
      return m ? m[1].trim() : '';
    } catch {
      return '';
    }
  }


  async getDeviceLocales(serial) {
    // per-app locale (OVERDARE) 우선 반환
    const pkgs = ['com.overdare.overdare.dev', 'com.overdare.overdare'];
    for (const pkg of pkgs) {
      try {
        const raw = await this._execText(['shell', 'cmd', 'locale', 'get-app-locales', pkg, '--user', '0'], serial);
        const v = (raw || '').trim();
        // 출력 형식: "Locales for com.xxx: [ko-KR]" 또는 "ko-KR"
        const match = v.match(/\[([^\]]+)\]/);
        if (!match) continue; // [] 빈 값 or 에러 문자열 → 무시
        const locale = match[1].trim();
        if (locale && locale !== 'null' && /^[a-z]{2}/i.test(locale)) {
          return [locale];
        }
      } catch { /* ignore */ }
    }
    try {
      const raw = await this._execText(['shell', 'settings', 'get', 'system', 'system_locales'], serial);
      const v = (raw || '').trim();
      if (v && v !== 'null' && v !== '') return v.split(',').map(l => l.trim()).filter(Boolean);
    } catch { /* ignore */ }
    try {
      const raw = await this._execText(['shell', 'getprop', 'persist.sys.locale'], serial);
      const v = (raw || '').trim();
      if (v && v !== 'null') return [v];
    } catch { /* ignore */ }
    return [];
  }

  async setDeviceLocale(serial, locale, apkPath) {
    try {
      // 1) system_locales에 선택 언어가 없으면 맨 뒤에 추가만 (기존 목록/순서 절대 변경 안 함)
      const current = await this._execText(['shell', 'settings', 'get', 'system', 'system_locales'], serial);
      const list = (current || '').trim().split(',').map(l => l.trim()).filter(l => l && l !== 'null');
      if (list.length > 0 && !list.includes(locale)) {
        await this._execText(['shell', 'settings', 'put', 'system', 'system_locales', [...list, locale].join(',')], serial);
      }

      // 2) OVERDARE per-app locale 설정 (persist.sys.locale 건드리지 않아 게스트 로그인 보호)
      const pkgs = ['com.overdare.overdare.dev', 'com.overdare.overdare'];
      for (const pkg of pkgs) {
        try {
          await this._execText(['shell', 'cmd', 'locale', 'set-app-locales', pkg, '--user', '0', '--locales', locale], serial);
        } catch { /* 미설치 패키지 무시 */ }
      }

      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async getForegroundPkg(serial) {
    try {
      const out = await this._execText(['shell', 'dumpsys', 'window', 'displays'], serial);
      const m = out.match(/mCurrentFocus.*?\s([a-zA-Z0-9_.]+)\//);
      return m ? m[1] : null;
    } catch {
      return null;
    }
  }

  async getRnBundleVersion(serial, pkg) {
    // OVERDARE RN OTA 번들 버전 — debuggable 빌드(.dev) 만 read 가능
    try {
      const xml = await this._execText(
        ['shell', 'run-as', pkg, 'cat', 'shared_prefs/OVERDARE.BundleVersions.xml'],
        serial, { timeout: 4000 }
      );
      if (!xml) return '';
      const m = xml.match(/<string\s+name="platform_version">\s*([^<]+?)\s*<\/string>/);
      return m ? m[1].trim() : '';
    } catch {
      return '';
    }
  }

  async getRunningAppInfo(serial, pkg) {
    const result = { server: '', unrealVersion: '', appVersion: '', rnVersion: '' };
    const appLogDir = `/sdcard/Android/data/${pkg}/files/App`;
    let logFiles = [];

    try {
      const ls = await this._execText(['shell', 'ls', '-t', appLogDir], serial);
      logFiles = ls.trim().split('\n').filter(f => f.startsWith('LogHandler')).map(f => `${appLogDir}/${f.trim()}`);
    } catch {}

    if (logFiles.length > 0) {
      try {
        const header = await this._execText(['shell', 'head', '-15', logFiles[0]], serial);
        for (const line of header.split('\n')) {
          const uv = line.match(/UnrealVersion:\s*(\S+)/);
          if (uv) result.unrealVersion = uv[1];
          const av = line.match(/AppVersionName:\s*(\S+)/);
          if (av) result.appVersion = av[1];
          const rv = line.match(/ReactNativeVersion:\s*(\S+)/);
          if (rv) result.rnVersion = rv[1];
        }
      } catch {}
    }

    for (const logFile of logFiles) {
      if (result.server) break;
      try {
        const out = await this._execText(
          ['shell', 'grep', 'createChannel', logFile],
          serial, { timeout: 5000 }
        );
        const lines = out.trim().split('\n').reverse();
        for (const line of lines) {
          const m = line.match(/farm-(.+?)\.(?:overdare\.com|ovdr\.io)/);
          if (m) { result.server = m[1]; break; }
        }
      } catch {}
    }

    for (const logFile of logFiles) {
      if (result.unrealVersion) break;
      try {
        const out = await this._execText(
          ['shell', 'grep', '-m', '1', 'getUnrealClientVersion', logFile],
          serial, { timeout: 5000 }
        );
        const m = out.match(/getUnrealClientVersion:\s*(\S+)/);
        if (m) result.unrealVersion = m[1];
      } catch {}
    }

    if (!result.unrealVersion) {
      try {
        const ueLogPath = `/sdcard/Android/data/${pkg}/files/UnrealGame/Meta/Meta/Saved/Logs/Meta.log`;
        const out = await this._execText(
          ['shell', 'grep', '-m', '1', 'Meta Version', ueLogPath],
          serial, { timeout: 5000 }
        );
        const m = out.match(/Meta Version:\s*(\S+)/);
        if (m) result.unrealVersion = m[1];
      } catch {}
    }

    for (const logFile of logFiles) {
      if (result.appVersion) break;
      try {
        const out = await this._execText(
          ['shell', 'grep', '-m', '1', 'app_version', logFile],
          serial, { timeout: 5000 }
        );
        const m = out.match(/"app_version":\s*"([^"]+)"/);
        if (m) result.appVersion = m[1];
      } catch {}
    }

    if (!result.appVersion) {
      try {
        const ver = await this.getPackageVersion(serial, pkg);
        result.appVersion = ver;
      } catch {}
    }

    if (!result.rnVersion) {
      try { result.rnVersion = await this.getRnBundleVersion(serial, pkg); } catch {}
    }
    if (!result.rnVersion) {
      for (const logFile of logFiles) {
        if (result.rnVersion) break;
        try {
          const out = await this._execText(
            ['shell', 'grep', '-m', '1', 'ReactNativeVersion\\|Embedded bundle version', logFile],
            serial, { timeout: 5000 }
          );
          const m = out.match(/(?:ReactNativeVersion|Embedded bundle version):\s*(\S+)/);
          if (m) result.rnVersion = m[1];
        } catch {}
      }
    }

    if (!result.server) {
      try {
        const log = await this._execText(['logcat', '-d', '-t', '10000'], serial);
        const lines = log.split('\n');
        for (let i = lines.length - 1; i >= 0; i--) {
          const m = lines[i].match(/farm-(.+?)\.(?:overdare\.com|ovdr\.io)/);
          if (m) { result.server = m[1]; break; }
        }
      } catch {}
    }

    return result;
  }

  async uninstallPackage(serial, pkg) {
    try {
      const output = await this._execText(['uninstall', pkg], serial);
      return { success: output.includes('Success'), output: output.trim() };
    } catch (e) {
      return { success: false, output: e.message };
    }
  }

  async launchApp(serial, pkg) {
    try {
      const output = await this._execText(
        ['shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1'],
        serial
      );
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, output: e.message };
    }
  }

  async forceStop(serial, pkg) {
    try {
      await this._execText(['shell', 'am', 'force-stop', pkg], serial);
      return { success: true };
    } catch (e) {
      return { success: false, output: e.message };
    }
  }

  async clearData(serial, pkg) {
    try {
      const output = await this._execText(['shell', 'pm', 'clear', pkg], serial);
      return { success: output.includes('Success'), output: output.trim() };
    } catch (e) {
      return { success: false, output: e.message };
    }
  }

  startLogcat(serial, filters, onLine) {
    this.stopLogcat();
    const args = ['-s', serial, 'logcat', '-v', 'threadtime'];
    if (filters && filters.length) {
      args.push(...filters);
    }
    this.logcatProcess = spawn(this.adbPath, args, { detached: !isWin });
    let buffer = '';
    this.logcatProcess.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach((line) => {
        if (line.trim()) onLine(line);
      });
    });
    this.logcatProcess.stderr.on('data', (data) => {
      onLine(`[stderr] ${data.toString().trim()}`);
    });
  }

  stopLogcat() {
    if (this.logcatProcess) {
      const p = this.logcatProcess;
      this.logcatProcess = null;
      try { p.stdout && p.stdout.removeAllListeners('data'); } catch {}
      try { p.stderr && p.stderr.removeAllListeners('data'); } catch {}
      try { p.stdout && p.stdout.pause(); } catch {}
      try { p.stderr && p.stderr.pause(); } catch {}
      try { p.kill('SIGTERM'); } catch {}
      try {
        if (isWin) {
          execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' });
        } else {
          process.kill(-p.pid, 'SIGKILL');
        }
      } catch {}
      setTimeout(() => {
        try { p.kill('SIGKILL'); } catch {}
      }, 500);
    }
  }

  async clearLogcat(serial) {
    try {
      await this._execText(['logcat', '-c'], serial);
      return { success: true };
    } catch (e) {
      return { success: false, output: e.message };
    }
  }

  async listFiles(serial, remotePath) {
    try {
      const output = await this._execText(['shell', 'ls', '-la', remotePath], serial);
      const lines = output.trim().split('\n');
      const files = [];
      for (const line of lines) {
        if (line.startsWith('total') || !line.trim()) continue;
        const match = line.match(/^([drwx\-lsStT]{10})\s+\S+\s+(\S+)\s+(\S+)\s+(\d+)?\s*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/);
        if (match) {
          const name = match[6].trim();
          if (name === '.' || name === '..') continue;
          files.push({
            permissions: match[1],
            owner: match[2],
            group: match[3],
            size: match[4] ? parseInt(match[4]) : 0,
            date: match[5],
            name: name.includes(' -> ') ? name.split(' -> ')[0] : name,
            isDirectory: match[1].startsWith('d'),
            isLink: match[1].startsWith('l'),
            fullPath: remotePath.replace(/\/+$/, '') + '/' + (name.includes(' -> ') ? name.split(' -> ')[0] : name),
          });
        }
      }
      return files.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
    } catch (e) {
      return [];
    }
  }

  async pullFile(serial, remotePath, localPath) {
    try {
      const output = await this._execText(['pull', remotePath, localPath], serial);
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, output: e.message };
    }
  }

  async pushFile(serial, localPath, remotePath) {
    try {
      const output = await this._execText(['push', localPath, remotePath], serial);
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, output: e.message };
    }
  }

  async deleteFile(serial, remotePath) {
    try {
      await this._execText(['shell', 'rm', '-rf', remotePath], serial);
      return { success: true };
    } catch (e) {
      return { success: false, output: e.message };
    }
  }

  async screencap(serial) {
    if (this._screencapJpgUnsupported !== true) {
      try {
        const buffer = await this._exec(['exec-out', 'screencap', '-j'], serial);
        if (buffer && buffer.length > 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
          return { success: true, data: buffer.toString('base64'), mime: 'image/jpeg' };
        }
        this._screencapJpgUnsupported = true;
      } catch (e) {
        this._screencapJpgUnsupported = true;
      }
    }
    try {
      const buffer = await this._exec(['exec-out', 'screencap', '-p'], serial);
      return { success: true, data: buffer.toString('base64'), mime: 'image/png' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async dumpUi(serial) {
    const extractXml = (s) => {
      if (!s) return '';
      const i = s.indexOf('<?xml');
      const j = s.lastIndexOf('</hierarchy>');
      if (i >= 0 && j > i) return s.slice(i, j + '</hierarchy>'.length);
      return '';
    };

    let xml = '';
    let lastErr = '';

    try {
      const out = await this._execText(['exec-out', 'uiautomator', 'dump', '/dev/tty'], serial);
      xml = extractXml(out);
    } catch (e) { lastErr = e.message; }

    if (!xml) {
      const candidates = ['/sdcard/window_dump.xml', '/sdcard/ui_dump.xml', '/data/local/tmp/ui_dump.xml'];
      for (const path of candidates) {
        try {
          const dumpOut = await this._execText(['shell', 'uiautomator', 'dump', path], serial);
          const m = dumpOut.match(/dumped to:\s*(\S+)/i);
          const realPath = (m && m[1]) || path;
          const cat = await this._execText(['exec-out', 'cat', realPath], serial);
          const parsed = extractXml(cat);
          if (parsed) { xml = parsed; break; }
        } catch (e) { lastErr = e.message; }
      }
    }

    if (!xml) {
      try {
        const out = await this._execText(['shell', 'uiautomator', 'dump'], serial);
        const m = out.match(/dumped to:\s*(\S+)/i);
        if (m) {
          const cat = await this._execText(['exec-out', 'cat', m[1]], serial);
          xml = extractXml(cat);
        }
      } catch (e) { lastErr = e.message; }
    }

    if (!xml) {
      return { success: false, error: lastErr || 'UI 덤프 실패: 결과 XML을 가져올 수 없습니다 (디바이스가 잠금 화면이거나 보안 앱 화면일 수 있음)' };
    }

    const screencap = await this.screencap(serial);
    let deviceSize = null;
    try { deviceSize = await this.getDeviceSize(serial); } catch {}
    return {
      success: true,
      xml,
      screenshot: screencap.success ? screencap.data : null,
      screenshotMime: screencap.success ? screencap.mime : null,
      deviceSize,
    };
  }

  async getWifiIp(serial) {
    try {
      const output = await this._execText(['shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0'], serial);
      const match = output.match(/inet\s+(\d+\.\d+\.\d+\.\d+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  async enableTcpip(serial, port = 5555) {
    try {
      const output = await this._execText(['tcpip', String(port)], serial);
      return { success: output.toLowerCase().includes('restarting'), output: output.trim() };
    } catch (e) {
      return { success: false, output: e.message };
    }
  }

  async pair(address, code) {
    try {
      const output = await this._execText(['pair', address, code]);
      const success = output.toLowerCase().includes('successfully paired');
      return { success, output: output.trim() };
    } catch (e) {
      return { success: false, output: e.message };
    }
  }

  async connectWireless(address) {
    try {
      const output = await this._execText(['connect', address]);
      const success = output.toLowerCase().includes('connected');
      return { success, output: output.trim() };
    } catch (e) {
      return { success: false, output: e.message };
    }
  }

  async disconnectWireless(address) {
    try {
      const output = await this._execText(['disconnect', address || '']);
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, output: e.message };
    }
  }

  async inputTap(serial, x, y) {
    try {
      await this._execText(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))], serial);
    } catch { /* ignore */ }
  }

  async inputSwipe(serial, x1, y1, x2, y2, durationMs) {
    try {
      await this._execText([
        'shell', 'input', 'swipe',
        String(Math.round(x1)), String(Math.round(y1)),
        String(Math.round(x2)), String(Math.round(y2)),
        String(durationMs || 300),
      ], serial);
    } catch { /* ignore */ }
  }

  async inputKeyEvent(serial, keycode) {
    try {
      await this._execText(['shell', 'input', 'keyevent', String(keycode)], serial);
    } catch { /* ignore */ }
  }

  async inputText(serial, text) {
    try {
      await this._execText(['shell', 'input', 'text', text.replace(/ /g, '%s')], serial);
    } catch { /* ignore */ }
  }

  startScreenRecord(serial, remotePath) {
    this.stopScreenRecord();
    this.screenRecordSerial = serial;
    this.screenRecordRemotePath = remotePath;
    const args = ['-s', serial, 'shell', 'screenrecord', '--time-limit', '180', remotePath];
    this.screenRecordProcess = spawn(this.adbPath, args, { stdio: 'ignore' });
    this.screenRecordProcess.on('exit', () => {
      this.screenRecordProcess = null;
      if (this._onScreenRecordExit) this._onScreenRecordExit();
    });
    this.screenRecordProcess.on('error', () => {
      this.screenRecordProcess = null;
    });
    return { success: true };
  }

  stopScreenRecord() {
    if (this.screenRecordProcess) {
      const p = this.screenRecordProcess;
      this.screenRecordProcess = null;
      try {
        if (isWin) {
          execSync(`taskkill /pid ${p.pid} /T /F`, { stdio: 'ignore' });
        } else {
          p.kill('SIGINT');
        }
      } catch {
        try { p.kill(); } catch {}
      }
    }
  }

  async stopScreenRecordAndPull(localPath) {
    const serial = this.screenRecordSerial;
    const remotePath = this.screenRecordRemotePath;
    if (!serial || !remotePath) return { success: false, error: '녹화 중이 아닙니다' };

    this.stopScreenRecord();

    await new Promise((r) => setTimeout(r, 1500));

    try {
      await this._execText(['pull', remotePath, localPath], serial);
      try { await this._execText(['shell', 'rm', remotePath], serial); } catch {}
      return { success: true, filePath: localPath };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  isScreenRecording() {
    return this.screenRecordProcess !== null;
  }
}

module.exports = AdbManager;
