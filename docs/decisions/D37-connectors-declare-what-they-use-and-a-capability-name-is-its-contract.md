# D37 · Connectors declare the capabilities they use; a capability's name is its contract

**Status:** proposed · **Date:** 2026-11-05 · **Area:** integrations

**Decision.** A connector may call another connector's `read` or `propose` through Clew (D20, D22,
`docs/architecture/working-across-connectors.md`). This decision makes that dependency visible and says what B may
change without breaking A. There is no version number per connector. The unit of compatibility is the capability.

1. **A declares what it uses.** The manifest gets an optional `uses`: the other connectors' capabilities this
   connector calls, by name (`uses: [{ name: 'calendar.today' }]`). A bundled connector declares the same in its
   descriptor. It is an optional field, so the protocol stays at version 1. Clew answers `denied` to a `clew.call` or
   `POST /api/connectors/call` for a capability that is not in the caller's `uses`, which keeps the list true.
2. **The name is the contract; a breaking change is a new name.** B keeps a capability's name only for compatible
   changes:
   - a new optional input property;
   - a new output property;
   - a looser constraint (a longer `maxLength`, more enum values on input).

   Anything else is breaking: a new required input, a removed or renamed property, a changed type, a narrowed
   constraint, or a different meaning. A breaking change is a new capability (`calendar.dayView` beside
   `calendar.today`). The old one stays and is marked in the manifest with `deprecated: { replacedBy, until }`. This is
   the rule the protocol already applies to itself (section "Versioning": a break is a new `protocol`, and both are
   accepted for a release).
3. **Clew classifies every manifest change against its users.** When B's manifest changes, Clew compares each changed
   capability that an enabled connector uses with the stored one. The rules of item 2 are applied mechanically to the
   two JSON Schemas, and each dependent gets one verdict: compatible, breaking or removed. `ManifestDiff.changed`
   already finds the changed names by comparing JSON; this adds the verdict and the dependents.
4. **A change is always audited, and a break is shown before anyone files a ticket.**
   - **Boot.** Today a manifest refetched at boot is applied and stored silently, with no audit row
     (`apps/server/src/connectors/remote.ts`). With this decision it writes the same `connector.manifest` audit row
     as "Hämta manifest igen".
   - **Not held back.** Clew cannot make B serve a capability B has removed, so the new manifest still goes live.
     Instead, a breaking or removed verdict marks each dependent's health `degraded`, with the capability and the
     reason.
   - **On the admin page.** The manual refresh dialog names the dependents before "Godkänn". A's page lists what it
     uses, with each target's state, audience and health. B's page lists who uses it.
   - **Before turning B off.** Disabling B, narrowing its audience or turning off a used capability names the
     dependents in the confirmation.
5. **B's output is checked when another connector reads it.** On a cross-connector call Clew validates B's output
   against B's declared output schema. A mismatch reaches A as `unavailable` ("Svaret följer inte kontraktet") and is
   recorded on B's health. A silent shape change then becomes the missing-source case that composites must already
   handle: name the source, mark the result partial. An empty output schema promises nothing and passes.
6. **`connector-check` checks `uses`.** With `--clew <url>` it asks the running Clew whether every used capability
   exists and is compatible, so a connector team sees a break before deploying.

Build order: the audit row at boot and the dependents in the diff (4), `uses` and its enforcement (1), the verdicts
(3), output validation on calls (5), `deprecated` and the admin lists (2, 4), then the checker (6).

**Why.** The product owner asked what happens to A when B changes, and whether connectors need versions. As built,
each kind of change hits A differently:

- **Input.** A call is validated against B's *current* input schema, so a new required field reaches A as `invalid`
  at runtime.
- **Output.** B's output is not checked at all, so a changed shape reaches A's code silently.
- **Boot.** A changed manifest goes live at boot without review or an audit row.
- **Manual refresh.** "Hämta manifest igen" shows what was added, removed and changed, but not whether a change
  breaks anyone, or whom.

A version per connector was weighed and left. Connectors are separate deployments run by different teams and
municipalities, and a version on B says that something changed, not whether A cares. Pinning A to a version of B
gives dependency resolution between services that deploy independently, and B could still only serve one version.
Clew is the broker and holds both manifests, so it can check compatibility itself, per capability, at the one moment
that matters: when B's manifest changes. Consumer-driven contract testing (Pact) was also left. It needs a broker and
a test suite on both sides for what two JSON Schemas and a declared `uses` already say.

**Replaces.** Nothing. Extends the connector protocol (`docs/architecture/connector-protocol.md`, manifest fields
`uses` and `deprecated`) and connector administration (D23: health `degraded`, dependents on the admin page).
