// The editor: palette, canvas interaction, text editing, files.

import {
  CHAR_W, CM, FONT_SIZE, LINE_H, SHAPE_TYPES, SIDES, geometry, isContainer, naturalSize, textLines,
} from './shapes.js';
import * as M from './model.js';
import { buildScene, drawOrder, drawScene, el, labelBox, sceneBounds } from './render.js';
import { exportPDF, exportPNG, exportSVG, readDiagramFile } from './export.js';

const PALETTE = ['startstop', 'process', 'io', 'decision', 'loopbody', 'function'];
const SNAP = 6;              // screen px: snap centres that are this close
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

const $ = (id) => document.getElementById(id);
const svg = $('canvas');
const content = $('content');
const overlay = $('overlay');
const wrap = $('canvas-wrap');
const textEditor = $('text-editor');

const state = {
  diagram: M.emptyDiagram(),
  scene: null,
  selected: null,       // { kind: 'shape' | 'arrow', id }
  hover: null,          // shape id under the pointer
  drag: null,           // current pointer action
  editing: null,        // { kind, id, original } while typing
  guides: [],
  view: { x: 0, y: 0, zoom: 1.5 },
  dirty: false,
  fileBase: 'diagram',
};

// ---------------------------------------------------------------- view

function viewSize() {
  return { w: wrap.clientWidth, h: wrap.clientHeight };
}

function applyView() {
  const { w, h } = viewSize();
  const { x, y, zoom } = state.view;
  svg.setAttribute('viewBox', `${x} ${y} ${w / zoom} ${h / zoom}`);
  $('zoom-level').textContent = `${Math.round(zoom * 100)}%`;
  if (state.editing) positionEditor();
}

function toWorld(clientX, clientY) {
  const r = svg.getBoundingClientRect();
  return { x: state.view.x + (clientX - r.left) / state.view.zoom, y: state.view.y + (clientY - r.top) / state.view.zoom };
}

function toScreen(x, y) {
  return { x: (x - state.view.x) * state.view.zoom, y: (y - state.view.y) * state.view.zoom };
}

function zoomAt(factor, clientX, clientY) {
  const before = toWorld(clientX, clientY);
  state.view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.view.zoom * factor));
  const r = svg.getBoundingClientRect();
  state.view.x = before.x - (clientX - r.left) / state.view.zoom;
  state.view.y = before.y - (clientY - r.top) / state.view.zoom;
  applyView();
  renderOverlay();
}

function zoomCentre(factor) {
  const r = svg.getBoundingClientRect();
  zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
}

function fitView() {
  const { w, h } = viewSize();
  const b = state.scene && sceneBounds(state.scene);
  if (!b) {
    state.view = { zoom: 1.5, x: -w / 2 / 1.5, y: -1.5 * CM };
  } else {
    const pad = 1 * CM;
    const bw = b.right - b.left + 2 * pad;
    const bh = b.bottom - b.top + 2 * pad;
    const zoom = Math.min(MAX_ZOOM, 2, Math.max(MIN_ZOOM, Math.min(w / bw, h / bh)));
    state.view = {
      zoom,
      x: (b.left + b.right) / 2 - w / 2 / zoom,
      y: (b.top + b.bottom) / 2 - h / 2 / zoom,
    };
  }
  applyView();
  renderOverlay();
}

// Scrolls so that a box (world coords) is on screen.
function ensureVisible(box) {
  const { w, h } = viewSize();
  const v = state.view;
  const pad = 20 / v.zoom;
  const vw = w / v.zoom;
  const vh = h / v.zoom;
  if (box.left - pad < v.x) v.x = box.left - pad;
  else if (box.right + pad > v.x + vw) v.x = box.right + pad - vw;
  if (box.top - pad < v.y) v.y = box.top - pad;
  else if (box.bottom + pad > v.y + vh) v.y = box.bottom + pad - vh;
  applyView();
}

// ---------------------------------------------------------------- render

function render() {
  state.scene = buildScene(state.diagram);
  content.replaceChildren();
  drawScene(content, state.scene, { interactive: true });
  if (state.editing) {
    const attr = state.editing.kind === 'shape' ? 'data-shape' : 'data-arrow';
    content.querySelector(`[${attr}="${CSS.escape(state.editing.id)}"]`)?.classList.add('editing');
  }
  renderOverlay();
  updateToolbar();
}

