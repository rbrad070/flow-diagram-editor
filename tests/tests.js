// Browser tests. Open tests/index.html through a local web server, e.g.
//   python3 -m http.server   then   http://localhost:8000/tests/
// (ES modules do not load from file:// URLs.)

import { CM, SHAPE_TYPES, geometry, naturalSize } from '../js/shapes.js';
import * as M from '../js/model.js';
import { buildScene, labelBox } from '../js/render.js';
import { exportPDF, exportPNG, exportSVG, readDiagramFile } from '../js/export.js';
import { extractJSONFromPDF, pdfString } from '../js/pdf.js';
import { extractJSONFromPNG } from '../js/png.js';

const results = [];
async function test(name, fn) {
  let r;
  try {
    await fn();
    r = { name, ok: true };
  } catch (err) {
    r = { name, ok: false, err };
  }
  results.push(r);
  const li = document.createElement('li');
  li.className = r.ok ? 'pass' : 'fail';
  li.textContent = (r.ok ? 'PASS ' : 'FAIL ') + name + (r.ok ? '' : ' — ' + r.err.message);
  document.getElementById('results').appendChild(li);
}
function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

// A while loop, as drawn in the course: a dashed loop body around the
// body's shapes, and a loop-back arrow from the loop body around to the
// decision.
export function whileLoop() {
  const d = M.emptyDiagram();
  const start = M.addShape(d, 'startstop', 0, 0, 'Start');
  const init = M.addShape(d, 'process', 0, 2 * CM, 'i = 0');
  const cond = M.addShape(d, 'decision', 0, 4.2 * CM, 'i < 5');
  const body = M.addShape(d, 'loopbody', 0, 7.4 * CM, '');
  Object.assign(body, { w: 4.4 * CM, h: 3.6 * CM });
  const print = M.addShape(d, 'io', 0, 6.6 * CM, 'Print i');
  const inc = M.addShape(d, 'process', 0, 8.3 * CM, 'i = i + 1');
  const stop = M.addShape(d, 'startstop', 5 * CM, 4.2 * CM, 'Stop');
  M.addArrow(d, start.id, init.id);
  M.addArrow(d, init.id, cond.id);
  M.addArrow(d, cond.id, print.id);   // True
  M.addArrow(d, print.id, inc.id);
  const back = M.addArrow(d, body.id, cond.id);
  back.label = 'loop back';
  M.addArrow(d, cond.id, stop.id);    // False
  return d;
}

function segmentCrossesBox(p, q, b) {
  const minX = Math.min(p.x, q.x), maxX = Math.max(p.x, q.x);
  const minY = Math.min(p.y, q.y), maxY = Math.max(p.y, q.y);
  return maxX > b.left + 1 && minX < b.right - 1 && maxY > b.top + 1 && minY < b.bottom - 1;
}

await test('process box is at least 3cm x 1cm', () => {
  const g = geometry({ type: 'process', x: 0, y: 0, text: 'x = 1' });
  assert(near(g.W, 3 * CM) && near(g.H, 1 * CM), `got ${g.W} x ${g.H}`);
});

await test('start/stop oval is at least 2.8cm x 1.2cm', () => {
  const g = geometry({ type: 'startstop', x: 0, y: 0, text: 'Start' });
  assert(near(g.W, 2.8 * CM) && near(g.H, 1.2 * CM), `got ${g.W} x ${g.H}`);
});

await test('decision diamond is twice as wide as tall', () => {
  const g = geometry({ type: 'decision', x: 0, y: 0, text: 'count <= 10' });
  assert(Math.abs(g.W / g.H - 2) < 0.4, `ratio ${g.W / g.H}`);
});

await test('shapes grow to fit long and multi-line text', () => {
  const short = geometry({ type: 'process', x: 0, y: 0, text: 'x' });
  const long = geometry({ type: 'process', x: 0, y: 0, text: 'total = total + price * quantity' });
  const multi = geometry({ type: 'process', x: 0, y: 0, text: 'a = 1\nb = 2\nc = 3' });
  assert(long.W > short.W, 'long text should be wider');
  assert(multi.H > short.H, 'three lines should be taller');
});

