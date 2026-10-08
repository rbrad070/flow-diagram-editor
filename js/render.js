// Turns a diagram into a "scene" (shape geometry, arrow paths and labels)
// and draws the scene as SVG. The PDF exporter draws the same scene, so
// screen, PNG, SVG and PDF all match.

import {
  ARROW_WIDTH, FONT_FAMILY, FONT_SIZE, SHAPE_TYPES, isContainer, textWidth,
} from './shapes.js';
import { findShape } from './model.js';
import { labelPositions, layoutShapes, routeAll } from './routing.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const DASH = [4, 4];          // TikZ "dashed": 3pt on, 3pt off

// Stealth arrowhead, as in TikZ ">=stealth".
const HEAD_LEN = 8;
const HEAD_HALF = 3.2;
const HEAD_INSET = 2.6;

export function buildScene(diagram) {
  const geo = layoutShapes(diagram);
  const routes = routeAll(diagram, geo);
  const arrows = [];
  for (const a of diagram.arrows) {
    const route = routes.get(a.id);
    if (!route) continue;
    const fromDecision = findShape(diagram, a.from)?.type === 'decision';
    const label = a.label ? placeLabel(a.label, labelPositions(route.points, fromDecision), geo) : null;
    arrows.push({ arrow: a, ...route, ...arrowParts(route.points), label });
  }
  return { diagram, geo, arrows };
}

// Uses the first label position that does not cover a shape. A label
// may sit inside a loop body, but not across its dashed border.
function placeLabel(text, positions, geo) {
  const labels = positions.map((p) => ({ text, ...p }));
  const free = labels.find((l) => {
    const b = labelBox(l);
    return ![...geo.values()].some((g) => {
      const o = g.box;
      const overlaps = b.left < o.right && b.right > o.left && b.top < o.bottom && b.bottom > o.top;
      if (!overlaps || !isContainer(g.shape)) return overlaps;
      const inside = b.left > o.left && b.right < o.right && b.top > o.top && b.bottom < o.bottom;
      return !inside;
    });
  });
  return free ?? labels[0];
}

// Loop bodies first (behind), largest first so nested ones stay
// clickable, then the other shapes.
export function drawOrder(scene) {
  const all = [...scene.geo.values()];
  const area = (g) => g.W * g.H;
  return [
    ...all.filter((g) => isContainer(g.shape)).sort((a, b) => area(b) - area(a)),
    ...all.filter((g) => !isContainer(g.shape)),
  ];
}

// Splits an arrow into the line to stroke and the arrowhead polygon.
function arrowParts(points) {
  const n = points.length;
  const tip = points[n - 1];
  const prev = points[n - 2];
  const len = Math.hypot(tip.x - prev.x, tip.y - prev.y) || 1;
  const ux = (tip.x - prev.x) / len;
  const uy = (tip.y - prev.y) / len;
  const at = (back, side) => [tip.x - ux * back - uy * side, tip.y - uy * back + ux * side];
  const head = [at(0, 0), at(HEAD_LEN, HEAD_HALF), at(HEAD_LEN - HEAD_INSET, 0), at(HEAD_LEN, -HEAD_HALF)];
  // Stop the line inside the head so it does not poke out of the tip.
  const stop = Math.min(HEAD_LEN - HEAD_INSET, len);
  const line = points.slice(0, n - 1).map((p) => [p.x, p.y]);
  line.push([tip.x - ux * stop, tip.y - uy * stop]);
  return { line, head };
}

export function labelBox(label) {
  const w = textWidth(label.text);
  const left = label.anchor === 'start' ? label.x : label.anchor === 'end' ? label.x - w : label.x - w / 2;
  return { left, right: left + w, top: label.y - FONT_SIZE * 0.8, bottom: label.y + FONT_SIZE * 0.25 };
}

