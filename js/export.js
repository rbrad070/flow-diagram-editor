// Export to SVG / PNG / PDF, and reading diagrams back from those files.
// Every export carries the diagram's JSON so it can be reopened.

import { CM } from './shapes.js';
import { fromJSON, toJSON } from './model.js';
import { SVG_NS, buildScene, drawScene, el, sceneBounds } from './render.js';
import { buildPDF, extractJSONFromPDF } from './pdf.js';
import { addPNGMetadata, extractJSONFromPNG } from './png.js';

const MARGIN = 0.3 * CM;
const PNG_DPI = 300;
const MAX_PNG_SIDE = 8000;
const METADATA_ID = 'cpsc100-flow-diagram';

function exportBounds(scene) {
  const b = sceneBounds(scene) || { left: 0, top: 0, right: 3 * CM, bottom: 2 * CM };
  return {
    left: b.left - MARGIN,
    top: b.top - MARGIN,
    right: b.right + MARGIN,
    bottom: b.bottom + MARGIN,
  };
}

export function exportSVG(diagram) {
  const scene = buildScene(diagram);
  const b = exportBounds(scene);
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', `${(w / CM).toFixed(3)}cm`);
  svg.setAttribute('height', `${(h / CM).toFixed(3)}cm`);
  svg.setAttribute('viewBox', `${b.left} ${b.top} ${w} ${h}`);
  const meta = el('metadata', { id: METADATA_ID }, svg);
  meta.textContent = toJSON(diagram);
  el('rect', { x: b.left, y: b.top, width: w, height: h, fill: '#fff' }, svg);
  drawScene(svg, scene);
  return {
    text: '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg),
    width: w,
    height: h,
  };
}

export async function exportPNG(diagram) {
  const svg = exportSVG(diagram);
  let scale = PNG_DPI / 96;
  scale = Math.min(scale, MAX_PNG_SIDE / svg.width, MAX_PNG_SIDE / svg.height);

  const url = URL.createObjectURL(new Blob([svg.text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(svg.width * scale);
    canvas.height = Math.round(svg.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return new Blob([addPNGMetadata(bytes, toJSON(diagram), 96 * scale)], { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function exportPDF(diagram, title) {
  const scene = buildScene(diagram);
  const bytes = buildPDF(scene, exportBounds(scene), toJSON(diagram), { title });
  return new Blob([bytes], { type: 'application/pdf' });
}

function extractJSONFromSVG(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  return doc.getElementById(METADATA_ID)?.textContent ?? null;
}

// Reads a diagram from a .json file, or from a PDF / PNG / SVG exported
// by the editor. Throws an Error with a student-friendly message.
export async function readDiagramFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = new TextDecoder().decode(bytes.subarray(0, 5));
  let json;
  if (head === '%PDF-') {
    json = extractJSONFromPDF(bytes);
  } else if (bytes[0] === 137 && head.slice(1, 4) === 'PNG') {
    json = extractJSONFromPNG(bytes);
  } else {
    const text = new TextDecoder().decode(bytes);
    json = /^\s*</.test(text) ? extractJSONFromSVG(text) : text;
  }
  if (json === null) {
    throw new Error('This file has no diagram inside it. Only files exported from this editor can be opened.');
  }
  return fromJSON(json);
}
