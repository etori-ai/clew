# The day beside, or in the column

**Date:** 2026-11-07 · **Canvas:** Clew · dagen bredvid eller i spalten (Claude Design,
https://claude.ai/artifact/7XQKJ8PfcHAtp8QNQx7DXS, private until shared) · **Outcome:**
[D72](../decisions/D72-the-day-is-the-pages-and-the-panel-holds-only-what-was-opened.md)

## The problem

On Hem at 1336 px and up ([D63](../decisions/D63-hem-is-drawn-as-the-canvas-draws-it.md) items 3 and 14) I dag and
Sedan i går stand in the panel while nothing is open, with the same handle and fold button as an open card. Opening a
card replaces them; closing it brings them back. The product owner found this confusing on 2026-11-07: one surface
means two different things, the page's own content and what the person opened, and with the panel's tabs
([D66](../decisions/D66-the-panel-keeps-everything-opened-beside-the-page-as-tabs.md)) the day disappears as if it were
a tab that was closed, though it was never opened.

## The four directions drawn

| | What it does | Keeps | Costs |
|---|---|---|---|
| **A · the day is the page's, the panel is only what was opened** (A1 rest, A2 a card open at 1440, A3 at 1800) | I dag and Sedan i går are the grid's third track at every width from 1024; the panel exists only while something is open; three tracks where they fit, else the day folds under the work in two columns | Every surface one job (D50); the layout the page already draws between 1024 and 1336; no new component; artboard A's full-width box at rest | At 1440 with a card open the day stands under the work, not beside it; the fold at rest goes |
| **B · the day as a strip** | A `DayStrip` (D32) under the box across the column, Sedan i går as one line; the panel is only what was opened | The day always in view, even with a card open | Artboard A's two cards go; the gap's sentence and the figure lines have no room; 120 px of the day's work on every screen |
| **C · the panel splits** | The card above, I dag and Sedan i går as two `Collapsible` rows at the panel's foot | Nothing moves; the day is one click away in the same place | The panel is still two things; a long card pushes the rows under the edge; the surface still shares |
| **D · the day as the panel's first tab** | D66's menu gains a fixed first entry "Bredvid"; what is opened comes after | Least code; the sharing becomes explicit | Entrenches what confused: the day is not something the person opened, and the menu shows one name at a time, so the day is still hidden while a card is open |

## Choice

A. It answers the product owner's point directly: the panel is what the person opened and nothing else, and the day
is page content that keeps its landmark ("Bredvid") wherever the layout places it. The three-track state at 1800 px
(A3) is what shows the model is right: on a screen that holds both, both are seen.
