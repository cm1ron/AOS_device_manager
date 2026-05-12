// Jira 티켓 생성 기능
// - 설정(이메일/token/baseUrl/projectKey) localStorage 저장
// - "🐞 Jira 티켓 생성" 버튼 클릭 → 설정 없으면 설정 모달, 있으면 생성 모달
// - 생성 모달: Summary, Components(다중), Labels(다중), Description 섹션, 옵션 첨부

(function () {
  const CFG_KEY = 'jira.config.v1';
  const FALLBACK_LABELS = ['Studio', 'Avatar', 'QA_잔여이슈', 'Content', 'Social'];
  const DEFAULT_LABELS = ['QA_잔여이슈'];
  const BUG_CATEGORIES = ['App - Android', 'App - iOS', 'Unreal', 'Platform', 'Art', 'UI / UX', 'Design', 'Crash', 'Studio', 'Web'];
  const LINKED_HISTORY_KEY = 'jira.linkedIssues.history.v1';
  const LINKED_HISTORY_MAX = 12;
  const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9_]+-\d+$/;

  function getLinkedHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(LINKED_HISTORY_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((k) => typeof k === 'string' && ISSUE_KEY_PATTERN.test(k)) : [];
    } catch { return []; }
  }
  function saveLinkedHistory(arr) {
    try { localStorage.setItem(LINKED_HISTORY_KEY, JSON.stringify(arr.slice(0, LINKED_HISTORY_MAX))); } catch {}
  }
  function pushLinkedHistory(keys) {
    const cur = getLinkedHistory();
    const next = [...keys.filter((k) => ISSUE_KEY_PATTERN.test(k)), ...cur.filter((k) => !keys.includes(k))];
    saveLinkedHistory(next);
  }
  function removeLinkedHistory(key) {
    saveLinkedHistory(getLinkedHistory().filter((k) => k !== key));
  }

  function getConfig() {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch { return null; }
  }
  function saveConfig(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {}
  }

  function modal(html, opts = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:10000';
    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.cssText = `background:var(--bg-secondary);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:18px;width:${opts.width || 520}px;max-width:92vw;max-height:88vh;overflow-y:auto;box-shadow:0 12px 40px rgba(0,0,0,0.5)`;
    box.innerHTML = html;
    overlay.appendChild(box);
    const dismissOnBackdrop = opts.dismissOnBackdrop !== false; // 기본 true
    const dismissOnEsc = opts.dismissOnEsc !== false; // 기본 true
    const close = () => {
      overlay.remove();
      if (escHandler) document.removeEventListener('keydown', escHandler, true);
    };
    if (dismissOnBackdrop) {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    } else {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) e.stopPropagation(); });
    }
    let escHandler = null;
    if (dismissOnEsc) {
      escHandler = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
      document.addEventListener('keydown', escHandler, true);
    }
    document.body.appendChild(overlay);
    return { overlay, box, close };
  }

  function showSettings(onSave) {
    const cfg = getConfig() || { baseUrl: 'https://overdare.atlassian.net', email: '', token: '', projectKey: 'QA' };
    const { box, close } = modal(`
      <h3 style="margin:0 0 12px 0;font-size:16px">⚙️ Jira 설정</h3>
      <p style="font-size:11px;color:var(--text-muted);margin:0 0 14px 0;line-height:1.5">
        본인 계정으로 티켓이 생성됩니다. 토큰은 이 PC 의 localStorage 에만 저장됩니다.<br>
        토큰 발급: <a href="#" id="open-token-page" style="color:var(--accent)">https://id.atlassian.com/manage-profile/security/api-tokens</a>
      </p>
      <label style="font-size:12px;display:block;margin-bottom:4px">Jira URL</label>
      <input id="jc-base" class="input" type="text" style="width:100%;margin-bottom:10px">
      <label style="font-size:12px;display:block;margin-bottom:4px">Atlassian 이메일</label>
      <input id="jc-email" class="input" type="email" placeholder="you@overdare.com" style="width:100%;margin-bottom:10px">
      <label style="font-size:12px;display:block;margin-bottom:4px">API Token</label>
      <input id="jc-token" class="input" type="password" placeholder="ATATT..." style="width:100%;margin-bottom:10px">
      <label style="font-size:12px;display:block;margin-bottom:4px">Project Key</label>
      <input id="jc-project" class="input" type="text" placeholder="QA" style="width:100%;margin-bottom:14px">
      <div id="jc-status" style="font-size:12px;color:var(--text-muted);margin-bottom:10px;min-height:18px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-sm jc-test">연결 테스트</button>
        <button class="btn btn-sm jc-cancel">취소</button>
        <button class="btn btn-sm btn-primary jc-save">저장</button>
      </div>
    `, { width: 500 });

    const $ = (s) => box.querySelector(s);
    $('#jc-base').value = cfg.baseUrl;
    $('#jc-email').value = cfg.email;
    $('#jc-token').value = cfg.token;
    $('#jc-project').value = cfg.projectKey;
    $('#open-token-page').addEventListener('click', (e) => {
      e.preventDefault();
      window.api.openExternal('https://id.atlassian.com/manage-profile/security/api-tokens');
    });
    const collect = () => ({
      baseUrl: $('#jc-base').value.trim(),
      email: $('#jc-email').value.trim(),
      token: $('#jc-token').value.trim(),
      projectKey: $('#jc-project').value.trim(),
    });
    $('.jc-test').addEventListener('click', async () => {
      const c = collect();
      $('#jc-status').textContent = '연결 확인 중...';
      const r = await window.api.jira.test(c);
      if (r.success) $('#jc-status').innerHTML = `<span style="color:var(--green)">✓ ${r.displayName} (${r.emailAddress})</span>`;
      else $('#jc-status').innerHTML = `<span style="color:var(--red)">✗ ${r.error || '실패'}</span>`;
    });
    $('.jc-cancel').addEventListener('click', close);
    $('.jc-save').addEventListener('click', () => {
      const c = collect();
      if (!c.baseUrl || !c.email || !c.token || !c.projectKey) {
        $('#jc-status').innerHTML = '<span style="color:var(--red)">모든 필드를 입력해주세요</span>';
        return;
      }
      saveConfig(c);
      close();
      if (onSave) onSave(c);
    });
  }

  function chipInput(initial = []) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:6px;background:var(--bg-primary);border:1px solid var(--border);border-radius:4px;min-height:32px;align-items:center;color:var(--text)';
    const items = [...initial];
    const input = document.createElement('input');
    input.type = 'text';
    input.style.cssText = 'flex:1;min-width:80px;background:transparent;color:var(--text);border:none;outline:none;font-size:12px;padding:2px';
    input.placeholder = '입력 후 Enter';

    function render() {
      wrap.querySelectorAll('.cv-chip').forEach((el) => el.remove());
      items.forEach((label, idx) => {
        const chip = document.createElement('span');
        chip.className = 'cv-chip';
        chip.style.cssText = 'background:var(--bg-secondary);color:var(--text);border:1px solid var(--border);font-size:11px;padding:2px 6px;border-radius:3px;display:inline-flex;align-items:center;gap:4px';
        chip.innerHTML = `${label}<button style="background:transparent;color:var(--text-muted);border:none;cursor:pointer;padding:0">×</button>`;
        chip.querySelector('button').addEventListener('click', () => { items.splice(idx, 1); render(); });
        wrap.insertBefore(chip, input);
      });
    }
    function add(v) {
      const t = v.trim();
      if (t && !items.includes(t)) { items.push(t); render(); }
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); add(input.value); input.value = ''; }
      else if (e.key === 'Backspace' && !input.value && items.length) { items.pop(); render(); }
    });
    wrap.appendChild(input);
    render();
    return { el: wrap, get: () => [...items], add, set: (arr) => { items.splice(0, items.length, ...arr); render(); } };
  }

  // 옵션 picker (체크박스 멀티 선택)
  function suggestionRow(suggestions, onPick) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px';
    suggestions.forEach((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = '+ ' + s;
      b.style.cssText = 'background:transparent;color:var(--accent);border:1px dashed var(--border);border-radius:3px;font-size:11px;padding:2px 6px;cursor:pointer';
      b.addEventListener('click', () => onPick(s));
      row.appendChild(b);
    });
    return row;
  }

  function buildDescriptionTemplate(deviceInfo) {
    const lines = [];
    if (deviceInfo) {
      const d = deviceInfo;
      lines.push(`서버환경 : ${d.server || '-'}`);
      lines.push(`언리얼버전 : ${d.unrealVersion || '-'}`);
      lines.push(`앱버전 : ${d.appVersion || '-'}`);
      lines.push(`RN버전 : ${d.rnVersion || '-'}`);
    }
    const devLines = [];
    if (deviceInfo) {
      const d = deviceInfo;
      if (d.model) devLines.push(`기종 : ${d.model}`);
      if (d.osVersion) devLines.push(`OS : Android ${d.osVersion}`);
      if (d.chipset) devLines.push(`칩셋 : ${d.chipset}`);
    }
    return [
      { heading: '🐞 빌드 버전', text: lines.join('\n') },
      { heading: '⚙️ 사전 조건', text: devLines.join('\n') },
      { heading: '🪜 재현 스텝', text: '1.', kind: 'list' },
      { heading: '📸 재현 결과', text: '' },
      { heading: '✅ 기대 결과', text: '' },
    ];
  }

  // 스크린샷 폴더에서 파일 선택 → attList 에 추가
  async function pickFromScreenshotsAndAppend(attList, renderFn) {
    try {
      if (!window.api || !window.api.pickAttachmentsFromScreenshots) return;
      const r = await window.api.pickAttachmentsFromScreenshots();
      if (!r || !r.ok || !Array.isArray(r.files)) return;
      for (const f of r.files) {
        if (f && f.dataBase64) attList.push({ filename: f.filename, dataBase64: f.dataBase64 });
      }
      renderFn();
    } catch (e) {
      console.warn('첨부 추가 실패:', e);
    }
  }

  // deviceInfo: { serial, model, osVersion, appVersion, rnVersion, foregroundPkg }
  // attachments: [{ filename, dataBase64 }] 또는 [{ filename, path }]
  async function showCreateModal({ deviceInfo, attachments } = {}) {
    let cfg = getConfig();
    if (!cfg) {
      showSettings((c) => { cfg = c; showCreateModal({ deviceInfo, attachments }); });
      return;
    }

    const sections = buildDescriptionTemplate(deviceInfo);

    const titleSuffix = '';
    const { box, close } = modal(`
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <h3 style="margin:0;font-size:16px;flex:1">+ Create Jira Bug Ticket</h3>
        <button class="btn btn-sm jct-settings" title="Jira 설정">⚙️</button>
        <button class="btn btn-sm jct-cancel">×</button>
      </div>
      <p style="font-size:11px;color:var(--text-muted);margin:0 0 8px 0">프로젝트 <b>${cfg.projectKey}</b> · Bug</p>
      ${deviceInfo ? `<div style="margin:0 0 12px 0;font-size:11px;color:var(--text-muted);line-height:1.7">
        ${[
          deviceInfo.server && `서버환경 : <span style="color:var(--text)">${deviceInfo.server}</span>`,
          deviceInfo.unrealVersion && `언리얼버전 : <span style="color:var(--text)">${deviceInfo.unrealVersion}</span>`,
          deviceInfo.appVersion && `앱버전 : <span style="color:var(--text)">${deviceInfo.appVersion}</span>`,
          deviceInfo.rnVersion && `RN버전 : <span style="color:var(--text)">${deviceInfo.rnVersion}</span>`,
        ].filter(Boolean).map((t) => `<div>${t}</div>`).join('')}
      </div>` : ''}

      <label style="font-size:12px;display:block;margin-bottom:4px">제목 <span style="color:var(--red)">*</span></label>
      <input id="jct-summary" class="input" type="text" style="width:100%;margin-bottom:10px">

      <label style="font-size:12px;display:block;margin-bottom:4px">Bug Category <span style="color:var(--red)">*</span></label>
      <select id="jct-bugcat" class="input" style="width:100%;margin-bottom:10px">
        <option value="">선택</option>
        ${BUG_CATEGORIES.map((c) => `<option value="${c}"${c === 'App - Android' ? ' selected' : ''}>${c}</option>`).join('')}
      </select>

      <label style="font-size:12px;display:block;margin-bottom:4px">Labels <span style="color:var(--red)">*</span></label>
      <div id="jct-labels"></div>

      <label style="font-size:12px;display:block;margin:10px 0 4px">Linked Item <span style="color:var(--red)">*</span></label>
      <div id="jct-linked"></div>

      <div id="jct-desc" style="display:none"></div>

      <div style="margin:14px 0 6px;font-size:12px">첨부</div>
      <div id="jct-attachments" style="font-size:11px;color:var(--text-muted)"></div>
      <div style="margin:6px 0 0">
        <button type="button" id="jct-att-add" class="btn"
          title="스크린샷 폴더에서 파일 선택"
          style="font-size:10px;padding:1px 6px;height:18px;line-height:1;border-radius:3px">+ 첨부 추가</button>
      </div>

      <div id="jct-status" style="font-size:12px;margin:10px 0;min-height:18px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-sm jct-cancel2">취소</button>
        <button class="btn btn-sm btn-primary jct-create">티켓 생성</button>
      </div>
    `, { width: 600, dismissOnBackdrop: false });

    const $ = (s) => box.querySelector(s);
    box.querySelectorAll('.jct-cancel, .jct-cancel2').forEach((b) => b.addEventListener('click', close));
    $('.jct-settings').addEventListener('click', () => { close(); showSettings(() => showCreateModal({ deviceInfo, attachments })); });

    // Linked Item chip 입력 (대문자 변환 + 형식 강제)
    const linkedInput = chipInput([]);
    const linkedWrap = linkedInput.el;
    const linkedTextInput = linkedWrap.querySelector('input');
    linkedTextInput.placeholder = 'QA-184 (입력 후 Enter)';
    linkedTextInput.style.textTransform = 'uppercase';
    linkedTextInput.addEventListener('input', () => {
      linkedTextInput.value = linkedTextInput.value.toUpperCase();
    });
    $('#jct-linked').appendChild(linkedWrap);

    const linkedHistoryRow = document.createElement('div');
    linkedHistoryRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:4px';
    $('#jct-linked').appendChild(linkedHistoryRow);
    function renderLinkedHistory() {
      linkedHistoryRow.innerHTML = '';
      const hist = getLinkedHistory();
      if (!hist.length) return;
      hist.forEach((key) => {
        const chip = document.createElement('span');
        chip.style.cssText = 'background:transparent;color:var(--accent);border:1px dashed var(--border);border-radius:3px;font-size:11px;padding:2px 6px;display:inline-flex;align-items:center;gap:4px';
        const label = document.createElement('button');
        label.type = 'button';
        label.textContent = '+ ' + key;
        label.style.cssText = 'background:transparent;color:var(--accent);border:none;cursor:pointer;padding:0;font-size:11px';
        label.addEventListener('click', () => linkedInput.add(key));
        const del = document.createElement('button');
        del.type = 'button';
        del.textContent = '×';
        del.title = '히스토리에서 제거';
        del.style.cssText = 'background:transparent;color:var(--text-muted);border:none;cursor:pointer;padding:0 0 0 2px;font-size:13px;line-height:1';
        del.addEventListener('click', (e) => { e.stopPropagation(); removeLinkedHistory(key); renderLinkedHistory(); });
        chip.appendChild(label);
        chip.appendChild(del);
        linkedHistoryRow.appendChild(chip);
      });
    }
    renderLinkedHistory();

    const labelInput = chipInput(DEFAULT_LABELS.slice());
    $('#jct-labels').appendChild(labelInput.el);
    $('#jct-labels').appendChild(suggestionRow(FALLBACK_LABELS, labelInput.add));

    // 섹션별 description
    const sectionInputs = [];
    const descRoot = $('#jct-desc');
    sections.forEach((sec, idx) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-bottom:8px';
      wrap.innerHTML = `
        <div style="font-size:11px;color:var(--text-muted);margin-bottom:2px">${sec.heading}</div>
        <textarea rows="${idx === 2 ? 4 : 2}" class="input" style="width:100%;resize:vertical;font-family:inherit;font-size:12px">${sec.text}</textarea>
      `;
      descRoot.appendChild(wrap);
      sectionInputs.push({ heading: sec.heading, kind: sec.kind, ta: wrap.querySelector('textarea') });
    });

    // 첨부 표시 (각 항목 옆 ✕ 로 제거 가능)
    const attList = (attachments || []).slice();
    const attEl = $('#jct-attachments');
    const renderAttachments = () => {
      attEl.innerHTML = '';
      if (!attList.length) { attEl.textContent = '(첨부 없음)'; return; }
      attList.forEach((a, idx) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 0';
        const name = document.createElement('span');
        name.textContent = '📎 ' + (a.filename || a.path);
        name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = '제외';
        del.style.cssText = 'background:transparent;border:1px solid var(--red);color:var(--red);width:18px;height:18px;line-height:1;border-radius:4px;cursor:pointer;font-size:10px;padding:0;flex-shrink:0';
        del.addEventListener('mouseenter', () => { del.style.background = 'var(--red)'; del.style.color = '#fff'; });
        del.addEventListener('mouseleave', () => { del.style.background = 'transparent'; del.style.color = 'var(--red)'; });
        del.addEventListener('click', () => { attList.splice(idx, 1); renderAttachments(); });
        row.appendChild(name);
        row.appendChild(del);
        attEl.appendChild(row);
      });
    };
    renderAttachments();

    $('#jct-att-add').addEventListener('click', () => pickFromScreenshotsAndAppend(attList, renderAttachments));

    $('.jct-create').addEventListener('click', async () => {
      const summary = $('#jct-summary').value.trim() + titleSuffix;
      const labels = labelInput.get();
      const linkedRaw = linkedInput.get().map((k) => String(k).toUpperCase().trim());
      const bugCategory = $('#jct-bugcat').value;
      if (!summary) { $('#jct-status').innerHTML = '<span style="color:var(--red)">제목을 입력해주세요</span>'; return; }
      if (!bugCategory) { $('#jct-status').innerHTML = '<span style="color:var(--red)">Bug Category 를 선택해주세요</span>'; return; }
      if (!linkedRaw.length) { $('#jct-status').innerHTML = '<span style="color:var(--red)">Linked Item 1개 이상 입력 (예: QA-184)</span>'; return; }
      const invalid = linkedRaw.filter((k) => !ISSUE_KEY_PATTERN.test(k));
      if (invalid.length) { $('#jct-status').innerHTML = `<span style="color:var(--red)">잘못된 이슈 키 형식: ${invalid.join(', ')}</span>`; return; }
      if (!labels.length) { $('#jct-status').innerHTML = '<span style="color:var(--red)">Labels 1개 이상 선택</span>'; return; }

      const descSections = sectionInputs.map((s) => ({ heading: s.heading, kind: s.kind, text: s.ta.value }));
      $('#jct-status').innerHTML = '<span style="color:var(--text-muted)">티켓 생성 중...</span>';
      $('.jct-create').disabled = true;
      const r = await window.api.jira.create(cfg, {
        projectKey: cfg.projectKey,
        issueType: 'Bug',
        summary,
        labels,
        bugCategory,
        linkedIssues: linkedRaw,
        linkType: 'Blocks',
        descriptionSections: descSections,
      }, attList);
      $('.jct-create').disabled = false;
      if (r.success) {
        pushLinkedHistory(linkedRaw);
        const linkFails = (r.links || []).filter((l) => l && !l.ok);
        const linkNote = linkFails.length ? ` <span style="color:var(--red)">(링크 실패: ${linkFails.map((l) => l.key).join(', ')})</span>` : '';
        $('#jct-status').innerHTML = `<span style="color:var(--green)">✓ ${r.key} 생성 완료</span>${linkNote} &nbsp; <a href="#" id="jct-open" style="color:var(--accent)">[Jira 에서 열기]</a> &nbsp; <a href="#" id="jct-close-now" style="color:var(--text-muted)">[닫기]</a>`;
        $('#jct-open').addEventListener('click', (e) => {
          e.preventDefault();
          const url = r.url;
          close();
          try {
            if (typeof App !== 'undefined' && App.switchPanel) {
              App.switchPanel('jira');
            } else {
              throw new Error('App not available');
            }
          } catch {
            document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
            const pj = document.getElementById('panel-jira');
            if (pj) pj.classList.add('active');
            document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
            const fb = document.querySelector('.nav-folder[data-folder="issue"]');
            if (fb) fb.classList.add('active');
          }
          const wv = document.getElementById('jira-webview');
          if (!wv) { window.api.openExternal(url); return; }
          try {
            const p = wv.loadURL(url);
            if (p && typeof p.catch === 'function') p.catch(() => {});
          } catch {
            try { wv.setAttribute('src', url); } catch {}
          }
        });
        $('#jct-close-now').addEventListener('click', (e) => { e.preventDefault(); close(); });
        $('.jct-create').textContent = '닫기';
        const newBtn = $('.jct-create').cloneNode(true);
        $('.jct-create').parentNode.replaceChild(newBtn, $('.jct-create'));
        newBtn.addEventListener('click', close);
        if (window.App && window.App.toast) window.App.toast(`✓ ${r.key} 생성 완료`, 'success');
      } else {
        $('#jct-status').innerHTML = `<span style="color:var(--red)">✗ ${r.error || '실패'}</span>`;
      }
    });
  }

  // ===== Reopen 모달 =====
  const REOPEN_DEFAULT_COMMENT = '해당 빌드에서 이슈 재현되어 리오픈 전달드립니다. 확인 부탁드립니다.';
  const REOPEN_LAST_KEY = 'jira.reopen.lastIssueKey';

  function buildAppInfoText(d) {
    if (!d) return '';
    const lines = [];
    if (d.server) lines.push(`서버환경 : ${d.server}`);
    if (d.unrealVersion) lines.push(`언리얼버전 : ${d.unrealVersion}`);
    if (d.appVersion) lines.push(`앱버전 : ${d.appVersion}`);
    if (d.rnVersion) lines.push(`RN버전 : ${d.rnVersion}`);
    if (d.model || d.osVersion) {
      const name = d.model || '디바이스';
      const os = d.osVersion ? `Android ${d.osVersion}` : '';
      lines.push(`디바이스 정보 : ${name}${os ? `(${os})` : ''}`);
    }
    return lines.join('\n');
  }

  async function showReopenModal({ deviceInfo, attachments } = {}) {
    let cfg = getConfig();
    if (!cfg || !cfg.email || !cfg.token) {
      showSettings((c) => { cfg = c; showReopenModal({ deviceInfo, attachments }); });
      return;
    }
    const appInfoText = buildAppInfoText(deviceInfo);
    const initialComment = (appInfoText ? appInfoText + '\n\n' : '') + REOPEN_DEFAULT_COMMENT;

    const { box, close } = modal(`
      <div style="display:flex;align-items:center;margin-bottom:12px">
        <h3 style="margin:0;font-size:16px;flex:1">🔁 Reopen Jira Ticket</h3>
        <button class="btn btn-sm jrm-cancel">✕</button>
      </div>

      <label style="font-size:12px;display:block;margin-bottom:4px">Issue Key <span style="color:var(--red)">*</span></label>
      <input id="jrm-key" class="input" type="text" placeholder="리오픈 티켓을 입력하세요. (예: QA-9162)" style="width:100%;margin-bottom:10px;text-transform:uppercase">

      <label style="font-size:12px;display:block;margin-bottom:4px">댓글 본문</label>
      <textarea id="jrm-comment" class="input" rows="8" style="width:100%;margin-bottom:10px;resize:vertical;font-family:inherit"></textarea>
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:12px">앱 정보가 자동으로 포함되어 있습니다. 자유롭게 수정하세요.</div>

      <div style="margin:14px 0 6px;font-size:12px">첨부</div>
      <div id="jrm-attachments" style="font-size:11px;color:var(--text-muted)"></div>
      <div style="margin:6px 0 12px">
        <button type="button" id="jrm-att-add" class="btn"
          title="스크린샷 폴더에서 파일 선택"
          style="font-size:10px;padding:1px 6px;height:18px;line-height:1;border-radius:3px">+ 첨부 추가</button>
      </div>

      <div id="jrm-status" style="font-size:12px;margin:10px 0;min-height:18px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn btn-sm jrm-cancel2">취소</button>
        <button class="btn btn-sm jrm-submit" style="background:#c0392b;border:1px solid #a33224;color:#fff">Reopen</button>
      </div>
    `, { width: 580, dismissOnBackdrop: false });

    const $ = (s) => box.querySelector(s);
    box.querySelectorAll('.jrm-cancel, .jrm-cancel2').forEach((b) => b.addEventListener('click', close));

    $('#jrm-comment').value = initialComment;

    // 첨부 표시 (각 항목 옆 ✕ 로 제거 가능)
    const attList = (attachments || []).slice();
    const attEl = $('#jrm-attachments');
    const renderAttachments = () => {
      attEl.innerHTML = '';
      if (!attList.length) { attEl.textContent = '(첨부 없음)'; return; }
      attList.forEach((a, idx) => {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:2px 0';
        const name = document.createElement('span');
        name.textContent = '📎 ' + (a.filename || a.path);
        name.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        const del = document.createElement('button');
        del.textContent = '✕';
        del.title = '제외';
        del.style.cssText = 'background:transparent;border:1px solid var(--red);color:var(--red);width:18px;height:18px;line-height:1;border-radius:4px;cursor:pointer;font-size:10px;padding:0;flex-shrink:0';
        del.addEventListener('mouseenter', () => { del.style.background = 'var(--red)'; del.style.color = '#fff'; });
        del.addEventListener('mouseleave', () => { del.style.background = 'transparent'; del.style.color = 'var(--red)'; });
        del.addEventListener('click', () => { attList.splice(idx, 1); renderAttachments(); });
        row.appendChild(name);
        row.appendChild(del);
        attEl.appendChild(row);
      });
    };
    renderAttachments();

    $('#jrm-att-add').addEventListener('click', () => pickFromScreenshotsAndAppend(attList, renderAttachments));

    $('.jrm-submit').addEventListener('click', async () => {
      const key = ($('#jrm-key').value || '').trim().toUpperCase();
      const commentText = $('#jrm-comment').value || '';
      if (!key) { $('#jrm-status').innerHTML = '<span style="color:var(--red)">Issue Key 를 입력하세요</span>'; return; }
      if (!/^[A-Z][A-Z0-9_]+-\d+$/.test(key)) { $('#jrm-status').innerHTML = '<span style="color:var(--red)">형식이 올바르지 않습니다 (예: QA-9162)</span>'; return; }
      $('.jrm-submit').disabled = true;
      $('#jrm-status').innerHTML = '<i>업로드 / 댓글 / 트랜지션 처리 중...</i>';

      // 이미지 첨부는 서버 업로드 후 인라인 표시
      const attsForApi = attList.map((a) => ({
        ...a,
        inlineImage: /\.(png|jpg|jpeg|gif|webp)$/i.test(a.filename || ''),
      }));
      const r = await window.api.jira.reopen(cfg, key, { commentText }, attsForApi);
      $('.jrm-submit').disabled = false;

      if (r && r.success) {
        localStorage.setItem(REOPEN_LAST_KEY, key);
        $('#jrm-status').innerHTML = `<span style="color:var(--green)">✓ ${r.key} Reopen 완료 (${r.transition || 'Reopened'})</span> &nbsp; <a href="#" id="jrm-open" style="color:var(--accent)">[Jira 에서 열기]</a> &nbsp; <a href="#" id="jrm-close-now" style="color:var(--text-muted)">[닫기]</a>`;
        $('#jrm-open').addEventListener('click', (e) => {
          e.preventDefault();
          const url = r.url;
          close();
          try {
            if (typeof App !== 'undefined' && App.switchPanel) {
              App.switchPanel('jira');
            } else {
              throw new Error('App not available');
            }
          } catch {
            document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
            const pj = document.getElementById('panel-jira');
            if (pj) pj.classList.add('active');
            document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
            const fb = document.querySelector('.nav-folder[data-folder="issue"]');
            if (fb) fb.classList.add('active');
          }
          const wv = document.getElementById('jira-webview');
          if (!wv) { window.api.openExternal(url); return; }
          try {
            const p = wv.loadURL(url);
            if (p && typeof p.catch === 'function') p.catch(() => {});
          } catch {
            try { wv.setAttribute('src', url); } catch {}
          }
        });
        $('#jrm-close-now').addEventListener('click', (e) => { e.preventDefault(); close(); });
        if (window.App && window.App.toast) window.App.toast(`✓ ${r.key} Reopen 완료`, 'success');
        $('.jrm-submit').textContent = '닫기';
        const newBtn = $('.jrm-submit').cloneNode(true);
        $('.jrm-submit').parentNode.replaceChild(newBtn, $('.jrm-submit'));
        newBtn.addEventListener('click', close);
      } else {
        $('#jrm-status').innerHTML = `<span style="color:var(--red)">✗ ${(r && r.error) || '실패'}</span>`;
      }
    });
  }

  // 외부 노출
  window.JiraTicket = {
    showSettings,
    showCreateModal,
    showReopenModal,
    getConfig,
  };
})();
