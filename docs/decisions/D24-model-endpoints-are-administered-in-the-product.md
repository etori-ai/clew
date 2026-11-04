# D24 · Model providers and models are administered in the product, and the chat can choose between them

**Status:** proposed · **Date:** 2026-11-04 · **Area:** product

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
