import type { Actor, Registry } from '../packages/connectors/src/index';
import type { DocumentBundle } from '../packages/contracts/src/index';

/** Source-level conditional revisions for fixture tests. Production approval also needs Clew's signed review evidence. */
export async function invoiceInput(registry: Registry, actor: Actor, refs: string[]) {
  const reviews = await Promise.all(
    refs.map(async ref => {
      const { document } = await registry.run<{ document: DocumentBundle }>(actor, 'finance.documents', { ref });
      return {
        ref,
        revision: document.revision,
        documents: document.documents.map(d => ({ id: d.id, revision: d.revision })),
      };
    }),
  );
  return { refs, reviews };
}