await test('input/output parallelogram leans right', () => {
  const g = geometry({ type: 'io', x: 0, y: 0, text: 'Print x' });
  const [bl, br, tr, tl] = g.outline.points;
  assert(tl[0] > bl[0] && tr[0] > br[0], 'top edge should be shifted right');
});

await test('function block is green with double side lines', () => {
  const g = geometry({ type: 'function', x: 0, y: 0, text: 'printTotal(t)' });
  assert(SHAPE_TYPES.function.fill === '#CCFFCC');
  assert(g.lines.length === 2, 'two side lines');
  assert(g.lines[0][0][0] > g.box.left && g.lines[1][0][0] < g.box.right, 'lines are inside the box');
});

await test('loop body is an unfilled dashed boundary', () => {
  const t = SHAPE_TYPES.loopbody;
  assert(t.fill === null && t.dashed && t.container);
  const d = M.emptyDiagram();
  const b = M.addShape(d, 'loopbody', 0, 0);
  assert(b.w > 0 && b.h > 0, 'new loop body has a size');
});

await test('resized shapes keep their size but never get smaller than their text', () => {
  const big = geometry({ type: 'process', x: 0, y: 0, text: 'x = 1', w: 200, h: 90 });
  assert(near(big.W, 200) && near(big.H, 90), `got ${big.W} x ${big.H}`);
  const text = 'a very long line of text in a box';
  const small = geometry({ type: 'process', x: 0, y: 0, text, w: 10, h: 10 });
  const nat = naturalSize({ type: 'process', text });
  assert(near(small.W, nat.W) && near(small.H, nat.H), 'should not shrink below its text');
});

await test('decision arrows are labelled True then False, and a third is refused', () => {
  const d = M.emptyDiagram();
  const c = M.addShape(d, 'decision', 0, 0, 'x > 0');
  const a = M.addShape(d, 'process', 0, 100);
  const b = M.addShape(d, 'process', 200, 0);
  const e = M.addShape(d, 'process', -200, 0);
  assert(M.addArrow(d, c.id, a.id).label === 'True');
  assert(M.addArrow(d, c.id, b.id).label === 'False');
  assert(M.arrowProblem(d, c.id, e.id), 'third arrow should be refused');
  M.swapTrueFalse(d, c.id);
  assert(d.arrows[0].label === 'False' && d.arrows[1].label === 'True', 'swap');
  M.removeArrow(d, d.arrows[1].id);
  assert(M.addArrow(d, c.id, b.id).label === 'True', 'refills the missing label');
});

await test('arrows to itself or duplicates are refused', () => {
  const d = M.emptyDiagram();
  const a = M.addShape(d, 'process', 0, 0);
  const b = M.addShape(d, 'process', 0, 100);
  assert(M.arrowProblem(d, a.id, a.id));
  M.addArrow(d, a.id, b.id);
  assert(M.arrowProblem(d, a.id, b.id));
});

await test('deleting a shape deletes its arrows', () => {
  const d = whileLoop();
  const cond = d.shapes.find((s) => s.type === 'decision');
  M.removeShape(d, cond.id);
  assert(d.arrows.every((a) => a.from !== cond.id && a.to !== cond.id));
  assert(d.arrows.length === 2, `got ${d.arrows.length}`);
});

await test('lined-up shapes get a straight arrow', () => {
  const d = M.emptyDiagram();
  const a = M.addShape(d, 'process', 0, 0, 'a = 1');
  const b = M.addShape(d, 'process', 0, 3 * CM, 'b = 2');
  M.addArrow(d, a.id, b.id);
  const s = buildScene(d);
  assert(s.arrows[0].points.length === 2, `got ${s.arrows[0].points.length} points`);
});

