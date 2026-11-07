# D77 · A model's reasoning is its own setting, and "Testa" tries a real turn's shape

**Status:** accepted, built 2026-11-07 · **Date:** 2026-11-07 · **Area:** product

**Decision.** A model has a `reasoning` setting beside `tools`, administered on its page (D24). `provider-default`, what
every model starts with, sends nothing about reasoning. `none` sends `reasoning_effort: "none"` through the AI SDK's
`reasoning` call option. The page draws it as the switch "Utan resonemang", which applies at once like Verktyg and
writes a `model.reasoning` audit row with the old and the new value. The value is a closed list, so a later effort level
is a new literal and not a new column. "Testa" on a model now sends a call shaped like a turn: it offers one tool when
the model has tools on and carries `reasoning_effort` when the model is set to `none`.

**Why.** The product owner saw "Modellen svarar inte just nu." on every free-text question with `gpt-6-luna`. The
provider refused the call: "Function tools with reasoning_effort are not supported for gpt-6-luna in
/v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'." Clew sends no
`reasoning_effort`; the model's own default collides with tools. Two things made it worse than one bad call. The model
was unusable with no setting to fix it. And "Testa" said the model answered, because its tiny completion carried no
tools, so the administrator had a green result and a failing composer.

**Rejected alternatives.**

- `reasoning: 'none'` on every call, one line in `createGenerator`. It fixes this model and sends a field to every
  endpoint, while the repository's promise is that any open-weight model behind an OpenAI-compatible server works
  (`CLAUDE.md`, D24). A strict server may refuse a field it does not know, and a model that does well with reasoning
  would lose it.
- `/v1/responses`, the provider's other suggestion. It is a vendor's API; the chat completion protocol is the one
  every self-hosted server offers and the only one Clew speaks (D24).
- Inferring it from the model's name or from the provider's error text. A list of names ages with every release, and
  an error message is not a contract. The administrator decides, and "Testa" shows the result.
- Retrying a refused call without the field. It hides the setting, doubles the refused calls and leaves the audit
  without a record of what was sent.

**Consequences.** Migration `0035_model_reasoning` adds the column with the default, so existing models send what they
sent before. A test of a model with tools on can fail where it passed before: that model would have failed its first
turn, so the failure moved to where the administrator can act on it, and the finding carries the provider's own words.
The minute probe still reads `GET /models` only: it proves the endpoint answers, and a model's refusal surfaces at
"Testa" or in the server log. A failed turn still marks the provider down until a probe or a test brings it back (D8).
