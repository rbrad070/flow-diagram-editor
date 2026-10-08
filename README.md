# Flow Diagram Editor

A browser-based editor for drawing flow diagrams in CPSC 100
(Introduction to Programming in C). Students open the link and start
drawing. They do not need to install anything, log in or make an account.

Shapes and styles match the course's TikZ diagrams: start/stop ovals,
process boxes, input/output parallelograms, decision diamonds, and
stealth arrows. All text is monospace. There are also a dashed loop body
boundary and a green function block.

## Using it

- **Add a shape**: click it in the palette (it goes under the selected
  shape) or drag it onto the diagram. Type its text, then press Enter.
  Use Shift+Enter for a new line.
- **Edit text**: double-click a shape, or select it and press Enter.
- **Draw an arrow**: point at a shape to see its blue dots, then drag
  from a dot to another shape. The first arrow out of a decision is
  labelled True, the second False. Double-click a decision arrow to swap
  them.
- **Label an arrow** (e.g. "loop back"): double-click it.
- **Move**: drag a shape. It snaps into line with nearby shapes.
- **Resize**: select a shape and drag a corner. **Reset size** undoes it.
- **Loop body**: a dashed boundary. Select it and click a shape in the
  palette to add that shape inside it. Shapes inside move with it. Draw
  the loop-back arrow from the loop body to the decision.
- **Delete**: select a shape or arrow and press Delete.
- **Zoom and move around**: pinch or Ctrl + scroll to zoom. Scroll or
  drag the background to move around.
- **Save… / Open…**: save a `.json` file and open it again later.
- **Export PDF / PNG / SVG**: the student types the file name. Every
  export also stores the diagram inside the file, so **Open…** can load
  an exported PDF, PNG or SVG back into the editor.

## Hosting on GitHub Pages

There is no build step. In the repository settings, under **Pages**, set
the source to "Deploy from a branch", choose `main` and `/ (root)`. The
editor is then at `https://<user>.github.io/<repo>/`.

To run it locally, serve the folder with any static web server, e.g.:

```sh
python3 -m http.server
```

then open <http://localhost:8000/>. (Opening `index.html` directly from
disk does not work, because browsers block ES modules on `file://`.)

## Tests

With the local server running, open <http://localhost:8000/tests/>.
The page runs the tests and shows pass/fail for each one.

## Files

| File | What it does |
|---|---|
| `index.html`, `css/editor.css` | Page layout and styles |
| `js/main.js` | The editor: palette, mouse input, text editing, files |
| `js/shapes.js` | Shape styles and sizes (follows the TikZ styles) |
| `js/model.js` | Diagram data and the `.json` file format |
| `js/routing.js` | Right-angle arrow routing |
| `js/render.js` | Draws a diagram as SVG |
| `js/pdf.js` | PDF writer (no library needed) with the diagram attached |
| `js/png.js` | Stores the diagram inside PNG files |
| `js/export.js` | Export to SVG / PNG / PDF and reading them back |