// if / else: True goes down, False goes right, both join up again.
export function ifElse() {
  const d = M.emptyDiagram();
  const cond = M.addShape(d, 'decision', 0, 0, 'x > 0');
  const yes = M.addShape(d, 'io', 0, 2.2 * CM, 'Print "positive"');
  const no = M.addShape(d, 'io', 6 * CM, 2.2 * CM, 'Print "not positive"');
  const after = M.addShape(d, 'startstop', 0, 4.4 * CM, 'Stop');
  M.addArrow(d, cond.id, yes.id);
  M.addArrow(d, cond.id, no.id);
  M.addArrow(d, yes.id, after.id);
  M.addArrow(d, no.id, after.id);
  return d;
}

function checkClean(d) {
  const scene = buildScene(d);
  for (const a of scene.arrows) {
    const pts = a.points;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      assert(near(p.x, q.x, 0.01) || near(p.y, q.y, 0.01), `diagonal segment in ${a.arrow.id}`);
      for (const g of scene.geo.values()) {
        const own = g.shape.id === a.arrow.from || g.shape.id === a.arrow.to;
        // Arrows may cross a loop body's boundary to reach shapes inside.
        if (SHAPE_TYPES[g.shape.type].container && !own) continue;
        // Own shapes: only the first/last segment may touch them.
        if (own && (i === 1 || i === pts.length - 1)) continue;
        assert(!segmentCrossesBox(p, q, g.box), `${a.arrow.id} crosses ${g.shape.id}`);
      }
    }
  }
  return scene;
}

await test('while loop: arrows use right angles only and never cross a shape', () => {
  checkClean(whileLoop());
});

await test('if / else: arrows use right angles only and never cross a shape', () => {
  const scene = checkClean(ifElse());
  const f = scene.arrows.find((a) => a.arrow.label === 'False');
  assert(f.fromSide === 'e', `False leaves from ${f.fromSide}`);
});

await test('False arrow to a shape on the right is one straight line', () => {
  const scene = buildScene(whileLoop());
  const f = scene.arrows.find((a) => a.arrow.label === 'False');
  assert(f.points.length === 2, `got ${f.points.length} points`);
});

await test('loop-back arrow does not share a line with another arrow', () => {
  const scene = buildScene(whileLoop());
  const back = scene.arrows.find((a) => a.arrow.label === 'loop back');
  assert(back.toSide === 'w' || back.toSide === 'e', `enters from ${back.toSide}`);
  const f = scene.arrows.find((a) => a.arrow.label === 'False');
  assert(back.toSide !== f.fromSide, 'enters where False leaves');
});

await test('loop-back arrow goes around the loop body to the decision', () => {
  const d = whileLoop();
  const scene = buildScene(d);
  const back = scene.arrows.find((a) => a.arrow.label === 'loop back');
  const trueArrow = scene.arrows.find((a) => a.arrow.label === 'True');
  assert(back.points.length >= 4, 'should have bends');
  assert(back.toSide !== trueArrow.fromSide, 'should not enter where True leaves');
  assert(back.fromSide !== 'n', 'should not leave the loop body through its top');
});

await test('arrow labels do not cover shapes', () => {
  for (const d of [whileLoop(), ifElse()]) {
    const scene = buildScene(d);
    for (const a of scene.arrows) {
      if (!a.label) continue;
      const b = labelBox(a.label);
      for (const g of scene.geo.values()) {
        if (SHAPE_TYPES[g.shape.type].container) continue;
        const hit = b.left < g.box.right && b.right > g.box.left && b.top < g.box.bottom && b.bottom > g.box.top;
        assert(!hit, `"${a.label.text}" covers ${g.shape.text}`);
      }
    }
  }
});

await test('decision True/False arrows leave from different sides', () => {
  const scene = buildScene(whileLoop());
  const t = scene.arrows.find((a) => a.arrow.label === 'True');
  const f = scene.arrows.find((a) => a.arrow.label === 'False');
  assert(t.fromSide !== f.fromSide, `${t.fromSide} / ${f.fromSide}`);
});

