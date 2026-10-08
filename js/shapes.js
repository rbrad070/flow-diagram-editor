// Shape definitions and geometry.
//
// Units are CSS pixels at 96 dpi, so 1 cm = 37.8 px and 1 pt = 1.333 px.
// Exports convert back to cm/pt, so exported diagrams have the same
// physical size as the course's TikZ diagrams.
//
// Each shape is stored as { id, type, x, y, text, w?, h? } where (x, y) is
// its centre. Its size follows the TikZ rules: grow to fit the text, but
// never smaller than the style's minimum width/height. w / h are an
// optional size set by resizing; a shape is never smaller than its text.

export const CM = 96 / 2.54;
export const PT = 96 / 72;

export const FONT_SIZE = 10 * PT;          // \ttfamily at 10pt
export const CHAR_W = 0.6 * FONT_SIZE;     // Courier-style monospace advance
export const LINE_H = 1.2 * FONT_SIZE;
export const FONT_FAMILY = '"Courier New", Cousine, "Liberation Mono", Courier, monospace';

const INNER_SEP = 0.3333 * FONT_SIZE;      // TikZ default inner sep (.3333em)
const THIN = 0.4 * PT;                     // TikZ default line width
const THICK = 0.8 * PT;                    // TikZ "thick"
export const ARROW_WIDTH = THICK;

const FUNCTION_BAR = 0.25 * CM;            // inset of the function block's side bars
const LOOP_PAD = 6;                        // loop body label inset

export const SHAPE_TYPES = {
  startstop: {
    name: 'Start / Stop',
    fill: '#E6E6FF',          // blue!10
    strokeWidth: THICK,
    defaultText: 'Start',
  },
  process: {
    name: 'Process',
    fill: '#FFE6CC',          // orange!20
    strokeWidth: THIN,
    defaultText: '',
  },
  io: {
    name: 'Input / Output',
    fill: '#FFE6CC',
    strokeWidth: THICK,
    defaultText: '',
  },
  decision: {
    name: 'Decision',
    fill: '#FFFFFF',          // white!10
    strokeWidth: THIN,
    defaultText: '',
  },
  loopbody: {
    // A dashed boundary drawn around the shapes in a loop body.
    name: 'Loop body',
    fill: null,
    strokeWidth: THICK,
    dashed: true,
    container: true,
    defaultText: '',
    defaultSize: { w: 5 * CM, h: 4 * CM },
  },
  function: {
    // Function call: "predefined process" box with double side lines.
    name: 'Function',
    fill: '#CCFFCC',          // green!20
    strokeWidth: THIN,
    defaultText: '',
  },
};

export const SIDES = ['n', 's', 'e', 'w'];
export const DIR = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

export function isContainer(shape) {
  return !!SHAPE_TYPES[shape.type]?.container;
}

export function textLines(text) {
  return String(text ?? '').split('\n');
}

function textBox(text, minChars = 0) {
  const lines = textLines(text);
  const chars = Math.max(minChars, ...lines.map((l) => l.length));
  return { w: chars * CHAR_W, h: lines.length * LINE_H };
}

