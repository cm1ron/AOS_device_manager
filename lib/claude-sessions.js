const fs = require('fs');
const path = require('path');
const os = require('os');

function getProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects');
}

// 디렉토리명은 절대경로를 인코딩한 형태(예: -c-Users-...-android-device-manager)
function decodeProjectDir(name) {
  if (!name) return '';
  // 선행 - 제거 + 나머지 - 를 / 또는 \\ 로 복원 (단순 추정)
  const cleaned = name.replace(/^-/, '');
  // Windows 경로 추정 (드라이브 문자 한 글자 + ':')
  const driveMatch = cleaned.match(/^([A-Za-z])-(.*)$/);
  if (driveMatch) {
    return driveMatch[1].toUpperCase() + ':\\' + driveMatch[2].replace(/-/g, '\\');
  }
  return '/' + cleaned.replace(/-/g, '/');
}

async function readFirstUserMessage(jsonlPath) {
  try {
    const content = fs.readFileSync(jsonlPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        const role = obj.role || (obj.message && obj.message.role);
        if (role === 'user') {
          let text = '';
          if (typeof obj.content === 'string') text = obj.content;
          else if (obj.message && typeof obj.message.content === 'string') text = obj.message.content;
          else if (Array.isArray(obj.content)) {
            const t = obj.content.find((c) => c && c.type === 'text');
            if (t) text = t.text || '';
          } else if (obj.message && Array.isArray(obj.message.content)) {
            const t = obj.message.content.find((c) => c && c.type === 'text');
            if (t) text = t.text || '';
          }
          if (text) return text.replace(/\s+/g, ' ').slice(0, 120);
        }
      } catch {}
    }
  } catch {}
  return '';
}

async function listSessions(limit = 50) {
  const root = getProjectsDir();
  if (!fs.existsSync(root)) return [];
  const projects = fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  const all = [];
  for (const proj of projects) {
    const dir = path.join(root, proj);
    let entries = [];
    try { entries = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch {}
    for (const f of entries) {
      const full = path.join(dir, f);
      try {
        const st = fs.statSync(full);
        all.push({
          id: f.replace(/\.jsonl$/, ''),
          project: proj,
          projectPath: decodeProjectDir(proj),
          mtime: st.mtimeMs,
          size: st.size,
          file: full,
        });
      } catch {}
    }
  }
  all.sort((a, b) => b.mtime - a.mtime);
  const top = all.slice(0, limit);
  for (const s of top) {
    s.preview = await readFirstUserMessage(s.file);
  }
  return top;
}

module.exports = { listSessions, getProjectsDir };
