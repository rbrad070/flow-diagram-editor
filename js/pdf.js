// A small PDF writer for flow diagrams. It needs no library: it draws
// the scene with PDF path operators and the built-in Courier font
// (a standard PDF font, so nothing is embedded and text stays sharp).
//
// The diagram's JSON is attached to the PDF as "diagram.json", so the
// instructor can reopen a submitted PDF in the editor.

import { FONT_SIZE, SHAPE_TYPES, isContainer, textWidth, ARROW_WIDTH } from './shapes.js';
import { DASH, drawOrder } from './render.js';

const PX_TO_PT = 72 / 96;
export const ATTACHMENT_NAME = 'diagram.json';

const n = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

function rgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => n(c / 255)).join(' ');
}

// Windows-1252 code points for characters outside Latin-1 that students
// might type. Anything else that Courier cannot show becomes "?".
const WIN_ANSI = {
  '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137,
  'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149,
  '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159,
};

export function pdfString(text) {
  let out = '(';
  for (const ch of text) {
    let code = ch.codePointAt(0);
    if (WIN_ANSI[ch]) code = WIN_ANSI[ch];
    else if (code > 255 || (code >= 128 && code < 160) || (code < 32)) code = 63; // "?"
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (code < 128) out += String.fromCharCode(code);
    else out += '\\' + code.toString(8).padStart(3, '0');
  }
  return out + ')';
}

function ellipsePath(cx, cy, rx, ry) {
  const k = 0.5522847498;
  const ox = rx * k, oy = ry * k;
  return [
    `${n(cx + rx)} ${n(cy)} m`,
    `${n(cx + rx)} ${n(cy + oy)} ${n(cx + ox)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} c`,
    `${n(cx - ox)} ${n(cy + ry)} ${n(cx - rx)} ${n(cy + oy)} ${n(cx - rx)} ${n(cy)} c`,
    `${n(cx - rx)} ${n(cy - oy)} ${n(cx - ox)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} c`,
    `${n(cx + ox)} ${n(cy - ry)} ${n(cx + rx)} ${n(cy - oy)} ${n(cx + rx)} ${n(cy)} c`,
    'h',
  ].join('\n');
}

function polyPath(points, close) {
  const ops = points.map(([x, y], i) => `${n(x)} ${n(y)} ${i ? 'l' : 'm'}`);
  if (close) ops.push('h');
  return ops.join('\n');
}

function text(str, x, y, anchor) {
  const w = textWidth(str);
  const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  // The page is drawn with y pointing down, so flip text back upright.
  return `BT /F1 ${n(FONT_SIZE)} Tf 1 0 0 -1 ${n(left)} ${n(y)} Tm ${pdfString(str)} Tj ET`;
}

// Builds the page's drawing commands, in px units with y pointing down.
function contentStream(scene) {
  const ops = ['0 0 0 RG', '0 J', '0 j'];

  const drawShape = (g) => {
    const style = SHAPE_TYPES[g.shape.type];
    ops.push(`${n(style.strokeWidth)} w`, style.dashed ? `[${DASH.join(' ')}] 0 d` : '[] 0 d');
    const o = g.outline;
    const path = o.kind === 'ellipse' ? ellipsePath(o.cx, o.cy, o.rx, o.ry) : polyPath(o.points, true);
    if (style.fill) ops.push(`${rgb(style.fill)} rg`, path, 'B');
    else ops.push(path, 'S');
    ops.push('[] 0 d');
    for (const line of g.lines) ops.push(polyPath(line, false), 'S');
    ops.push('0 0 0 rg');
    for (const line of g.text) {
      if (line.text) ops.push(text(line.text, line.x, line.y, line.anchor));
    }
  };

  // Same order as the screen: loop bodies, then arrows, then shapes.
  const order = drawOrder(scene);
  order.filter((g) => isContainer(g.shape)).forEach(drawShape);

  for (const a of scene.arrows) {
    ops.push(`${n(ARROW_WIDTH)} w [] 0 d`, polyPath(a.line, false), 'S');
    ops.push('0 0 0 rg', polyPath(a.head, true), 'f');
    if (a.label) ops.push('0 0 0 rg', text(a.label.text, a.label.x, a.label.y, a.label.anchor));
  }

  order.filter((g) => !isContainer(g.shape)).forEach(drawShape);
  return ops.join('\n');
}

function pdfDate(d) {
  const p = (v) => String(v).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

// Returns the PDF file as a Uint8Array. `bounds` is the area to show, in
// px; the page is that size (so the diagram prints at its real size).
export function buildPDF(scene, bounds, json, { title = 'Flow diagram', date = new Date() } = {}) {
  const enc = new TextEncoder();
  const latin1 = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

  const W = (bounds.right - bounds.left) * PX_TO_PT;
  const H = (bounds.bottom - bounds.top) * PX_TO_PT;
  // Map px (y down) to pt (y up).
  const ctm = `${n(PX_TO_PT)} 0 0 ${n(-PX_TO_PT)} ${n(-bounds.left * PX_TO_PT)} ${n(H + bounds.top * PX_TO_PT)} cm`;
  const content = latin1(`q\n${ctm}\n${contentStream(scene)}\nQ\n`);
  const jsonBytes = enc.encode(json);
  const d = pdfDate(date);

  const objects = [
    `<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(${ATTACHMENT_NAME}) 6 0 R] >> >> /AF [6 0 R] >>`,
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(W)} ${n(H)}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    { dict: '', data: content },
    `<< /Type /Filespec /F (${ATTACHMENT_NAME}) /UF (${ATTACHMENT_NAME}) /AFRelationship /Source /Desc (Flow diagram source - open it in the flow diagram editor) /EF << /F 7 0 R /UF 7 0 R >> >>`,
    { dict: `/Type /EmbeddedFile /Subtype /application#2Fjson /Params << /Size ${jsonBytes.length} /ModDate (${d}) >> `, data: jsonBytes },
    `<< /Title ${pdfString(title)} /Producer (CPSC 100 Flow Diagram Editor) /CreationDate (${d}) >>`,
  ];

  const chunks = [];
  let offset = 0;
  const push = (bytes) => { chunks.push(bytes); offset += bytes.length; };
  push(latin1('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'));

  const offsets = [];
  objects.forEach((obj, i) => {
    offsets.push(offset);
    if (typeof obj === 'string') {
      push(latin1(`${i + 1} 0 obj\n${obj}\nendobj\n`));
    } else {
      push(latin1(`${i + 1} 0 obj\n<< ${obj.dict}/Length ${obj.data.length} >>\nstream\n`));
      push(obj.data);
      push(latin1('\nendstream\nendobj\n'));
    }
  });

  const xref = offset;
  let tail = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) tail += `${String(o).padStart(10, '0')} 00000 n \n`;
  tail += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  push(latin1(tail));

  const out = new Uint8Array(offset);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

// Finds the diagram JSON attached to a PDF made by buildPDF. Returns the
// JSON text, or null if there is none.
export function extractJSONFromPDF(bytes) {
  // Latin-1 decoding keeps one char per byte, so string offsets are byte offsets.
  const s = new TextDecoder('latin1').decode(bytes);
  const re = /\/Type\s*\/EmbeddedFile\b[^]*?\/Length\s+(\d+)\s*>>\s*stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const len = Number(m[1]);
    const header = m[0];
    if (/\/Filter/.test(header)) continue;   // compressed: not one of ours
    const text = new TextDecoder().decode(bytes.subarray(start, start + len));
    if (text.trimStart().startsWith('{')) return text;
  }
  return null;
}
