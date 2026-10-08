// The diagram data model and its JSON file format.
//
// {
//   "format": "cpsc100-flow-diagram",
//   "version": 1,
//   "shapes": [{ "id": "s1", "type": "process", "x": 0, "y": 0, "text": "x = 0",
//                "w": 150, "h": 40 }],
//   "arrows": [{ "id": "a1", "from": "s1", "to": "s2",
//                "fromSide": null, "toSide": null, "label": "" }]
// }
//
// Shape x/y are the shape's centre in px (96 dpi). w/h are optional: the
// size the shape was resized to (it still grows to fit its text). fromSide/toSide are
// "n" | "s" | "e" | "w", or null to let the router choose.

import { SHAPE_TYPES, SIDES } from './shapes.js';

export const FORMAT = 'cpsc100-flow-diagram';
export const VERSION = 1;

export function emptyDiagram() {
  return { format: FORMAT, version: VERSION, shapes: [], arrows: [] };
}

function nextId(diagram, prefix) {
  const used = new Set([...diagram.shapes, ...diagram.arrows].map((o) => o.id));
  let n = 1;
  while (used.has(prefix + n)) n++;
  return prefix + n;
}

export function findShape(diagram, id) {
  return diagram.shapes.find((s) => s.id === id);
}

export function findArrow(diagram, id) {
  return diagram.arrows.find((a) => a.id === id);
}

export function addShape(diagram, type, x, y, text = SHAPE_TYPES[type].defaultText) {
  const shape = { id: nextId(diagram, 's'), type, x, y, text };
  const size = SHAPE_TYPES[type].defaultSize;
  if (size) Object.assign(shape, size);
  diagram.shapes.push(shape);
  return shape;
}

export function removeShape(diagram, id) {
  diagram.shapes = diagram.shapes.filter((s) => s.id !== id);
  diagram.arrows = diagram.arrows.filter((a) => a.from !== id && a.to !== id);
}

export function removeArrow(diagram, id) {
  diagram.arrows = diagram.arrows.filter((a) => a.id !== id);
}

export function outgoing(diagram, shapeId) {
  return diagram.arrows.filter((a) => a.from === shapeId);
}

// Checks whether an arrow from -> to is allowed. Returns an error message
// for the student, or null if the arrow is fine.
export function arrowProblem(diagram, fromId, toId) {
  if (fromId === toId) return 'An arrow must go to a different shape.';
  const from = findShape(diagram, fromId);
  if (diagram.arrows.some((a) => a.from === fromId && a.to === toId)) {
    return 'These shapes are already connected.';
  }
  if (from.type === 'decision' && outgoing(diagram, fromId).length >= 2) {
    return 'A decision has only two arrows out: True and False.';
  }
  return null;
}

export function addArrow(diagram, from, to, fromSide = null, toSide = null) {
  const source = findShape(diagram, from);
  let label = '';
  if (source.type === 'decision') {
    // The first arrow out of a decision is True, the second is False.
    const taken = outgoing(diagram, from).map((a) => a.label);
    label = taken.includes('True') ? 'False' : 'True';
  }
  const arrow = { id: nextId(diagram, 'a'), from, to, fromSide, toSide, label };
  diagram.arrows.push(arrow);
  return arrow;
}

// Swaps the True and False labels on a decision's arrows.
export function swapTrueFalse(diagram, decisionId) {
  for (const a of outgoing(diagram, decisionId)) {
    a.label = a.label === 'True' ? 'False' : 'True';
  }
}

export function toJSON(diagram) {
  return JSON.stringify(
    {
      format: FORMAT,
      version: VERSION,
      shapes: diagram.shapes.map(({ id, type, x, y, text, w, h }) => (
        w || h ? { id, type, x, y, text, w, h } : { id, type, x, y, text })),
      arrows: diagram.arrows.map(({ id, from, to, fromSide, toSide, label }) => ({
        id, from, to, fromSide, toSide, label,
      })),
    },
    null,
    2,
  );
}

// Parses and checks a diagram file. Throws an Error with a message
// students can understand if the file is not a usable diagram.
export function fromJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This file is not a flow diagram.');
  }
  if (!data || data.format !== FORMAT || !Array.isArray(data.shapes)) {
    throw new Error('This file is not a flow diagram.');
  }
  if (data.version > VERSION) {
    throw new Error('This diagram was made by a newer version of the editor. Reload the page and try again.');
  }

  const diagram = emptyDiagram();
  const ids = new Set();
  for (const s of data.shapes) {
    // Early test versions had one "dashed" box for loop bodies and
    // function calls; it held text, so it is closest to a function block.
    const type = s?.type === 'dashed' ? 'function' : s?.type;
    if (!s || !SHAPE_TYPES[type] || typeof s.id !== 'string' || ids.has(s.id)) continue;
    ids.add(s.id);
    const shape = {
      id: s.id,
      type,
      x: Number(s.x) || 0,
      y: Number(s.y) || 0,
      text: typeof s.text === 'string' ? s.text : '',
    };
    if (Number(s.w) > 0 && Number(s.h) > 0) {
      shape.w = Number(s.w);
      shape.h = Number(s.h);
    }
    diagram.shapes.push(shape);
  }
  for (const a of Array.isArray(data.arrows) ? data.arrows : []) {
    if (!a || typeof a.id !== 'string' || ids.has(a.id)) continue;
    if (!findShape(diagram, a.from) || !findShape(diagram, a.to) || a.from === a.to) continue;
    ids.add(a.id);
    diagram.arrows.push({
      id: a.id,
      from: a.from,
      to: a.to,
      fromSide: SIDES.includes(a.fromSide) ? a.fromSide : null,
      toSide: SIDES.includes(a.toSide) ? a.toSide : null,
      label: typeof a.label === 'string' ? a.label : '',
    });
  }
  return diagram;
}
