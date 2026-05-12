const { app, BrowserWindow, ipcMain, dialog, shell, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const AdbManager = require('./lib/adb-manager');
const ScrcpyManager = require('./lib/scrcpy-manager');
const DeviceMonitor = require('./lib/device-monitor');
const CrashMonitor = require('./lib/crash-monitor');
const PtyManager = require('./lib/pty-manager');
const fileTree = require('./lib/file-tree');
const claudeSessions = require('./lib/claude-sessions');
const { JiraClient, buildDescriptionAdf, buildDescriptionPanelAdf } = require('./lib/jira');
const { BvtRunner, autoDetectOrcaSlack, listScenarios } = require('./lib/bvt-runner');

let mainWindow;
let adb;
let scrcpyMgr;
let bvtRunner = null;
let deviceMonitor;
let crashMonitor;
let ptyMgr;

const BASE_DIR = process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(process.execPath) : __dirname);

const CONFIG_DIR = path.join(app.getPath('userData'), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'settings.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

function saveConfig(cfg) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
}

function getRememberedWireless() {
  const cfg = loadConfig();
  const list = Array.isArray(cfg.rememberedWirelessDevices) ? cfg.rememberedWirelessDevices : [];
  return list.filter((d) => d && typeof d.address === 'string' && /^[\d.]+:\d+$/.test(d.address));
}

function rememberWireless(address) {
  if (!address || !/^[\d.]+:\d+$/.test(address)) return;
  const cfg = loadConfig();
  const list = Array.isArray(cfg.rememberedWirelessDevices) ? cfg.rememberedWirelessDevices : [];
  const filtered = list.filter((d) => d && d.address !== address);
  filtered.unshift({ address, lastConnected: Date.now() });
  cfg.rememberedWirelessDevices = filtered.slice(0, 10);
  saveConfig(cfg);
}

function getDeviceAliases() {
  const cfg = loadConfig();
  return (cfg.deviceAliases && typeof cfg.deviceAliases === 'object') ? cfg.deviceAliases : {};
}

function setDeviceAlias(serial, alias) {
  if (!serial) return;
  const cfg = loadConfig();
  if (!cfg.deviceAliases || typeof cfg.deviceAliases !== 'object') cfg.deviceAliases = {};
  const trimmed = (alias || '').trim();
  if (trimmed) cfg.deviceAliases[serial] = trimmed.slice(0, 30);
  else delete cfg.deviceAliases[serial];
  saveConfig(cfg);
}

function forgetWireless(address) {
  const cfg = loadConfig();
  const list = Array.isArray(cfg.rememberedWirelessDevices) ? cfg.rememberedWirelessDevices : [];
  cfg.rememberedWirelessDevices = list.filter((d) => d && d.address !== address);
  saveConfig(cfg);
}

async function autoReconnectWireless() {
  const remembered = getRememberedWireless();
  if (!remembered.length || !adb) return [];
  const results = [];
  for (const item of remembered) {
    try {
      const r = await adb.connectWireless(item.address);
      results.push({ address: item.address, success: !!r.success, output: r.output });
      if (r.success) {
        const cfg = loadConfig();
        const list = Array.isArray(cfg.rememberedWirelessDevices) ? cfg.rememberedWirelessDevices : [];
        const target = list.find((d) => d && d.address === item.address);
        if (target) {
          target.lastConnected = Date.now();
          saveConfig(cfg);
        }
      }
    } catch (e) {
      results.push({ address: item.address, success: false, output: e.message });
    }
  }
  return results;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'QA Manager',
    icon: path.join(__dirname, 'assets', 'qa-icon.ico'),
    backgroundColor: '#1e1e2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
  mainWindow.setMenuBarVisibility(false);

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isF12 = input.key === 'F12';
    const isCtrlShiftI = (input.control || input.meta) && input.shift && (input.key === 'I' || input.key === 'i');
    if (isF12 || isCtrlShiftI) {
      const wc = mainWindow.webContents;
      if (wc.isDevToolsOpened()) wc.closeDevTools();
      else wc.openDevTools();
      event.preventDefault();
    }
  });

  mainWindow.on('app-command', (_e, cmd) => {
    if (cmd === 'browser-backward') {
      try { mainWindow.webContents.send('mouse-nav', 'back'); } catch {}
    } else if (cmd === 'browser-forward') {
      try { mainWindow.webContents.send('mouse-nav', 'forward'); } catch {}
    }
  });
}