await test('JSON keeps resized shapes and opens old "dashed" boxes as functions', () => {
  const d = M.fromJSON(JSON.stringify({
    format: M.FORMAT, version: 1,
    shapes: [
      { id: 's1', type: 'process', x: 0, y: 0, text: 'a', w: 200, h: 80 },
      { id: 's2', type: 'dashed', x: 0, y: 100, text: 'f()' },
    ],
    arrows: [],
  }));
  assert(d.shapes[0].w === 200 && d.shapes[0].h === 80, 'size kept');
  assert(d.shapes[1].type === 'function', 'dashed -> function');
  assert(M.toJSON(M.fromJSON(M.toJSON(d))) === M.toJSON(d));
});

await test('JSON save and load keeps the diagram', () => {
  const d = whileLoop();
  const back = M.fromJSON(M.toJSON(d));
  assert(M.toJSON(back) === M.toJSON(d));
});

await test('loading rejects files that are not diagrams', () => {
  for (const bad of ['', 'hello', '{}', '{"format":"other","shapes":[]}', '[1,2]']) {
    let threw = false;
    try { M.fromJSON(bad); } catch { threw = true; }
    assert(threw, `accepted ${JSON.stringify(bad)}`);
  }
});

await test('loading drops broken shapes and arrows', () => {
  const d = M.fromJSON(JSON.stringify({
    format: M.FORMAT, version: 1,
    shapes: [{ id: 's1', type: 'process', x: 0, y: 0, text: 'ok' }, { id: 's2', type: 'cloud' }],
    arrows: [{ id: 'a1', from: 's1', to: 's2' }],
  }));
  assert(d.shapes.length === 1 && d.arrows.length === 0);
});

await test('PDF strings escape brackets and non-ASCII text', () => {
  assert(pdfString('f(x)') === '(f\\(x\\))');
  assert(pdfString('a\\b') === '(a\\\\b)');
  assert(pdfString('café') === '(caf\\351)');
  assert(pdfString('x ≤ 3') === '(x ? 3)');
});

const d = whileLoop();
d.shapes[1].text = 'i = 0\n// "quoted" (brackets) café';
const json = M.toJSON(d);

await test('PDF export contains the diagram JSON', async () => {
  const blob = exportPDF(d, 'test');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert(extractJSONFromPDF(bytes) === json, 'JSON mismatch');
  const back = await readDiagramFile(new File([blob], 'x.pdf'));
  assert(M.toJSON(back) === json);
  document.getElementById('sample-pdf').textContent = btoa(String.fromCharCode(...bytes));
  const ifBytes = new Uint8Array(await exportPDF(ifElse(), 'if').arrayBuffer());
  document.getElementById('sample-ifelse').textContent = btoa(String.fromCharCode(...ifBytes));
});

await test('PNG export contains the diagram JSON', async () => {
  const blob = await exportPNG(d);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert(extractJSONFromPNG(bytes) === json, 'JSON mismatch');
  const back = await readDiagramFile(new File([blob], 'x.png'));
  assert(M.toJSON(back) === json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  document.getElementById('sample-png').textContent = btoa(bin);
});

await test('SVG export contains the diagram JSON', async () => {
  const svg = exportSVG(d).text;
  const back = await readDiagramFile(new File([svg], 'x.svg'));
  assert(M.toJSON(back) === json);
  document.getElementById('sample-svg').textContent = svg;
});

await test('opening a non-diagram file gives a clear message', async () => {
  let msg = '';
  try { await readDiagramFile(new File(['%PDF-1.4 nothing here'], 'x.pdf')); } catch (e) { msg = e.message; }
  assert(/no diagram/.test(msg), msg);
});

const failed = results.filter((r) => !r.ok);
document.getElementById('summary').textContent =
  failed.length ? `${failed.length} of ${results.length} tests FAILED` : `All ${results.length} tests passed`;
document.body.dataset.done = 'true';
