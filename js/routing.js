// Right-angle arrow routing.
//
// For each arrow we try every allowed pair of sides (n/s/e/w) and a set of
// candidate paths with up to three bends, then keep the cheapest. Paths
// that cross a shape cost a lot, so arrows (especially loop-backs) go
// around shapes instead of through them, like the TikZ "-- ++(-2.4,0) |-"
// paths in the course diagrams.

import { DIR, SIDES, geometry, isContainer } from './shapes.js';

const STUB = 14;        // straight run out of / into a shape before bending
const MARGIN = 18;      // clearance when going around a shape
const ALIGN_TOL = 3;    // treat near-aligned ports as aligned

// Cost weights.
const HIT = 10000;
const PORT_CLASH = 400;
const OVERLAP = 300;
const BEND = 20;
const SIDE_COST = {
  from: { s: 0, e: 6, w: 6, n: 30 },
  to: { n: 0, e: 6, w: 6, s: 30 },
};

export function layoutShapes(diagram) {
  const geo = new Map();
  for (const s of diagram.shapes) geo.set(s.id, geometry(s));
  return geo;
}

// Routes every arrow. Returns Map(arrowId -> { points, fromSide, toSide }).
export function routeAll(diagram, geo = layoutShapes(diagram)) {
  const routes = new Map();
  // Ports used so far: key "shapeId:side" -> list of "in" | "out".
  const used = new Map();
  const use = (id, side, dir) => {
    const k = id + ':' + side;
    if (!used.has(k)) used.set(k, []);
    used.get(k).push(dir);
  };

  // Arrows with fixed sides claim their ports first.
  for (const a of diagram.arrows) {
    if (a.fromSide) use(a.from, a.fromSide, 'out');
    if (a.toSide) use(a.to, a.toSide, 'in');
  }

  const boxes = [...geo.values()].map((g) => ({ id: g.shape.id, container: isContainer(g.shape), ...g.box }));
  const segments = [];   // segments of arrows routed so far

  // Route the main downward / sideways flow first, and arrows that go
  // back up (loop-backs) last, so loop-backs fit around the main flow.
  const goesUp = (a) => geo.get(a.to)?.box.bottom < geo.get(a.from)?.box.top;
  const order = [...diagram.arrows.filter((a) => !goesUp(a)), ...diagram.arrows.filter(goesUp)];

  for (const a of order) {
    const from = geo.get(a.from);
    const to = geo.get(a.to);
    if (!from || !to) continue;
    const clash = (id, side, dir) => {
      const list = used.get(id + ':' + side) || [];
      // Two arrows coming in at one port is a normal merge. Anything else
      // (in + out, or two out) at the same port is confusing.
      return list.some((d) => d === 'out' || dir === 'out') ? list.length : 0;
    };
    const best = routeOne(from, to, a.fromSide, a.toSide, boxes, segments, clash);
    routes.set(a.id, best);
    for (let i = 1; i < best.points.length; i++) segments.push([best.points[i - 1], best.points[i], a.to]);
    if (!a.fromSide) use(a.from, best.fromSide, 'out');
    if (!a.toSide) use(a.to, best.toSide, 'in');
  }
  return routes;
}

function routeOne(from, to, fromSide, toSide, boxes, segments, clash) {
  let best = null;
  for (const fs of fromSide ? [fromSide] : SIDES) {
    for (const ts of toSide ? [toSide] : SIDES) {
      let extra = 0;
      if (!fromSide) extra += SIDE_COST.from[fs] + PORT_CLASH * clash(from.shape.id, fs, 'out');
      if (!toSide) extra += SIDE_COST.to[ts] + PORT_CLASH * clash(to.shape.id, ts, 'in');
      if (best && extra >= best.cost) continue;
      for (const points of candidates(from, fs, to, ts, boxes)) {
        const cost = extra + pathCost(points, from, to, boxes, segments);
        if (!best || cost < best.cost) best = { points, fromSide: fs, toSide: ts, cost };
      }
    }
  }
  return best;
}

function candidates(from, fs, to, ts, boxes) {
  const p1 = { ...from.ports[fs] };
  let p2 = { ...to.ports[ts] };
  const [dx1, dy1] = DIR[fs];
  const [dx2, dy2] = DIR[ts];

  // Nearly lined up and facing each other: draw one straight line.
  if (dx1 === -dx2 && dy1 === -dy2) {
    if (dx1 === 0 && Math.abs(p1.x - p2.x) <= ALIGN_TOL && (p2.y - p1.y) * dy1 > 0) {
      return [[p1, { x: p1.x, y: p2.y }]];
    }
    if (dy1 === 0 && Math.abs(p1.y - p2.y) <= ALIGN_TOL && (p2.x - p1.x) * dx1 > 0) {
      return [[p1, { x: p2.x, y: p1.y }]];
    }
  }

  const a = { x: p1.x + dx1 * STUB, y: p1.y + dy1 * STUB };
  const b = { x: p2.x + dx2 * STUB, y: p2.y + dy2 * STUB };

  const xs = new Set([(a.x + b.x) / 2, a.x, b.x]);
  const ys = new Set([(a.y + b.y) / 2, a.y, b.y]);
  for (const box of boxes) {
    xs.add(box.left - MARGIN);
    xs.add(box.right + MARGIN);
    ys.add(box.top - MARGIN);
    ys.add(box.bottom + MARGIN);
  }

  const mids = [[{ x: a.x, y: b.y }], [{ x: b.x, y: a.y }]];
  for (const x of xs) mids.push([{ x, y: a.y }, { x, y: b.y }]);
  for (const y of ys) mids.push([{ x: a.x, y }, { x: b.x, y }]);

  const out = [];
  for (const mid of mids) {
    const pts = simplify([p1, a, ...mid, b, p2]);
    if (pts && startsAndEndsRight(pts, dx1, dy1, dx2, dy2)) out.push(pts);
  }
  return out;
}

