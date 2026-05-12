// 이미지 주석(Annotation) 에디터 (자체 구현, 외부 라이브러리 없음)
// 사용법:
//   App.ImageAnnotator.open({
//     dataURL: 'data:image/png;base64,...',
//     filename: 'screenshot.png',
//     onSave: (newDataURL, filename) => { ... }
//   })
(function () {
  const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#000000', '#ffffff'];
  const WIDTHS = [2, 4, 6];
  // 흑백 SVG 아이콘 (currentColor 사용 → 테마 자동 대응)
  const ICONS = {
    pen: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
    rect: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="1"/></svg>',
    ellipse: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="12" rx="9" ry="7"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="20" x2="19" y2="5"/><polyline points="10,5 19,5 19,14"/></svg>',
    line: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="20" x2="20" y2="4"/></svg>',
    text: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4,7 4,4 20,4 20,7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg>',
    highlight: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l-4 4v4h4l4-4"/><path d="M15 5l4 4-7 7-4-4z"/><line x1="14" y1="6" x2="18" y2="10"/></svg>',
    pin: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><text x="12" y="16" text-anchor="middle" font-size="11" font-weight="bold" fill="currentColor" stroke="none">1</text></svg>',
    undo: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9,14 4,9 9,4"/><path d="M4 9h11a5 5 0 010 10h-3"/></svg>',
    redo: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15,14 20,9 15,4"/><path d="M20 9H9a5 5 0 000 10h3"/></svg>',
    trash: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
    save: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>',
    close: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',
    reset: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1,4 1,10 7,10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>',
  };
  const TOOLS = [
    { id: 'pen', title: '펜 (자유선)' },
    { id: 'rect', title: '빈 사각형' },
    { id: 'ellipse', title: '빈 원/타원' },
    { id: 'arrow', title: '화살표' },
    { id: 'line', title: '직선' },
    { id: 'text', title: '텍스트' },
    { id: 'highlight', title: '반투명 하이라이트 박스' },
    { id: 'pin', title: '번호 핀 (자동 증가)' },
  ];

  let state = null;

  function open({ dataURL, imageUrl, filename, onSave }) {
    if (state) close();
    const overlay = document.createElement('div');
    overlay.className = 'img-anno-overlay';
    overlay.innerHTML = `
      <div class="img-anno-modal">
        <div class="img-anno-head">
          <span class="img-anno-title">이미지 편집</span>
          <span class="img-anno-fname" id="ia-fn"></span>
          <span style="flex:1"></span>
          <button class="img-anno-hbtn" id="ia-undo" title="실행 취소 (Ctrl+Z)">${ICONS.undo}</button>
          <button class="img-anno-hbtn" id="ia-redo" title="재실행 (Ctrl+Y)">${ICONS.redo}</button>
          <button class="img-anno-hbtn" id="ia-clear" title="모두 지우기">${ICONS.trash}</button>
          <span class="img-anno-vsep"></span>
          <button class="img-anno-hbtn" id="ia-cancel" title="취소 (Esc)">${ICONS.close}</button>
          <button class="img-anno-hbtn img-anno-primary" id="ia-save" title="저장 (Ctrl+S)">${ICONS.save}<span>저장</span></button>
        </div>
        <div class="img-anno-toolbar">
          <div class="img-anno-group" id="ia-tools"></div>
          <div class="img-anno-sep"></div>
          <div class="img-anno-group" id="ia-colors"></div>
          <div class="img-anno-sep"></div>
          <div class="img-anno-group" id="ia-widths"></div>
          <div class="img-anno-sep"></div>
          <span class="img-anno-pin">
            <span class="img-anno-pin-label">핀</span>
            <span class="img-anno-pin-num" id="ia-pin-num">1</span>
            <button type="button" class="img-anno-hbtn img-anno-hbtn-xs" id="ia-pin-reset" title="번호 핀 카운터 리셋">${ICONS.reset}</button>
          </span>
          <span style="flex:1"></span>
          <span class="img-anno-hint">드래그로 그리기 · 텍스트 도구에서 글자 드래그로 이동 · Esc 취소</span>
        </div>
        <div class="img-anno-canvas-wrap">
          <canvas id="ia-canvas"></canvas>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    state = {
      overlay, filename, onSave,
      tool: 'pen',
      color: COLORS[0],
      width: WIDTHS[1],
      pinCounter: 1,
      shapes: [],
      redoStack: [],
      drawing: null,
      img: null,
      canvas: null,
      ctx: null,
      scale: 1,
    };

    overlay.querySelector('#ia-fn').textContent = filename || 'image.png';
    renderTools();
    renderColors();
    renderWidths();

    bindGlobalEvents();
    loadImage(dataURL || imageUrl);
  }

  function close() {
    if (!state) return;
    state.overlay.remove();
    document.removeEventListener('keydown', onKeydown, true);
    state = null;
  }

  function bindGlobalEvents() {
    // capture 단계로 등록 + ESC 는 부모 모달까지 전파되지 않도록 차단
    document.addEventListener('keydown', onKeydown, true);
    state.overlay.querySelector('#ia-cancel').addEventListener('click', close);
    state.overlay.querySelector('#ia-save').addEventListener('click', save);
    state.overlay.querySelector('#ia-undo').addEventListener('click', undo);
    state.overlay.querySelector('#ia-redo').addEventListener('click', redo);
    state.overlay.querySelector('#ia-clear').addEventListener('click', () => {
      if (!state.shapes.length) return;
      if (confirm('모든 마킹을 지울까요?')) {
        state.shapes = []; state.redoStack = []; redraw();
      }
    });
    state.overlay.querySelector('#ia-pin-reset').addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      state.pinCounter = 1;
      const el = state.overlay.querySelector('#ia-pin-num');
      if (el) el.textContent = '1';
    });
  }

  function onKeydown(e) {
    if (!state) return;
    if (e.key === 'Escape') {
      // 부모 모달(Jira 생성/리오픈) 닫힘 방지
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      e.preventDefault();
      if (state.drawing) { state.drawing = null; redraw(); }
      else if (state.dragging) { state.dragging = null; redraw(); }
      else close();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault(); redo();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault(); save();
    }
  }

  function renderTools() {
    const wrap = state.overlay.querySelector('#ia-tools');
    wrap.innerHTML = TOOLS.map((t) => `
      <button class="img-anno-tool ${t.id === state.tool ? 'on' : ''}" data-tool="${t.id}" title="${t.title}">${ICONS[t.id]}</button>
    `).join('');
    wrap.querySelectorAll('.img-anno-tool').forEach((b) => {
      b.addEventListener('click', () => {
        state.tool = b.getAttribute('data-tool');
        wrap.querySelectorAll('.img-anno-tool').forEach((x) => x.classList.toggle('on', x === b));
      });
    });
  }
  function renderColors() {
    const wrap = state.overlay.querySelector('#ia-colors');
    wrap.innerHTML = COLORS.map((c) => `
      <button class="img-anno-color ${c === state.color ? 'on' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>
    `).join('');
    wrap.querySelectorAll('.img-anno-color').forEach((b) => {
      b.addEventListener('click', () => {
        state.color = b.getAttribute('data-color');
        wrap.querySelectorAll('.img-anno-color').forEach((x) => x.classList.toggle('on', x === b));
      });
    });
  }
  function renderWidths() {
    const wrap = state.overlay.querySelector('#ia-widths');
    wrap.innerHTML = WIDTHS.map((w) => `
      <button class="img-anno-width ${w === state.width ? 'on' : ''}" data-width="${w}" title="${w}px">
        <span style="display:inline-block;width:18px;height:${w}px;background:currentColor;vertical-align:middle"></span>
      </button>
    `).join('');
    wrap.querySelectorAll('.img-anno-width').forEach((b) => {
      b.addEventListener('click', () => {
        state.width = parseInt(b.getAttribute('data-width'), 10);
        wrap.querySelectorAll('.img-anno-width').forEach((x) => x.classList.toggle('on', x === b));
      });
    });
  }

  function loadImage(src) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      state.img = img;
      const canvas = state.overlay.querySelector('#ia-canvas');
      const wrap = state.overlay.querySelector('.img-anno-canvas-wrap');
      const maxW = wrap.clientWidth - 20;
      const maxH = wrap.clientHeight - 20;
      const scale = Math.min(1, maxW / img.naturalWidth, maxH / img.naturalHeight);
      state.scale = scale;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.style.width = (img.naturalWidth * scale) + 'px';
      canvas.style.height = (img.naturalHeight * scale) + 'px';
      state.canvas = canvas;
      state.ctx = canvas.getContext('2d');
      bindCanvasEvents();
      redraw();
    };
    img.onerror = () => {
      alert('이미지를 불러올 수 없습니다.');
      close();
    };
    img.src = src;
  }

  function bindCanvasEvents() {
    const c = state.canvas;
    const toLocal = (e) => {
      const rect = c.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (c.width / rect.width);
      const y = (e.clientY - rect.top) * (c.height / rect.height);
      return { x, y };
    };

    const hitTextAt = (x, y) => {
      // 위에 있는(나중에 그려진) 것부터 hit
      for (let i = state.shapes.length - 1; i >= 0; i--) {
        const s = state.shapes[i];
        if (s.type !== 'text') continue;
        const w = s._w || 0, h = s._h || (s.fontSize || 18) * 1.25;
        if (x >= s.x && x <= s.x + w && y >= s.y && y <= s.y + h) return s;
      }
      return null;
    };

    c.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      const { x, y } = toLocal(e);
      if (state.tool === 'pin') {
        const pinShape = { type: 'pin', x, y, num: state.pinCounter, color: state.color };
        state.shapes.push(pinShape);
        state.pinCounter++;
        state.redoStack = [];
        state.overlay.querySelector('#ia-pin-num').textContent = String(state.pinCounter);
        redraw();
        return;
      }
      if (state.tool === 'text') {
        // 기존 텍스트 위면 드래그 이동, 빈 곳이면 새 입력
        const hit = hitTextAt(x, y);
        if (hit) {
          state.dragging = { shape: hit, dx: x - hit.x, dy: y - hit.y };
          c.style.cursor = 'move';
          return;
        }
        openTextInput(e.clientX, e.clientY, x, y);
        return;
      }
      state.drawing = {
        type: state.tool,
        x1: x, y1: y, x2: x, y2: y,
        color: state.color,
        width: state.width,
        points: state.tool === 'pen' ? [{ x, y }] : null,
      };
    });
    c.addEventListener('mousemove', (e) => {
      const { x, y } = toLocal(e);
      if (state.dragging) {
        state.dragging.shape.x = x - state.dragging.dx;
        state.dragging.shape.y = y - state.dragging.dy;
        redraw();
        return;
      }
      if (state.tool === 'text' && !state.drawing) {
        c.style.cursor = hitTextAt(x, y) ? 'move' : 'text';
      }
      if (!state.drawing) return;
      state.drawing.x2 = x; state.drawing.y2 = y;
      if (state.drawing.type === 'pen') state.drawing.points.push({ x, y });
      redraw();
    });
    const endDraw = () => {
      if (state.dragging) {
        state.dragging = null;
        c.style.cursor = state.tool === 'text' ? 'text' : 'crosshair';
        return;
      }
      if (!state.drawing) return;
      const d = state.drawing;
      if (d.type !== 'pen' && Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 3) {
        state.drawing = null; redraw(); return;
      }
      state.shapes.push(d);
      state.redoStack = [];
      state.drawing = null;
      redraw();
    };
    c.addEventListener('mouseup', endDraw);
    c.addEventListener('mouseleave', endDraw);
  }

  function openTextInput(clientX, clientY, canvasX, canvasY) {
    const prev = state.overlay.querySelector('.img-anno-text-input');
    if (prev) prev.remove();
    const fontSize = Math.max(14, state.width * 6);
    const displaySize = fontSize * state.scale;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'img-anno-text-input';
    input.placeholder = '텍스트 입력 (Enter 확정, Esc 취소)';
    input.style.cssText = `
      position:fixed;
      left:${clientX}px;
      top:${clientY}px;
      min-width:140px;
      padding:2px 6px;
      font-size:${Math.max(12, displaySize)}px;
      font-weight:bold;
      color:${state.color};
      background:rgba(255,255,255,0.95);
      border:2px solid ${state.color};
      border-radius:4px;
      outline:none;
      box-shadow:0 2px 8px rgba(0,0,0,0.25);
      z-index:11100;
    `;
    document.body.appendChild(input);
    setTimeout(() => input.focus(), 0);

    const commit = () => {
      const txt = input.value.trim();
      input.remove();
      if (!txt) { redraw(); return; }
      state.shapes.push({ type: 'text', x: canvasX, y: canvasY, text: txt, color: state.color, fontSize });
      state.redoStack = [];
      redraw();
    };
    const cancel = () => { input.remove(); redraw(); };

    input.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
    });
    input.addEventListener('blur', () => { commit(); });
  }

  function redraw() {
    const { ctx, canvas, img } = state;
    if (!ctx || !img) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    for (const s of state.shapes) drawShape(ctx, s);
    if (state.drawing) drawShape(ctx, state.drawing);
  }

  function drawShape(ctx, s) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.width || 3;
    if (s.type === 'pen') {
      ctx.beginPath();
      const pts = s.points || [];
      if (pts.length) {
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.stroke();
      }
    } else if (s.type === 'rect') {
      ctx.strokeRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
    } else if (s.type === 'ellipse') {
      const cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
      const rx = Math.abs(s.x2 - s.x1) / 2, ry = Math.abs(s.y2 - s.y1) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.type === 'line') {
      ctx.beginPath();
      ctx.moveTo(s.x1, s.y1);
      ctx.lineTo(s.x2, s.y2);
      ctx.stroke();
    } else if (s.type === 'arrow') {
      drawArrow(ctx, s.x1, s.y1, s.x2, s.y2, s.width || 3);
    } else if (s.type === 'highlight') {
      ctx.globalAlpha = 0.3;
      ctx.fillRect(Math.min(s.x1, s.x2), Math.min(s.y1, s.y2), Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1));
    } else if (s.type === 'text') {
      const fs = s.fontSize || 18;
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.lineWidth = Math.max(2, fs / 8);
      ctx.strokeStyle = (s.color === '#ffffff' || s.color === '#f59e0b') ? '#000' : '#fff';
      ctx.strokeText(s.text, s.x, s.y);
      ctx.fillStyle = s.color;
      ctx.fillText(s.text, s.x, s.y);
      // hit-test 용 bbox 캐시
      try { s._w = ctx.measureText(s.text).width; s._h = fs * 1.25; } catch {}
    } else if (s.type === 'pin') {
      const r = 22;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${r * 1.1}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(s.num), s.x, s.y + 1);
    }
    ctx.restore();
  }

  function drawArrow(ctx, x1, y1, x2, y2, width) {
    const headLen = Math.max(12, width * 4);
    const ang = Math.atan2(y2 - y1, x2 - x1);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(ang - Math.PI / 7), y2 - headLen * Math.sin(ang - Math.PI / 7));
    ctx.lineTo(x2 - headLen * Math.cos(ang + Math.PI / 7), y2 - headLen * Math.sin(ang + Math.PI / 7));
    ctx.closePath();
    ctx.fill();
  }

  function undo() {
    if (!state.shapes.length) return;
    state.redoStack.push(state.shapes.pop());
    redraw();
  }
  function redo() {
    if (!state.redoStack.length) return;
    state.shapes.push(state.redoStack.pop());
    redraw();
  }

  function save() {
    const dataURL = state.canvas.toDataURL('image/png');
    const cb = state.onSave;
    const fn = state.filename || 'edited.png';
    close();
    if (cb) cb(dataURL, fn);
  }

  window.App = window.App || {};
  window.App.ImageAnnotator = { open, close };
})();
