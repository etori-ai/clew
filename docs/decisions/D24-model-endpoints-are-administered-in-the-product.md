# D24 · Model providers and models are administered in the product, and the chat can choose between them

**Status:** accepted, built 2026-11-05; the check script of As built amended 2026-11-12 in the fixes of the review of users and the organisation (R4): `models-check` is for the development stack, switches its model on for its own unit only and deletes only its own audit rows · **Date:** 2026-11-04 · **Area:** product

**Amended 2026-11-12.** R4 of the
[review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md)
found that a run of `bun scripts/models-check.ts` deleted the audit history administrators had written about an
earlier, removed model of the same name, and put its model in every person's menu while it ran. The script, named in
the last item of As built, now works this way:

- It is for the development stack. Unless `CLEW_POC=true`, or `--confirm` is given, it exits with code 2 before it
  opens the database: "models-check is for the development stack (CLEW_POC=true): it adds a provider, a model and a
  person to this installation and removes them afterwards. Run again with --confirm to run it here."
- Each run uses throwaway ids: the provider `check-<run>`, the person `check-<run>-person` in the organisation `check`,
  and the unit `check-<run>-unit`.
- It switches the model on for that unit only, in the same call that enables it, so the model is never in anybody
  else's menu.
- Its clean-up deletes the model, the provider, the person and only the audit rows whose actor is
  `person:check-<run>-person`, so what administrators wrote about an earlier model with the same id stays.
- A run killed before its clean-up leaves the model, the provider, their audit rows and the person behind.
- Without `--url`, the stand-in endpoint answers streamed and whole requests, as a turn asks.

Why, since the choices were taken in the work: a refusal outside the development stack, with `--confirm` to run it
anyway, was chosen over a script that runs anywhere, because it adds a person and a model to the installation it runs
in; and over removing the script, because it is the one live check of the model adapters against a real endpoint and
an operator may need it in a test installation. Deleting only the run's own audit rows keeps an organisation's audit
trail whole, which a public body must be able to show, and a unit of its own keeps a check from changing what
thousands of people are offered while it runs.

**Decision.** The inference endpoint behind the composer is no longer one set of environment variables
(`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`). An administrator adds **providers** (an OpenAI-compatible base
URL and a key, sealed in the database like a connector's secret, D23) and **models** under them (the model
id, a Swedish display name, a short description of what it is good for, optional context and cost notes) on
the same administration surface as the connectors (`docs/architecture/connector-administration.md`,
section "Modeller"). Each model can be switched on or off, given an audience (the same roles, units and
later groups shape as a connector) and marked as the installation's default. The composer offers the person
the models in their audience and remembers their choice; the server validates the choice on every request
and records which model produced an answer. No restart, no environment variable, no `AI_*` in
`.env.example`. The only protocol is still the OpenAI-compatible chat completion API with tool calling, so
an open-weight, self-hosted model remains a complete installation; a closed model is an operator's choice
and never something the repository depends on (`CLAUDE.md`).

**Why.** The same operating model as D23: Clew is run as a hosted service by people with a browser, and
"which model answers" is a decision the municipality takes and changes (a new self-hosted model, a pilot of
a second provider, a cheaper model for simple questions), not a deployment parameter. One endpoint also
hid a real need: different questions want different models, and a person who asks about their calendar
should be able to pick the small local model while a manager drafting a long reply picks the capable one.
Keeping several models behind one environment variable is not possible; keeping them in the database with
an audience is the same mechanism connectors already need.

This narrows the Clew/Eneo line in `docs/vision.md` ("no model administration beyond which endpoint",
"one environment variable in Clew") to: Clew administers **which endpoints and models the composer may
use and who may pick them**; Eneo keeps model administration as a product (provider catalogues, quotas,
security classifications, assistant builders, knowledge). When Eneo is installed and exposes an
OpenAI-compatible endpoint with tool passthrough, it is one provider in Clew's list, and classifications it
publishes become inputs to Clew's own rule about which data may leave (unchanged). The vision text is
updated with this decision.

**Replaces.** The `AI_*` environment configuration of `apps/server/src/assistant/model.ts` (session 5) and the
two vision sentences above. D8 is unchanged: every model may be off and the composer still routes
deterministically. D14 is unchanged in substance; its "one environment variable" wording is superseded by
this decision.

**As built (2026-11-05).** The design in `docs/architecture/connector-administration.md` (section Modeller) holds,
with these settled while building:

- *Nothing is cached in process.* The turn reads the provider and model rows and the person's pick from Postgres
  and opens the key for that call only, so a change on any instance is live on the next question without a watcher
  or a restart. What stays in process is health per provider (`ModelHealth`): a failed turn marks it down, the
  minute probe (`GET /models`; an endpoint without a list counts as answering) or "Testa" brings it back, and a
  provider nobody has checked yet is worth trying.
- *The person's model* is their pick if they may still use it, else the default, else the first switched-on model
  in their audience; none means the router (D8). So one switched-on model works without being marked default, and a
  model taken away falls back without a word: the answer's "Svar från …" line shows it.
- *The default* is at most one switched-on model, held by a partial unique index; setting a new one clears the old
  one in the same transaction, each with its audit row, and switching the default off clears its flag. A new model
  starts off, for everyone, not the default.
- *The grant* is the administration grant `admin.connectors`: one surface, one grant, until a reason to split them.
- *The composer's menu* sits in `ChatComposer`'s `footerActions`, the slot Astryx documents for a model selector
  (template `ChatComposerFooterActions`), not in `headerActions`. It is a compound `DropdownMenu` with a
  `DropdownMenuRadioGroup`, which Astryx supports in the popover presentation only, so a phone gets the anchored
  menu, not a sheet. The menu shows when the person has two models or more (amended by D36: whenever a model answers, also with one); a pick is `PATCH /api/assistant/model`,
  audited as `model.chosen` on `person:<id>`.
- *Not built:* the context and cost notes, a structural preview per role (a model is either in the audience or not),
  reordering (the order is the order added), and classification-gated inference (still the open question in
  `vision.md`). `bun scripts/models-check.ts` proves the live adapters against a stand-in endpoint, or against a
  real one with `--url` and `--model`.
