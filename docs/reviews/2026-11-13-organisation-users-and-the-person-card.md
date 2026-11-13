# Design exploration: Organisation, Användare and the person card · 2026-11-13

On 2026-11-12 the product owner asked for a more modern and appealing design of three surfaces: Administration ›
Organisation, Administration › Användare and the person card (`/people/:key`). The design was to be drawn first in a
Claude Design canvas: creative, but not over the top. Impeccable was used to raise the craft and keep generic AI output
out. On 2026-11-13 the owner handed the canvas's open choices to the session that drew it. This note records:

- what the canvas draws, and why;
- what was settled while it was built;
- what was decided, and what the freeze holds back;
- what was fixed in the product, and what is left to build.

The decision is
[D121](../decisions/D121-a-unit-is-walked-one-step-up-and-one-step-down-and-the-people-pages-follow-their-canvas.md).
This note is its evidence. The redesign itself is not built in `apps/web` yet; "Fixed in the product" lists what is.

Canvas: [Organisation, Användare och personkortet](https://claude.ai/artifact/1HgEBc2v9nVkz6QKrK2aoN), published as
artifact version 17 on 2026-11-13. It has 29 boards on five pages: Organisation, Användare, Personkortet, Mönster and
Strukturerna. It is private until the owner shares it.

## The brief

The owner's answers in the interview:

- **The two administration pages.** Four jobs weigh the same: checking the directory import, looking someone up
  quickly, granting capabilities and understanding the organisation.
- **The person card.** It serves four readers equally: a manager, a colleague, the person themself and an
  administrator.
- **The look of the person card.** It should have "a modern touch", with clear sections and perhaps a picture: not
  traditionally dull, but not over the top either.
- **Distances.** Three matter, and each is its own way of looking: the whole tree, one förvaltning or unit, and the
  person card.
- **Structure.** This was left open ("Här är jag öppen för förslag").

## Structure: one step up, one step down

The direction round dealt seven structures. Three are kept on the page Strukturerna: "Ett steg upp, ett steg ner",
"Slå upp först" and "Organisationen i kolumner". The owner's direction settled on the first.

A unit opens in the drawer on the desktop, or in the sheet on a phone, and is shown in its context, from the top:

1. "Ingår i <enhet>", as a step up;
2. the unit's chef or chefer;
3. "Rapporterar till …", the heads of the units below, each with the unit they lead as a step down;
4. "Enheter under", the units below as steps down;
5. its medarbetare, one line each.

The walk comes before the list, so the step down stands in the same place in a unit of five people and in a unit of
eighty. A step replaces `?unit=` without adding a history entry, moves focus to the new heading and announces it. Esc
closes the drawer. If the person has not walked, focus returns to what opened it. If they have, it goes to the row of
the unit they stand on, and the tree opens down to that row. This lets a person walk the organisation without reading
the tree's indentation and without closing the drawer. D121 decides it, and with it amends the order in item 6 of
[D99, units form a tree](../decisions/D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md)
and rule 7 of the [interface-space rules](../reference/interface-spaces.md#placement-and-return-rules) (D83).

## What each surface draws

**Organisation** (10 boards):

- The tree is a ledger on the desktop, with each unit's size in a count column. Phones keep today's sentence.
- The problems card is "Att rätta i katalogen": the fix is made in the directory, never in Clew.
- Rank shows by size and by detail in the drawer: a Chef row takes Avatar 48 with the e-mail, a reporting row 36,
  and each of the others one line at 24. No row there shows a user name.
- The states drawn are empty, no manager and nobody placed, plus dark mode and the phone's tree and sheet.
- Ledningen at the top is drawn on one board only, as a proposal.

**Användare** (6 boards):

- People come first and the catalogues last, with calm statuses.
- A person's cell is the name, and under it the title and the user name in the supporting type.
- Capabilities are Astryx tokens, and the "Ger" links narrow the list to one capability.
- A banner says when a catalogue has gone silent.
- The toolbar and the pager use the product's size sm.
- Below 1267 px the table becomes a list.
- An add form maps a group to a capability.

**The person card** (9 boards):

- The pinned header has Avatar 72 and a title line that is always there.
- Kontaktuppgifter comes before Anställningar.
- A row under "Behöver dig" says its state in words, before the reason.
- Four readers are drawn: a manager, a colleague, the person themself and an administrator who opens the card from
  Användare.
- The other states are a source that does not answer, a person who does not exist, dark mode and two phone boards.
- DecideMonogram shows the monogram filled with the accent colour, a proposal that D121 turned down.

**Mönster**: "Samma person i alla storlekar" shows one person at every size the three surfaces draw.

## Settled while building

The canvas's lock settled 26 details while the boards were built. The ones the product must follow:

- **Links.** PersonNameLink is underlined in its own colour, at rest too.
- **Rows.** Rows are Astryx ListItems with gap 8, so a row's text starts on one line.
- **Placeholders.** They are `--text-2` at full opacity. The browser's default grey measured 3.28:1 in dark mode.
- **Empty states.** EmptyStates are Astryx's, with no icon.
- **Headings that take focus.** They never grow, so the focus ring hugs the words.
- **The Användare table.**
  - Its columns give Person a floor of 272 px. Astryx's table then needs 1267 px, so a 1280 px screen keeps the
    table.
  - A token too long for its cell ends in an ellipsis.
  - The toolbar and the pager are the product's size sm. "Rensa filter" stands at the end of the line with the count
    ("12 av 257 personer").
- **"Lägg till" (groups to capabilities).** It is always enabled. A press with a field left empty shows each field's
  error and moves focus to the first one.
- **Field focus.** It is drawn as Astryx draws it: an accent border and an accent-muted inset, with no outline.
- **Invalid fields.** A focused invalid field gets a 2 px inset in the error colour, at 5.9:1 in light and 8.6:1 in
  dark. Without that, it would look the same as an unfocused one. The canvas first drew 1 px; the product's review
  found a single pixel too little, and the canvas followed.
- **Focus after a pointer choice.** Focus returns to a Selector in its resting look, as Astryx draws it. The look
  holds as Astryx's Selector keeps it: until the list opens again or the trigger takes focus by keyboard. A blur or a
  key that does not open the list leaves it in place, and while it holds a hover draws no inset. The product gets
  this from Astryx as it ships. An earlier round of the canvas ended the look at the first key; that lead was
  withdrawn, because the product could only follow it by patching Astryx.
- **Unit names.** A unit's name is drawn in the surface's own type everywhere, as the product draws `unitLabel`.
  This includes the id of a unit the directory sent no group for (`unit-familjecentralen`).
- **User names.** Beside a person, a user name stands on the supporting line after the title, in the supporting
  type. Code type is kept for where a user name or a group's key is itself the value, as in Detaljer ›
  Användarnamn.
- **Separators.** Where " · " joins two parts that can wrap, a no-break space stands before the dot, so the dot
  never starts a line.
- **Avatars.** 24 in tables, the tree and one-line rows; 36 in two-line rows; 48 for a unit's head and the phone's
  header; 72 only at the top of the person page.
- **The phone.**
  - Name links are 20 px tall, which WCAG 2.5.8's spacing exception allows.
  - List options are 44 px tall.
  - The person's place moves from above the h1 into the trail line.

## Decided

The canvas left its open choices as stickies. D121 settles them. Each sticky on the canvas now says which way it
went.

Taken:

- **Organisation:** walking in the drawer, with the walk before the list; the unit stays in the drawer, not beside
  the tree; the shell keeps AppShell `section`.
- **Användare:** "Lägg till" always pressable.
- **The person card:** the title line always in the header; a source named once; the state of a work row in words,
  which answers the colour-only dot (WCAG 1.4.1).
- **Mönster:** an avatar's size follows its place, and Personal follows the rule.

Turned down:

- **The accent-filled monogram.** Colour means a system in Clew
  ([D71](../decisions/D71-three-type-levels-and-an-area-mark-whose-colour-is-the-system.md)), and a person is not
  one.

Held by the freeze
([D101](../decisions/D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md)),
each a new field or a new part of a page, in the order D121 gives them:

1. the manager by name and the unit's place on the person card;
2. search or a problem filter in the organisation tree;
3. a person's title in the unit drawer
   ([D110](../decisions/D110-a-persons-title-is-pushed-as-scims-title-and-kept-apart-from-the-role.md));
4. when a person last signed in;
5. a photo from the directory;
6. Ledningen above the tree.

## The Impeccable finish review

An Impeccable finish reviewer read artifact version 15 against three things: the direction contract in
`apps/web/.impeccable/surfaces/`, 17 captures of the boards, and Impeccable's craft floor. The build had no approved
comp and no quality-bar card, and Impeccable's detector found nothing on any board. The reviewer's reading was
therefore the only check against generic output. It ended in "fix", with eight findings.

Fixed on the canvas in version 16:

- **One legend for overdue.** An overdue item was red in "Behöver dig" and yellow in Utvecklingssamtal, and its own
  row said only "Inte klar". Overdue is now the alert tone everywhere, and each overdue row says "Försenad".
- **Ledningen without a hero number.** "250" stood at display size over a small label, a template the craft floor
  refuses. It now reads "250 personer i Kommunen" in the rows' supporting type.
- **The drawer's status line.** "12 personer på enheten, 1 avstängd" read as if the disabled person were one of the
  twelve, while Chef (1) and Medarbetare (12) add up to 13. It now reads "12 personer på enheten och 1 avstängd".
- **Copy.** The canvas now uses:
  - Swedish long dates ("Ansökan kom 10 november kl. 16:40");
  - "Registrerade: 2", without the word twice;
  - badge labels with a capital ("Går ut snart", "Utgånget"), as "Försenad", "Klar" and "Bokat" have;
  - on the phone, the role with a capital, as in the role filter and the drawer.

Fixed on the canvas in version 17, after the owner handed over the choices:

- **A large unit hid the step down.** Each Medarbetare row in the drawer was 58 px tall with the name, the user name
  and the e-mail, so at 1440 × 900 "Rapporterar till" never showed. In a school of eighty it would have stood more
  than 4,000 px down. The others are now one line each, and the walk stands before them.
- **The user name in code type competed with the name.** At 14 px, the monospace user name after a name looked larger
  than the Figtree name and wrapped rows to two to four lines. It now stands on the supporting line, in the
  supporting type. The table's columns and its 1267 px threshold did not move.

Disputed:

- **The teal source badge.** "Personalsystemet" is teal because D71, which is accepted, gives a connected system its
  hue and outlines the house. The reviewer read hue as reserved for states that need action, but D71 decides
  otherwise.
- **A larger unit name in the drawer.** The name is the title of Astryx's Drawer, in the type the Drawer gives it. A
  display size there, or a tinted band behind the unit's head, would restyle an Astryx component by hand, which this
  repository does not allow.

Held by the freeze:

- **The person card's place in the organisation.** The reviewer wants the unit and its chef as a step for every
  reader. That needs the chef in the person's data, a new field. It is first in D121's list of what waits.

Left as it is:

- **"Åtgärdspunkter" twice.** The small heading over the fuller reading is the taken proposal "a source named once".
  The summary line above it carries the same word, in the product's own text.
- **The separator on the phone.** A long unit name and its role may not fit on one phone line. Then the "·" ends the
  first line, bound to the unit's name. Holding the pair to one line, as the desktop table does, would cut the role
  off.

The reviewer asked the product to keep five things when it follows:

- the tree as a ledger, with guides, the chef on the supporting line and right-aligned tabular counts;
- the step-up row, and the step in place that announces "Visar <enhet>";
- one badge vocabulary for unit states, in the problems card, the tree and the drawer;
- initials only, sized by place (24, 36, 48, 72), neutral and hidden from screen readers;
- fault states said plainly, with the recovery beside them.

## Fixed in the product

The canvas was measured against Astryx 0.7.13 and the product, and found defects in what is built today. They were
fixed in the change that adds this note, each with a test, and read by two independent reviewers, whose findings were
fixed in turn.

- **The rail's width.** `apps/web/src/components/panel.tsx` set `RAIL = 256`, but Astryx's SideNav is 260 wide. The
  panel now stands beside the page from 1340 px, not 1336.
- **Focus on a field with a status** (WCAG 2.4.7). Astryx replaces a field's focus border and inset with its status,
  so a focused invalid field looked unfocused. Clew's theme (`packages/ui/src/theme.ts`) now gives it a 2 px inset in
  the status colour. A FileInput also gets an outline that only forced colours paint.
- **A work row's state in words** (WCAG 1.4.1). "Att göra i dag" and "Att göra" differed by the dot's colour alone.
  The row's supporting line now begins with the state, on Hem, in Att göra and on the person and unit pages. An item
  that waits on someone keeps its reason alone ("Väntar på skyddsombudet"), which already says so. The line may take
  three rows, so the reason is not cut at 320 px.
- **The drawer's status line** reads "och 1 avstängd".
- **The role in Användare's narrow list** has its capital, and its separator never starts a line.
- **The HR fixture** writes "Ansökan kom 10 november kl. 16:40", a long date like the card's others.
- **Avatars beside a name** are hidden from assistive technology in the unit drawer and on Personal. Personal's rows
  take 36 px and its table 24, in place of a 32 nothing else used.

One finding was wrong. The canvas reported that a Selector's options stay 32 px tall on a phone. Measured under a
coarse pointer they are 50 to 52 px: the 32 came from a mouse pointer at phone width. Nothing changed in the theme,
and a test now holds the 44 px.

Left for the build of D121, or open:

- "Lägg till" on Användare is still disabled until both fields are chosen (D121 item 5).
- On the phone, the entity page still draws the person's place as a small line above the h1 (D121 item 6).
- `apps/web/src/components/panel-labels.ts` gives its values in lower case ("bokat", "utgånget", "går ut snart").
  Where one becomes a badge, as on the canvas, it needs a capital like the other badge labels.
- A saved theme's surface is not held to 3:1 against Clew's error and warning colours. It is an
  [open question](../maintainers/open-questions.md), because the answer changes the theme file's contract.
- A manual screen-reader pass with VoiceOver is still needed, on the canvas's flows and on the fixes. The names and
  states were read from Chrome's accessibility tree, not heard.

## Evidence

Every board is built from templates. Two kinds of check ran on it:

- probes in the rendered page;
- real mouse and keyboard input through the Chrome DevTools Protocol.

They covered:

- keyboard paths and visible focus;
- contrast in light and dark;
- reflow at 320 px and target sizes;
- forced colours;
- Astryx's own metrics, read from its 0.7.13 source.

Independent verifiers reviewed each round, and a fresh verifier confirmed each repair. Two rounds were checked by the
lead designer instead, to save time: the last repair before version 15 and the fixes of version 16. There every board
was rebuilt and linted with 0 errors, the families' probes and real-input scripts ran with 0 failures, and a pixel
comparison showed changes only where they were intended.

Version 17 went through a full round again. Four builders changed the boards, three independent verifiers raised 16
findings, the builders repaired them, and a fresh verifier confirmed each one and compared every board with the
published version:

- 11 boards are identical to version 16, and the others differ only where the three changes ask;
- the drawer's order holds in all 51 units of the development directory, in the DOM, down the panel and in tab
  order;
- a person with no user name gets a plain name, on Organisation and Användare alike, which the earlier boards had
  not proved.

No board draws all five groups of the drawer at once, because only one unit in the data has both units under it and
people of its own. Main draws "Rapporterar till" before "Medarbetare"; the board with Vård och omsorg draws it before
"Enheter under".

Forced colours were checked by painted pixels, because computed styles in Chrome do not show what is drawn there. An
earlier version of the canvas's shared CSS left a false focus edge on fields that had no focus. It was fixed: every
field's border now resolves to a system colour, as Astryx's fields do, and an error message keeps its panel's outline,
as Astryx's FieldStatus draws it. This was a fault in the canvas, not in the product.

Not everything on the boards acts. The Användare toolbar's filters and the pager's page size do not open: their looks
are drawn and checked, and the add form's two Selectors carry the full behaviour of a Selector, from the press model
to where focus returns.
