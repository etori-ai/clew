# D78 · Work items, cards and proposals have distinct meanings

**Status:** accepted · **Date:** 2026-11-08 · **Area:** product

**Decision.** Use the [vocabulary and entity map](../reference/vocabulary.md) as the shared product vocabulary in current documentation and design discussions.

1. A **work item** is the work Clew tracks for a person, including suggestions, work waiting on others and information to acknowledge. A **card** or work-list **row** presents it. Opening that presentation shows the **work item's detail view**, usually in the **side panel**; it does not create another work item.
2. A **proposal** is a suggested change prepared for review. Qualify **booking proposal** and **job proposal** when needed. Approval is a **decision**; a **job** groups steps approved together; an **execution** tracks an approved source operation; a **watch** checks for a result; a **receipt** records the outcome, including uncertainty.
3. A **source record** belongs to its **source system**, reached through a **connector** and its **capabilities**. A work item can concern several records. Reserve **case / ärende** for actual source-system cases.
4. A **conversation** is the exchange with the assistant. **Context chips** reference work items and other supported objects. Use **page**, **view**, **side panel** and **tab** for interface destinations, presentations and containers.
5. Use concrete Swedish content and action names in the interface, such as “Granska fakturor” and “Visa bokningsförslaget”. **Work item** is the English umbrella term for specifications and documentation.
6. Keep **thread** for existing implementation references. The current `Thread` combines work and conversation fields, while `Proposal` is calendar-specific. This decision does not rename code, routes, protocol fields or database records, and does not establish new job interfaces or stored links between successive jobs.

**Why.** Calling the tracked work, its visual card and a proposed change by interchangeable names makes interactions difficult to describe. The product owner requested a shared vocabulary and entity map, then asked for the documentation to adopt it. Separating the work from its presentation gives a stable description across Home, lists, the panel and conversations, and keeps approved work meaningful while execution or replies are still pending.

**Replaces.** The combined “Thread/card” definition in the product overview. Earlier decisions retain their wording and behavior: [D12](D12-objects-chips-proposals.md) establishes referenceable objects and chips, [D30](D30-a-proposal-thread-is-an-obligation-with-four-steps.md) tracks a calendar obligation, and [D50](D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md) separates conversations and panel content. This decision clarifies their vocabulary without superseding their interaction rules.