// Removes repeated and collinear points. Returns null if the path
// doubles back on itself.
function simplify(points) {
  const pts = [];
  for (const p of points) {
    const last = pts[pts.length - 1];
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    pts.push(p);
  }
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (out.length >= 2) {
      const o = out[out.length - 2];
      const q = out[out.length - 1];
      const d1 = dirOf(o, q);
      const d2 = dirOf(q, p);
      if (d1[0] === d2[0] && d1[1] === d2[1]) {
        out[out.length - 1] = p;
        continue;
      }
      if (d1[0] === -d2[0] && d1[1] === -d2[1]) return null;
    }
    out.push(p);
  }
  // A path with a diagonal segment is not a right-angle path.
  for (let i = 1; i < out.length; i++) {
    if (Math.abs(out[i].x - out[i - 1].x) > 0.01 && Math.abs(out[i].y - out[i - 1].y) > 0.01) return null;
  }
  return out;
}

function dirOf(p, q) {
  return [Math.sign(Math.round(q.x - p.x)), Math.sign(Math.round(q.y - p.y))];
}

function startsAndEndsRight(pts, dx1, dy1, dx2, dy2) {
  const d0 = dirOf(pts[0], pts[1]);
  const dn = dirOf(pts[pts.length - 2], pts[pts.length - 1]);
  return d0[0] === dx1 && d0[1] === dy1 && dn[0] === -dx2 && dn[1] === -dy2;
}

function pathCost(pts, from, to, boxes, segments) {
  let length = 0;
  let hits = 0;
  let shared = 0;
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i - 1];
    const q = pts[i];
    length += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    for (const box of boxes) {
      const own = box.id === from.shape.id || box.id === to.shape.id;
      // Arrows cross loop body boundaries freely, unless the arrow
      // starts or ends on that loop body.
      if (box.container && !own) continue;
      // Shrink the arrow's own shapes a little so touching their port is
      // not a hit; grow the others so arrows keep clear of them.
      if (segmentHitsBox(p, q, box, own ? -1 : 4)) hits++;
    }
    for (const [r, s, target] of segments) {
      // Arrows merging into the same shape may share their last stretch.
      if (target !== to.shape.id) shared += overlap(p, q, r, s);
    }
  }
  return hits * HIT + (pts.length - 2) * BEND + length + (shared > 0 ? OVERLAP + shared * 4 : 0);
}

// Length over which two axis-aligned segments run along the same line.
function overlap(p, q, r, s) {
  const vertical = (a, b) => Math.abs(a.x - b.x) < 0.5;
  if (vertical(p, q) && vertical(r, s) && Math.abs(p.x - r.x) < 2) {
    return Math.max(0, Math.min(Math.max(p.y, q.y), Math.max(r.y, s.y)) - Math.max(Math.min(p.y, q.y), Math.min(r.y, s.y)));
  }
  if (!vertical(p, q) && !vertical(r, s) && Math.abs(p.y - r.y) < 2) {
    return Math.max(0, Math.min(Math.max(p.x, q.x), Math.max(r.x, s.x)) - Math.max(Math.min(p.x, q.x), Math.min(r.x, s.x)));
  }
  return 0;
}

function segmentHitsBox(p, q, box, pad) {
  const left = box.left - pad, right = box.right + pad;
  const top = box.top - pad, bottom = box.bottom + pad;
  const minX = Math.min(p.x, q.x), maxX = Math.max(p.x, q.x);
  const minY = Math.min(p.y, q.y), maxY = Math.max(p.y, q.y);
  return maxX > left && minX < right && maxY > top && minY < bottom;
}

// Places to draw an arrow's label, best first: beside the arrow, near its
// start for decision arrows (True / False), otherwise beside its longest
// segment. The second place is on the other side of the arrow.
export function labelPositions(points, nearStart) {
  let i = 0;
  if (!nearStart) {
    let longest = -1;
    for (let k = 1; k < points.length; k++) {
      const len = Math.abs(points[k].x - points[k - 1].x) + Math.abs(points[k].y - points[k - 1].y);
      if (len > longest) { longest = len; i = k - 1; }
    }
  }
  const p = points[i];
  const q = points[i + 1];
  const [dx, dy] = dirOf(p, q);
  const at = nearStart
    ? { x: p.x + dx * 14, y: p.y + dy * 14 }
    : { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  if (dx === 0) {
    // Vertical segment: label to the right of it, else to the left.
    return [
      { x: at.x + 5, y: at.y + 4, anchor: 'start' },
      { x: at.x - 5, y: at.y + 4, anchor: 'end' },
    ];
  }
  // Horizontal segment: label above it, else below.
  const anchor = nearStart ? (dx > 0 ? 'start' : 'end') : 'middle';
  return [
    { x: at.x, y: at.y - 5, anchor },
    { x: at.x, y: at.y + 15, anchor },
  ];
}