function changed() {
  state.dirty = true;
  render();
}

function sceneArrow(id) {
  return state.scene.arrows.find((a) => a.arrow.id === id);
}

function renderOverlay() {
  overlay.replaceChildren();
  const z = state.view.zoom;
  const sel = state.selected;
  const drag = state.drag;

  if (sel?.kind === 'shape' && state.scene.geo.has(sel.id)) {
    const b = state.scene.geo.get(sel.id).box;
    const pad = 5 / z;
    el('rect', {
      class: 'sel-box',
      x: b.left - pad, y: b.top - pad,
      width: b.right - b.left + 2 * pad, height: b.bottom - b.top + 2 * pad,
      'stroke-width': 1.5 / z, 'stroke-dasharray': `${5 / z} ${4 / z}`,
    }, overlay);
    // Corner handles for resizing.
    if (!drag || drag.kind === 'resize') {
      const size = 9 / z;
      for (const [corner, x, y] of [
        ['nw', b.left - pad, b.top - pad], ['ne', b.right + pad, b.top - pad],
        ['sw', b.left - pad, b.bottom + pad], ['se', b.right + pad, b.bottom + pad],
      ]) {
        el('rect', {
          class: `handle handle-${corner}`, 'data-handle': corner,
          x: x - size / 2, y: y - size / 2, width: size, height: size, 'stroke-width': 1.5 / z,
        }, overlay);
      }
    }
  }
  if (sel?.kind === 'arrow') {
    const a = sceneArrow(sel.id);
    if (a) {
      el('polyline', {
        class: 'sel-arrow', points: a.points.map((p) => `${p.x},${p.y}`).join(' '), 'stroke-width': 8 / z,
      }, overlay);
    }
  }

  for (const g of state.guides) {
    const { w, h } = viewSize();
    const v = state.view;
    const attrs = g.axis === 'x'
      ? { x1: g.at, x2: g.at, y1: v.y, y2: v.y + h / z }
      : { y1: g.at, y2: g.at, x1: v.x, x2: v.x + w / z };
    el('line', { class: 'guide', ...attrs, 'stroke-width': 1 / z }, overlay);
  }

  // Connection dots: on every shape while drawing an arrow, otherwise on
  // the shape under the pointer and the selected shape.
  let portShapes;
  if (drag?.kind === 'connect') portShapes = state.diagram.shapes.map((s) => s.id);
  else if ((drag?.kind === 'move' || drag?.kind === 'resize') && drag.moved) portShapes = [];
  else portShapes = [...new Set([state.hover, sel?.kind === 'shape' ? sel.id : null].filter(Boolean))];

  if (drag?.kind === 'connect' && drag.target && !drag.target.side) {
    const b = state.scene.geo.get(drag.target.id)?.box;
    if (b) {
      const pad = 4 / z;
      el('rect', {
        class: 'shape-target', x: b.left - pad, y: b.top - pad,
        width: b.right - b.left + 2 * pad, height: b.bottom - b.top + 2 * pad, 'stroke-width': 2 / z,
      }, overlay);
    }
  }

  for (const id of portShapes) {
    const g = state.scene.geo.get(id);
    if (!g) continue;
    for (const side of SIDES) {
      const p = g.ports[side];
      const isTarget = drag?.kind === 'connect' && drag.target?.id === id && drag.target?.side === side;
      el('circle', {
        class: 'port' + (isTarget ? ' target' : ''),
        cx: p.x, cy: p.y, r: 5.5 / z, 'stroke-width': 1.5 / z,
        'data-port': `${id}:${side}`,
      }, overlay);
    }
  }

  if (drag?.kind === 'connect' && drag.moved) {
    const p = state.scene.geo.get(drag.from)?.ports[drag.side];
    if (p) {
      el('line', {
        class: 'connect-line', x1: p.x, y1: p.y, x2: drag.cur.x, y2: drag.cur.y,
        'stroke-width': 1.5 / z, 'stroke-dasharray': `${5 / z} ${4 / z}`,
      }, overlay);
    }
  }

  if (drag?.kind === 'palette' && drag.at) {
    const ghost = el('g', { class: 'ghost' }, overlay);
    const d = M.emptyDiagram();
    M.addShape(d, drag.type, drag.at.x, drag.at.y, '');
    drawScene(ghost, buildScene(d));
  }
}

