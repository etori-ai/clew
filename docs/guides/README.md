# Guides

Step-by-step instructions for recurring work. A guide says how; the reasons are in `docs/decisions/` and
`docs/architecture/`. Keep each guide runnable: commands as they are typed inside the devcontainer, code
that compiles against the current types, and a worked example where one helps.

| Guide | For |
|---|---|
| [Creating a connector](creating-a-connector.md) | Connecting a system to Clew as its own service behind the connector protocol, in any language, registered by an administrator: the questions to answer first, the manifest, the four routes, the assertion, the checker, connecting it to a running Clew, shipping. The one path for every integration, ours or a third party's (D21, D23) |
| [Worked example: a custom employee directory](example-custom-directory.md) | A made-up municipality, Fjällby kommun, connects its own directory system end to end: contract, adapter, connector, registration, tests, documentation |

Adding a guide: one file, kebab-case name, a first sentence that says who it is for, and a row here.
