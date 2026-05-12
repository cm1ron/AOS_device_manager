const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getFilePath: (file) => webUtils.getPathForFile(file),
  getWebviewPreloadPath: () => ipcRenderer.invoke('app:webview-preload-path'),
  openExternal: (url, opts) => ipcRenderer.invoke('shell:open-external', url, opts),
  onMouseNav: (cb) => ipcRenderer.on('mouse-nav', (_e, dir) => cb(dir)),
  onJiraOpenIssue: (cb) => ipcRenderer.on('jira:open-issue', (_e, url, fromId) => cb(url, fromId)),
  onWebviewZoomChanged: (cb) => ipcRenderer.on('webview:zoom-changed', (_e, id, factor) => cb(id, factor)),
  bvt: {
    detectOrca: () => ipcRenderer.invoke('bvt:detect-orca'),
    listScenarios: (orcaPath) => ipcRenderer.invoke('bvt:list-scenarios', orcaPath),
    status: () => ipcRenderer.invoke('bvt:status'),
    start: (opts) => ipcRenderer.invoke('bvt:start', opts),
    stop: () => ipcRenderer.invoke('bvt:stop'),
    sendStdin: (text) => ipcRenderer.invoke('bvt:stdin', text),
    onEvent: (cb) => ipcRenderer.on('bvt:event', (_e, ev) => cb(ev)),
  },
  jira: {
    test: (cfg) => ipcRenderer.invoke('jira:test', cfg),
    components: (cfg, projectKey) => ipcRenderer.invoke('jira:components', cfg, projectKey),
    create: (cfg, payload, attachments) => ipcRenderer.invoke('jira:create', cfg, payload, attachments),
    reopen: (cfg, issueKey, payload, attachments) => ipcRenderer.invoke('jira:reopen', cfg, issueKey, payload, attachments),
    inspect: (cfg, issueKey) => ipcRenderer.invoke('jira:inspect', cfg, issueKey),
    createMeta: (cfg, projectKey, issueType) => ipcRenderer.invoke('jira:createmeta', cfg, projectKey, issueType),
  },
  webview: {
    find: (id, text, opts) => ipcRenderer.invoke('webview:find', id, text, opts),
    stopFind: (id) => ipcRenderer.invoke('webview:find-stop', id),
    onFindOpen: (cb) => ipcRenderer.on('webview:find-open', (_e, id, withReplace) => cb(id, withReplace)),
    onFindClose: (cb) => ipcRenderer.on('webview:find-close', (_e, id) => cb(id)),
    onFindResult: (cb) => ipcRenderer.on('webview:find-result', (_e, payload) => cb(payload)),
    execJs: (id, code) => ipcRenderer.invoke('webview:exec-js', id, code),
  },
  listClaudeSessions: (limit) => ipcRenderer.invoke('claude:list-sessions', limit),
  getDevices: () => ipcRenderer.invoke('adb:get-devices'),
  getWifiIp: (serial) => ipcRenderer.invoke('adb:get-wifi-ip', serial),
  pairDevice: (address, code) => ipcRenderer.invoke('adb:pair', address, code),
  connectWireless: (address) => ipcRenderer.invoke('adb:connect-wireless', address),
  disconnectWireless: (address) => ipcRenderer.invoke('adb:disconnect-wireless', address),
  enableTcpip: (serial, port) => ipcRenderer.invoke('adb:enable-tcpip', serial, port),
  setupFixedPort: (serial) => ipcRenderer.invoke('wireless:setup-fixed-port', serial),
  getDeviceAliases: () => ipcRenderer.invoke('device:get-aliases'),
  setDeviceAlias: (serial, alias) => ipcRenderer.invoke('device:set-alias', serial, alias),
  getRememberedWireless: () => ipcRenderer.invoke('wireless:get-remembered'),
  forgetWireless: (address) => ipcRenderer.invoke('wireless:forget', address),
  reconnectWirelessAll: () => ipcRenderer.invoke('wireless:auto-reconnect'),
  onWirelessAutoReconnect: (cb) => {
    ipcRenderer.on('wireless:auto-reconnect-result', (_, results) => cb(results));
  },
  getDeviceInfo: (serial) => ipcRenderer.invoke('adb:get-device-info', serial),
  getDeviceLocales: (serial) => ipcRenderer.invoke('adb:get-device-locales', serial),
  setDeviceLocale: (serial, locale) => ipcRenderer.invoke('adb:set-device-locale', serial, locale),
  onDevicesChanged: (cb) => {
    ipcRenderer.on('devices-changed', (_, devices) => cb(devices));
  },
  onScrcpyExited: (cb) => {
    ipcRenderer.on('scrcpy-exited', () => cb());
  },

  terminal: {
    listShells: () => ipcRenderer.invoke('terminal:list-shells'),
    getAdbPath: () => ipcRenderer.invoke('terminal:adb-path'),
    openFolder: (p) => ipcRenderer.invoke('terminal:open-folder', p),
    create: (opts) => ipcRenderer.invoke('terminal:create', opts),
    write: (id, data) => ipcRenderer.send('terminal:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('terminal:kill', id),
    onData: (id, cb) => {
      const ch = `terminal:data:${id}`;
      const handler = (_e, data) => cb(data);
      ipcRenderer.on(ch, handler);
      return () => ipcRenderer.removeListener(ch, handler);
    },
    onExit: (id, cb) => {
      const ch = `terminal:exit:${id}`;
      const handler = (_e, info) => cb(info);
      ipcRenderer.on(ch, handler);
      return () => ipcRenderer.removeListener(ch, handler);
    },
  },

  tree: {
    readDir: (p, opts) => ipcRenderer.invoke('tree:read-dir', p, opts || {}),
    listEditors: () => ipcRenderer.invoke('tree:list-editors'),
    openWith: (cmd, p) => ipcRenderer.invoke('tree:open-with', cmd, p),
    showInFolder: (p) => ipcRenderer.invoke('tree:show-in-folder', p),
    pickFolder: () => ipcRenderer.invoke('tree:pick-folder'),
  },

  installApk: (serial) => ipcRenderer.invoke('adb:install-apk', serial),
  installApkPath: (serial, p) => ipcRenderer.invoke('adb:install-apk-path', serial, p),
  cleanInstall: (serial, pkg) => ipcRenderer.invoke('adb:clean-install', serial, pkg),
  listPackages: (serial, filter) => ipcRenderer.invoke('adb:list-packages', serial, filter),
  uninstallPackage: (serial, pkg) => ipcRenderer.invoke('adb:uninstall-package', serial, pkg),
  launchApp: (serial, pkg) => ipcRenderer.invoke('adb:launch-app', serial, pkg),
  forceStop: (serial, pkg) => ipcRenderer.invoke('adb:force-stop', serial, pkg),
  clearData: (serial, pkg) => ipcRenderer.invoke('adb:clear-data', serial, pkg),

  startLogcat: (serial, filters) => ipcRenderer.invoke('adb:start-logcat', serial, filters),
  stopLogcat: () => ipcRenderer.invoke('adb:stop-logcat'),
  clearLogcat: (serial) => ipcRenderer.invoke('adb:clear-logcat', serial),
  onLogcatLine: (cb) => {
    ipcRenderer.on('logcat-line', (_, line) => cb(line));
  },
  onLogcatLines: (cb) => {
    ipcRenderer.on('logcat-lines', (_, lines) => cb(lines));
  },

  startH264Stream: (serial, opts) => ipcRenderer.invoke('adb:start-h264-stream', serial, opts),
  stopH264Stream: () => ipcRenderer.invoke('adb:stop-h264-stream'),
  onH264Chunk: (cb) => ipcRenderer.on('h264-chunk', (_, chunk) => cb(chunk)),
  onH264Meta: (cb) => ipcRenderer.on('h264-meta', (_, meta) => cb(meta)),
  onH264End: (cb) => ipcRenderer.on('h264-end', () => cb()),
  offH264Chunk: () => ipcRenderer.removeAllListeners('h264-chunk'),
  offH264Meta: () => ipcRenderer.removeAllListeners('h264-meta'),
  offH264End: () => ipcRenderer.removeAllListeners('h264-end'),

  listFiles: (serial, p) => ipcRenderer.invoke('adb:list-files', serial, p),
  pullFile: (serial, remotePath) => ipcRenderer.invoke('adb:pull-file', serial, remotePath),
  pushFile: (serial, remotePath) => ipcRenderer.invoke('adb:push-file', serial, remotePath),
  deleteFile: (serial, remotePath) => ipcRenderer.invoke('adb:delete-file', serial, remotePath),

  startScrcpy: (serial, options) => ipcRenderer.invoke('scrcpy:start', serial, options),
  stopScrcpy: () => ipcRenderer.invoke('scrcpy:stop'),
  isScrcpyRunning: () => ipcRenderer.invoke('scrcpy:is-running'),
  startRecording: (serial) => ipcRenderer.invoke('adb:start-record', serial),
  stopRecording: (serial) => ipcRenderer.invoke('adb:stop-record', serial),
  isRecording: () => ipcRenderer.invoke('adb:is-recording'),
  onRecordingFinished: (cb) => {
    ipcRenderer.on('screen-record-finished', () => cb());
  },
  screencap: (serial) => ipcRenderer.invoke('adb:screencap', serial),

  dumpUi: (serial) => ipcRenderer.invoke('adb:dump-ui', serial),
  getForegroundPkg: (serial) => ipcRenderer.invoke('adb:foreground-pkg', serial),
  getRunningAppInfo: (serial, pkg) => ipcRenderer.invoke('adb:running-app-info', serial, pkg),
  inputTap: (serial, x, y) => ipcRenderer.invoke('adb:input-tap', serial, x, y),
  inputSwipe: (serial, x1, y1, x2, y2, dur) => ipcRenderer.invoke('adb:input-swipe', serial, x1, y1, x2, y2, dur),
  inputKey: (serial, keycode) => ipcRenderer.invoke('adb:input-key', serial, keycode),

  saveFileDialog: (name) => ipcRenderer.invoke('dialog:save-file', name),
  writeFile: (p, content) => ipcRenderer.invoke('fs:write-file', p, content),

  pullAllLogs: (serial, remotePaths, opts) => ipcRenderer.invoke('adb:pull-all-logs', serial, remotePaths, opts),
  openFolder: (folderPath) => ipcRenderer.invoke('shell:open-folder', folderPath),
  openLogsTodayFolder: () => ipcRenderer.invoke('logs:open-today-folder'),
  saveScreenshot: (base64Data) => ipcRenderer.invoke('adb:save-screenshot', base64Data),
  openScreenshotFolder: () => ipcRenderer.invoke('shell:open-screenshot-folder'),
  pickAttachmentsFromScreenshots: () => ipcRenderer.invoke('dialog:pick-files-from-screenshots'),

  readLogsDir: (dirPath) => ipcRenderer.invoke('fs:read-logs-dir', dirPath),
  fetchRecentLog: (serial) => ipcRenderer.invoke('adb:fetch-recent-log', serial),

  onCrashDetected: (cb) => ipcRenderer.on('crash-detected', (_, data) => cb(data)),
  crashGetHistory: () => ipcRenderer.invoke('crash:get-history'),
  crashClearHistory: () => ipcRenderer.invoke('crash:clear-history'),
  crashOpenFolder: () => ipcRenderer.invoke('crash:open-folder'),
  crashReadLog: (filePath) => ipcRenderer.invoke('crash:read-log', filePath),
  crashTest: () => ipcRenderer.invoke('crash:test'),
  crashSetWatchedApp: (pkg) => ipcRenderer.invoke('crash:set-watched-app', pkg),
  crashRestartMonitor: (serial) => ipcRenderer.invoke('crash:restart-monitor', serial),
});