function updateToolbar() {
  const sel = state.selected;
  const shape = sel?.kind === 'shape' ? M.findShape(state.diagram, sel.id) : null;
  const arrow = sel?.kind === 'arrow' ? M.findArrow(state.diagram, sel.id) : null;
  const fromDecision = arrow && M.findShape(state.diagram, arrow.from)?.type === 'decision';
  const decisionWithArrows = shape?.type === 'decision' && M.outgoing(state.diagram, shape.id).length > 0;

  $('btn-edit').textContent = arrow ? 'Edit label' : 'Edit text';
  $('btn-edit').disabled = !sel || fromDecision;
  $('btn-delete').disabled = !sel;
  $('btn-swap').hidden = !(fromDecision || decisionWithArrows);
  $('btn-auto').hidden = !arrow;
  $('btn-fit-size').hidden = !shape;
  $('btn-fit-size').disabled = !(shape && shape.w);
  $('btn-auto').disabled = !(arrow && (arrow.fromSide || arrow.toSide));

  let hint;
  if (state.editing) {
    hint = state.editing.kind === 'shape'
      ? 'Type the text. Press Enter when done. Press Shift+Enter for a new line. Press Esc to undo your typing.'
      : 'Type the label. Press Enter when done. Press Esc to undo your typing.';
  } else if (fromDecision) {
    hint = 'Double-click the arrow (or click Swap True / False) to swap the labels. Press Delete to remove it.';
  } else if (arrow) {
    hint = 'Double-click the arrow to add a label. Press Delete to remove it.';
  } else if (shape && isContainer(shape)) {
    hint = 'Drag a corner to resize the loop body. Put shapes inside it: they move with it. Double-click to add a label.';
  } else if (shape) {
    hint = 'Double-click or press Enter to type. Drag a blue dot to another shape to draw an arrow. Drag a corner to resize.';
  } else if (!state.diagram.shapes.length) {
    hint = 'Click a shape on the left (or drag it here) to add it to your diagram.';
  } else {
    hint = 'Click a shape to select it. Drag from a blue dot to another shape to draw an arrow. Drag the background to move around.';
  }
  $('hint').textContent = hint;
}

// ---------------------------------------------------------------- messages

let toastTimer = null;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
}

// ---------------------------------------------------------------- shapes

// The shape at a point: the topmost drawn, so shapes inside a loop body
// win over the loop body, and inner loop bodies over outer ones.
function shapeAt(p, pad = 0) {
  const order = drawOrder(state.scene);
  for (let i = order.length - 1; i >= 0; i--) {
    const b = order[i].box;
    if (p.x >= b.left - pad && p.x <= b.right + pad && p.y >= b.top - pad && p.y <= b.bottom + pad) return order[i].shape;
  }
  return null;
}

// Shapes whose centre is inside a loop body (including nested loop
// bodies and their contents). They move with it.
function contents(container) {
  const b = state.scene.geo.get(container.id).box;
  return state.diagram.shapes.filter((s) =>
    s.id !== container.id && s.x > b.left && s.x < b.right && s.y > b.top && s.y < b.bottom);
}

// Snaps a centre point so it lines up with other shapes' centres.
function snapCentre(x, y, exclude = new Set()) {
  const tol = SNAP / state.view.zoom;
  let bestX = null;
  let bestY = null;
  for (const s of state.diagram.shapes) {
    if (exclude.has(s.id)) continue;
    const dx = Math.abs(s.x - x);
    const dy = Math.abs(s.y - y);
    if (dx <= tol && (bestX === null || dx < Math.abs(bestX - x))) bestX = s.x;
    if (dy <= tol && (bestY === null || dy < Math.abs(bestY - y))) bestY = s.y;
  }
  const guides = [];
  if (bestX !== null) guides.push({ axis: 'x', at: bestX });
  if (bestY !== null) guides.push({ axis: 'y', at: bestY });
  return { x: bestX ?? x, y: bestY ?? y, guides };
}

function boxesOverlap(a, b, gap) {
  return a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
}

function newShapeText(type) {
  if (type === 'startstop' && state.diagram.shapes.some((s) => s.type === 'startstop' && /^start$/i.test(s.text.trim()))) {
    return 'Stop';
  }
  return SHAPE_TYPES[type].defaultText;
}