function setupIpcHandlers() {
  adb = new AdbManager();
  const fs = require('fs');
  const isWin = process.platform === 'win32';

  ipcMain.handle('claude:list-sessions', async (_e, limit) => {
    try { return { ok: true, sessions: await claudeSessions.listSessions(limit || 50) }; }
    catch (e) { return { ok: false, error: e.message, sessions: [] }; }
  });

  ipcMain.handle('shell:open-external', async (_e, url, opts = {}) => {
    if (!url || typeof url !== 'string') return { ok: false, error: 'invalid url' };
    const isWindows = process.platform === 'win32';
    const browser = (opts.browser || '').toLowerCase();
    if (isWindows && browser) {
      const { spawn } = require('child_process');
      const candidates = {
        chrome: [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
        ],
        edge: [
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ],
        whale: [
          path.join(process.env.LOCALAPPDATA || '', 'Naver\\Naver Whale\\Application\\whale.exe'),
          'C:\\Program Files\\Naver\\Naver Whale\\Application\\whale.exe',
          'C:\\Program Files (x86)\\Naver\\Naver Whale\\Application\\whale.exe',
        ],
      }[browser] || [];
      for (const exe of candidates) {
        try {
          if (exe && fs.existsSync(exe)) {
            spawn(exe, [url], { detached: true, stdio: 'ignore' }).unref();
            return { ok: true, browser, exe };
          }
        } catch { /* try next */ }
      }
    }
    try { await shell.openExternal(url); return { ok: true, browser: 'default' }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('app:webview-preload-path', () => {
    const url = require('url');
    const candidate = app.isPackaged
      ? path.join(__dirname, 'webview-preload.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
      : path.join(__dirname, 'webview-preload.js');
    return url.pathToFileURL(candidate).toString();
  });

  ptyMgr = new PtyManager();
  ipcMain.handle('terminal:list-shells', () => ptyMgr.isAvailable() ? ptyMgr.listShells() : []);
  ipcMain.handle('terminal:create', (event, opts) => {
    if (!ptyMgr.isAvailable()) {
      return { error: '터미널 모듈(node-pty)이 로드되지 않았습니다. 앱을 재빌드해주세요.' };
    }
    const baseCwd = process.env.PORTABLE_EXECUTABLE_DIR
      || (app.isPackaged ? path.dirname(process.execPath) : __dirname);
    return ptyMgr.create(event.sender, { cwd: baseCwd, ...(opts || {}) });
  });
  ipcMain.handle('terminal:adb-path', () => adb.adbPath);
  ipcMain.handle('terminal:open-folder', (_e, folderPath) => {
    if (!folderPath) return false;
    try {
      shell.openPath(folderPath);
      return true;
    } catch { return false; }
  });

  // 파일 트리 IPC
  ipcMain.handle('tree:read-dir', (_e, dirPath, opts) => fileTree.readDir(dirPath, opts || {}));
  ipcMain.handle('tree:list-editors', () => fileTree.detectEditors());
  ipcMain.handle('tree:open-with', (_e, command, targetPath) => {
    if (!command || !targetPath) return false;
    try {
      const { spawn } = require('child_process');
      // .cmd 또는 .exe 모두 detached 로 실행
      const child = spawn(command, [targetPath], {
        detached: true,
        stdio: 'ignore',
        shell: process.platform === 'win32',
      });
      child.unref();
      return true;
    } catch (e) {
      return { error: e.message };
    }
  });
  ipcMain.handle('tree:show-in-folder', (_e, targetPath) => {
    if (!targetPath) return false;
    try { shell.showItemInFolder(targetPath); return true; } catch { return false; }
  });
  ipcMain.handle('tree:pick-folder', async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '워크스페이스 폴더 선택',
      properties: ['openDirectory'],
    });
    if (r.canceled || !r.filePaths?.[0]) return null;
    return r.filePaths[0];
  });
  ipcMain.on('terminal:write', (_e, id, data) => ptyMgr.write(id, data));
  ipcMain.on('terminal:resize', (_e, id, cols, rows) => ptyMgr.resize(id, cols, rows));
  ipcMain.on('terminal:kill', (_e, id) => ptyMgr.kill(id));

  const adbBin = isWin ? 'adb.exe' : 'adb';
  const scrcpyPacked = path.join(process.resourcesPath, 'scrcpy');
  const scrcpyDev = path.join(__dirname, 'vendor', 'scrcpy');
  let scrcpyDir = null;

  if (fs.existsSync(scrcpyPacked)) {
    scrcpyDir = scrcpyPacked;
  } else if (fs.existsSync(scrcpyDev)) {
    scrcpyDir = scrcpyDev;
  }

  if (scrcpyDir && fs.existsSync(path.join(scrcpyDir, adbBin))) {
    adb.adbPath = path.join(scrcpyDir, adbBin);
  } else if (!isWin) {
    const linuxAdb = ['/usr/bin/adb', '/usr/local/bin/adb'].find((p) => fs.existsSync(p));
    if (linuxAdb) adb.adbPath = linuxAdb;
  }

  scrcpyMgr = new ScrcpyManager(scrcpyDir);
  deviceMonitor = new DeviceMonitor(adb);

  const crashDir = path.join(BASE_DIR, 'crashes');
  crashMonitor = new CrashMonitor(adb.adbPath, crashDir);

  crashMonitor.on('crash', (crash) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('crash-detected', crash);
    }
  });

  deviceMonitor.on('devices-changed', (devices) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('devices-changed', devices);
      const connectedSerials = devices
        .filter((d) => d.status === 'device')
        .map((d) => d.serial);
      if (connectedSerials.length) {
        if (!crashMonitor.isRunning()) {
          crashMonitor.start(connectedSerials);
        } else {
          crashMonitor.updateDevices(connectedSerials);
        }
      } else {
        crashMonitor.stop();
      }
    }
  });

  ipcMain.handle('adb:get-devices', () => adb.getDevices());
  ipcMain.handle('adb:get-device-info', (_, serial) => adb.getDeviceInfo(serial));
  ipcMain.handle('adb:get-device-locales', (_, serial) => adb.getDeviceLocales(serial));
  ipcMain.handle('adb:set-device-locale', (_, serial, locale) => {
    const apkPath = app.isPackaged
      ? path.join(process.resourcesPath, 'app', 'assets', 'ADBChangeLanguage.apk')
      : path.join(__dirname, 'assets', 'ADBChangeLanguage.apk');
    return adb.setDeviceLocale(serial, locale, fs.existsSync(apkPath) ? apkPath : null);
  });

  ipcMain.handle('adb:install-apk', async (_, serial) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'APK Files', extensions: ['apk'] }],
    });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
    return adb.installApk(serial, result.filePaths[0]);
  });
  ipcMain.handle('adb:install-apk-path', (_, serial, apkPath) => adb.installApk(serial, apkPath));

  ipcMain.handle('adb:clean-install', async (_, serial, pkgName) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'APK Files', extensions: ['apk'] }],
    });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
    try { await adb.forceStop(serial, pkgName); } catch {}
    const uninstResult = await adb.uninstallPackage(serial, pkgName);
    if (!uninstResult.success) {
      return { success: false, output: `삭제 실패: ${uninstResult.output}\n패키지명(${pkgName})이 맞는지 확인해주세요.` };
    }
    await new Promise((r) => setTimeout(r, 1500));
    return adb.installApk(serial, result.filePaths[0]);
  });

  ipcMain.handle('adb:list-packages', (_, serial, filter) => adb.listPackages(serial, filter));
  ipcMain.handle('adb:uninstall-package', (_, serial, pkg) => adb.uninstallPackage(serial, pkg));
  ipcMain.handle('adb:launch-app', (_, serial, pkg) => adb.launchApp(serial, pkg));
  ipcMain.handle('adb:force-stop', (_, serial, pkg) => adb.forceStop(serial, pkg));
  ipcMain.handle('adb:clear-data', (_, serial, pkg) => adb.clearData(serial, pkg));

  let logcatBuffer = [];
  let logcatFlushTimer = null;
  const flushLogcat = () => {
    if (!logcatBuffer.length) return;
    const batch = logcatBuffer;
    logcatBuffer = [];
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('logcat-lines', batch);
    }
  };
  ipcMain.handle('adb:start-logcat', (_, serial, filters) => {
    logcatBuffer = [];
    if (logcatFlushTimer) { clearInterval(logcatFlushTimer); }
    logcatFlushTimer = setInterval(flushLogcat, 100);
    adb.startLogcat(serial, filters, (line) => {
      logcatBuffer.push(line);
      if (logcatBuffer.length >= 500) flushLogcat();
    });
    return { success: true };
  });
  ipcMain.handle('adb:stop-logcat', () => {
    adb.stopLogcat();
    if (logcatFlushTimer) { clearInterval(logcatFlushTimer); logcatFlushTimer = null; }
    logcatBuffer = [];
    return { success: true };
  });
  ipcMain.handle('adb:clear-logcat', (_, serial) => adb.clearLogcat(serial));

  ipcMain.handle('adb:start-h264-stream', async (_, serial, opts) => {
    try {
      const deviceSize = await adb.getDeviceSize(serial).catch(() => null);
      adb.startH264Stream(
        serial,
        opts,
        (chunk) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('h264-chunk', chunk);
          }
        },
        (meta) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('h264-meta', { ...meta, deviceSize });
          }
        },
        () => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('h264-end');
          }
        }
      );
      return { success: true, deviceSize };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('adb:stop-h264-stream', () => {
    adb.stopH264Stream();
    return { success: true };
  });

  ipcMain.handle('adb:list-files', (_, serial, remotePath) => adb.listFiles(serial, remotePath));
  ipcMain.handle('adb:pull-file', async (_, serial, remotePath) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: path.basename(remotePath),
    });
    if (result.canceled) return { success: false, canceled: true };
    return adb.pullFile(serial, remotePath, result.filePath);
  });
  ipcMain.handle('adb:push-file', async (_, serial, remotePath) => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
    if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };
    return adb.pushFile(serial, result.filePaths[0], remotePath);
  });
  ipcMain.handle('adb:delete-file', (_, serial, remotePath) => adb.deleteFile(serial, remotePath));

  scrcpyMgr.onExit = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scrcpy-exited');
    }
  };
  ipcMain.handle('scrcpy:start', (_, serial, options) => scrcpyMgr.start(serial, options));
  ipcMain.handle('scrcpy:stop', () => scrcpyMgr.stop());
  ipcMain.handle('scrcpy:is-running', () => scrcpyMgr.isRunning());

  adb._onScreenRecordExit = () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('screen-record-finished');
    }
  };

  ipcMain.handle('adb:start-record', (_, serial) => {
    const now = new Date();
    const ts = `${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`;
    const remotePath = `/sdcard/rec_${ts}.mp4`;
    return adb.startScreenRecord(serial, remotePath);
  });

  ipcMain.handle('adb:stop-record', async (_, serial) => {
    const today = new Date().toISOString().slice(0, 10);
    const dir = path.join(BASE_DIR, 'screenshots', today);
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}-${now.getMinutes().toString().padStart(2,'0')}-${now.getSeconds().toString().padStart(2,'0')}`;
    const localPath = path.join(dir, `record_${time}.mp4`);
    return adb.stopScreenRecordAndPull(localPath);
  });

  ipcMain.handle('adb:is-recording', () => adb.isScreenRecording());
  ipcMain.handle('adb:screencap', (_, serial) => adb.screencap(serial));

  ipcMain.handle('adb:dump-ui', (_, serial) => adb.dumpUi(serial));
  ipcMain.handle('adb:foreground-pkg', (_, serial) => adb.getForegroundPkg(serial));
  ipcMain.handle('adb:running-app-info', (_, serial, pkg) => adb.getRunningAppInfo(serial, pkg));
  ipcMain.handle('adb:get-wifi-ip', (_, serial) => adb.getWifiIp(serial));
  ipcMain.handle('adb:pair', (_, address, code) => adb.pair(address, code));
  ipcMain.handle('adb:connect-wireless', async (_, address) => {
    const result = await adb.connectWireless(address);
    if (result && result.success) rememberWireless(address);
    return result;
  });
  ipcMain.handle('adb:disconnect-wireless', (_, address) => adb.disconnectWireless(address));

  ipcMain.handle('adb:enable-tcpip', (_, serial, port) => adb.enableTcpip(serial, port || 5555));

  ipcMain.handle('wireless:setup-fixed-port', async (_, serial) => {
    try {
      const isWireless = typeof serial === 'string' && serial.includes(':');
      let ip;
      if (isWireless) {
        ip = serial.split(':')[0];
      } else {
        ip = await adb.getWifiIp(serial);
        if (!ip) return { success: false, step: 'ip', output: 'Wi-Fi IP를 가져올 수 없습니다. 폰이 Wi-Fi에 연결되어 있는지 확인하세요.' };
      }

      const tcp = await adb.enableTcpip(serial, 5555);
      if (!tcp.success) return { success: false, step: 'tcpip', output: tcp.output };

      await new Promise((r) => setTimeout(r, 2000));

      const address = `${ip}:5555`;
      let conn = await adb.connectWireless(address);
      if (!conn.success) {
        await new Promise((r) => setTimeout(r, 1500));
        conn = await adb.connectWireless(address);
      }
      if (!conn.success) return { success: false, step: 'connect', output: conn.output, address };

      if (isWireless && serial !== address) {
        try { await adb.disconnectWireless(serial); } catch {}
        forgetWireless(serial);
      }

      rememberWireless(address);
      return { success: true, address, output: conn.output, wasWireless: isWireless };
    } catch (e) {
      return { success: false, step: 'exception', output: e.message };
    }
  });

  ipcMain.handle('device:get-aliases', () => getDeviceAliases());
  ipcMain.handle('device:set-alias', (_, serial, alias) => {
    setDeviceAlias(serial, alias);
    return getDeviceAliases();
  });

  ipcMain.handle('wireless:get-remembered', () => getRememberedWireless());
  ipcMain.handle('wireless:forget', (_, address) => {
    forgetWireless(address);
    return getRememberedWireless();
  });
  ipcMain.handle('wireless:auto-reconnect', () => autoReconnectWireless());

  ipcMain.handle('adb:input-tap', (_, serial, x, y) => adb.inputTap(serial, x, y));
  ipcMain.handle('adb:input-swipe', (_, serial, x1, y1, x2, y2, dur) => adb.inputSwipe(serial, x1, y1, x2, y2, dur));
  ipcMain.handle('adb:input-key', (_, serial, keycode) => adb.inputKeyEvent(serial, keycode));

  ipcMain.handle('adb:save-screenshot', async (_, base64Data) => {
    const fs = require('fs');
    const today = new Date().toISOString().slice(0, 10);
    const dir = path.join(BASE_DIR, 'screenshots', today);
    fs.mkdirSync(dir, { recursive: true });

    const now = new Date();
    const time = `${now.getHours().toString().padStart(2,'0')}-${now.getMinutes().toString().padStart(2,'0')}-${now.getSeconds().toString().padStart(2,'0')}`;
    const fileName = `screenshot_${time}.png`;
    const filePath = path.join(dir, fileName);

    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    return { success: true, filePath, dir };
  });

  ipcMain.handle('shell:open-screenshot-folder', async () => {
    const fs = require('fs');
    const { shell } = require('electron');
    const today = new Date().toISOString().slice(0, 10);
    const dir = path.join(BASE_DIR, 'screenshots', today);
    fs.mkdirSync(dir, { recursive: true });
    shell.openPath(dir);
  });

  ipcMain.handle('dialog:pick-files-from-screenshots', async () => {
    const fs = require('fs');
    const today = new Date().toISOString().slice(0, 10);
    const todayDir = path.join(BASE_DIR, 'screenshots', today);
    const rootDir = path.join(BASE_DIR, 'screenshots');
    fs.mkdirSync(todayDir, { recursive: true });
    const defaultPath = fs.existsSync(todayDir) ? todayDir : rootDir;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '첨부할 파일 선택 (스크린샷 폴더)',
      defaultPath,
      properties: ['openFile', 'multiSelections'],
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true, files: [] };
    const files = [];
    for (const fp of result.filePaths) {
      try {
        const buf = fs.readFileSync(fp);
        files.push({ filename: path.basename(fp), dataBase64: buf.toString('base64') });
      } catch (e) {
        files.push({ filename: path.basename(fp), error: e.message });
      }
    }
    return { ok: true, files };
  });

  ipcMain.handle('dialog:save-file', async (_, defaultName) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: defaultName,
      filters: [{ name: 'Text Files', extensions: ['txt', 'log'] }],
    });
    if (result.canceled) return null;
    return result.filePath;
  });

  ipcMain.handle('fs:write-file', async (_, filePath, content) => {
    const fs = require('fs').promises;
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  });

  function safeName(name) {
    return name.replace(/[<>:"/\\|?*]/g, '_');
  }

  ipcMain.handle('adb:pull-all-logs', async (_, serial, remotePaths, opts = {}) => {
    const fs = require('fs');

    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
    // 시간대별 서브폴더로 그룹화
    const sessionDir = opts.withScreenshot
      ? path.join(BASE_DIR, 'logs', today, time)
      : path.join(BASE_DIR, 'logs', today);
    fs.mkdirSync(sessionDir, { recursive: true });

    const paths = Array.isArray(remotePaths) ? remotePaths : [remotePaths];
    let totalPulled = 0;
    let screenshotPath = null;
    const pulledFiles = [];

    try {
      for (const remotePath of paths) {
        const files = await adb.listFiles(serial, remotePath);
        const realFiles = files.filter((f) => !f.isDirectory);
        for (const f of realFiles) {
          const safe = safeName(f.name);
          const localPath = path.join(sessionDir, safe);
          await adb.pullFile(serial, f.fullPath, localPath);
          pulledFiles.push({ name: safe, path: localPath });
          totalPulled++;
        }
      }

      if (opts.withScreenshot) {
        try {
          const shot = await adb.screencap(serial);
          if (shot && shot.success && shot.data) {
            screenshotPath = path.join(sessionDir, `screenshot_${time}.png`);
            fs.writeFileSync(screenshotPath, Buffer.from(shot.data, 'base64'));
          }
        } catch (e) { /* screenshot optional */ }
      }

      if (!totalPulled && !screenshotPath) return { success: false, error: '추출할 파일이 없습니다.' };
      return { success: true, logsDir: sessionDir, count: totalPulled, screenshotPath, files: pulledFiles };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('logs:open-today-folder', async () => {
    const fs = require('fs');
    const { shell } = require('electron');
    const now = new Date();
    const pad = (n) => n.toString().padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const todayDir = path.join(BASE_DIR, 'logs', today);
    const baseDir = path.join(BASE_DIR, 'logs');
    try {
      if (fs.existsSync(todayDir)) { shell.openPath(todayDir); return { success: true, path: todayDir }; }
      fs.mkdirSync(baseDir, { recursive: true });
      shell.openPath(baseDir);
      return { success: true, path: baseDir };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('shell:open-folder', async (_, folderPath) => {
    const { shell } = require('electron');
    shell.openPath(folderPath);
  });

  ipcMain.handle('fs:read-logs-dir', async (_, dirPath) => {
    const fsP = require('fs').promises;
    try {
      const files = await fsP.readdir(dirPath);
      let combined = '';
      for (const f of files) {
        if (!f.endsWith('.txt') && !f.endsWith('.log')) continue;
        const content = await fsP.readFile(path.join(dirPath, f), 'utf-8');
        combined += `\n===== ${f} =====\n${content}\n`;
        if (combined.length > 100000) break;
      }
      return { success: true, text: combined.slice(0, 100000) };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('adb:fetch-recent-log', async (_, serial) => {
    try {
      const log = await adb._execText(['logcat', '-d', '-t', '3000'], serial);
      return { success: true, text: log };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // --- Crash Monitor ---
  ipcMain.handle('crash:get-history', () => crashMonitor.getHistory());
  ipcMain.handle('crash:clear-history', () => { crashMonitor.clearHistory(); return { success: true }; });
  ipcMain.handle('crash:set-watched-app', (_, pkg) => {
    crashMonitor.setWatchedApp(pkg || null);
    return { success: true };
  });
  ipcMain.handle('crash:restart-monitor', (_, serial) => {
    if (serial && crashMonitor.isRunning()) {
      crashMonitor.updateDevices([...new Set([...crashMonitor.connectedSerials, serial])]);
    } else if (serial) {
      crashMonitor.start([serial]);
    }
    return { success: true };
  });
  ipcMain.handle('crash:open-folder', () => {
    const { shell } = require('electron');
    fs.mkdirSync(crashDir, { recursive: true });
    shell.openPath(crashDir);
  });
  ipcMain.handle('crash:read-log', async (_, filePath) => {
    try {
      return { success: true, text: fs.readFileSync(filePath, 'utf-8') };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('crash:test', async () => {
    const now = new Date();
    const dummyStacktrace = `03-31 01:20:15.123 E/AndroidRuntime(12345): FATAL EXCEPTION: main
03-31 01:20:15.123 E/AndroidRuntime(12345): Process: com.example.socialapp, PID: 12345
03-31 01:20:15.123 E/AndroidRuntime(12345): java.lang.NullPointerException
03-31 01:20:15.123 E/AndroidRuntime(12345):     at com.example.socialapp.ui.friend.FriendListFragment.onFriendButtonClick(FriendListFragment.java:142)`;

    const crash = {
      time: now.toISOString(),
      timeLocal: `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`,
      type: 'CRASH',
      app: 'com.example.socialapp',
      activity: 'com.example.socialapp/.ui.friend.FriendListActivity',
      preview: dummyStacktrace.split('\n').slice(0, 5).join('\n'),
      stacktrace: dummyStacktrace,
      file: null,
    };

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('crash-detected', crash);
    }

    return { success: true };
  });

  // ── Jira ──────────────────────────────────────────────────────────
  ipcMain.handle('jira:test', async (_e, cfg) => {
    try {
      const client = new JiraClient(cfg);
      const me = await client.myself();
      return { success: true, accountId: me.accountId, displayName: me.displayName, emailAddress: me.emailAddress };
    } catch (e) { return { success: false, error: e.message, status: e.status }; }
  });

  ipcMain.handle('jira:inspect', async (_e, cfg, issueKey) => {
    try {
      const client = new JiraClient(cfg);
      const issue = await client.getIssue(issueKey);
      const names = issue.names || {};
      const fields = issue.fields || {};
      const list = Object.keys(fields).map((id) => ({
        id,
        name: names[id] || id,
        value: fields[id],
      }));
      return { success: true, fields: list };
    } catch (e) { return { success: false, error: e.message, status: e.status, body: e.body }; }
  });

  ipcMain.handle('jira:createmeta', async (_e, cfg, projectKey, issueType) => {
    try {
      const client = new JiraClient(cfg);
      const meta = await client.getCreateMeta(projectKey, issueType || 'Bug');
      const proj = (meta.projects || [])[0];
      const itype = proj && (proj.issuetypes || [])[0];
      const fields = itype && itype.fields ? itype.fields : {};
      const list = Object.keys(fields).map((id) => ({
        id,
        name: fields[id].name,
        required: fields[id].required,
        schema: fields[id].schema,
        allowedValues: fields[id].allowedValues,
      }));
      return { success: true, fields: list };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('jira:components', async (_e, cfg, projectKey) => {
    try {
      const client = new JiraClient(cfg);
      const list = await client.listComponents(projectKey);
      return { success: true, items: list };
    } catch (e) { return { success: false, error: e.message }; }
  });

  ipcMain.handle('jira:create', async (_e, cfg, payload, attachments) => {
    try {
      const client = new JiraClient(cfg);
      const descPanel = payload.descriptionSections ? buildDescriptionPanelAdf(payload.descriptionSections) : undefined;
      const issue = await client.createIssue({
        projectKey: payload.projectKey,
        issueType: payload.issueType,
        summary: payload.summary,
        descriptionPanelAdf: descPanel,
        labels: payload.labels,
        components: payload.components,
        priority: payload.priority,
        severity: payload.severity,
        bugCategory: payload.bugCategory,
        frequency: payload.frequency,
      });
      const linkResults = [];
      const linkedIssues = Array.isArray(payload.linkedIssues) ? payload.linkedIssues : [];
      const linkType = payload.linkType || 'Relates';
      for (const targetKey of linkedIssues) {
        try {
          // 새 티켓이 "is blocked by" 대상 → inward = 대상, outward = 새 티켓
          await client.createIssueLink(targetKey, issue.key, linkType);
          linkResults.push({ key: targetKey, ok: true });
        } catch (e) {
          linkResults.push({ key: targetKey, ok: false, error: e.message });
        }
      }
      const attachResults = [];
      for (const att of (attachments || [])) {
        try {
          if (att.path) {
            const r = await client.attachFile(issue.key, att.path, att.filename);
            attachResults.push({ name: att.filename || att.path, ok: true });
          } else if (att.dataBase64) {
            const buf = Buffer.from(att.dataBase64, 'base64');
            await client.attachBuffer(issue.key, buf, att.filename);
            attachResults.push({ name: att.filename, ok: true });
          }
        } catch (e) {
          attachResults.push({ name: att.filename || att.path, ok: false, error: e.message });
        }
      }
      const issueUrl = `${cfg.baseUrl.replace(/\/$/, '')}/browse/${issue.key}`;
      return { success: true, key: issue.key, url: issueUrl, attachments: attachResults, links: linkResults };
    } catch (e) { return { success: false, error: e.message, status: e.status, body: e.body }; }
  });

  // 단일 이슈 리오픈: 첨부 업로드 → 댓글 (인라인 이미지 포함) 작성 → "Reopened" 트랜지션
  ipcMain.handle('jira:reopen', async (_e, cfg, issueKey, payload, attachments) => {
    try {
      const client = new JiraClient(cfg);
      // 1) 첨부 업로드
      const uploaded = []; // { id, filename, mimeType, isImage }
      for (const att of (attachments || [])) {
        try {
          let r;
          if (att.path) {
            r = await client.attachFile(issueKey, att.path, att.filename);
          } else if (att.dataBase64) {
            const buf = Buffer.from(att.dataBase64, 'base64');
            r = await client.attachBuffer(issueKey, buf, att.filename);
          }
          // attachFile 응답은 배열
          const arr = Array.isArray(r) ? r : (r ? [r] : []);
          for (const a of arr) {
            uploaded.push({
              id: a.id,
              filename: a.filename || att.filename,
              mimeType: a.mimeType || '',
              isImage: !!(att.inlineImage) || /^image\//i.test(a.mimeType || ''),
            });
          }
        } catch (e) {
          uploaded.push({ filename: att.filename, ok: false, error: e.message });
        }
      }

      // 2) ADF 댓글 본문 구성: plain 텍스트 + 인라인 이미지 (mediaSingle)
      const commentText = payload.commentText || '';
      const adfContent = [];
      const lines = commentText.split('\n');
      const para = { type: 'paragraph', content: [] };
      lines.forEach((line, i) => {
        if (line) para.content.push({ type: 'text', text: line });
        if (i < lines.length - 1) para.content.push({ type: 'hardBreak' });
      });
      if (para.content.length === 0) adfContent.push({ type: 'paragraph' });
      else adfContent.push(para);

      // ※ Jira Cloud REST API 로 만든 댓글은 mediaSingle 인라인 이미지를 거부합니다.
      // (ATTACHMENT_VALIDATION_ERROR / INVALID_INPUT) 대신 첨부 파일명을 클릭 가능한
      // 링크로 댓글 본문 끝에 나열. 누르면 Jira 첨부 미리보기/다운로드 페이지 열림.
      const baseUrl = cfg.baseUrl.replace(/\/$/, '');
      const goodUploads = uploaded.filter((u) => u && u.id);
      if (goodUploads.length) {
        const para = { type: 'paragraph', content: [] };
        goodUploads.forEach((u, i) => {
          const safeName = encodeURIComponent(u.filename || `file-${u.id}`);
          const href = `${baseUrl}/secure/attachment/${u.id}/${safeName}`;
          para.content.push({
            type: 'text',
            text: u.filename || `file-${u.id}`,
            marks: [{ type: 'link', attrs: { href } }],
          });
          if (i < goodUploads.length - 1) para.content.push({ type: 'hardBreak' });
        });
        adfContent.push(para);
      }
      const bodyAdf = { type: 'doc', version: 1, content: adfContent };
      await client.addComment(issueKey, bodyAdf);

      // 3) Reopened 트랜지션 찾아서 실행
      const tr = await client.listTransitions(issueKey);
      const list = (tr && tr.transitions) || [];
      const reopenTr = list.find((t) => /reopen/i.test(t.name)) || list.find((t) => /다시\s*열기|재오픈/.test(t.name));
      if (!reopenTr) {
        return { success: false, error: `Reopen 트랜지션을 찾을 수 없습니다. 가능한 트랜지션: ${list.map((t) => t.name).join(', ') || '(없음)'}` };
      }
      await client.doTransition(issueKey, reopenTr.id);

      const issueUrl = `${cfg.baseUrl.replace(/\/$/, '')}/browse/${issueKey}`;
      return { success: true, key: issueKey, url: issueUrl, transition: reopenTr.name, uploaded };
    } catch (e) {
      return { success: false, error: e.message, status: e.status, body: e.body };
    }
  });

  // ===== BVT 자동화 =====
  ipcMain.handle('bvt:detect-orca', () => autoDetectOrcaSlack());
  ipcMain.handle('bvt:list-scenarios', (_e, orcaPath) => listScenarios(orcaPath));
  ipcMain.handle('bvt:status', () => ({ running: !!(bvtRunner && bvtRunner.isRunning()) }));
  ipcMain.handle('bvt:start', async (_e, opts) => {
    try {
      if (bvtRunner && bvtRunner.isRunning()) return { success: false, error: '이미 실행 중입니다' };
      bvtRunner = new BvtRunner(mainWindow);
      await bvtRunner.start(opts);
      return { success: true };
    } catch (e) { return { success: false, error: e.message }; }
  });
  ipcMain.handle('bvt:stop', () => {
    if (bvtRunner && bvtRunner.isRunning()) { bvtRunner.stop(); return { success: true }; }
    return { success: false, error: '실행 중이 아닙니다' };
  });
  ipcMain.handle('bvt:stdin', (_e, text) => {
    if (bvtRunner && bvtRunner.isRunning()) return { success: bvtRunner.sendStdin(text) };
    return { success: false };
  });
}

// webview (Hub/Hiker/Woodman/TC/Orca) 안에서만 F5/Ctrl+R 로 reload.
// 메인 윈도우 (renderer) 의 F5 는 무시 → 일반 패널에서 새로고침되지 않음.
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  // Jira issue 링크 (window.open / target=_blank) → 메인 윈도우로 라우팅
  const JIRA_BROWSE_RE = /^https?:\/\/[^/]*atlassian\.net\/browse\//i;
  try {
    contents.setWindowOpenHandler(({ url }) => {
      if (JIRA_BROWSE_RE.test(url || '')) {
        try {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('jira:open-issue', url, contents.id);
          }
        } catch {}
        return { action: 'deny' };
      }
      // 그 외 외부 링크는 OS 브라우저로
      try { shell.openExternal(url); } catch {}
      return { action: 'deny' };
    });
  } catch {}
  try {
    contents.on('will-navigate', (event, url) => {
      if (!JIRA_BROWSE_RE.test(url || '')) return;
      // 현재 webview 의 시작 URL 이 atlassian.net 이면 (= jira-webview 본체) 그냥 정상 진행
      try {
        const cur = contents.getURL() || '';
        if (/atlassian\.net\/(browse|jira|issues|projects)/i.test(cur)) {
          return; // jira 패널 안에서의 이동은 막지 않음
        }
      } catch {}
      // 그 외 (예: confluence) → navigation 막고 메인 윈도우에 라우팅 요청
      try { event.preventDefault(); } catch {}
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('jira:open-issue', url, contents.id);
        }
      } catch {}
    });
  } catch {}
  try {
    contents.on('input-event', (_evt, input) => {
      if (input.type !== 'mouseDown') return;
      const isBack = input.button === 'back' || input.button === 3;
      const isFwd = input.button === 'forward' || input.button === 4;
      if (!isBack && !isFwd) return;
      try {
        const nh = contents.navigationHistory;
        if (isBack) {
          if (nh ? nh.canGoBack() : contents.canGoBack()) {
            nh ? nh.goBack() : contents.goBack();
            return;
          }
        } else {
          if (nh ? nh.canGoForward() : contents.canGoForward()) {
            nh ? nh.goForward() : contents.goForward();
            return;
          }
        }
        // webview 가 더 못 가면 메인 윈도우에 패널 history 이동 신호
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('mouse-nav', isBack ? 'back' : 'forward');
        }
      } catch {}
    });
  } catch {}
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isF5 = input.key === 'F5';
    const isCtrlMeta = input.control || input.meta;
    const isCtrlR = isCtrlMeta && (input.key === 'r' || input.key === 'R');
    const isCtrlF = isCtrlMeta && (input.key === 'f' || input.key === 'F') && !input.shift;
    const isCtrlH = isCtrlMeta && (input.key === 'h' || input.key === 'H') && !input.shift;
    const isEscape = input.key === 'Escape';
    if (isCtrlF || isCtrlH) {
      event.preventDefault();
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('webview:find-open', contents.id, isCtrlH);
        }
      } catch { /* ignore */ }
      return;
    }
    if (isEscape) {
      try {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('webview:find-close', contents.id);
        }
      } catch { /* ignore */ }
    }
    // 줌 단축키 (Ctrl +/- /0)
    if (isCtrlMeta && (input.key === '+' || input.key === '=' || input.key === '-' || input.key === '_' || input.key === '0')) {
      event.preventDefault();
      try {
        const cur = contents.getZoomFactor() || 1;
        let next = cur;
        if (input.key === '0') next = 1;
        else if (input.key === '+' || input.key === '=') next = Math.min(3, cur + 0.1);
        else next = Math.max(0.3, cur - 0.1);
        contents.setZoomFactor(next);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('webview:zoom-changed', contents.id, next);
        }
      } catch {}
      return;
    }
    if (!isF5 && !isCtrlR) return;
    event.preventDefault();
    try {
      if (input.shift) contents.reloadIgnoringCache();
      else contents.reload();
    } catch { /* ignore */ }
  });
  // 줌 변경(휠 등) 시 영구 저장 (renderer 가 webContents id 로 매핑)
  try {
    contents.on('zoom-changed', (_evt, dir) => {
      try {
        const cur = contents.getZoomFactor() || 1;
        const next = Math.max(0.3, Math.min(3, cur + (dir === 'in' ? 0.1 : -0.1)));
        contents.setZoomFactor(next);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('webview:zoom-changed', contents.id, next);
        }
      } catch {}
    });
  } catch {}
  contents.on('found-in-page', (_evt, result) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('webview:find-result', { id: contents.id, result });
      }
    } catch { /* ignore */ }
  });
});

ipcMain.handle('webview:find', async (_e, webContentsId, text, opts) => {
  try {
    const contents = webContents.fromId(webContentsId);
    if (!contents) return { success: false, error: 'webContents not found' };
    if (!text) { contents.stopFindInPage('clearSelection'); return { success: true }; }
    const o = opts || { findNext: false };
    // 새 검색어(=findNext:false): 페이지 맨 위에서부터 찾도록 selection 초기화
    if (!o.findNext) {
      try {
        contents.stopFindInPage('clearSelection');
        await contents.executeJavaScript('window.scrollTo(0,0); (window.getSelection && window.getSelection().removeAllRanges());', true).catch(() => {});
      } catch { /* ignore */ }
    }
    const reqId = contents.findInPage(text, o);
    return { success: true, requestId: reqId };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('webview:find-stop', (_e, webContentsId) => {
  try {
    const contents = webContents.fromId(webContentsId);
    if (contents) contents.stopFindInPage('clearSelection');
    return { success: true };
  } catch (e) { return { success: false, error: e.message }; }
});
ipcMain.handle('webview:exec-js', async (_e, webContentsId, code) => {
  try {
    const contents = webContents.fromId(webContentsId);
    if (!contents) return { success: false, error: 'webContents not found' };
    const result = await contents.executeJavaScript(code, true);
    return { success: true, result };
  } catch (e) { return { success: false, error: e.message }; }
});

app.whenReady().then(() => {
  createWindow();
  setupIpcHandlers();
  deviceMonitor.start();

  mainWindow.webContents.once('did-finish-load', async () => {
    try {
      const results = await autoReconnectWireless();
      if (results.length) {
        mainWindow.webContents.send('wireless:auto-reconnect-result', results);
      }
    } catch {}
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  deviceMonitor.stop();
  crashMonitor.stop();
  adb.stopLogcat();
  adb.stopScreenRecord();
  adb.stopH264Stream();
  scrcpyMgr.stop();
  if (ptyMgr) ptyMgr.killAll();
  if (process.platform !== 'darwin') app.quit();
});
