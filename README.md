# Math Notebook

A notebook for working math problems step by step, from algebra through calculus.
It works like a Jupyter notebook for math: each step goes in its own cell, text cells
go between steps, and interactive graphs sit beside the work.

## Run it

```bash
python main.py
```

You can also press **Run** on `main.py` in PyCharm. The first run builds the web UI (this needs
Node.js). After that it starts the app at <http://127.0.0.1:8642/> and opens your browser.

- Notebooks are saved in `~/MathJournal/`, one readable `.mathnb.json` file each. Folders in the app are
  ordinary folders there (e.g. `~/MathJournal/Algebra/Unit 2/Quadratics.mathnb.json`).
  Set `MATHJOURNAL_DIR` to use a different folder, or `MATHJOURNAL_PORT` to use a different port.
- Deleted notebooks and folders are moved to `~/MathJournal/.trash/` and can be recovered from there.
- After changing the frontend code, rebuild it with `cd frontend && npm run build`, or delete `frontend/dist`.

First-time setup on a new computer:

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt
cd frontend && npm install && cd ..
.venv/bin/python main.py
```

## Folders

The home page shows the folders and notebooks in the folder you're in, with a path at the top
(**All notebooks › Algebra › Unit 2**) to go back up. Click a folder to open it.

- **+ New folder** and **+ New notebook** create them in the folder you're viewing; **Import file…** imports there too.
- Each folder and notebook has a **⋯** menu: **Rename…**, **Move to…** and **Delete** (to the trash).
- Drag a notebook or folder onto another folder, or onto a part of the path at the top, to move it there.
- **Search** looks through every folder and shows where each match is.
- In a notebook, the **←** link at the top goes back to its folder.

## Writing math

Each step is a live math editor ([MathLive](https://mathlive.io)). Type the way you'd write on paper:

| Type | You get |
|---|---|
| `1/2`, or select `x+1` then `/` | a stacked fraction. Arrow keys move into the numerator and denominator to edit it |
| `x^2`, `a_1` | exponent and subscript. Press → to leave |
| `sqrt`, `pi`, `theta`, `int`, `lim`, `sum`, `infty` | √, π, θ, ∫, lim, Σ, ∞ |
| `<=`, `>=`, `!=` | ≤, ≥, ≠ |
| `(`, `[`, `\|` | brackets and absolute value that close themselves |

| Key | Action |
|---|---|
| **Enter** | next step. The previous step appears in gray as a suggested starting point |
| **→** on a gray suggestion | accept it and edit from there (or just start typing to write something new) |
| **Shift+Enter** | new step that starts as a copy of this one |
| **↑ / ↓** | move between steps (inside a fraction, these move between its top and bottom) |
| **Backspace** on an empty step | delete it |
| **Shift+↓** (or **±**) | do the same thing to both sides, written under the step (see below). **Esc** or **Shift+↑** goes back to the step |
| **Alt+Enter** | add a text cell below |
| **Option+H** (Alt+H) | add a divider (a section title) below |
| **Alt+↑ / ↓** | move a cell up or down |
| **⌘ /** or **Option /** (Ctrl+/ or Alt+/ on Windows) | comment on this step. Press it again or Esc to go back to the step. **In Safari use Option /**, because Safari keeps ⌘ / for View → Show Status Bar |
| **Esc** | finish editing a text cell |

Text cells use Markdown with `$inline math$` and `$$display math$$`. For a plain dollar sign (money in a word
problem), type `\$`: "costs \$20" shows "costs $20".
Step numbers restart after each text cell or divider, so each problem starts again at step 1.
Click **⌨︎ Keyboard** for an on-screen math keyboard.

### Writing work under a step

To show what you're doing to both sides, write it directly under the step, inside its box:

```
y + 5 = x + 3
 − 5      − 5
```

Click **±** next to the step, or put the cursor on a term (for example just after `+5`) and press **Shift+↓**.
Type the operation once, e.g. `-5`. It appears in red under **both** sides, and the two copies always match:
editing either one changes the other. **→ / ←** switch between the copies.

Each copy sits centered under a term. To line it up with a different term, **drag it left or right** (it snaps
under the nearest term on its own side of the =), or press **Option+← / →**. **Esc** or **Shift+↑** goes back
to the step, and **Enter** goes on to the next step. ± only appears on steps with an =, <, >, ≤, ≥ or ≠.

The next step's gray suggestion is the **result** of the operation, simplified: after `−3` under
`2x + 3 = 5x − 8`, Enter suggests `2x = 5x − 11` (press **→** to use it, or just type your own step).
Start the operation with `+` or `−` to add or subtract, `·` (or `*`) to multiply, or `÷` (or `/`) to divide.
Mixed numbers like 2½ (typed `2` then `1/2`) are understood, and multiplying or dividing an inequality
by a negative number flips it.

### Systems of equations (elimination)

**Option+S** (or **Add system below** in a cell's ⋯ menu) adds a system laid out the way it's done on paper:

```
         3x + 2y = 16
   ×1  − 3x −  y =  7
         ───────────
              3y =  9
```

Type each equation (their = signs line up), press **←** at the start of a row to write a note like `×3`
beside it, click the **+** to switch it to **−**, and write the combined equation under the line.
**Enter** moves down the rows and from under the line to the next step. It's only a layout: the app
never combines the equations for you. **Graph these equations** in the ⋯ menu graphs them, and the
crossing point is marked.

### Number lines

Choose **Show number line** in a step's ⋯ menu to draw the step's inequality (or equation) in one letter
under it: `x ≥ 3`, `−2 < x ≤ 3`, `x² ≥ 9` and so on, with a filled dot where the endpoint is included and an
open dot where it isn't. It redraws as the step changes.

### Printing and PDF

Click **🖨 Print** at the top of a notebook (or press ⌘P). Sections are expanded, graphs are placed after
the work, and the editing controls are left out. In the print dialog, choose **PDF → Save as PDF** to make a file.

### Dividers

A divider is a section title, like a Markdown heading. Add one with **Option+H** or **+ Divider** (hover between
cells). Click **▾** to collapse everything under it, down to the next divider. Collapsed sections stay
collapsed when you reopen the notebook, and they open again when you move into them.

### The ⋯ menu

Hover over a cell and click **⋯** on its right for everything you can do with it: comment, ± (same to both
sides), graph the step, add a step, text or divider below, move it up or down, or delete it. Each item shows
its keyboard shortcut.

## Comments

Choose **Comment** in a cell's ⋯ menu, or press **⌘ /** (**Option /** in Safari), to leave a comment. You enter
your name the first time, and it's saved in the browser. Comments are stored in the notebook file. A cell
with comments shows a 💬 count on its right; click it to open them.

## Layout

The work is on the left and the graphs on the right, with a divider between them. **Drag the divider** to
make either side wider (double-click it to reset); the width is remembered. The divider's **◀ / ▶** buttons
collapse either side so the other uses the whole window, and the same spot shows a button to bring it back.
**📈 Graphs** at the top also shows or hides the graphs.

## Graphs

Choose **Graph this step** in a step's ⋯ menu, or open **📈 Graphs → + Add graph**. Each graph can hold:

- **Expressions**: `y = 2x + 1`, `x^2 - 4`, `f(x) = \sin x`, `x = 3`, circles and other implicit
  curves (`x^2 + y^2 = 25`). Any other variable gets a slider, including subscripted and Greek ones
  (`a` and `b` in `y = ax + b`, `a_1`, `v_{max}`, `\alpha`).
- **Equations in x alone** like `2x + 3 = 5x − 8` are drawn as a vertical line at each solution (here x = 11/3).
- **Points**: `(10, 0)`, or several at once: `(1, 2), (3, 4)`.
- **Inequalities**: `y < 2x + 1`, `y ≥ x^2` shade below or above the boundary (dashed for < and >, solid for ≤
  and ≥); inequalities in x alone, like `x > 3` or `x^2 < 9`, shade the vertical bands where they're true.
- **Intersections**: where two lines or curves (`y = …`, or vertical lines like `x = 3`) cross, the point is
  marked with its coordinates, e.g. **(18, 70)**. Markers follow the view as you pan and zoom. Turn them off
  with **Mark intersections** under the graph. (Circles and tables of points aren't included yet.)
- **Calculus tools** for `y = f(x)`: derivative curve, a draggable tangent line that shows its slope, and
  shaded area under the curve between two draggable bounds.
- **Tables of points**: type x and y values, or pick "y from …" to compute y from an expression.
  You can choose to connect the points. The **label** column names a point on the graph (e.g. "meet").
- **Annotations**: say what the **x-axis** and **y-axis** represent (e.g. "time (hours)"), give each
  line or table a **label** (e.g. "Candle 1"), and add **+ Note** text anywhere. Labels and notes can be
  dragged on the graph, and they stay where you put them.

Drag to pan, and **pinch** on the trackpad to zoom (or use the + / − buttons). Two-finger scrolling scrolls
the page as usual. ⟲ resets the view. Everything is open-source ([JSXGraph](https://jsxgraph.org))
and works offline.

## Sharing

- **Share** copies a link that contains the whole notebook inside the URL. Nothing is uploaded anywhere.
- The person who opens it sees a read-only copy. They can add comments, then click
  **Share back** to send you a link that includes their comments.
- Opening a shared link in your own app shows **Save to my journal**. If you already have that
  notebook, this adds only the new comments and never changes your work.
- **Export** downloads the `.mathnb.json` file. **Import file…** on the home page opens one.

### Hosted viewer (open share links on any device)

By default, share links point at `http://127.0.0.1:8642`, so they only open on a computer that is running
the app. To open links anywhere, including on a phone:

1. Push this folder to a GitHub repository.
2. In the repo, go to **Settings → Pages → Source** and choose **GitHub Actions**. The included
   workflow (`.github/workflows/viewer.yml`) publishes the viewer on each push to `main`.
3. In the app, open **⚙ Settings** on the home page and set the viewer address
   (e.g. `https://yourname.github.io/MathDocs/`).

The viewer is the same app without the local server. It can show notebooks, accept comments,
and make share-back links, and its **Open in my app** button opens the notebook in your local app.

## File format

```json
{
  "format": "math-notebook",
  "version": 1,
  "id": "…",
  "title": "Quadratics",
  "cells": [
    { "id": "a1", "type": "markdown", "text": "## Problem 1", "comments": [] },
    { "id": "b2", "type": "math", "latex": "x^2-5x+6=0", "comments": [
      { "id": "c3", "author": "Dad", "text": "Nice!", "created": "2026-10-02T14:00:00Z" } ] },
    { "id": "d4", "type": "math", "latex": "\\left(x-2\\right)\\left(x-3\\right)=0", "comments": [] }
  ],
  "graphs": [
    { "id": "g1", "title": "", "bbox": [-10, 10, 10, -10], "items": [
      { "id": "e1", "kind": "expr", "latex": "y=x^2-5x+6", "color": "#2f5bea", "tangentAt": 2.5 },
      { "id": "t1", "kind": "table", "color": "#d6336c", "rows": [["2", "0"], ["3", "0"]] } ] }
  ]
}
```

Math is stored as LaTeX, so it's readable as text and works with other math tools.

## Development

```
main.py              launcher (builds UI if needed, runs server, opens browser)
server/              FastAPI app + notebook storage (atomic writes, safe file names, trash)
tests/               backend tests        → .venv/bin/python -m pytest
frontend/src/
  main.ts            router (#/ home, #/nb/<name>, #/scratch, #/share/<data>)
  model.ts           notebook format, normalize/migrate, comment merging
  mathfn.ts          LaTeX → plottable function (Compute Engine)
  share.ts           share-link encoding (lz-string)
  views/notebook.ts  the editor (cells, keyboard, comments, saving)
  views/graphs.ts    graph panel (JSXGraph)
  views/home.ts      notebook list
  logic.test.ts      frontend tests       → cd frontend && npm test
```

For live-reload development, run the server (`python main.py`) and `cd frontend && npm run dev`.
Vite proxies `/api` to the server.