// Where to put a shape added by clicking the palette: inside the
// selected loop body, under the selected shape, or in the middle of
// the screen.
function defaultPosition(type, text) {
  const sel = state.selected?.kind === 'shape' ? M.findShape(state.diagram, state.selected.id) : null;
  const probe = geometry({ type, x: 0, y: 0, text, ...SHAPE_TYPES[type].defaultSize });
  let x;
  let y;
  if (sel && isContainer(sel) && !SHAPE_TYPES[type].container) {
    x = sel.x;
    y = geometry(sel).box.top + 0.8 * CM + probe.H / 2;
  } else if (sel) {
    x = sel.x;
    y = geometry(sel).box.bottom + 1 * CM + probe.H / 2;
  } else {
    const { w, h } = viewSize();
    const v = state.view;
    x = v.x + w / 2 / v.zoom;
    y = state.diagram.shapes.length ? v.y + h / 2 / v.zoom : v.y + 2 * CM;
  }
  // Move down until it does not overlap another shape. Loop bodies are
  // boundaries, so shapes may go inside them.
  const others = state.diagram.shapes.filter((s) => !isContainer(s));
  for (let i = 0; i < 100; i++) {
    const box = geometry({ type, x, y, text, ...SHAPE_TYPES[type].defaultSize }).box;
    if (!others.some((s) => boxesOverlap(geometry(s).box, box, 0.3 * CM))) break;
    y += 0.5 * CM;
  }
  return { x, y };
}

function addNewShape(type, at) {
  commitEdit();
  const text = newShapeText(type);
  const { x, y } = at ?? defaultPosition(type, text);
  const shape = M.addShape(state.diagram, type, x, y, text);
  state.selected = { kind: 'shape', id: shape.id };
  changed();
  ensureVisible(state.scene.geo.get(shape.id).box);
  startEdit('shape', shape.id, true);
}

function deleteSelected() {
  const sel = state.selected;
  if (!sel) return;
  if (sel.kind === 'shape') M.removeShape(state.diagram, sel.id);
  else M.removeArrow(state.diagram, sel.id);
  state.selected = null;
  state.hover = null;
  changed();
}

function swapSelected() {
  const sel = state.selected;
  if (!sel) return;
  const decisionId = sel.kind === 'shape' ? sel.id : M.findArrow(state.diagram, sel.id)?.from;
  if (!decisionId) return;
  M.swapTrueFalse(state.diagram, decisionId);
  changed();
}

function resetSizeSelected() {
  const shape = state.selected?.kind === 'shape' && M.findShape(state.diagram, state.selected.id);
  if (!shape) return;
  delete shape.w;
  delete shape.h;
  Object.assign(shape, SHAPE_TYPES[shape.type].defaultSize);
  changed();
}

function autoRouteSelected() {
  const arrow = state.selected?.kind === 'arrow' && M.findArrow(state.diagram, state.selected.id);
  if (!arrow) return;
  arrow.fromSide = null;
  arrow.toSide = null;
  changed();
}

// ---------------------------------------------------------------- text editing

function startEdit(kind, id, selectAll = false) {
  commitEdit();
  const obj = kind === 'shape' ? M.findShape(state.diagram, id) : M.findArrow(state.diagram, id);
  if (!obj) return;
  if (kind === 'arrow' && M.findShape(state.diagram, obj.from)?.type === 'decision') return;
  state.editing = { kind, id, original: kind === 'shape' ? obj.text : obj.label };
  state.selected = { kind, id };
  textEditor.value = state.editing.original;
  textEditor.hidden = false;
  render();
  positionEditor();
  textEditor.focus();
  if (selectAll) textEditor.select();
  else textEditor.setSelectionRange(textEditor.value.length, textEditor.value.length);
}

