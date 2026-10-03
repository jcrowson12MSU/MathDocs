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
**Enter** moves down the rows and from under the line to the next step. The app never combines the
equations for you. **Graph these equations** in the ⋯ menu graphs them, and the crossing point is marked.

**Multiplying an equation so a variable cancels.** Write the multiplier as the row's note (e.g. `×3`
beside `2x − y = 5`) and press **Enter**. A new system appears below with that row written out in gray as
`3(2x − y) = 3·5`; press **→** to accept it. Press **Enter** on the empty line under it and the next system
suggests the distributed row, `6x − 3y = 15`. Now the y terms are `+3y` and `−3y`, so write the combined
equation (`10x = 40`) under the line yourself. Unchanged rows are copied along. You can always type your
own row instead of accepting a suggestion. In a note, typing `*` gives **×**.

### Substituting a value

Once a step gives a letter's value (`x = 4`, `y = −3`, `x = ½`), choose **Substitute x = 4 into…** in its
⋯ menu and pick one of the equations above it. The next step starts in gray with the value written in,
`2(4) − y = 5`; press **→** to accept. Parentheses are added where they're needed (`9(−2)`, `−(−3)`, `(−2)²`),
and the arithmetic is left to you.

### "Let x = …" (word problems)

**+ Let x =** between steps (or **Add “Let x = …” box below** in the ⋯ menu) adds a box for what each letter
stands for: *x = number of months*, *y = total paid in dollars*. A graph can use the meanings of x and y as its axis
labels: **Graph this step** links the new graph to the nearest Let box above the step, and the **Axis labels from**
menu under each graph picks a Let box (or none). Labels you type on the graph always win. (In older notebooks with
one graph and one Let box, the two are linked automatically.)

### Practice mode

**🎓 Practice** at the top of a notebook turns the app's help off for that notebook (it's saved with it):
next steps start as a plain copy instead of a worked-out suggestion, **Next system** copies rows instead of
multiplying them out, **Substitute** isn't offered, graphs don't mark crossings, and slope triangles don't
show their numbers. Turn it off to check the work.

Empty exponent or subscript boxes (`x_{}`) are removed when you leave a step.

### Layouts (Algebra II and geometry)

**+ Layout ▾** between steps (or **Add layout below…** in the ⋯ menu) adds a layout drawn the way it's done on
paper. The boxes are filled in by hand; nothing in them is computed. ↑ ↓ ← → move between boxes and **Enter**
goes to the next one.

- **Box (area model)**: terms across the top and down the side, products inside. For multiplying polynomials
  and for factoring. **+ row** / **+ column** add terms.
- **X (factoring diamond)**: what the two numbers multiply to (top) and add to (bottom), the numbers left and right.
- **Synthetic division**: the zero of the divisor in the corner, the coefficients across, then the middle and
  bottom rows.
- **Long division**: divisor ) dividend with the quotient on top, then work lines (every other line has a rule
  under it for subtracting). **⌥←** / **⌥→** shift a line to line up like terms; Enter on the last line adds one.
- **Matrix (row operations)**: type the entries; a bar before the last column makes it augmented. Write a row
  operation in the red note beside a row — `R_2-3R_1`, `R_1<->R_2` (swap), `1/2 R_1` — and press **Enter**: the
  next matrix appears below with the operations applied in gray (**→** accepts a row). The operations are your
  choice; the app only does the arithmetic. In practice mode the next matrix is a plain copy.
- **Two-column proof**: Given, Prove, then numbered **Statements | Reasons**. Statements are math
  (`\angle`, `\cong`, `\triangle`, `\overline{AB}`, `\parallel`, `\perp`); reasons are plain text. Enter on the
  last reason adds a row.

### Calculus cells

Also under **+ Layout ▾**:

- **Limit table**: type f(x) and what x approaches (a number, or `\infty`). The table shows f(x) at x values
  closing in from the left and from the right (or 10, 100, 1000 … toward ∞). Evaluating f is arithmetic; the
  limit itself goes in the **lim f(x) =** box and is yours. In practice mode the f(x) column is blank.
- **u-substitution**: the integral, **Let u =** and **du =**, the integral in u, its result, and the result back in x.
- **Integration by parts**: u, dv, du, v, then uv − ∫v du and the result.
- **Tabular (DI) integration**: D and I columns with the signs +, −, +, … down the side; **+ row** adds rows.

Nothing in these layouts is worked out for you.

**Calculus keyboard.** **⌨ Keyboard → ∫ d/dx** has keys for d/dx, dy/dx, f′, f″, ∂, ∇, ∫ (indefinite, definite,
double, triple, line), evaluation bars, + C, limits (two-sided and one-sided), Σ, ∞, →, Δ, vectors (⃗v, ⟨a, b⟩,
î ĵ k̂, ‖v‖), · and ×.

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
- **Standard form** like `9x + 12y = 30` (and anything else with one y for each x) is drawn as the line
  `y = …` it equals, so crossings with other lines are marked.
