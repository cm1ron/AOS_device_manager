// PTY (pseudo-terminal) 세션 관리
// - 각 세션은 셸 프로세스 1개와 1:1 매핑
// - 렌더러로부터 키 입력 받아 셸로 전달, 셸 출력은 webContents 로 stream
// - 매니저 종료 시 모든 세션 정리

const path = require('path');
const fs = require('fs');
const os = require('os');

let pty;
try {
  pty = require('node-pty');
} catch (e) {
  pty = null;
}

// 시스템에 설치된 셸을 자동 감지 (Windows)
function detectShellsWindows() {
  const out = [];
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || '';
  const systemRoot = process.env.SystemRoot || 'C:\\Windows';

  // Git Bash (개발자 친화: 우선 표시)
  for (const p of [
    path.join(programFiles, 'Git', 'bin', 'bash.exe'),
    path.join(programFilesX86, 'Git', 'bin', 'bash.exe'),
    localAppData ? path.join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe') : '',
  ].filter(Boolean)) if (fs.existsSync(p)) { out.push({ id: 'gitbash', label: 'Git Bash', shell: p, args: ['--login', '-i'] }); break; }

  // PowerShell 7+ (pwsh)
  for (const p of [
    path.join(programFiles, 'PowerShell', '7', 'pwsh.exe'),
    path.join(programFilesX86, 'PowerShell', '7', 'pwsh.exe'),
  ]) if (fs.existsSync(p)) { out.push({ id: 'pwsh', label: 'PowerShell 7', shell: p, args: [] }); break; }

  // Windows PowerShell 5.1
  const wps = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  if (fs.existsSync(wps)) out.push({ id: 'powershell', label: 'Windows PowerShell', shell: wps, args: [] });

  // CMD
  const cmd = path.join(systemRoot, 'System32', 'cmd.exe');
  if (fs.existsSync(cmd)) out.push({ id: 'cmd', label: 'Command Prompt', shell: cmd, args: [] });

  // WSL
  const wsl = path.join(systemRoot, 'System32', 'wsl.exe');
  if (fs.existsSync(wsl)) out.push({ id: 'wsl', label: 'WSL', shell: wsl, args: [] });

  return out;
}

function detectShellsUnix() {
  const out = [];
  const candidates = [
    { id: 'zsh', label: 'zsh', shell: '/bin/zsh' },
    { id: 'bash', label: 'bash', shell: '/bin/bash' },
    { id: 'sh', label: 'sh', shell: '/bin/sh' },
    { id: 'fish', label: 'fish', shell: '/usr/bin/fish' },
    { id: 'fish-local', label: 'fish', shell: '/usr/local/bin/fish' },
  ];
  const seen = new Set();
  for (const c of candidates) {
    if (fs.existsSync(c.shell) && !seen.has(c.id.replace('-local', ''))) {
      seen.add(c.id.replace('-local', ''));
      out.push({ ...c, id: c.id.replace('-local', ''), args: [] });
    }
  }
  return out;
}

function detectShells() {
  const list = process.platform === 'win32' ? detectShellsWindows() : detectShellsUnix();
  if (list.length === 0) {
    list.push(process.platform === 'win32'
      ? { id: 'cmd', label: 'cmd', shell: 'cmd.exe', args: [] }
      : { id: 'sh', label: 'sh', shell: '/bin/sh', args: [] });
  }
  // 첫 항목에 default 표시
  list[0].default = true;
  return list;
}

class PtyManager {
  constructor() {
    this.sessions = new Map(); // id -> { proc, webContents }
    this._nextId = 1;
  }

  isAvailable() {
    return pty !== null;
  }

  listShells() {
    return detectShells();
  }

  /**
   * 새 셸 세션 생성
   * @param {Electron.WebContents} webContents - 출력 보낼 대상
   * @param {object} opts
   * @param {string} [opts.shell] - 사용할 셸 (없으면 OS 기본)
   * @param {string} [opts.cwd]   - 시작 디렉토리
   * @param {number} [opts.cols]  - 초기 컬럼
   * @param {number} [opts.rows]  - 초기 로우
   * @returns {{id: number}|{error: string}}
   */
  create(webContents, opts = {}) {
    if (!pty) {
      return { error: 'node-pty 모듈을 사용할 수 없습니다. 빌드를 확인해주세요.' };
    }

    const isWin = process.platform === 'win32';
    const shell = opts.shell || (isWin ? (process.env.COMSPEC || 'powershell.exe') : (process.env.SHELL || '/bin/bash'));
    const args = Array.isArray(opts.args) ? opts.args : [];
    const cwd = opts.cwd || process.env.HOME || process.env.USERPROFILE || os.homedir();
    const cols = opts.cols || 100;
    const rows = opts.rows || 30;

    let proc;
    try {
      proc = pty.spawn(shell, args, {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: { ...process.env, TERM: 'xterm-256color' },
      });
    } catch (e) {
      return { error: `셸을 시작하지 못했습니다: ${e.message}` };
    }

    const id = this._nextId++;
    const session = { proc, webContents };
    this.sessions.set(id, session);

    proc.onData((data) => {
      if (!webContents.isDestroyed()) {
        webContents.send(`terminal:data:${id}`, data);
      }
    });

    proc.onExit(({ exitCode, signal }) => {
      if (!webContents.isDestroyed()) {
        webContents.send(`terminal:exit:${id}`, { exitCode, signal });
      }
      this.sessions.delete(id);
    });

    // 렌더러가 사라지면 자동 정리
    const cleanup = () => this.kill(id);
    webContents.once('destroyed', cleanup);

    return { id, shell, cwd };
  }

  write(id, data) {
    const s = this.sessions.get(id);
    if (s) s.proc.write(data);
  }

  resize(id, cols, rows) {
    const s = this.sessions.get(id);
    if (s) {
      try { s.proc.resize(cols, rows); } catch { /* ignore */ }
    }
  }

  kill(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    try { s.proc.kill(); } catch { /* ignore */ }
    this.sessions.delete(id);
  }

  killAll() {
    for (const id of [...this.sessions.keys()]) this.kill(id);
  }
}

module.exports = PtyManager;
