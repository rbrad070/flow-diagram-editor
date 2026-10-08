# Flow Diagram Editor

A browser-based editor for drawing programming flow diagrams, built for
CPSC 100 (Introduction to Programming in C, Selkirk College). It has two
uses:

1. **Instructor demos**: drawing diagrams live on a projector in lectures
   and tutorials, and exporting diagrams for course handouts.
2. **Student use**: students draw flow diagrams for practice in
   tutorials, and export them to upload to Moodle for assignments.

Students are first-year programmers using college lab computers or their
own laptops. The editor must work with no install, no login and no
account: they open a link and start drawing.

## Hosting and stack

- Hosted on **GitHub Pages** as a static site. No server and no backend;
  everything runs in the browser.
- Prefer **plain HTML, CSS and JavaScript (ES modules) with no build
  step**, so the repo deploys to Pages as-is and stays easy to maintain.
  Add a build tool (e.g. Vite) only if a real need comes up, and say why.
- Render diagrams as **SVG**. Keep dependencies minimal; vendor any
  library you need (e.g. a PDF library) instead of relying on a CDN at
  runtime, so the editor keeps working if a CDN is blocked on the lab
  network.
- Must work in current Chrome, Edge and Firefox on Windows, macOS and
  ChromeOS. Mouse is the main input; trackpads must work too.

## Diagram notation (must match the course)

The course's existing diagrams are TikZ. The editor's shapes and look
must match them so that live demos, handouts and student work all look
the same. The TikZ styles are:

```latex
\tikzstyle{startstop} = [ellipse, draw=black, thick, align=center, minimum width=2.8cm, minimum height=1.2cm, fill=blue!10]
\tikzstyle{process}   = [rectangle, minimum width=3cm, minimum height=1cm, text centered, draw=black, fill=orange!20]
\tikzstyle{io}        = [trapezium, trapezium left angle=70, trapezium right angle=110, draw, thick, align=center, inner xsep=8pt, inner ysep=6pt, fill=orange!20]
\tikzstyle{decision}  = [diamond, aspect=2, text centered, draw=black, fill=white!10]
\tikzstyle{arrow}     = [thick,->,>=stealth]
% Added for the editor (not in the original course styles):
\tikzstyle{loopbody}  = [rectangle, draw, thick, dashed]
\tikzstyle{function}  = [rectangle, minimum width=3cm, minimum height=1cm, text centered, inner xsep=0.35cm, draw=black, fill=green!20,
                         path picture={\draw ([xshift=0.25cm]path picture bounding box.north west) -- ([xshift=0.25cm]path picture bounding box.south west);
                                       \draw ([xshift=-0.25cm]path picture bounding box.north east) -- ([xshift=-0.25cm]path picture bounding box.south east);}]
\tikzset{every node/.append style={font=\ttfamily}}
```

So, in the editor:

| Shape | Use | Look |
|---|---|---|
| Oval (`startstop`) | Start / Stop | ellipse, light blue fill (`blue!10` ≈ `#E6E6FF`) |
| Rectangle (`process`) | process, variable assignment | orange fill (`orange!20` ≈ `#FFE6CC`) |
| Parallelogram (`io`) | input / output | slanted sides, same orange fill |
| Diamond (`decision`) | condition | white fill, about twice as wide as tall |
| Loop body | boundary around the shapes in a loop body (W5) | dashed rectangle, no fill; holds process, io and decision shapes; resizable |
| Function | function call (W7) | "predefined process": rectangle with a double line at each end, light green fill (`green!20` = `#CCFFCC`) |
| Arrow | flow | solid line with a stealth arrowhead |

- All text in shapes is **monospace**.
- Decision diamonds have exactly two outgoing arrows, labelled
  **True** and **False**.
- **Loop-back arrows** run from the bottom/side of the loop body back up
  to the decision diamond. They must route cleanly around shapes with
  right-angle bends, as in the TikZ `-- ++(-2.4,0) |-` paths, never cut
  diagonally across the diagram.
- Arrow labels (True / False / "loop back") sit beside the arrow.
- Every shape can be resized, but never smaller than its text. Shapes
  inside a loop body move with it.

### Shape ladder

The course unlocks shapes week by week. The editor should support
limiting the palette to what a week allows (e.g. a setting or a URL
parameter such as `?week=4`), so students in early weeks only see the
shapes they know:

| Week | Shapes available |
|---|---|
| W1–W3 | oval, rectangle, parallelogram, arrow |
| W4 | + diamond |
| W5–W6 | + loop-back arrow, loop body |
| W7+ | full set (+ function) |

## Features, in build order

Build in milestones. Each one should leave a working, deployable editor.

1. **Core editor**: add each shape from a palette, edit its text, drag to
   move, delete; connect shapes with arrows; True/False labels on
   decision arrows; export to **PDF** and **PNG**; save and load a
   `.json` diagram file.
2. **Classroom-ready**: snap-to-grid and alignment guides, clean
   right-angle arrow routing (especially loop-backs), undo/redo, autosave
   to the browser so a closed tab does not lose work, keyboard shortcuts,
   starter templates (`if`, `while`, `do-while`, `for`), the week-based
   shape palette.
3. **Demo mode**: large, high-contrast rendering for a projector, and a
   **trace mode** that steps through the diagram highlighting the current
   shape and showing variable values, to match the course's tracing
   exercises.
4. **Later / optional**: export to TikZ using the styles above, so
   diagrams drop straight into the course's `.tex` handouts; checking a
   student diagram against an answer key.

## Student submission rules

- In tutorials, students draw diagrams for practice and do not hand them
  in. In assignments, they export a diagram and upload it to Moodle.
- The editor does **not** impose a filename format. On export, students
  type their own filename (default to something simple like
  `diagram.pdf`); the assignment sheet tells them what to call it.
- **Embed the diagram's JSON in every exported PDF/SVG** (e.g. as PDF
  metadata or an attached file). This lets the instructor reopen a
  submission in the editor and makes automatic checking possible later.
- Diagrams are graded on: (1) every step matches the student's actual
  code; (2) correct flowchart symbols; (3) one box per meaningful step,
  not one box per line of code; (4) legible, accurate labels. The editor
  should make these easy to get right (clear shapes, readable text) but
  must not do the student's thinking for them: no auto-generating a
  diagram from code.

## Non-goals

- No accounts, no server-side storage, no collaboration features.
- No generating diagrams from C code.
- Not a general-purpose diagramming tool: only the shapes above.

## Writing style for anything students read

- The course's weekly sessions are **tutorials**, never "labs".
- Plain, short wording; students are beginners and many are not native
  English speakers.
