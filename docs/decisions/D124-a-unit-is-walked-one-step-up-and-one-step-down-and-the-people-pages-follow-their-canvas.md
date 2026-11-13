# D124 · A unit is walked one step up and one step down, and Organisation, Användare and the person card follow their canvas

**Status:** provisional (accepted when an administrator has found a unit's reporting line in the drawer of a directory with several hundred units, and the walk has passed a manual screen-reader pass); built: item 9, and of item 10 Personal's sizes and the hidden avatars in the unit drawer and on Personal, and of item 8 the work row and Användare's narrow list; nothing else is · **Date:** 2026-11-13 · **Area:** ui

**Context.** On 2026-11-12 the product owner asked for a more modern design of Administration › Organisation,
Administration › Användare and the person card, drawn first in a canvas:
[Organisation, Användare och personkortet](https://claude.ai/artifact/1HgEBc2v9nVkz6QKrK2aoN). The review
[Organisation, Användare and the person card](../reviews/2026-11-13-organisation-users-and-the-person-card.md)
describes it. The canvas left its open choices as notes beside its boards. On 2026-11-13 the owner asked that those
choices be made and carried out, without being put to the owner one by one. This record is that choice. It was
made for a large organisation: a directory with several hundred units and units with eighty people or more.

**Decision.** The canvas is the reference for the three surfaces. No item adds a presentation field, a page or a
destination, so the freeze on new surface
([D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md)) holds.

1. **A unit is walked in its drawer.** The unit stays in the end `Drawer` over the tree, a `BottomSheet` on a phone,
   as [D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md) item 6 places
   it. It is not moved beside the tree. In it a person steps to the unit above ("Ingår i …") and to the units below,
   without closing it.
   - A step replaces `?unit=` and adds no history entry, so Back still closes the drawer.
   - A step moves the focus to the unit's heading and announces "Visar <enhet>".
   - A unit named in "Att rätta i katalogen" opens the drawer the same way.
2. **The drawer walks before it lists.** The order is: the step up, the status line, who leads the unit, who reports
   to them from the units below, the units below, and last the others placed on the unit. D99 item 6 put the others
   before the reporting line. A unit of eighty people then pushed the step down more than 4,000 px away.
   - A leader's row has Avatar 48 and the e-mail under the name.
   - A reporting row has Avatar 36 and "Chef för <enhet>", where the unit is the step down, then the e-mail.
   - Each of the others is one line: Avatar 24, the name, and "Avstängd" at the end where it applies.
   - No row in the drawer shows a user name. Användare and the person page do.
3. **Closing after a walk returns to where the person stands.** Esc or ✕ gives the focus back to what opened the
   drawer when no step was taken. After a step it goes to the tree row of the unit shown, and the tree opens down to
   that row. This is the one exception to rule 7 of the
   [interface-space rules](../reference/interface-spaces.md#placement-and-return-rules): the opener may be a
   different unit's row, far from where the person now is.
4. **Organisation.** On a wide screen the tree is a ledger: each unit's own count and its branch's count stand in
   an end column, in words. A phone keeps the sentence under the leader. What a push left wrong is one card, "Att
   rätta i katalogen", with one row per problem and the state's badge first.
5. **Användare.** People come first and the catalogues last. A state that is in order is a word, and colour marks
   only what an administrator must act on. Capabilities are Astryx Tokens.
   - The table shows from a window 1267 px wide and is a list below that: the rail's 260, the page's gutters of
     64, and the 943 the table needs for its columns' floors, its border and a scroll bar.
   - "Lägg till" is always enabled. A press with a field left empty shows each empty field's error under it and
     moves the focus to the first.
6. **The person card.** The pinned header carries Avatar 72 and a title line that is always there: the titles of the
   person's employments
   ([D114](D114-person-profiles-show-employments-and-categorised-phone-numbers.md)), else the directory's title
   ([D110](D110-a-persons-title-is-pushed-as-scims-title-and-kept-apart-from-the-role.md)). A person with neither
   has no title line. "Titel" leaves the details rail. Kontaktuppgifter stands before Anställningar. A source is named once: the fuller reading under it
   gets a small heading in place of the source's mark a second time, on the unit page too. On a phone the person's
   place stands in the trail line, not above the name.
7. **A user name is supporting text.** Beside a person it stands on the supporting line after the title ("Rektor ·
   hillevi"), in the supporting type. Code type is kept for where a user name or a group's key is itself the value,
   as in Detaljer › Användarnamn.
8. **A separator never starts a line.** Where " · " joins two parts that can wrap, the space before the dot is a
   no-break space.
9. **A work row says its state in words.** The state's word begins the row's supporting line, before the reason,
   on Hem, in Att göra and on the person and unit pages. The dot stays, as decoration. Colour alone no longer tells
   "Ska göras i dag" from "Ska göras" (WCAG 1.4.1), which Astryx's `StatusDot` asks for itself. An item that waits
   keeps its reason alone ("Väntar på skyddsombudet", "Väntar på källans besked"), which already says its state.
   The line is never cut short, and a due badge that would repeat the state's word is left out.
10. **An avatar's size follows its place.** 24 in tables, the tree and one-line rows; 36 in two-line rows; 48 for
    a unit's leader and the phone's header; 72 only at the top of the person page. An avatar beside a visible name is
    hidden from assistive technology. Personal's rows take 36 and its table 24, in place of a 32 nothing else used.
11. **The monogram stays neutral.** The canvas proposed filling the 72 px avatar with the installation's accent.
    Colour means a system in Clew
    ([D71](D71-three-type-levels-and-an-area-mark-whose-colour-is-the-system.md)), and a person is not one.
12. **The shell keeps AppShell `section`.** Whether Clew's shell is `elevated` is a choice for every page, not for
    these three.

**Held by the freeze.** The line drawn here is stricter than D101's list. Redrawing what a page already shows is
taken above. A fact the page does not hold today (1, 3, 4 and 5 below) and a new function or section on a page (2
and 6) wait for D101. They are notes on the canvas, in this order of need:

1. the manager by name and the unit's place on the person card, so a person can step from a colleague to their unit
   and its head;
2. search or a problem filter in the organisation tree, which a directory of several hundred units needs before it
   is pushed for real;
3. a person's title in the unit drawer;
4. when a person last signed in, on Användare;
5. a photo from the directory;
6. "Ledningen" above the tree.

**Why.**

- **The walk.** The owner opened the municipality on 2026-11-11 and could not tell who reported to its director: the
  line was only in the tree's indentation. D99 item 6 answered with the reporting group. The walk lets a person
  follow that line through the whole organisation without closing the drawer and finding the next row in the tree.
- **The order.** The step down must not depend on how many people a unit has. With the others last and one line
  each, the step up, the leader and the step down stand together at the top of every unit, small or large.
- **No user name in the drawer.** The drawer answers who leads, who reports and who is placed. The user name is an
  account's identifier, and an account is looked up on Användare.
- **Closing after a walk.** Returning to the first opener would move the person back to a part of the tree they
  left several steps ago, and the unit they were reading would be out of sight.
- **"Lägg till" enabled.** A disabled button says nothing about why. An error under the empty field does, and a
  screen reader reads the label and the error together.
- **Evidence.** The canvas was checked with probes and real keyboard and mouse input, for contrast, reflow at 320 px,
  target sizes and forced colours, and reviewed by independent verifiers and an Impeccable finish review. The review
  records what was found, fixed and disputed. No screen reader has read it, which is why this record is provisional.

**Not built.** The change that adds this record builds item 9, with the other fixes the review lists. Of item 10
it builds Personal's sizes and the hidden avatars in the unit drawer and on Personal; the drawer's 36 and 48 and the
person page's 72 come with items 2 and 6. Of item 8 it builds the work row and Användare's narrow list; the other
separators in the web app still have a plain space. Items 1 to 7 are not built: the pages they change were being
reworked by another review when this was decided, and the build follows when that has landed.
When it is built, D99's item 6 and "As built", rule 7 of the interface-space rules, `tests/a11y/organisation.spec.ts`,
`tests/a11y/users.spec.ts` and `tests/a11y/person.spec.ts` change with it.

**Replaces.** The order of the overlay in D99 item 6 (leaders, the others, the reporting line) and its "close back
to the tree with the focus on the row", for the case where a step was taken. Rule 7 of the interface-space rules
gets that one exception. The row of
[D112](D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 3 gains the
state's word (built). Item 6 redraws the person page of D112 item 5 and where D114 item 6 shows an employment's
title (not built). Nothing is superseded.
