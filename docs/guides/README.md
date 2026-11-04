# Guides

Step-by-step instructions for recurring work. A guide says how; the reasons are in `docs/decisions/` and
`docs/architecture/`. Keep each guide runnable: commands as they are typed inside the devcontainer, code
that compiles against the current types, and a worked example where one helps.

| Guide | For |
|---|---|
| [Creating an external connector](creating-an-external-connector.md) | Connecting a system as its own service behind the connector protocol, in any language, without changing Clew: manifest, routes, assertion, checker, wiring into a stack. The default path for every integration, ours or a third party's (D21) |
| [Creating an integration](creating-an-integration.md) | Connecting a system to Clew: the two paths (the system fulfils Clew's contract, or Clew gets an adapter), the order of work, what a review checks |
| [Worked example: a custom employee directory](example-custom-directory.md) | A made-up municipality, Fjällby kommun, connects its own directory system end to end: contract, adapter, connector, registration, tests, documentation |

Adding a guide: one file, kebab-case name, a first sentence that says who it is for, and a row here.
