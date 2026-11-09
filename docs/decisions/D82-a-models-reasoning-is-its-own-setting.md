# D82 · A model's reasoning is its own setting, and the model test settles it

**Status:** accepted, built 2026-11-09 · **Date:** 2026-11-07, revised 2026-11-09 · **Area:** product

**Decision.** A model has a `reasoning` value beside `tools` (D24). `provider-default`, what every model starts with,
sends nothing about reasoning. `none` sends `reasoning_effort: "none"` through the AI SDK's `reasoning` call option.
Nobody sets it by hand: the model test settles it, run when a model is added and again on "Testa". The test sends a call shaped like a turn, with one tool when the
model has tools on, first with nothing about reasoning. When the provider refuses that call and takes the same call with
`reasoning_effort: "none"`, the model's value becomes `none`; when it takes the first call, the value becomes
`provider-default`. A change writes a `model.reasoning` audit row with the old value, the new one and `found: test`, in
the transaction that changes the row. The model's page shows the value as a sentence under "Resonemang", and the test's
findings say when Clew asks the model not to reason. Adding a model returns the test's report beside the model; a
failed test keeps the model, which starts switched off anyway, and the add dialogs' announcement names each model that
did not answer. The value is a closed list, so a later effort level is a new
literal and not a new column.

**Why.** The product owner saw "Modellen svarar inte just nu." on every free-text question with `gpt-6-luna`. The
provider refused the call: "Function tools with reasoning_effort are not supported for gpt-6-luna in
/v1/chat/completions. To use function tools, use /v1/responses or set reasoning_effort to 'none'." Clew sent no
`reasoning_effort`; the model's own default collided with tools. "Testa" said the model answered, because its tiny
completion carried no tools, so the administrator had a green result and a failing composer. The first version of this
decision (2026-11-07) added a switch, "Utan resonemang". The product owner found a switch the wrong level: whether a
provider takes tools with reasoning is a fact about the provider, and the administrator should not need to know what
reasoning is to get a working model. The restriction is the provider's choice, not a protocol rule: self-hosted
servers such as vLLM, Ollama and llama.cpp take tools with reasoning in a chat completion.

**Rejected alternatives.**

- `reasoning: 'none'` on every call, one line in `createGenerator`. It fixes this model and sends a field to every
  endpoint, while the repository's promise is that any open-weight model behind an OpenAI-compatible server works
  (`CLAUDE.md`, D24). A strict server may refuse a field it does not know, and a model that does well with reasoning
  would lose it.
- `/v1/responses`, the provider's other suggestion. It carries reasoning between tool calls, but it is a vendor's API;
  the chat completion protocol is the one every self-hosted server offers and the only one Clew speaks (D24). Taking it
  up is its own decision.
- A switch for the administrator (this decision's first version). It asks a person to diagnose what the test can prove.
- Inferring it from the model's name or from the provider's error text. A list of names ages with every release, and
  an error message is not a contract. The evidence is the same call failing one way and passing the other.
- Retrying a refused turn without the field. It doubles the refused calls on every question, puts a write in the turn
  path and leaves no record of what was sent. The test does it once, where an administrator acts, and writes the row.

**Consequences.** Migration `0036_model_reasoning` adds the column with the default, so existing models send what they
sent before. A model added before this revision keeps `provider-default` until an administrator presses "Testa"; one
added now is settled before anyone can ask it a question. Adding a model costs one or two tiny calls to its provider. A later test starts from the default again, so a provider that starts taking
tools with reasoning gets the model's own reasoning back. A test that fails for another reason (a wrong model id, a
refused key, no answer), or whose second call also fails, leaves the value as it was and reports the first call's
error. A model with tools off is tested without a tool and settles at `provider-default`. The minute probe still reads
`GET /models` only; it proves the endpoint answers, and a model's refusal surfaces at "Testa" or in the server log. A
failed turn still marks the provider down until a probe or a test brings it back (D8).