// The smallest size a shape can be: big enough for its text, and at
// least the TikZ style's minimum size.
export function naturalSize(shape) {
  switch (shape.type) {
    case 'startstop': {
      // TikZ ellipse: circumscribes the text box (scaled by sqrt 2).
      const t = textBox(shape.text);
      return {
        W: Math.max(2.8 * CM, Math.SQRT2 * (t.w + 2 * INNER_SEP)),
        H: Math.max(1.2 * CM, Math.SQRT2 * (t.h + 2 * INNER_SEP)),
      };
    }
    case 'io': {
      // TikZ trapezium, left angle 70, right angle 110: a parallelogram
      // leaning right. inner xsep 8pt, inner ysep 6pt, no minimum size
      // (a short minimum keeps an empty shape easy to click).
      const t = textBox(shape.text, 4);
      const H = t.h + 2 * 6 * PT;
      return { W: t.w + 2 * 8 * PT + 2 * ioSlant(H), H };
    }
    case 'decision': {
      // TikZ diamond with aspect=2: half-width = x + 2y, half-height = y + x/2.
      const t = textBox(shape.text, 5);
      const w = t.w + 2 * INNER_SEP;
      const h = t.h + 2 * INNER_SEP;
      return { W: w + 2 * h, H: h + w / 2 };
    }
    case 'loopbody': {
      const t = textBox(shape.text);
      return { W: Math.max(2 * CM, t.w + 2 * LOOP_PAD), H: Math.max(1.5 * CM, t.h + 2 * LOOP_PAD) };
    }
    case 'function': {
      const t = textBox(shape.text);
      return {
        W: Math.max(3 * CM, t.w + 2 * INNER_SEP + 2 * FUNCTION_BAR),
        H: Math.max(1 * CM, t.h + 2 * INNER_SEP),
      };
    }
    case 'process':
    default: {
      const t = textBox(shape.text);
      return { W: Math.max(3 * CM, t.w + 2 * INNER_SEP), H: Math.max(1 * CM, t.h + 2 * INNER_SEP) };
    }
  }
}

function ioSlant(H) {
  return H / Math.tan((70 * Math.PI) / 180);
}

// Returns the geometry of a shape: its size, outline, connection ports
// and where its text goes.
export function geometry(shape) {
  const { x, y } = shape;
  const nat = naturalSize(shape);
  const W = Math.max(nat.W, shape.w || 0);
  const H = Math.max(nat.H, shape.h || 0);
  const l = x - W / 2, r = x + W / 2, top = y - H / 2, bot = y + H / 2;
  let outline;
  let lines = [];          // extra lines drawn inside the shape
  let slant = 0;
  let text = textLayout(shape.text, x, y);

  switch (shape.type) {
    case 'startstop':
      outline = { kind: 'ellipse', cx: x, cy: y, rx: W / 2, ry: H / 2 };
      break;
    case 'io':
      slant = ioSlant(H);
      outline = { kind: 'polygon', points: [[l, bot], [r - slant, bot], [r, top], [l + slant, top]] };
      break;
    case 'decision':
      outline = { kind: 'polygon', points: [[x, top], [r, y], [x, bot], [l, y]] };
      break;
    case 'loopbody':
      outline = { kind: 'polygon', points: [[l, top], [r, top], [r, bot], [l, bot]] };
      // Label in the top-left corner, out of the way of the shapes inside.
      text = textLines(shape.text).map((line, i) => ({
        text: line,
        x: l + LOOP_PAD,
        y: top + LOOP_PAD + i * LINE_H + 0.8 * FONT_SIZE,
        anchor: 'start',
      }));
      break;
    case 'function':
      outline = { kind: 'polygon', points: [[l, top], [r, top], [r, bot], [l, bot]] };
      lines = [
        [[l + FUNCTION_BAR, top], [l + FUNCTION_BAR, bot]],
        [[r - FUNCTION_BAR, top], [r - FUNCTION_BAR, bot]],
      ];
      break;
    case 'process':
    default:
      outline = { kind: 'polygon', points: [[l, top], [r, top], [r, bot], [l, bot]] };
      break;
  }

  const ports = {
    n: { x, y: top },
    s: { x, y: bot },
    e: { x: r - slant / 2, y },
    w: { x: l + slant / 2, y },
  };

  return {
    shape, W, H, outline, lines, ports, text,
    box: { left: l, top, right: r, bottom: bot },
  };
}

// Baselines for each line of text, centred in the shape.
function textLayout(text, cx, cy) {
  const lines = textLines(text);
  const top = cy - (lines.length * LINE_H) / 2;
  return lines.map((line, i) => ({
    text: line,
    x: cx,
    y: top + i * LINE_H + LINE_H / 2 + 0.33 * FONT_SIZE,
    anchor: 'middle',
  }));
}

export function textWidth(text) {
  return String(text).length * CHAR_W;
}
