const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const AdbManager = require('./lib/adb-manager');
const ScrcpyManager = require('./lib/scrcpy-manager');
const DeviceMonitor = require('./lib/device-monitor');
const CrashMonitor = require('./lib/crash-monitor');

let mainWindow;
let adb;
let scrcpyMgr;
let deviceMonitor;
let crashMonitor;

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
    title: 'Android Device Manager',
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
}

function setupIpcHandlers() {
  adb = new AdbManager();
  const fs = require('fs');
  const isWin = process.platform === 'win32';

  ipcMain.handle('app:webview-preload-path', () => {
    const url = require('url');
    const candidate = app.isPackaged
      ? path.join(__dirname, 'webview-preload.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1')
      : path.join(__dirname, 'webview-preload.js');
    return url.pathToFileURL(candidate).toString();
  });

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

  ipcMain.handle('adb:start-logcat', (_, serial, filters) => {
    adb.startLogcat(serial, filters, (line) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('logcat-line', line);
      }
    });
    return { success: true };
  });
  ipcMain.handle('adb:stop-logcat', () => {
    adb.stopLogcat();
    return { success: true };
  });
  ipcMain.handle('adb:clear-logcat', (_, serial) => adb.clearLogcat(serial));

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

  ipcMain.handle('adb:pull-all-logs', async (_, serial, remotePaths) => {
    const fs = require('fs');

    const today = new Date().toISOString().slice(0, 10);
    const logsDir = path.join(BASE_DIR, 'logs', today);
    fs.mkdirSync(logsDir, { recursive: true });

    const paths = Array.isArray(remotePaths) ? remotePaths : [remotePaths];
    let totalPulled = 0;

    try {
      for (const remotePath of paths) {
        const files = await adb.listFiles(serial, remotePath);
        const realFiles = files.filter((f) => !f.isDirectory);
        for (const f of realFiles) {
          const localPath = path.join(logsDir, safeName(f.name));
          await adb.pullFile(serial, f.fullPath, localPath);
          totalPulled++;
        }
      }

      if (!totalPulled) return { success: false, error: '로그 파일이 없습니다.' };
      return { success: true, logsDir, count: totalPulled };
    } catch (e) {
      return { success: false, error: e.message };
    }
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
}

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
  scrcpyMgr.stop();
  if (process.platform !== 'darwin') app.quit();
});