- **Points**: `(10, 0)`, or several at once: `(1, 2), (3, 4)`.
- **Inequalities**: `y < 2x + 1`, `y ≥ x^2` shade below or above the boundary (dashed for < and >, solid for ≤
  and ≥); inequalities in x alone, like `x > 3` or `x^2 < 9`, shade the vertical bands where they're true.
- **Intersections**: where two lines or curves (`y = …`, or vertical lines like `x = 3`) cross, the point is
  marked with its coordinates, e.g. **(18, 70)**. Markers follow the view as you pan and zoom. Turn them off
  with **Mark intersections** under the graph (practice mode hides them too). (Circles and tables of points aren't included yet.)
- **Restrictions and piecewise functions**: put the domain in braces after the expression,
  `y = x^2 {x < 2}` or `y = 6 − x {2 ≤ x ≤ 5}`. The ends get a filled dot if they're included and an open dot
  if not. A piecewise function is several restricted expressions.
- **Holes**: where an expression is undefined but the graph continues on both sides — `(x² − 4)/(x − 2)` at
  x = 2 — an open circle is drawn. Asymptotes aren't drawn for you.
- **Parent function**: under a `y = …` expression, choose **Parent: y = x²** (or |x|, √x, 1/x, 2ˣ, sin x …) to draw
  it faintly behind the transformed one.
- **Polar and parametric curves**: `r = 2\cos\theta` (θ from 0 to 2π) and `(3\cos t, 2\sin t)`. A range in
  braces sets how far they go: `r = \theta {0 ≤ θ ≤ 4π}`, `(t, t^2) {−1 ≤ t ≤ 1}`.
- **Degrees / π ticks / Same scale** (under each graph): **Degrees** makes `sin x` take x in degrees (and the
  x-axis follows); **π ticks** labels the x-axis π/2, π, 3π/2 … (or 90°, 180° …); **Same scale** keeps circles round.
- **+ Unit circle**: a point you drag around the unit circle (it stops every 15°), its terminal side, the reference
  triangle and the angle (θ = π/3, or 60° in degrees). The point's coordinates are left as **(?, ?)** to work out.
- **+ Construction** (geometry): tools for **Point, Segment, Line, Ray, Circle** (compass: center, then a point on
  it), **Polygon**, **Midpoint**, **Perpendicular**, **Parallel**, **⊥ Bisector**, **∠ Bisector** and **Intersect**,
  plus a **Ruler** and **Protractor**. Click points (or empty spots, which make new points A, B, C …); dragging a
  point moves everything built from it. **Undo last** removes the last thing added. Practice mode hides the ruler
  and protractor readings.
- **Slope triangle** for `y = f(x)`: two dots on the line (drag them; they land on whole-number x) with the
  run and rise drawn between them, e.g. **run = 2**, **rise = 4**. It never shows the slope itself.
- **Calculus tools** for `y = f(x)`: derivative curve, a draggable tangent line that shows its slope, and
  shaded area under the curve between two draggable bounds. In practice mode the derivative curve, the slope and
  the area are hidden (the tangent line and the shading stay).
- **Riemann sum**: rectangles under the curve between two draggable ends on the x-axis, with **n** (1–100) and
  **Left / Right / Midpoint / Trapezoids**. The total of the rectangles is shown (hidden in practice mode).
- **Secant line**: through x = a and x = a + h; drag the first point along the curve and slide **h** toward 0.
  Its slope (a difference quotient) is shown, except in practice mode.
- **Series**: `y = \sum_{k=0}^{n} \frac{x^k}{k!}` graphs the partial sum, with **n** as a slider that steps by 1.
  You write the series; the app doesn't make Taylor polynomials for you.
- **Sequences**: `a_n = (1 + 1/n)^n` plots the points (n, aₙ) for n = 1, 2, 3 …
- **Vectors**: `\langle 3, 4\rangle` (or `\vec{v} = \langle 3, 4\rangle`) draws an arrow from the origin.
- **Vector fields and phase planes**: `\langle -y, x\rangle` draws arrows across the view (longer where the field
  is stronger).
- **Slope fields**: `\frac{dy}{dx} = x - y` (or `y' = x - y`). No solution curves are drawn for you — graph your
  own solution (with a slider for the constant, like `y = x - 1 + Ce^{-x}`) on top to check it follows the field.
- **3D** (under the graph): `z = x^2 + y^2` surfaces, space curves `(\cos t, \sin t, t)` (with ranges in braces),
  points `(1, 2, 3)` and vectors `\langle 1, 2, 2\rangle`. Drag to turn the view.
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
