// 파일 트리 백엔드: 한 단계 lazy 읽기 + 무시 목록 + 에디터 감지
// 매니저 안에서 코드 작업할 때 좌측 트리 패널이 사용한다.

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 기본 무시 목록 (빠르게 폴더 펼치기 위해)
const DEFAULT_IGNORES = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.cache',
  '.vscode',
  '.idea',
  '__pycache__',
  '.pytest_cache',
  '.venv',
  'venv',
  '.DS_Store',
  'Thumbs.db',
]);

// 무거워질 수 있어 펼침 자체를 비활성화할 폴더(개수 너무 많을 때만 표시 후 안 펼침)
const HEAVY_DIRS = new Set(['node_modules', '.git']);

/**
 * 한 디렉토리의 직속 자식만 반환 (lazy)
 * @param {string} dirPath
 * @param {{showHidden?: boolean}} opts
 */
async function readDir(dirPath, opts = {}) {
  const showHidden = !!opts.showHidden;
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (e) {
    return { error: e.code === 'EACCES' ? '권한이 없습니다' : (e.message || '읽을 수 없습니다') };
  }

  const items = [];
  for (const ent of entries) {
    const name = ent.name;
    if (!showHidden && name.startsWith('.')) continue;
    if (DEFAULT_IGNORES.has(name) && !showHidden) continue;

    const full = path.join(dirPath, name);
    let isDir = ent.isDirectory();
    let isSymlink = ent.isSymbolicLink();

    if (isSymlink) {
      try {
        const stat = await fs.stat(full);
        isDir = stat.isDirectory();
      } catch { /* dangling link */ }
    }

    let size = 0;
    let mtime = 0;
    if (!isDir) {
      try {
        const stat = await fs.stat(full);
        size = stat.size;
        mtime = stat.mtimeMs;
      } catch { /* ignore */ }
    }

    items.push({
      name,
      path: full,
      isDir,
      isSymlink,
      size,
      mtime,
      heavy: isDir && HEAVY_DIRS.has(name),
    });
  }

  // 폴더 먼저, 그 다음 파일, 각각 한글/대소문자 무시 정렬
  items.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name, 'ko', { sensitivity: 'base', numeric: true });
  });

  return { items };
}

/**
 * 외부 에디터 자동 감지 (Cursor / VSCode)
 * @returns {Array<{id: string, label: string, command: string}>}
 */
function detectEditors() {
  const out = [];
  const isWin = process.platform === 'win32';

  const tryWhere = (cmd) => {
    try {
      const r = execSync(isWin ? `where ${cmd}` : `which ${cmd}`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2000,
      }).toString().trim().split(/\r?\n/)[0];
      if (r && fsSync.existsSync(r)) return r;
    } catch { /* not found */ }
    return null;
  };

  // Cursor (PATH)
  let cursor = tryWhere('cursor');
  // Cursor (Windows 기본 경로)
  if (!cursor && isWin) {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'resources', 'app', 'bin', 'cursor.cmd'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'cursor', 'Cursor.exe'),
    ];
    for (const c of candidates) if (c && fsSync.existsSync(c)) { cursor = c; break; }
  }
  if (cursor) out.push({ id: 'cursor', label: 'Cursor', command: cursor });

  // VSCode
  let code = tryWhere('code');
  if (!code && isWin) {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Microsoft VS Code', 'bin', 'code.cmd'),
      path.join(process.env.ProgramFiles || '', 'Microsoft VS Code', 'bin', 'code.cmd'),
    ];
    for (const c of candidates) if (c && fsSync.existsSync(c)) { code = c; break; }
  }
  if (code) out.push({ id: 'code', label: 'VS Code', command: code });

  return out;
}

module.exports = { readDir, detectEditors, DEFAULT_IGNORES, HEAVY_DIRS };
