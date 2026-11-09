# Independent MCP development providers

Medarbetarpuls is a single-person synthetic poll provider; `../mcp-status` is a tools-only service-status provider. Neither imports Clew code, serves a Clew manifest, nor calls a Clew API. They expose standard MCP Streamable HTTP. The poll HTML uses MCP Apps JSON-RPC, `_meta.ui.resourceUri` and `text/html;profile=mcp-app`.

Start the services from the host, then register policy inside the development container:

```sh
docker compose -f .devcontainer/compose.yaml up -d mcp-pulse mcp-status
docker exec -w /workspace clew-app-1 bun run db:init
docker exec -w /workspace clew-app-1 bun scripts/dev-mcp.ts --person hillevi
```

The script discovers the real catalogues and inserts only endpoint, person, allowlists and watch policy with an audit row. It is idempotent and preserves existing configuration. `--person` is required; there is no Hillevi name check in the application. Default interval is 30 seconds for this demonstration; use `--interval 604800` on initial registration for weekly reads. The normal development BFF reconciles registrations into Temporal workflows. It must already have an enabled model available to the target person (a model need not generate text for a deterministic read).

Sign in as Hillevi and open a card under Home → **Från dina tjänster**, or use **Alla tjänster** to open the catalogue sidebar over the same page (`open-services=1`). `/chat/services` and `/labs/mcp` are compatibility redirects to that overlay over Home. Each delivery opens in the existing sidebar overlay, or a tall sheet on a phone, with Home or the catalogue still underneath. Opening a service from the catalogue keeps that catalogue underneath; close returns to its entry, then to the page. A card opened directly from Home returns to that card. The page's filters and unsent draft stay intact. The address carries `open-service` and `open-delivery`, and earlier service-page links redirect to the matching overlay. Clew obtains the tools, text and HTML over HTTP; nothing imports mock content into the web bundle. The first poll is delivered by Temporal. Home and the service inbox refresh within ten seconds. The first healthy status read establishes a quiet baseline. Delivery continues without an open browser.

Change the source, then wait for the configured watch (up to 30 seconds plus the ten-second UI refresh by default):

```sh
docker exec -w /workspace clew-app-1 bun -e "await fetch('http://mcp-pulse:4035/fixture/next-week', {method:'POST'})"
docker exec -w /workspace clew-app-1 bun -e "await fetch('http://mcp-status:4036/fixture/down', {method:'POST'})"
docker exec -w /workspace clew-app-1 bun -e "await fetch('http://mcp-status:4036/fixture/up', {method:'POST'})"
```

These fixture-control addresses change the fake vendor's state, not Clew's inbox. They are not MCP tools or a required provider integration. Published host ports are loopback-only, 4035 and 4036. The providers' source state is in memory and resets when their containers restart; Clew's registrations, evidence, deliveries and decision receipts persist in Postgres. Resetting a provider does not erase Clew's deduplication history.

`get_pending_poll` exposes the App; app-only `submit_poll` validates the current poll and score, deduplicates an identical answer and returns a receipt without the raw score. Clew asks for confirmation before the real `tools/call`, audits the decision and seals the receipt. The answer does not enter model context or chat history. After a successful submission, Clew re-reads the configured pending-poll tool and immediately refreshes the inbox. When that read confirms the same poll is answered, its card disappears while the open App can show the receipt. Opening an already-answered poll or the next scheduled check does the same, so answers made elsewhere also clear the card. A failed or incomplete read keeps the card until a later successful check; the write is never repeated just to refresh attention. Closing a resolved card returns focus to **Alla tjänster**. Its original link remains usable, and a new week can create a new card. Notices without a configured attention condition do not disappear automatically.

Development only: one synthetic provider identity, no vendor OAuth, no real employee data. The source uses a small stateless JSON-response transport; GET/SSE and session replay are unsupported. Clew uses the official client SDK, but its limited browser bridge is not a production MCP Apps host. Production OAuth, sandboxing, normal conversational tool routing, unread/expiry and attention policy remain in [the architecture plan](../../docs/architecture/mcp-chat-services.md).
