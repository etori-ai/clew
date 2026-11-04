# D20 · Every execute capability declares its undo: compensating, hold or none; holds run on Temporal

**Status:** proposed · **Date:** 2026-11-04 · **Area:** product

**Decision.** An `execute` capability in `packages/modules` declares exactly one kind of undo, and the
registry refuses to register one that declares none:

- **Compensating.** The action runs at once, the receipt is read back, and a named reverse capability
  can be run within a window (ten minutes today). This is the existing model and stays the default
  wherever the source can reverse the effect: cancelling a calendar invitation, un-acknowledging a
  notification in SupportManagement, deleting a note within its window.
- **Hold.** Nothing leaves Clew for a hold period. The card shows a countdown and an Ångra button;
  when the period ends the action is re-validated against the source, dispatched, read back, and the
  receipt written. This is for effects the source cannot reverse: a reply sent to a stakeholder, a
  message to a citizen, a submission to another organisation. The pattern is the delayed send in mail
  clients.
- **None.** Only for an action that must take effect at the moment of the click. The card says "Kan inte
  ångras" before the button is pressed, never after. The registry requires a reason string on the
  capability so the choice is reviewable.

A hold is one Temporal workflow per decision (D17), keyed by thread id and decision id so a retry never
dispatches twice. The decision endpoint writes the thread in a new state `pending`, with the decision and
an audit row, in one transaction and starts the workflow. The workflow waits on the timer or a `cancel`
signal. On cancel it ends and the thread reopens with an audit row `thread.undone`. On expiry one activity
rebuilds the actor from the person id on the server, re-checks the grant against the authorization
version carried from the click, runs the capability through the registry, reads back, and writes receipt
and audit in one transaction. The dispatch activity gets one attempt: no retry without a proven outcome,
an `unknown` row stays `unknown` until a later read-back reconciles it. While the thread is `pending` the
scan, the attention counter and "never pushed twice" treat it as handled, and the card stays in its place
with its countdown. If Temporal is unreachable the hold cannot be started and the card says so instead of
dispatching at once (D8).

The hold length is a time limit under WCAG 2.2 success criterion 2.2.1, so it is a per-person setting
with a default of thirty seconds and a range the person can change, not a constant.

**Why.** The errand module (D18) brings the first execute whose effect the source cannot take back: a reply
to a stakeholder. The rule so far, "irreversible effects have no undo and the card says so"
(`integration-paths.md`), makes the warning the whole safety net. A hold gives every action an undo
without asking the source for anything, and keeps the receipt honest: the receipt is still a read-back,
it just arrives after the hold. Compensating undo stays the first choice because the person gets the real
receipt at once and the source's own reversal is the truth; a hold on a reversible action would only add
waiting. Declaring the kind on the capability, and refusing one that declares none, turns a product rule
into something the registry enforces and a reviewer can see. Temporal is the right engine because a hold
is a durable timer with a cancel signal, which is exactly what D17 adopted it for, and because the
`reminder` workflow already has the shape (timer, signal, activity that touches the thread).

**Replaces.** Narrows D15 once more: compensating undo windows (`undo-expiry`, `receipt-final`) stay on the
`job` table until migrated; holds start on Temporal. Extends the Undo row in `integration-paths.md`
from one kind to three. Nothing else; the human decision endpoint stays the only path to a source and is
never a tool (D8).