// Bounding box of everything drawn, or null for an empty diagram.
export function sceneBounds(scene) {
  const boxes = [...scene.geo.values()].map((g) => g.box);
  for (const a of scene.arrows) {
    for (const [x, y] of [...a.line, ...a.head]) boxes.push({ left: x, right: x, top: y, bottom: y });
    if (a.label) boxes.push(labelBox(a.label));
  }
  if (!boxes.length) return null;
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

export function el(tag, attrs = {}, parent = null) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== null && v !== undefined) node.setAttribute(k, v);
  }
  if (parent) parent.appendChild(node);
  return node;
}

const fmt = (n) => Math.round(n * 100) / 100;
const pointsAttr = (pts) => pts.map(([x, y]) => `${fmt(x)},${fmt(y)}`).join(' ');

function drawText(parent, text, x, y, anchor, extra = {}) {
  const t = el('text', {
    x: fmt(x), y: fmt(y),
    'text-anchor': anchor,
    'font-family': FONT_FAMILY,
    'font-size': fmt(FONT_SIZE),
    fill: '#000',
    'xml:space': 'preserve',
    ...extra,
  }, parent);
  t.textContent = text;
  return t;
}

// Draws the scene into `parent` (an SVG <g> or <svg>). In the editor,
// shapes and arrows carry data-* attributes for hit testing.
export function drawScene(parent, scene, { interactive = false } = {}) {
  // Loop bodies go underneath the arrows, so arrows inside stay clickable.
  const containerLayer = el('g', { class: 'containers' }, parent);
  const arrowLayer = el('g', { class: 'arrows' }, parent);
  const shapeLayer = el('g', { class: 'shapes' }, parent);

  for (const g of drawOrder(scene)) {
    const s = g.shape;
    const style = SHAPE_TYPES[s.type];
    const layer = style.container ? containerLayer : shapeLayer;
    const grp = el('g', interactive ? { 'data-shape': s.id, class: 'shape' + (style.container ? ' container' : '') } : {}, layer);
    const common = {
      // In the editor a loop body's inside is clickable, so it can be
      // selected and dragged; exports leave it unfilled.
      fill: style.fill ?? (interactive ? 'transparent' : 'none'),
      stroke: '#000',
      'stroke-width': fmt(style.strokeWidth),
      'stroke-dasharray': style.dashed ? DASH.join(' ') : null,
      'stroke-linejoin': 'miter',
    };
    const o = g.outline;
    if (o.kind === 'ellipse') {
      el('ellipse', { cx: fmt(o.cx), cy: fmt(o.cy), rx: fmt(o.rx), ry: fmt(o.ry), ...common }, grp);
    } else {
      el('polygon', { points: pointsAttr(o.points), ...common }, grp);
    }
    for (const line of g.lines) {
      el('polyline', { points: pointsAttr(line), fill: 'none', stroke: '#000', 'stroke-width': fmt(style.strokeWidth) }, grp);
    }
    for (const line of g.text) {
      if (line.text) drawText(grp, line.text, line.x, line.y, line.anchor, interactive ? { 'pointer-events': 'none' } : {});
    }
  }

  for (const a of scene.arrows) {
    const grp = el('g', interactive ? { 'data-arrow': a.arrow.id, class: 'arrow' } : {}, arrowLayer);
    if (interactive) {
      // Wide invisible line so the arrow is easy to click.
      el('polyline', {
        points: pointsAttr(a.line), fill: 'none', stroke: 'transparent', 'stroke-width': 12, class: 'hit',
      }, grp);
    }
    el('polyline', {
      points: pointsAttr(a.line),
      fill: 'none',
      stroke: '#000',
      'stroke-width': fmt(ARROW_WIDTH),
      'stroke-linejoin': 'miter',
      class: 'line',
    }, grp);
    el('polygon', { points: pointsAttr(a.head), fill: '#000', stroke: 'none', class: 'head' }, grp);
    if (a.label) {
      drawText(grp, a.label.text, a.label.x, a.label.y, a.label.anchor, interactive ? { class: 'label' } : {});
    }
  }
}
