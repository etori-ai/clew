# Exploration note: external MCP services in AI chat, built and removed · 2026-11-11

Status: closing note. The prototype of [D81](../decisions/D81-mcp-apps-extend-ai-chat-with-provider-owned-interactions.md)
was built 2026-11-08 to 2026-11-09 and removed from the code on 2026-11-11. The product owner's reason: consuming a
vendor's own MCP server is not a use case now. The prototype was built to see whether it fits the architecture and
can be built. It does and it can. D81 is withdrawn; nothing in the repository depends on it.

## What was asked

Can a vendor that already has a standard MCP server, and perhaps an MCP App, be used from Clew without building a
Clew connector or writing a Clew manifest? And can Clew still keep its own rules around it: access checked on the
server, a human decision before a write, an audit row, and a card when something new needs the person?

## What was built

- A gateway in the server (`apps/server/src/mcp/`) shaped like every other use-case folder: contracts, a pure domain
  file, use cases over ports, an HTTP adapter on the official MCP SDK (`@modelcontextprotocol/sdk`, MIT) and a
  Postgres adapter. Three tables: `mcp_connection`, `mcp_delivery`, `mcp_decision`.
- Two independent mock providers speaking plain MCP over HTTP (`fixtures/mcp-pulse`, a staff poll with an MCP App;
  `fixtures/mcp-status`, a tool-only service status), each its own compose service. Neither knew about Clew.
- A read watch as a durable workflow (`mcpWatch`): an approved read on an interval, compared by a configured identity
  and condition in the tool's structured result, one deduplicated delivery per new item, and the delivery resolved
  when a later read showed the item no longer needed the person.
- In the web app: a section "Från dina tjänster" on Hem with one card per delivery, a service catalogue and the
  opened App or notice as overlays over the current page, the provider's HTML in a sandboxed frame behind a small
  bridge, and Clew's own confirmation before an App's write was sent.
- A registration script (`scripts/dev-mcp.ts`), unit, Postgres, Node runtime and browser tests.

All of it ran only with `CLEW_POC=true`, never in production, for one synthetic identity per provider.

## What it showed

1. **It fits.** The gateway sat beside the connector registry without changing it. The dependency and purity rules
   (D20, D25) covered it unchanged. No module imported it and it imported no module.
2. **A provider needs no Clew contract.** Tool names, schemas, results and App HTML came from the providers over
   standard MCP. What Clew added (which tools may be read or written, what counts as new, when it stops needing the
   person) was host configuration saved at registration, never something the provider supplied.
3. **Clew's rules can be kept around a foreign tool.** Access and the model gate were checked on every read. A write
   was bound to an immutable decision before dispatch, its result stored sealed, a repeat replayed the stored result,
   and an uncertain outcome stayed unknown instead of being retried.
4. **Proactive cards work without vendor push.** A scheduled read plus a comparison rule was enough for "a new poll is
   waiting" and "the service is down, then back". The rule needs a stable identity in the result; a provider that
   returns only free text cannot be watched this way.
5. **The durable engine carried it.** A watch was rounds of at most a hundred reads, restarted by a reconciler, so
   one workflow's history stayed bounded.

## What was not done

- No provider OAuth. This is the large missing part: discovery, authorization code with PKCE, client registration or
  administrator-supplied client credentials, sealed per-person tokens, refresh and revocation.
- No production App host: a dedicated sandbox origin, the full Apps bridge and a compatibility matrix.
- No administration page, no enabling of a service per conversation, and no routing of MCP tools to the model.
- Writes used a small decision table of their own, not the execution ledger (D45, D47).
- No real provider was met. The [provider review](2026-11-08-mcp-services-and-provider-compatibility.md) is the only
  evidence about real vendors, and it found no vendor offering exactly the poll-plus-App flow.
- Accessibility was checked for the synthetic App only. A sandbox cannot make a provider's interface conform.

## If this is taken up again

Start from OAuth, not from the interface: without a per-person provider token nothing here can meet a real vendor.
Decide first whether a write goes through the execution ledger. Take the comparison-rule design (identity plus
condition, resolved by a later read) as it was; it was the part that worked best.

The related question, an ordinary connector that uses MCP as its source API, is unaffected by this removal and is
described in [MCP-backed native connectors](2026-11-09-mcp-backed-native-connectors.md).

## Where the removed work is

The last commit that contains the prototype is `37049a7`. To read it:

```sh
git show 37049a7:docs/architecture/mcp-chat-services.md   # the full design and the trace of the implemented path
git ls-tree -r --name-only 37049a7 | grep -i mcp          # every file of the prototype
```

Migration `0047_drop_mcp_chat_services` drops the three tables. Audit rows the prototype wrote stay in `audit`. Rounds
of `mcpWatch` that were still pending when the code was removed belong to no registered workflow; cancel them once
with `DBOS.cancelWorkflow` or leave them, they do nothing.

Paths in older reviews, decisions and session notes that point into `apps/server/src/mcp/`, `apps/web/src/labs/mcp/`
or `fixtures/` name files that exist only in that history.
