// Webview 내부 Ctrl+F 검색바 + Ctrl+H Replace
// main 프로세스에서 Ctrl+F 감지 → webview:find-open(webContentsId) 수신
// 입력 → window.api.webview.find(id, text)
// 결과 → webview:find-result 로 매치 정보 수신
// Replace: webview.execJs 로 활성 input/textarea/contenteditable 안에서 치환
(function () {
  if (!window.api || !window.api.webview) return;

  let bar, input, info, btnPrev, btnNext, btnClose;
  let replaceRow, replaceInput, btnReplace, btnReplaceAll, btnToggleReplace;
  let activeId = null;
  let replaceVisible = false;

  function build() {
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'webview-find-bar';
    bar.style.cssText = `
      position: fixed; top: 12px; right: 16px; z-index: 10000;
      display: none; flex-direction: column; gap: 4px;
      background: #1e1e2e; color: #cdd6f4;
      border: 1px solid #45475a; border-radius: 6px;
      padding: 6px 8px; box-shadow: 0 6px 18px rgba(0,0,0,0.35);
      font-size: 12px;
    `;
    bar.innerHTML = `
      <div class="wf-row1" style="display:flex;align-items:center;gap:6px">
        <button class="wf-toggle" title="Replace 토글 (Ctrl+H)" style="background:#313244;color:#cdd6f4;border:none;border-radius:4px;padding:4px 6px;cursor:pointer;font-size:11px">⌄</button>
        <input type="text" class="wf-find" placeholder="페이지에서 검색..." style="background:#11111b;color:#cdd6f4;border:1px solid #313244;border-radius:4px;padding:4px 6px;width:200px;outline:none">
        <span class="wf-info" style="color:#7f849c;min-width:50px;text-align:center">0/0</span>
        <button class="wf-prev" title="이전 (Shift+Enter)" style="background:#313244;color:#cdd6f4;border:none;border-radius:4px;padding:4px 8px;cursor:pointer">↑</button>
        <button class="wf-next" title="다음 (Enter)" style="background:#313244;color:#cdd6f4;border:none;border-radius:4px;padding:4px 8px;cursor:pointer">↓</button>
        <button class="wf-close" title="닫기 (Esc)" style="background:transparent;color:#cdd6f4;border:none;font-size:16px;cursor:pointer;padding:0 4px">×</button>
      </div>
      <div class="wf-row2" style="display:none;align-items:center;gap:6px;padding-left:30px">
        <input type="text" class="wf-replace" placeholder="바꿀 텍스트..." style="background:#11111b;color:#cdd6f4;border:1px solid #313244;border-radius:4px;padding:4px 6px;width:200px;outline:none">
        <button class="wf-replace-one" title="현재 항목만 바꾸기" style="background:#313244;color:#cdd6f4;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:11px">바꾸기</button>
        <button class="wf-replace-all" title="활성 입력칸 안에서 전체 바꾸기" style="background:#45475a;color:#cdd6f4;border:none;border-radius:4px;padding:4px 8px;cursor:pointer;font-size:11px">전체 바꾸기</button>
      </div>
    `;
    document.body.appendChild(bar);
    input = bar.querySelector('.wf-find');
    info = bar.querySelector('.wf-info');
    btnPrev = bar.querySelector('.wf-prev');
    btnNext = bar.querySelector('.wf-next');
    btnClose = bar.querySelector('.wf-close');
    btnToggleReplace = bar.querySelector('.wf-toggle');
    replaceRow = bar.querySelector('.wf-row2');
    replaceInput = bar.querySelector('.wf-replace');
    btnReplace = bar.querySelector('.wf-replace-one');
    btnReplaceAll = bar.querySelector('.wf-replace-all');

    let lastText = '';
    const doFind = (forward = true) => {
      const text = input.value;
      if (!text) { info.textContent = '0/0'; window.api.webview.stopFind(activeId); return; }
      const opts = text === lastText ? { findNext: true, forward } : { findNext: false, forward };
      lastText = text;
      window.api.webview.find(activeId, text, opts);
    };

    input.addEventListener('input', () => doFind(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); doFind(!e.shiftKey); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? doReplaceAll() : doReplaceOne(); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    btnPrev.addEventListener('click', () => doFind(false));
    btnNext.addEventListener('click', () => doFind(true));
    btnClose.addEventListener('click', close);
    bar.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    btnToggleReplace.addEventListener('click', () => setReplaceVisible(!replaceVisible));
    btnReplace.addEventListener('click', doReplaceOne);
    btnReplaceAll.addEventListener('click', doReplaceAll);
  }

  function setReplaceVisible(v) {
    replaceVisible = v;
    if (!replaceRow) return;
    replaceRow.style.display = v ? 'flex' : 'none';
    btnToggleReplace.textContent = v ? '⌃' : '⌄';
    if (v) setTimeout(() => replaceInput && replaceInput.focus(), 30);
  }

  // 활성 webview 안에서 포커스된 input/textarea/contenteditable 의 텍스트를 치환.
  // React/Atlassian 에디터를 위해 native setter + InputEvent dispatch.
  async function execReplace(findText, replaceText, all) {
    if (activeId == null || !findText) return { replaced: 0 };
    const code = `
      (function() {
        var find = ${JSON.stringify(findText)};
        var repl = ${JSON.stringify(replaceText || '')};
        var all = ${all ? 'true' : 'false'};
        function escapeRegExp(s) { return s.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&'); }
        var rx = new RegExp(escapeRegExp(find), all ? 'g' : '');

        // 1) ACE editor (window.ace) — JSON Schema 에디터 등에서 사용
        try {
          if (window.ace && typeof window.ace.edit === 'function') {
            var nodes = document.querySelectorAll('.ace_editor');
            for (var i = 0; i < nodes.length; i++) {
              var editor;
              try { editor = window.ace.edit(nodes[i]); } catch (e) { continue; }
              if (!editor || !editor.session) continue;
              if (all) {
                editor.replaceAll(repl, { needle: find, regExp: false, caseSensitive: true, wholeWord: false });
                return { replaced: 'ace-all' };
              } else {
                editor.find(find, { caseSensitive: true, wholeWord: false, regExp: false, wrap: true });
                editor.replace(repl);
                return { replaced: 1, kind: 'ace' };
              }
            }
          }
        } catch (e) { /* fall through */ }

        // 2) Monaco editor (window.monaco)
        try {
          if (window.monaco && window.monaco.editor && typeof window.monaco.editor.getEditors === 'function') {
            var eds = window.monaco.editor.getEditors();
            if (eds && eds.length) {
              var ed = eds.find(function(e){ return e.hasTextFocus && e.hasTextFocus(); }) || eds[0];
              var model = ed.getModel();
              if (model) {
                var ms = model.findMatches(find, true, false, true, null, false);
                if (!ms.length) return { replaced: 0 };
                if (all) {
                  ed.executeEdits('replace-all', ms.map(function(m){ return { range: m.range, text: repl }; }));
                  return { replaced: ms.length, kind: 'monaco' };
                } else {
                  ed.executeEdits('replace', [{ range: ms[0].range, text: repl }]);
                  return { replaced: 1, kind: 'monaco' };
                }
              }
            }
          }
        } catch (e) { /* fall through */ }

        // 3) CodeMirror 5 (.CodeMirror 컨테이너의 .CodeMirror 객체)
        try {
          var cmNodes = document.querySelectorAll('.CodeMirror');
          for (var i = 0; i < cmNodes.length; i++) {
            var cm = cmNodes[i].CodeMirror;
            if (!cm) continue;
            var value = cm.getValue();
            var nv = value.replace(rx, repl);
            if (nv === value) continue;
            cm.setValue(nv);
            return { replaced: 'cm', kind: 'codemirror' };
          }
        } catch (e) { /* fall through */ }

        // 4) 일반 input / textarea / contenteditable
        var el = document.activeElement;
        if (!el || el === document.body) {
          var cands = document.querySelectorAll('textarea, input[type=text], input:not([type]), [contenteditable=""], [contenteditable="true"]');
          el = cands[cands.length - 1] || null;
        }
        if (!el) return { replaced: 0, reason: 'no editable element focused' };
        var tag = (el.tagName || '').toLowerCase();

        if (tag === 'textarea' || tag === 'input') {
          var proto = tag === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
          var oldVal = el.value;
          var newVal = oldVal.replace(rx, repl);
          if (newVal === oldVal) return { replaced: 0 };
          setter.call(el, newVal);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          var matches = oldVal.match(rx);
          return { replaced: matches ? matches.length : (all ? 0 : 1) };
        }

        if (el.isContentEditable) {
          // selection 기반: 첫 매치 1개만 치환
          if (!all) {
            var sel = window.getSelection();
            if (sel && sel.toString() === find) {
              document.execCommand('insertText', false, repl);
              return { replaced: 1 };
            }
            // selection 이 일치하지 않으면 활성 영역에서 첫 매치 찾아 select 후 치환
            var text = el.innerText;
            var idx = text.indexOf(find);
            if (idx < 0) return { replaced: 0 };
            // 텍스트 노드 walker 로 위치 매핑
            var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
            var acc = 0, node, startNode = null, startOff = 0, endNode = null, endOff = 0;
            while ((node = walker.nextNode())) {
              var nl = node.nodeValue.length;
              if (startNode == null && acc + nl > idx) { startNode = node; startOff = idx - acc; }
              if (acc + nl >= idx + find.length) { endNode = node; endOff = (idx + find.length) - acc; break; }
              acc += nl;
            }
            if (!startNode || !endNode) return { replaced: 0 };
            var range = document.createRange();
            range.setStart(startNode, startOff);
            range.setEnd(endNode, endOff);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('insertText', false, repl);
            return { replaced: 1 };
          } else {
            // 전체: 반복적으로 첫 매치 치환 (최대 1000회 안전장치)
            var count = 0;
            for (var i = 0; i < 1000; i++) {
              var t = el.innerText;
              var j = t.indexOf(find);
              if (j < 0) break;
              var w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
              var a = 0, n, sN = null, sO = 0, eN = null, eO = 0;
              while ((n = w.nextNode())) {
                var l = n.nodeValue.length;
                if (sN == null && a + l > j) { sN = n; sO = j - a; }
                if (a + l >= j + find.length) { eN = n; eO = (j + find.length) - a; break; }
                a += l;
              }
              if (!sN || !eN) break;
              var r = document.createRange();
              r.setStart(sN, sO); r.setEnd(eN, eO);
              var s = window.getSelection();
              s.removeAllRanges(); s.addRange(r);
              document.execCommand('insertText', false, repl);
              count++;
            }
            return { replaced: count };
          }
        }
        return { replaced: 0, reason: 'unsupported element: ' + tag };
      })();
    `;
    try {
      const res = await window.api.webview.execJs(activeId, code);
      return (res && res.result) || { replaced: 0 };
    } catch (e) {
      return { replaced: 0, error: e.message };
    }
  }

  async function doReplaceOne() {
    if (!input.value) return;
    const r = await execReplace(input.value, replaceInput.value, false);
    const ok = r && r.replaced && r.replaced !== 0;
    flashInfo(ok ? `1개 바꿈` : `매치 없음`);
    if (ok && !r.kind) setTimeout(() => doFindNext(), 50);
  }
  async function doReplaceAll() {
    if (!input.value) return;
    const r = await execReplace(input.value, replaceInput.value, true);
    const c = typeof r.replaced === 'number' ? r.replaced : (r.replaced ? '전체' : 0);
    flashInfo(`${c}개 바꿈`);
  }
  function doFindNext() {
    const text = input.value;
    if (!text) return;
    window.api.webview.find(activeId, text, { findNext: true, forward: true });
  }
  function flashInfo(msg) {
    if (!info) return;
    const orig = info.textContent;
    info.textContent = msg;
    info.style.color = '#a6e3a1';
    setTimeout(() => { info.style.color = '#7f849c'; info.textContent = orig; }, 1200);
  }

  function open(id, withReplace = false) {
    build();
    activeId = id;
    bar.style.display = 'inline-flex';
    if (withReplace) setReplaceVisible(true);
    input.focus();
    input.select();
  }
  function close() {
    if (!bar) return;
    bar.style.display = 'none';
    if (activeId != null) {
      try { window.api.webview.stopFind(activeId); } catch {}
    }
  }

  window.api.webview.onFindOpen((id, withReplace) => open(id, !!withReplace));
  window.api.webview.onFindClose(() => close());
  window.api.webview.onFindResult(({ result }) => {
    if (!info || !result) return;
    if (result.matches != null) {
      info.textContent = `${result.activeMatchOrdinal || 0}/${result.matches}`;
    }
  });

  // 페이지 자체 Ctrl+F / Ctrl+H 도 잡아서(웹뷰 외부 패널에서도 동일 UI 제공)
  document.addEventListener('keydown', (e) => {
    const isCtrl = e.ctrlKey || e.metaKey;
    if (!isCtrl) return;
    const isF = (e.key === 'f' || e.key === 'F') && !e.shiftKey;
    const isH = (e.key === 'h' || e.key === 'H') && !e.shiftKey;
    if (!isF && !isH) return;
    const activePanel = document.querySelector('.panel.active');
    if (!activePanel) return;
    const wv = activePanel.querySelector('webview');
    if (!wv) return;
    e.preventDefault();
    try { open(wv.getWebContentsId(), isH); } catch {}
  });
})();
