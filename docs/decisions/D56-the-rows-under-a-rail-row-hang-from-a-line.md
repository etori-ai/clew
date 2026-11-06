# D56 · The rows under a rail row hang from a line

**Status:** accepted · **Date:** 2026-11-06 · **Area:** ui

**Decision.** A row in the rail that opens (Administration, Fler verktyg, the account) puts its rows in `SubRows`
(`apps/web/src/components/shell.tsx`). `nav.tsx` and `shell.tsx` use nothing else for this. It is an Astryx composition and
no custom CSS:

```tsx
<HStack gap={1} paddingInlineStart={4}>
  <StackItem aria-hidden><Divider orientation="vertical" variant="strong" /></StackItem>
  <StackItem size="fill">{children}</StackItem>
</HStack>
```

1. **The line starts under the parent's icon** and runs the whole height of the rows without a break. `paddingInlineStart`
   puts it on the centre of the icon, at the same place in the page rail and the phone drawer.
2. **The rows move further in.** The label of a row now starts 21 px further in than its parent's. The selected and hover
   fill starts just after the line.
3. **`variant="strong"`.** `subtle` is close to invisible on the rail in Neutral and in Sundsvall light.
4. **The line is hidden from assistive technology.** A `Divider` is a `role="separator"`, and a separator at the start of a
   list says nothing: Astryx already gives the rows `role="group"` named by the parent.
5. **The `StackItem` around the `Divider` is required.** A vertical `Divider` has `height: 100%`, which needs a parent of
   known height. Directly in the `HStack` it drew at 0 px. A stretched `StackItem` gives it that height.

**Why.** Astryx indents a nested `SideNavItem` by `--spacing-2 + depth * --spacing-6`, which puts the child's label on the
same x as the parent's label, because the parent has an icon and the child does not. The product owner, 2026-11-05: the
rows should have a line "så att man inte misstolkar undervalen som val på samma nivå som parent".

Astryx 0.7.7 has no guide line for this. `SideNavItem` has no prop for it, its depth is a private context, and
`astryx-side-nav-item` exposes `data-size`, `data-selected` and `data-disabled` but no depth, so `defineTheme` cannot reach
it either. `TreeList` has `variant="lineGuides"` but is a tree of its own: items as data, its own row look and chevrons, and
no link, selected state or `endContent` like the rest of the rail. An inline `style` on the child rows would have been an
exception. The composition above needs none, so this decision allows no custom CSS.

The indent and the group carry the hierarchy, and the line reinforces them. The rail's `strong` border in Neutral light is
`#d4d4d4` on `#f1f1f1`, about 1.3:1, so WCAG 1.4.11 is met by the indent and not by the line. Sundsvall's `strong` border is
dark in light mode and light in dark mode, so the line is heavier there. It is the same token and we keep it.

Measured with Playwright at 1280 and 320 px, in `tests/a11y/shell.spec.ts`: the line is on the icon's centre and as tall as
the group, the label is further in than the parent's, no row is clipped, the keyboard goes from the parent into its first
row, the separator is not in the accessibility tree, and axe finds nothing with the rows open. `tests/a11y/menu.spec.ts`
checks the line under Fler verktyg. Looked at in Neutral and Sundsvall, light and dark, and in the phone drawer.

**Replaces.** Nothing. It adds to the rail in
[D50](D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md).
