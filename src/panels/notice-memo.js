// 메모 / 회의록 패널 (panel-memo)
// - 좌측 메모 목록 / 우측 contenteditable rich-text 에디터
// - 다중 메모, localStorage 자동 저장 (디바운스 400ms)
// - 볼드/이탤릭/언더라인/취소선/리스트/링크/서식제거 (툴바 + 단축키)
// - 자동 변환: 줄 시작 "1. " → 번호 리스트, "- "/"* " → 불릿 리스트, URL → 링크
// - 다운로드: .html (서식 유지)
(function () {
  const STORE_KEY = 'memo.notes.v1';
  const ACTIVE_KEY = 'memo.activeId.v1';

  const ta = document.getElementById('notice-memo');
  const status = document.getElementById('notice-memo-status');
  const listEl = document.getElementById('notice-memo-list');
  const btnNew = document.getElementById('notice-memo-new');
  const btnRename = document.getElementById('notice-memo-rename');
  const btnDl = document.getElementById('notice-memo-download');
  const btnDel = document.getElementById('notice-memo-delete');
  const btnRec = document.getElementById('notice-memo-record');
  if (!ta || !listEl) return;

  let notes = load();
  let activeId = localStorage.getItem(ACTIVE_KEY) || (notes[0] && notes[0].id) || null;
  if (!notes.length) {
    const n = createNote('회의록');
    notes.push(n);
    activeId = n.id;
    save();
  }
  if (!notes.find((n) => n.id === activeId)) activeId = notes[0].id;

  renderList();
  loadActive();

  function getContent() { return ta.innerHTML; }
  function setContent(html) { ta.innerHTML = html || ''; }

  let timer = null;
  ta.addEventListener('input', () => {
    if (status) status.textContent = '입력 중...';
    clearTimeout(timer);
    timer = setTimeout(() => {
      const note = notes.find((n) => n.id === activeId);
      if (!note) return;
      note.content = getContent();
      note.mtime = Date.now();
      save();
      updateStatus();
    }, 400);
  });

  btnNew?.addEventListener('click', async () => {
    const name = (await askText('새 메모 이름', defaultName()) || '').trim();
    if (!name) return;
    const n = createNote(name);
    notes.unshift(n);
    activeId = n.id;
    save();
    renderList();
    loadActive();
    ta.focus();
  });

  btnRename?.addEventListener('click', async () => {
    const note = notes.find((n) => n.id === activeId);
    if (!note) return;
    const name = (await askText('메모 이름 변경', note.name) || '').trim();
    if (!name) return;
    note.name = name;
    note.mtime = Date.now();
    save();
    renderList();
    updateStatus();
  });

  btnDl?.addEventListener('click', () => {
    const note = notes.find((n) => n.id === activeId);
    if (!note || !(note.content || '').trim()) {
      toast('내용이 비어 있습니다', 'error');
      return;
    }
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const safeName = (note.name || 'memo').replace(/[\\/:*?"<>|]+/g, '_');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(note.name)}</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;max-width:780px;margin:32px auto;padding:0 20px;line-height:1.7;color:#222}h1{font-size:20px;border-bottom:1px solid #ddd;padding-bottom:8px}a{color:#2557d6}code{background:#f3f3f5;padding:1px 5px;border-radius:3px;font-family:Consolas,monospace}</style>
</head><body><h1>${escapeHtml(note.name)}</h1>${note.content}</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}_${stamp}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  btnDel?.addEventListener('click', async () => {
    const note = notes.find((n) => n.id === activeId);
    if (!note) return;
    const ok = await askConfirm('메모 삭제', `'${note.name}' 메모를 삭제합니다. 계속할까요?`, { okLabel: '삭제', danger: true });
    if (!ok) return;
    notes = notes.filter((n) => n.id !== activeId);
    if (!notes.length) {
      const n = createNote('회의록');
      notes.push(n);
      activeId = n.id;
    } else {
      activeId = notes[0].id;
    }
    save();
    renderList();
    loadActive();
  });

  function load() {
    let arr = null;
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (Array.isArray(raw)) arr = raw;
    } catch {}
    if (!arr) {
      // 구버전 단일 메모 키 마이그레이션
      try {
        const old = localStorage.getItem('notice.memo.v1');
        if (old) {
          const n = createNote('회의록');
          n.content = textToHtml(old);
          arr = [n];
        }
      } catch {}
    }
    if (!arr) return [];
    // plain text 였던 메모를 HTML 로 1회 마이그레이션
    const migFlag = 'memo.htmlMigrated.v1';
    if (!localStorage.getItem(migFlag)) {
      for (const n of arr) {
        if (typeof n.content === 'string' && !/<\w+[\s>]/.test(n.content)) {
          n.content = textToHtml(n.content);
        }
      }
      try { localStorage.setItem(migFlag, '1'); } catch {}
    }
    return arr;
  }

  function escapeHtml(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function textToHtml(s) {
    return escapeHtml(s).replace(/\r?\n/g, '<br>');
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(notes));
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    } catch {}
  }

  function createNote(name) {
    return { id: 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, content: '', mtime: Date.now() };
  }

  function defaultName() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 회의록`;
  }

  function loadActive() {
    const note = notes.find((n) => n.id === activeId);
    setContent(note ? (note.content || '') : '');
    updateStatus();
    highlightActive();
  }

  function renderList() {
    listEl.innerHTML = '';
    for (const n of notes) {
      const row = document.createElement('div');
      row.className = 'memo-list-item';
      row.dataset.id = n.id;
      row.style.cssText = 'padding:6px 8px;border-radius:4px;cursor:pointer;font-size:12px;display:flex;flex-direction:column;gap:2px;border:1px solid transparent';
      row.innerHTML = `
        <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></div>
        <div style="font-size:10px;color:var(--text-muted)"></div>
      `;
      row.children[0].textContent = n.name;
      row.children[1].textContent = fmtTime(n.mtime);
      row.addEventListener('mouseenter', () => { if (n.id !== activeId) row.style.background = 'var(--bg-hover)'; });
      row.addEventListener('mouseleave', () => { if (n.id !== activeId) row.style.background = ''; });
      row.addEventListener('click', () => {
        if (activeId === n.id) return;
        activeId = n.id;
        save();
        loadActive();
      });
      listEl.appendChild(row);
    }
    highlightActive();
  }

  function highlightActive() {
    listEl.querySelectorAll('.memo-list-item').forEach((el) => {
      const on = el.dataset.id === activeId;
      el.style.background = on ? 'var(--accent-soft, var(--bg-hover))' : '';
      el.style.borderColor = on ? 'var(--accent, var(--border))' : 'transparent';
    });
  }

  function updateStatus() {
    if (!status) return;
    const note = notes.find((n) => n.id === activeId);
    if (!note) { status.textContent = ''; return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = note.content || '';
    const len = (tmp.textContent || '').length;
    const d = new Date(note.mtime);
    const pad = (n) => String(n).padStart(2, '0');
    status.textContent = `${note.name} · ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} · ${len}자`;
  }

  function fmtTime(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function toast(msg, type) {
    try {
      if (window.App && App.toast) { App.toast(msg, type || 'info'); return; }
    } catch {}
    try { alert(msg); return; } catch {}
    console.log('[memo]', msg);
  }

  // Electron renderer 는 window.prompt 미지원 → 간단 모달
  function buildModal(title, bodyEl, { okLabel = '확인', cancelLabel = '취소', danger = false } = {}) {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.width = '420px';
    const titleEl = document.createElement('div');
    titleEl.style.cssText = 'font-size:14px;font-weight:600;margin-bottom:12px;color:var(--text)';
    titleEl.textContent = title;
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:16px';
    const btnCancel = document.createElement('button');
    btnCancel.className = 'btn btn-sm';
    btnCancel.textContent = cancelLabel;
    const btnOk = document.createElement('button');
    btnOk.className = 'btn btn-sm';
    btnOk.style.cssText = danger
      ? 'background:#e85c5c;color:#fff;border-color:#e85c5c'
      : 'background:var(--accent,#5b8cff);color:#fff;border-color:var(--accent,#5b8cff)';
    btnOk.textContent = okLabel;
    btnRow.appendChild(btnCancel);
    btnRow.appendChild(btnOk);
    box.appendChild(titleEl);
    box.appendChild(bodyEl);
    box.appendChild(btnRow);
    ov.appendChild(box);
    return { ov, box, btnOk, btnCancel };
  }

  function showModal({ ov, btnOk, btnCancel }, onOk) {
    return new Promise((resolve) => {
      let closed = false;
      const close = (val) => {
        if (closed) return; closed = true;
        try { document.body.removeChild(ov); } catch {}
        resolve(val);
      };
      document.body.appendChild(ov);
      setTimeout(() => {
        btnCancel.addEventListener('click', () => close(null));
        btnOk.addEventListener('click', () => close(onOk ? onOk() : true));
        ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(null); });
        document.addEventListener('keydown', function esc(e) {
          if (closed) { document.removeEventListener('keydown', esc); return; }
          if (e.key === 'Escape') { e.preventDefault(); close(null); }
        });
      }, 0);
    });
  }

  function askText(title, defaultValue) {
    const body = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'text';
    input.value = defaultValue || '';
    input.className = 'input';
    input.style.cssText = 'width:100%;padding:8px 10px;font-size:13px;background:var(--bg-input,var(--bg-elevated));color:var(--text);border:1px solid var(--border);border-radius:4px;outline:none;box-sizing:border-box';
    body.appendChild(input);
    const m = buildModal(title, body);
    setTimeout(() => { input.focus(); input.select(); }, 0);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); m.btnOk.click(); }
    });
    return showModal(m, () => input.value);
  }

  function askConfirm(title, message, opts = {}) {
    const body = document.createElement('div');
    body.style.cssText = 'font-size:13px;line-height:1.6;color:var(--text)';
    body.textContent = message;
    const m = buildModal(title, body, opts);
    return showModal(m, () => true);
  }

  // ----- 마이크 녹음 (MediaRecorder) -----
  let mediaRec = null;
  let mediaStream = null;
  let recChunks = [];
  let recStartedAt = 0;
  let recTimer = null;

  const REC_DOT_STYLE = 'display:inline-block;width:9px;height:9px;border-radius:50%;background:#e85c5c;margin-right:6px;vertical-align:middle';
  const REC_DOT_PULSING = REC_DOT_STYLE + ';box-shadow:0 0 0 0 rgba(232,92,92,0.7);animation:recPulse 1.2s infinite';

  // 펄스 keyframes 1회 주입
  if (!document.getElementById('rec-pulse-style')) {
    const st = document.createElement('style');
    st.id = 'rec-pulse-style';
    st.textContent = '@keyframes recPulse{0%{box-shadow:0 0 0 0 rgba(232,92,92,0.7)}70%{box-shadow:0 0 0 8px rgba(232,92,92,0)}100%{box-shadow:0 0 0 0 rgba(232,92,92,0)}}';
    document.head.appendChild(st);
  }

  function setRecBtnIdle() {
    if (!btnRec) return;
    btnRec.innerHTML = `<span style="${REC_DOT_STYLE}"></span>녹음`;
    btnRec.style.background = '';
    btnRec.style.color = '';
    btnRec.style.borderColor = '';
    btnRec.title = '회의 녹음 시작/중지 (마이크)';
  }
  function setRecBtnRecording(elapsedSec) {
    if (!btnRec) return;
    const m = Math.floor(elapsedSec / 60);
    const s = elapsedSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    btnRec.innerHTML = `<span style="${REC_DOT_PULSING.replace('#e85c5c', '#fff')};background:#fff"></span>녹음 중 ${pad(m)}:${pad(s)}`;
    btnRec.style.background = '#e85c5c';
    btnRec.style.color = '#fff';
    btnRec.style.borderColor = '#e85c5c';
    btnRec.title = '클릭하여 녹음 중지';
  }

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('이 환경에서는 녹음이 지원되지 않습니다', 'error');
      return;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const name = (e && e.name) || '';
      let msg;
      if (name === 'NotFoundError' || /not found|requested device/i.test(e.message || '')) {
        msg = '마이크를 찾을 수 없습니다. Windows 설정 → 개인 정보 → 마이크에서 "데스크톱 앱이 마이크에 액세스 허용"을 켜고, 입력 장치가 연결되어 있는지 확인하세요.';
      } else if (name === 'NotAllowedError' || /denied|permission/i.test(e.message || '')) {
        msg = '마이크 권한이 거부되었습니다. 시스템 설정에서 권한을 허용해 주세요.';
      } else {
        msg = '마이크 접근 실패: ' + (e.message || e);
      }
      toast(msg, 'error');
      console.error('[memo] getUserMedia failed', e);
      return;
    }
    let mime = '';
    const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    for (const c of candidates) {
      if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) { mime = c; break; }
    }
    try {
      mediaRec = new MediaRecorder(mediaStream, mime ? { mimeType: mime } : undefined);
    } catch (e) {
      toast('녹음 시작 실패: ' + (e.message || e), 'error');
      stopStream();
      return;
    }
    recChunks = [];
    mediaRec.addEventListener('dataavailable', (ev) => {
      if (ev.data && ev.data.size > 0) recChunks.push(ev.data);
    });
    mediaRec.addEventListener('stop', () => {
      const type = (mediaRec && mediaRec.mimeType) || 'audio/webm';
      const blob = new Blob(recChunks, { type });
      recChunks = [];
      stopStream();
      saveRecording(blob, type);
    });
    mediaRec.start(1000); // 1초마다 청크
    recStartedAt = Date.now();
    setRecBtnRecording(0);
    recTimer = setInterval(() => {
      const sec = Math.floor((Date.now() - recStartedAt) / 1000);
      setRecBtnRecording(sec);
    }, 1000);
  }

  function stopRecording() {
    try { mediaRec && mediaRec.state !== 'inactive' && mediaRec.stop(); } catch {}
    clearInterval(recTimer); recTimer = null;
    setRecBtnIdle();
  }

  function stopStream() {
    try { mediaStream && mediaStream.getTracks().forEach((t) => t.stop()); } catch {}
    mediaStream = null;
    mediaRec = null;
  }

  function saveRecording(blob, type) {
    const ext = type.includes('mp4') ? 'm4a' : (type.includes('ogg') ? 'ogg' : 'webm');
    const note = notes.find((n) => n.id === activeId);
    const baseName = (note && note.name) ? note.name : 'recording';
    const safe = baseName.replace(/[\\/:*?"<>|]+/g, '_');
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}`;
    const filename = `${safe}_${stamp}.${ext}`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);

    const sizeMB = (blob.size / 1024 / 1024).toFixed(2);
    toast(`녹음 저장: ${filename} (${sizeMB} MB)`, 'success');

    if (note) {
      const html = `<div style="background:var(--bg-elevated);padding:6px 10px;border-radius:4px;font-size:12px;margin:6px 0">🎤 [녹음 첨부: <code>${escapeHtml(filename)}</code> · ${sizeMB} MB · ${escapeHtml(now.toLocaleString())}]</div>`;
      ta.innerHTML = (ta.innerHTML || '') + html;
      note.content = getContent();
      note.mtime = Date.now();
      save();
      updateStatus();
    }
  }

  btnRec?.addEventListener('click', () => {
    if (mediaRec && mediaRec.state === 'recording') stopRecording();
    else startRecording();
  });

  setRecBtnIdle();
  window.addEventListener('beforeunload', () => { try { stopRecording(); } catch {} });

  // ----- 리치 에디터: 툴바 / 단축키 / 자동변환 / 링크 -----
  const URL_RX = /(https?:\/\/[^\s<>"]+)/g;

  function exec(cmd, value) {
    ta.focus();
    try { document.execCommand(cmd, false, value); } catch {}
    refreshToolbarState();
    triggerSave();
  }

  function triggerSave() {
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  document.querySelectorAll('#notice-memo-toolbar .memo-tb').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault()); // selection 유지
    btn.addEventListener('click', async () => {
      const cmd = btn.dataset.cmd;
      if (cmd === 'createLink') {
        const sel = window.getSelection();
        const selectedText = sel && sel.toString();
        const url = (await askText('링크 URL', selectedText && /^https?:\/\//.test(selectedText) ? selectedText : 'https://') || '').trim();
        if (!url) return;
        if (!sel || sel.rangeCount === 0 || !selectedText) {
          // 선택 없으면 URL 자체를 링크로 삽입
          exec('insertHTML', `<a href="${escapeAttr(url)}">${escapeHtml(url)}</a>&nbsp;`);
        } else {
          exec('createLink', url);
        }
      } else {
        exec(cmd);
      }
    });
  });

  function escapeAttr(s) { return (s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

  function refreshToolbarState() {
    const map = ['bold', 'italic', 'underline', 'strikeThrough', 'insertUnorderedList', 'insertOrderedList'];
    document.querySelectorAll('#notice-memo-toolbar .memo-tb').forEach((btn) => {
      const cmd = btn.dataset.cmd;
      if (!map.includes(cmd)) return;
      let on = false;
      try { on = document.queryCommandState(cmd); } catch {}
      btn.classList.toggle('active', !!on);
    });
  }
  ta.addEventListener('keyup', refreshToolbarState);
  ta.addEventListener('mouseup', refreshToolbarState);

  // 단축키 (Ctrl/Cmd + B/I/U)
  ta.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === 'b') { e.preventDefault(); exec('bold'); }
    else if (k === 'i') { e.preventDefault(); exec('italic'); }
    else if (k === 'u') { e.preventDefault(); exec('underline'); }
  });

  // Tab / Shift+Tab : 리스트 안이면 들여/내어쓰기, 아니면 일반 들여쓰기
  ta.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    exec(e.shiftKey ? 'outdent' : 'indent');
  });

  // 자동변환: 줄 시작에서 "1. " 또는 "- "/"* " + 스페이스 → 리스트
  ta.addEventListener('keydown', (e) => {
    if (e.key !== ' ') return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return;
    // 현재 캐럿이 속한 텍스트 노드의 시작부터 캐럿까지의 문자열 확인
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent.slice(0, range.startOffset);
    // 현재 라인이 노드 시작부터 시작인지 확인 (단순화: 노드 전체가 라인 시작이라고 가정)
    // 더 안전하게: parentNode 가 LI 면 무시 (이미 리스트)
    const parent = node.parentElement;
    if (parent && (parent.closest('li'))) return;
    let cmd = null;
    if (/^1\.$/.test(text)) cmd = 'insertOrderedList';
    else if (/^[-*]$/.test(text)) cmd = 'insertUnorderedList';
    if (!cmd) return;
    e.preventDefault();
    // 트리거 문자 ("1." 또는 "-"/"*") 제거 후 리스트 적용
    range.setStart(node, 0);
    range.setEnd(node, text.length);
    range.deleteContents();
    exec(cmd);
  });

  // 자동변환: 스페이스/엔터/탭 시 직전 단어가 URL 이면 링크로 변환
  ta.addEventListener('keyup', (e) => {
    if (e.key !== ' ' && e.key !== 'Enter' && e.key !== 'Tab') return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;
    if (node.parentElement && node.parentElement.closest('a')) return;
    const upto = node.textContent.slice(0, range.startOffset);
    const m = upto.match(/(https?:\/\/[^\s<>"]+)[\s\u00A0]?$/);
    if (!m) return;
    const url = m[1];
    const start = upto.length - (m[0].endsWith(' ') || m[0].endsWith('\u00A0') ? m[0].length - 1 : m[0].length);
    const r = document.createRange();
    r.setStart(node, start);
    r.setEnd(node, start + url.length);
    const a = document.createElement('a');
    a.href = url;
    a.textContent = url;
    r.deleteContents();
    r.insertNode(a);
    // 캐럿을 링크 다음으로 이동
    const after = document.createRange();
    after.setStartAfter(a);
    after.collapse(true);
    sel.removeAllRanges();
    sel.addRange(after);
    triggerSave();
  });

  // 붙여넣기: 일반 텍스트면 URL 자동 링크화, 그 외는 plain text 로 (서식 오염 방지)
  ta.addEventListener('paste', (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    const text = cd.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    const trimmed = text.trim();
    if (/^https?:\/\/\S+$/.test(trimmed)) {
      exec('insertHTML', `<a href="${escapeAttr(trimmed)}">${escapeHtml(trimmed)}</a>`);
      return;
    }
    // 멀티라인 텍스트: URL 부분만 링크화, 나머지는 escape, 줄바꿈은 <br>
    const html = escapeHtml(text)
      .replace(/\r?\n/g, '<br>')
      .replace(URL_RX, (u) => `<a href="${escapeAttr(u)}">${u}</a>`);
    exec('insertHTML', html);
  });

  // 링크 클릭: 외부 브라우저로
  ta.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd 누르고 클릭 → 편집 (기본 동작)
      return;
    }
    e.preventDefault();
    try {
      if (window.api && window.api.openExternal) window.api.openExternal(href);
      else window.open(href, '_blank');
    } catch {}
  });
})();
