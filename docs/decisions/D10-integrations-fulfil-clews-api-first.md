# D10 · Integrations fulfil Clew's API; adapters are the fallback

**Status:** accepted, order of work amended by [D100](D100-the-vision-is-narrowed-to-what-clew-can-keep-today.md) (2026-11-10: an adapter is the normal case; asking the system's owner first is no longer a fixed step) · **Date:** 2026-11-03 · **Area:** integrations

**Decision.** When a system is connected to Clew, the order is fixed. First, the integration is asked to
implement the API Clew has defined for that domain (the capability descriptors in `packages/contracts` and
the provider interface of the module, for example `CalendarProvider`). That applies to vendors, to other
municipalities' teams and to Sundsvall's own dept44 services. Only when the system cannot or will not do so
does Clew write an adapter that translates from the system's protocol to Clew's contract. The adapter is
Clew's code, in Clew's repository, under Clew's licence; the contract does not move to accommodate it.

**Why.** D1 says Clew owns the contract. D10 says who does the work of meeting it. Asking the integration
first keeps adapter count low and makes a vendor's "we support Clew" a checkable claim. Writing our own
adapter when that fails keeps every system reachable regardless of vendor interest. The two together mean
no system is ever a blocker for the platform, at worst a cost.

**What it means in practice.** Sundsvall's landscape checked 2026-11-03: Heroma is reached by RPA today
(no API; `RPA-Heroma` on github.com/Sundsvallskommun), Raindance through the municipality's own dept44
services behind the WSO2 gateway, aggregates through `api-service-datawarehousereader`. These will be
adapters in `service` auth mode with a `scope` rule. Microsoft 365 is reached through Microsoft Graph, an
adapter in `user-delegated` mode. A dept44 service that exposes Clew's contract directly needs no adapter.

**Replaces.** Nothing; makes the adapter policy in `docs/architecture/integrations.md` explicit.
