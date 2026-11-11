import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { ManifestReference, ReferenceField, ReferenceRecipe, ReferenceRule } from '@clew/contracts';
import {
  Banner,
  Button,
  CodeBlock,
  Divider,
  Heading,
  Layout,
  LayoutContent,
  LayoutPanel,
  Link,
  Markdown,
  MetadataList,
  MetadataListItem,
  Outline,
  Selector,
  Skeleton,
  Tab,
  TabList,
  Text,
  TextInput,
  VStack,
  useMediaQuery,
  type OutlineItem,
} from '@clew/ui';
import { createQueryClient } from '../query-client';
import { manifestReferenceQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';

/**
 * The connector manifest field by field (D60, item 5), for the integrator who builds against this instance. Public,
 * like the login, and outside the session's shell: documentation, so English. Astryx's `documentation-technical`
 * template: the article in one column, an Outline of the headings in a sticky panel at its start (the product owner put
 * the field list on the left), a Selector in its place on a phone, and a reference's width rather than a form's.
 * Everything on the page is data from `/api/protocol/manifest-reference.json`, generated from the schema the instance
 * validates manifests with; the browser draws and never decides. Rule texts are Markdown lists: a ListItem keeps to one
 * line, and a rule is a sentence or two. A filter above the outline narrows it to the headings whose path or name holds
 * the typed text, each then named by its full path; the count is spoken as it changes.
 */
const mobileQuery = '(max-width: 768px)';
/** The template's own panel style: the outline stays put while the article scrolls, and scrolls itself when it is taller than the window. */
const outlinePanel: CSSProperties = {
  position: 'sticky',
  top: 24,
  alignSelf: 'start',
  maxHeight: 'calc(100vh - 48px)',
  overflowY: 'auto',
};
const json = (value: unknown) => JSON.stringify(value, null, 2);
const leaf = (path: string) => path.split('.').at(-1) ?? path;
const presence = (f: ReferenceField) =>
  (f.required ? 'required' : 'optional') + (f.variants ? ` (${f.variants.join(', ')} only)` : '');
const where: Record<ReferenceRule['enforced'], string> = {
  loader: 'when the manifest is loaded',
  registry: 'when the connector is registered',
  check: 'in the conformance check',
  call: 'on each call',
};
const ruleLine = (r: ReferenceRule, detail = '') =>
  `- **${r.title}.** ${r.text}${r.decision ? ` (${r.decision})` : ''}${detail}`;

function outlineOf(reference: ManifestReference): OutlineItem[] {
  return [
    { id: 'recipes', label: 'Recipes', level: 2 },
    ...reference.recipes.map(r => ({ id: `recipe-${r.id}`, label: r.title, level: 3 })),
    { id: 'fields', label: 'Fields', level: 2 },
    ...reference.sections.flatMap(s => [
      { id: `section-${s.id}`, label: s.title, level: 3 },
      ...s.paths.map(p => {
        const f = reference.fields.find(f => f.path === p)!;
        return { id: f.id, label: leaf(p), level: Math.min(4 + f.depth, 6) };
      }),
    ]),
    { id: 'rules', label: 'Every rule', level: 2 },
  ];
}

/** The outline narrowed to what holds the text: a field by its path, anything else by its name. Matches are named by their path, so the context shows. */
function narrow(items: OutlineItem[], pathOf: Map<string, string>, text: string): OutlineItem[] {
  const q = text.trim().toLowerCase();
  if (!q) return items;
  return items.flatMap(i => {
    const path = pathOf.get(i.id);
    const hit = (path ?? i.label).toLowerCase().includes(q);
    return hit ? [{ id: i.id, label: path ?? i.label, level: 3 }] : [];
  });
}

/** A recipe's example as JSON and, where it holds a schema, the same authored with TypeBox, in two tabs (the admin page's tab pattern). */
function Example({ recipe }: { recipe: ReferenceRecipe }) {
  const [tab, setTab] = useState<'json' | 'typebox'>('json');
  const block = (code: string, language: string) => (
    <CodeBlock
      code={code}
      language={language}
      title="Example"
      hasLanguageLabel={false}
      width="100%"
      isWrapped
      maxHeight={420}
    />
  );
  if (!recipe.typebox) return block(json(recipe.example), 'json');
  const panel = (t: string) => `example-${recipe.id}-${t}`;
  return (
    <VStack gap={2}>
      <TabList value={tab} onChange={v => setTab(v as 'json' | 'typebox')} size="sm" role="tablist">
        <Tab value="json" label="JSON" panelId={panel('json')} />
        <Tab value="typebox" label="TypeBox" panelId={panel('typebox')} />
      </TabList>
      {tab === 'json' && (
        <div id={panel('json')} role="tabpanel" aria-label="JSON">
          {block(json(recipe.example), 'json')}
        </div>
      )}
      {tab === 'typebox' && (
        <div id={panel('typebox')} role="tabpanel" aria-label="TypeBox">
          {block(recipe.typebox, 'ts')}
        </div>
      )}
    </VStack>
  );
}

function Field({ field }: { field: ReferenceField }) {
  return (
    <VStack gap={2}>
      <Heading level={4} id={field.id}>
        {field.path}
      </Heading>
      <Markdown>{field.description}</Markdown>
      <MetadataList>
        <MetadataListItem label="Type">{field.type}</MetadataListItem>
        <MetadataListItem label="Presence">{presence(field)}</MetadataListItem>
        {field.constraints.length > 0 && (
          <MetadataListItem label="Constraints">{field.constraints.join('; ')}</MetadataListItem>
        )}
      </MetadataList>
      {field.rules.length > 0 && (
        <VStack gap={1}>
          <Text as="p" weight="semibold">
            Pairs with
          </Text>
          <Markdown>{field.rules.map(r => ruleLine(r)).join('\n')}</Markdown>
        </VStack>
      )}
      {field.example !== undefined && (
        <CodeBlock
          code={json(field.example)}
          language="json"
          title="Example"
          hasLanguageLabel={false}
          width="100%"
          isWrapped
        />
      )}
    </VStack>
  );
}

function Article({ reference }: { reference: ManifestReference }) {
  const mobile = useMediaQuery(mobileQuery);
  const items = useMemo(() => outlineOf(reference), [reference]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const scrollTo = useCallback((id: string) => {
    setActiveId(id);
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ block: 'start' });
      window.history.pushState(null, '', `#${id}`);
      target.focus?.();
    }
  }, []);
  // An address with an entry's anchor (a field, or a rule the manifest preview links to) lands on it once it is drawn:
  // the article arrives after the page, so the browser's own jump to the fragment found nothing.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    const target = id ? document.getElementById(id) : null;
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    if (target.hasAttribute('tabindex')) target.focus({ preventScroll: true });
    setActiveId(id);
  }, []);
  const byPath = useMemo(() => new Map(reference.fields.map(f => [f.path, f])), [reference]);
  const pathOf = useMemo(() => new Map(reference.fields.map(f => [f.id, f.path])), [reference]);
  const [filter, setFilter] = useState('');
  const shown = useMemo(() => narrow(items, pathOf, filter), [items, pathOf, filter]);
  const filterField = (
    <TextInput
      type="search"
      label="Filter the outline"
      isLabelHidden
      placeholder="Filter"
      value={filter}
      onChange={setFilter}
      hasClear
      startIcon="search"
      size="sm"
      width="100%"
    />
  );
  const count = filter.trim() ? (
    <Text as="p" type="supporting" color="secondary" role="status">
      {shown.length === 1 ? '1 heading' : `${shown.length} headings`} of {items.length}
    </Text>
  ) : null;
  return (
    <Layout
      height="auto"
      contentWidth={1280}
      start={
        mobile ? undefined : (
          <LayoutPanel isScrollable={false} label="On this page" role="complementary" style={outlinePanel}>
            <VStack gap={2}>
              {filterField}
              {count}
              <Outline items={shown} density="compact" label="On this page" onActiveIdChange={setActiveId} />
            </VStack>
          </LayoutPanel>
        )
      }
      content={
        <LayoutContent role="main" isScrollable={false} padding={8}>
          <VStack gap={8}>
            <VStack gap={2}>
              <Heading level={1}>Clew manifest reference</Heading>
              <Text as="p" color="secondary">
                Protocol {reference.protocol}. One entry per field of the connector manifest: what it does, its type,
                whether it is required, its constraints, an example and what it must agree with. Generated from the
                schema this instance validates manifests with, so nothing here is a field that does not exist. The
                Swedish in examples is what a person reads in Clew; everything else in a manifest is English.
              </Text>
              <Text as="p" color="secondary">
                The routes on both sides are on <a href="/api/protocol">the OpenAPI page</a>. A manifest can be tried on{' '}
                <Link href="/protocol/preview">the manifest preview</Link>, which says what Clew would do with it, or
                dry-run with <code>POST /api/protocol/manifest</code>; this page as data is{' '}
                <a href="/api/protocol/manifest-reference.json">manifest-reference.json</a>.
              </Text>
              {mobile && (
                <VStack gap={2}>
                  {filterField}
                  {count}
                  <Selector
                    label="On this page"
                    options={shown.map(i => ({ value: i.id, label: pathOf.get(i.id) ?? i.label }))}
                    value={activeId}
                    onChange={scrollTo}
                    width="100%"
                  />
                </VStack>
              )}
            </VStack>
            <VStack gap={4}>
              <Heading level={3} accessibilityLevel={2} id="recipes">
                Recipes
              </Heading>
              <Text as="p">
                On the wire a schema is JSON Schema. Write it in your language's schema library and emit it: TypeBox or
                zod in TypeScript, Pydantic in Python. Where a recipe holds a schema, its TypeBox tab shows the same
                manifest written that way.
              </Text>
              {reference.recipes.map(r => (
                <VStack key={r.id} gap={2}>
                  <Heading level={4} accessibilityLevel={3} id={`recipe-${r.id}`}>
                    {r.title}
                  </Heading>
                  <Markdown>{r.text}</Markdown>
                  {/* A header bar keeps the copy button in it; without one Astryx gives the button a column of its own beside the code. */}
                  <Example recipe={r} />
                </VStack>
              ))}
            </VStack>
            <Divider />
            <VStack gap={6}>
              <Heading level={3} accessibilityLevel={2} id="fields">
                Fields
              </Heading>
              {reference.sections.map(s => (
                <VStack key={s.id} gap={4}>
                  <Heading level={4} accessibilityLevel={3} id={`section-${s.id}`}>
                    {s.title}
                  </Heading>
                  {s.paths.map(p => (
                    <Field key={p} field={byPath.get(p)!} />
                  ))}
                </VStack>
              ))}
            </VStack>
            <Divider />
            <VStack gap={3}>
              <Heading level={3} accessibilityLevel={2} id="rules">
                Every rule
              </Heading>
              <Text as="p">
                Where Clew applies each: when the manifest is loaded, when the connector is registered, in the
                conformance check, or on each call.
              </Text>
              {/* One block per rule, so the manifest preview can link to the rule a problem breaks (`#rule-<id>`). */}
              <VStack gap={1}>
                {reference.rules.map(r => (
                  <div key={r.id} id={`rule-${r.id}`} tabIndex={-1}>
                    <Markdown>
                      {ruleLine(
                        r,
                        ` Applied ${where[r.enforced]}. Fields: ${r.fields.map(f => `\`${f}\``).join(', ')}.`,
                      )}
                    </Markdown>
                  </div>
                ))}
              </VStack>
            </VStack>
          </VStack>
        </LayoutContent>
      }
    />
  );
}

function Page() {
  const query = useQuery(manifestReferenceQuery);
  usePageTitle('Clew manifest reference');
  // 3.1.2: the page is English inside a Swedish product; the document says so while it is shown.
  useEffect(() => {
    const was = document.documentElement.lang;
    document.documentElement.lang = 'en';
    return () => {
      document.documentElement.lang = was;
    };
  }, []);
  if (query.data) return <Article reference={query.data} />;
  return (
    <Layout
      height="auto"
      contentWidth={960}
      content={
        <LayoutContent role="main" padding={8}>
          <VStack gap={4}>
            <Heading level={1}>Clew manifest reference</Heading>
            {query.isError ? (
              <Banner status="error" title={errorMessage(query.error, 'The reference could not be read.')}>
                <Button
                  label="Try again"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void query.refetch();
                  }}
                />
              </Banner>
            ) : (
              <Skeleton height={320} width="100%" />
            )}
          </VStack>
        </LayoutContent>
      }
    />
  );
}

export function ManifestReferencePage() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>
  );
}
