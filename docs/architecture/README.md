# Architecture and design background

For connector implementation use the [current protocol](../reference/connector-protocol.md), [guides](../guides/README.md) and [support matrix](../reference/status.md). These pages retain internal architecture and design reasoning. Several date from before connector services, declared views and protocol 2; their examples are not current implementation instructions.

| Page | How to use it |
|---|---|
| [Backend structure](backend-structure.md) | Maintainer code organization, dependency direction and ports. |
| [Testing](testing.md) | Maintainer test layers and commands. |
| [Connector administration](connector-administration.md) | Administration design and as-built notes; verify current behavior in the admin use cases. |
| [Reliability and authorization plan](reliability-and-authorization-plan.md) | Phased delivery plan; distinguish the plan from the implementations now present. |
| [Integration principles](integrations.md) | Early design background; in-process integration and MCP-hosting examples were replaced by connector services. |
| [Integration paths](integration-paths.md) | Historical landscape and candidate source systems; current availability is in the support matrix. |
| [Capability surfaces](capability-surfaces.md) | Design of REST, model and possible MCP surfaces; a designed MCP surface is not a supported endpoint. |
| [Working across connectors](working-across-connectors.md) | Identity/ref composition rationale; current callback authorization is in the integrator guide. |
| [Identity](identity.md) | Original OIDC/OAuth, MCP and SCIM design; current connector requests use the distinct protocol 2 authority. |
| [Scheduled work](scheduled-work.md) | Historical Postgres scheduler rationale and Temporal adoption criteria; Temporal has since been adopted. |

Decision records are indexed [separately](../decisions/README.md). Read the linked implementation when a design says “today” or “not built”: those words describe the revision reviewed, not every later checkout.