function positionEditor() {
  const ed = state.editing;
  if (!ed) return;
  const z = state.view.zoom;
  const lines = textLines(textEditor.value);
  const chars = Math.max(1, ...lines.map((l) => l.length)) + 1;
  const w = chars * CHAR_W * z;
  const h = lines.length * LINE_H * z;
  let left;
  let top;
  const shape = ed.kind === 'shape' ? M.findShape(state.diagram, ed.id) : null;
  textEditor.style.textAlign = shape && !isContainer(shape) ? 'center' : 'left';
  if (shape && isContainer(shape)) {
    // Loop body label: top-left corner.
    const first = state.scene.geo.get(shape.id).text[0];
    const c = toScreen(first.x, first.y - 0.8 * FONT_SIZE);
    left = c.x;
    top = c.y - (LINE_H - FONT_SIZE) * z / 2;
  } else if (shape) {
    const c = toScreen(shape.x, shape.y);
    left = c.x - w / 2;
    top = c.y - h / 2;
  } else {
    const a = sceneArrow(ed.id);
    if (!a) return;
    let p;
    if (a.label) {
      const b = labelBox(a.label);
      p = { x: b.left, y: (b.top + b.bottom) / 2 };
    } else {
      // Middle of the longest segment.
      let best = 0;
      for (let i = 1; i < a.points.length; i++) {
        const q = a.points[i - 1];
        const r = a.points[i];
        const len = Math.abs(r.x - q.x) + Math.abs(r.y - q.y);
        if (len > best) { best = len; p = { x: (q.x + r.x) / 2 + 6, y: (q.y + r.y) / 2 }; }
      }
    }
    const c = toScreen(p.x, p.y);
    left = c.x;
    top = c.y - h / 2;
  }
  Object.assign(textEditor.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${w}px`,
    height: `${h}px`,
    fontSize: `${FONT_SIZE * z}px`,
    lineHeight: `${LINE_H * z}px`,
  });
}

function applyEditorText() {
  const ed = state.editing;
  if (!ed) return;
  if (ed.kind === 'shape') {
    const s = M.findShape(state.diagram, ed.id);
    if (s) s.text = textEditor.value;
  } else {
    const a = M.findArrow(state.diagram, ed.id);
    if (a) a.label = textEditor.value.replace(/\s*\n\s*/g, ' ');
  }
}

function finishEdit(keep) {
  const ed = state.editing;
  if (!ed) return;
  if (!keep) textEditor.value = ed.original;
  applyEditorText();
  if (keep && textEditor.value !== ed.original) state.dirty = true;
  state.editing = null;
  textEditor.hidden = true;
  render();
}

function commitEdit() { finishEdit(true); }

textEditor.addEventListener('input', () => {
  if (state.editing?.kind === 'arrow' && textEditor.value.includes('\n')) {
    textEditor.value = textEditor.value.replace(/\n/g, '');
  }
  applyEditorText();
  render();
  positionEditor();
});

textEditor.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    commitEdit();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    finishEdit(false);
  }
});

textEditor.addEventListener('blur', () => commitEdit());

// ---------------------------------------------------------------- canvas pointer input

function connectTarget(e) {
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const port = hit?.closest?.('[data-port]');
  if (port) {
    const [id, side] = port.dataset.port.split(':');
    return { id, side };
  }
  const s = shapeAt(toWorld(e.clientX, e.clientY), 8 / state.view.zoom);
  return s ? { id: s.id, side: null } : null;
}

// Double-clicks are detected here rather than with the dblclick event:
// the canvas is redrawn on every click, so the element under the first
// click is gone by the second and the browser's dblclick goes astray.
let lastDown = null;

function onDoubleClick(shapeEl, arrowEl) {
  if (shapeEl) {
    startEdit('shape', shapeEl.dataset.shape);
  } else if (arrowEl) {
    const arrow = M.findArrow(state.diagram, arrowEl.dataset.arrow);
    if (M.findShape(state.diagram, arrow.from)?.type === 'decision') {
      M.swapTrueFalse(state.diagram, arrow.from);
      changed();
    } else {
      startEdit('arrow', arrow.id);
    }
  }
}

svg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  commitEdit();
  const p = toWorld(e.clientX, e.clientY);
  const handle = e.target.closest('[data-handle]');
  if (handle && e.button === 0 && state.selected?.kind === 'shape') {
    // Resize from a corner; the opposite corner stays where it is.
    const corner = handle.dataset.handle;
    const b = state.scene.geo.get(state.selected.id).box;
    const sx = corner.includes('w') ? -1 : 1;
    const sy = corner.includes('n') ? -1 : 1;
    state.drag = {
      kind: 'resize', id: state.selected.id, sx, sy, moved: false,
      fixed: { x: sx < 0 ? b.right : b.left, y: sy < 0 ? b.bottom : b.top },
    };
    svg.setPointerCapture(e.pointerId);
    e.preventDefault();
    return;
  }
  const port = e.target.closest('[data-port]');
  const shapeEl = port ? null : e.target.closest('[data-shape]');
  const arrowEl = e.target.closest('[data-arrow]');

  const key = e.button === 0 ? (shapeEl?.dataset.shape ?? arrowEl?.dataset.arrow ?? null) : null;
  const now = performance.now();
  const isDouble = key !== null && lastDown?.key === key && now - lastDown.t < 500 &&
    Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 6;
  lastDown = isDouble ? null : { key, t: now, x: e.clientX, y: e.clientY };
  if (isDouble) {
    e.preventDefault();
    onDoubleClick(shapeEl, arrowEl);
    return;
  }

  if (e.button === 1 || (!port && !shapeEl && !arrowEl)) {
    if (e.button === 0) state.selected = null;
    state.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: state.view.x, vy: state.view.y };
    svg.classList.add('panning');
    render();
  } else if (port) {
    const [id, side] = port.dataset.port.split(':');
    state.drag = { kind: 'connect', from: id, side, start: p, cur: p, moved: false, target: null };
  } else if (shapeEl) {
    const s = M.findShape(state.diagram, shapeEl.dataset.shape);
    state.selected = { kind: 'shape', id: s.id };
    // A loop body carries the shapes inside it.
    const carried = isContainer(s) ? contents(s).map((c) => ({ shape: c, x: c.x, y: c.y })) : [];
    state.drag = {
      kind: 'move', id: s.id, x0: s.x, y0: s.y, dx: s.x - p.x, dy: s.y - p.y,
      sx: e.clientX, sy: e.clientY, moved: false, carried,
      exclude: new Set([s.id, ...carried.map((c) => c.shape.id)]),
    };
    render();
  } else {
    state.selected = { kind: 'arrow', id: arrowEl.dataset.arrow };
    state.drag = null;
    render();
  }
  if (state.drag) svg.setPointerCapture(e.pointerId);
  e.preventDefault();
});

svg.addEventListener('pointermove', (e) => {
  const drag = state.drag;
  if (!drag) {
    const s = shapeAt(toWorld(e.clientX, e.clientY), 10 / state.view.zoom);
    const id = s?.id ?? null;
    if (id !== state.hover) {
      state.hover = id;
      renderOverlay();
    }
    return;
  }
  const p = toWorld(e.clientX, e.clientY);
  if (drag.kind === 'pan') {
    state.view.x = drag.vx - (e.clientX - drag.sx) / state.view.zoom;
    state.view.y = drag.vy - (e.clientY - drag.sy) / state.view.zoom;
    applyView();
  } else if (drag.kind === 'move') {
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 3) return;
    drag.moved = true;
    const s = M.findShape(state.diagram, drag.id);
    const snapped = snapCentre(p.x + drag.dx, p.y + drag.dy, drag.exclude);
    s.x = snapped.x;
    s.y = snapped.y;
    for (const c of drag.carried) {
      c.shape.x = c.x + s.x - drag.x0;
      c.shape.y = c.y + s.y - drag.y0;
    }
    state.guides = snapped.guides;
    render();
  } else if (drag.kind === 'resize') {
    drag.moved = true;
    const s = M.findShape(state.diagram, drag.id);
    const nat = naturalSize(s);
    s.w = Math.max(nat.W, (p.x - drag.fixed.x) * drag.sx);
    s.h = Math.max(nat.H, (p.y - drag.fixed.y) * drag.sy);
    s.x = drag.fixed.x + (drag.sx * s.w) / 2;
    s.y = drag.fixed.y + (drag.sy * s.h) / 2;
    render();
  } else if (drag.kind === 'connect') {
    drag.cur = p;
    drag.moved = drag.moved || Math.hypot(p.x - drag.start.x, p.y - drag.start.y) * state.view.zoom > 4;
    const t = connectTarget(e);
    drag.target = t && t.id !== drag.from ? t : null;
    renderOverlay();
  }
});

function endPointer(e) {
  const drag = state.drag;
  if (!drag) return;
  state.drag = null;
  state.guides = [];
  svg.classList.remove('panning');
  if ((drag.kind === 'move' || drag.kind === 'resize') && drag.moved) {
    state.dirty = true;
  } else if (drag.kind === 'connect') {
    if (!drag.moved) {
      state.selected = { kind: 'shape', id: drag.from };
    } else if (e.type === 'pointerup' && drag.target) {
      const problem = M.arrowProblem(state.diagram, drag.from, drag.target.id);
      if (problem) {
        toast(problem);
      } else {
        const arrow = M.addArrow(state.diagram, drag.from, drag.target.id, drag.side, drag.target.side);
        state.selected = { kind: 'arrow', id: arrow.id };
        state.dirty = true;
      }
    } else if (e.type === 'pointerup') {
      toast('To draw an arrow, let go of the mouse on another shape.');
    }
  }
  render();
}

svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', endPointer);
svg.addEventListener('pointerleave', () => {
  if (!state.drag && state.hover) {
    state.hover = null;
    renderOverlay();
  }
});

// Trackpad two-finger scroll and mouse wheel move the view; pinch (or
// Ctrl + wheel) zooms.
svg.addEventListener('wheel', (e) => {
  e.preventDefault();
  const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
  const dx = e.deltaX * scale;
  const dy = e.deltaY * scale;
  if (e.ctrlKey || e.metaKey) {
    zoomAt(Math.min(1.25, Math.max(0.8, Math.pow(1.0018, -dy))), e.clientX, e.clientY);
  } else {
    state.view.x += dx / state.view.zoom;
    state.view.y += dy / state.view.zoom;
    applyView();
  }
}, { passive: false });

// ---------------------------------------------------------------- palette

function paletteIcon(type) {
  const d = M.emptyDiagram();
  const s = M.addShape(d, type, 0, 0, '');
  if (isContainer(s)) Object.assign(s, { w: 3 * CM, h: 1.25 * CM });
  const scene = buildScene(d);
  const b = scene.geo.values().next().value.box;
  const icon = el('svg', { viewBox: `${b.left - 2} ${b.top - 2} ${b.right - b.left + 4} ${b.bottom - b.top + 4}`, 'aria-hidden': 'true' });
  drawScene(icon, scene);
  return icon;
}

function buildPalette() {
  const palette = $('palette');
  for (const type of PALETTE) {
    const btn = document.createElement('button');
    btn.className = 'palette-item';
    btn.title = `Add a ${SHAPE_TYPES[type].name} shape (click, or drag onto the diagram)`;
    const label = document.createElement('span');
    label.textContent = SHAPE_TYPES[type].name;
    btn.append(paletteIcon(type), label);

    btn.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      btn.setPointerCapture(e.pointerId);
      state.drag = { kind: 'palette', type, sx: e.clientX, sy: e.clientY, moved: false, at: null };
    });
    btn.addEventListener('pointermove', (e) => {
      const drag = state.drag;
      if (drag?.kind !== 'palette') return;
      drag.moved = drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6;
      const r = wrap.getBoundingClientRect();
      const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (drag.moved && over) {
        const p = toWorld(e.clientX, e.clientY);
        const snapped = snapCentre(p.x, p.y);
        drag.at = { x: snapped.x, y: snapped.y };
        state.guides = snapped.guides;
      } else {
        drag.at = null;
        state.guides = [];
      }
      renderOverlay();
    });
    const end = (e) => {
      const drag = state.drag;
      if (drag?.kind !== 'palette') return;
      state.drag = null;
      state.guides = [];
      if (e.type === 'pointerup' && !drag.moved) addNewShape(type);
      else if (e.type === 'pointerup' && drag.at) addNewShape(type, drag.at);
      else renderOverlay();
    };
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    // Keyboard: Enter / Space on the button.
    btn.addEventListener('click', (e) => {
      if (e.detail === 0) addNewShape(type);
    });
    palette.appendChild(btn);
  }
}

// ---------------------------------------------------------------- files

function cleanFileName(name, ext) {
  let n = name.trim().replace(/[\\/:*?"<>|]+/g, '-');
  if (n.toLowerCase().endsWith(ext)) n = n.slice(0, -ext.length);
  n = n.replace(/\.+$/, '').trim();
  return (n || 'diagram') + ext;
}

// Asks the student for a file name. Resolves to the name, or null if
// they cancel.
function askFileName(title, ext, note) {
  const dialog = $('name-dialog');
  const input = $('name-input');
  $('name-title').textContent = title;
  $('name-note').textContent = note;
  $('name-ok').textContent = title.startsWith('Save') ? 'Save' : 'Export';
  input.value = state.fileBase + ext;
  dialog.returnValue = '';
  dialog.showModal();
  input.focus();
  input.setSelectionRange(0, state.fileBase.length);
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => {
      if (dialog.returnValue !== 'ok') return resolve(null);
      const name = cleanFileName(input.value, ext);
      state.fileBase = name.slice(0, -ext.length);
      resolve(name);
    }, { once: true });
  });
}

$('name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('name-dialog').close('ok');
  }
});

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function needShapes() {
  if (state.diagram.shapes.length) return true;
  toast('Your diagram is empty. Add some shapes first.');
  return false;
}

const REOPEN_NOTE = 'You can open this file in the editor again later.';

async function saveJSON() {
  commitEdit();
  const name = await askFileName('Save diagram', '.json', REOPEN_NOTE);
  if (!name) return;
  download(new Blob([M.toJSON(state.diagram)], { type: 'application/json' }), name);
  state.dirty = false;
}

async function exportAs(kind) {
  commitEdit();
  if (!needShapes()) return;
  const ext = '.' + kind;
  const name = await askFileName(`Export ${kind.toUpperCase()}`, ext, REOPEN_NOTE);
  if (!name) return;
  try {
    let blob;
    if (kind === 'pdf') blob = exportPDF(state.diagram, state.fileBase);
    else if (kind === 'png') blob = await exportPNG(state.diagram);
    else blob = new Blob([exportSVG(state.diagram).text], { type: 'image/svg+xml' });
    download(blob, name);
    state.dirty = false;
  } catch (err) {
    console.error(err);
    toast('Sorry, the export did not work. Please try again.');
  }
}

function confirmReplace(message) {
  return !(state.dirty && state.diagram.shapes.length) || window.confirm(message);
}

async function openFile(file) {
  if (!confirmReplace('Open this file? Your current diagram will be replaced.')) return;
  try {
    const diagram = await readDiagramFile(file);
    commitEdit();
    state.diagram = diagram;
    state.selected = null;
    state.hover = null;
    state.dirty = false;
    state.fileBase = file.name.replace(/\.[^.]*$/, '') || 'diagram';
    render();
    fitView();
  } catch (err) {
    console.error(err);
    toast(err.message || 'Sorry, this file could not be opened.');
  }
}

function newDiagram() {
  if (!confirmReplace('Start a new diagram? Your current diagram will be cleared.')) return;
  commitEdit();
  state.diagram = M.emptyDiagram();
  state.selected = null;
  state.hover = null;
  state.dirty = false;
  state.fileBase = 'diagram';
  render();
  fitView();
}

$('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) openFile(file);
});

wrap.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
wrap.addEventListener('drop', (e) => {
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  e.preventDefault();
  openFile(file);
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty && state.diagram.shapes.length) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------------------------------------------------------------- toolbar and keys

$('btn-new').addEventListener('click', newDiagram);
$('btn-open').addEventListener('click', () => $('file-input').click());
$('btn-save').addEventListener('click', saveJSON);
$('btn-pdf').addEventListener('click', () => exportAs('pdf'));
$('btn-png').addEventListener('click', () => exportAs('png'));
$('btn-svg').addEventListener('click', () => exportAs('svg'));
$('btn-edit').addEventListener('click', () => state.selected && startEdit(state.selected.kind, state.selected.id));
$('btn-swap').addEventListener('click', swapSelected);
$('btn-auto').addEventListener('click', autoRouteSelected);
$('btn-fit-size').addEventListener('click', resetSizeSelected);
$('btn-delete').addEventListener('click', deleteSelected);
$('btn-zoom-in').addEventListener('click', () => zoomCentre(1.25));
$('btn-zoom-out').addEventListener('click', () => zoomCentre(0.8));
$('btn-fit').addEventListener('click', fitView);

document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, dialog') || state.editing) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selected) {
      e.preventDefault();
      deleteSelected();
    }
  } else if ((e.key === 'Enter' || e.key === 'F2') && state.selected && e.target === document.body) {
    e.preventDefault();
    startEdit(state.selected.kind, state.selected.id);
  } else if (e.key === 'Escape') {
    state.selected = null;
    render();
  }
});

window.addEventListener('resize', applyView);

// ---------------------------------------------------------------- start

buildPalette();
render();
fitView();

// For automated tests.
window.__editor = { state, render, addNewShape };
