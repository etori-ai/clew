import { useEffect, useId, useRef, useState, type ReactNode, type Ref } from 'react';
import { QueryClientProvider, useMutation } from '@tanstack/react-query';
import { fieldTone, markFields, needsPerson, type EntityKind, type View } from '@clew/contracts';
import {
  Badge,
  Banner,
  Button,
  Card,
  DropdownMenu,
  FileInput,
  Grid,
  HStack,
  Heading,
  Layout,
  LayoutContent,
  Link,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  Section,
  Selector,
  Table,
  Text,
  TextArea,
  VStack,
  proportional,
  useAnnounce,
  useMediaQuery,
} from '@clew/ui';
import { createQueryClient } from '../query-client';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { SectionFrame, SectionRow } from '../components/entity-sections';
import { badgeVariant } from '../components/view';
import { actionMenuItems } from '../entity-actions';
import { markText } from './staff-model';
import {
  MANIFEST_MAX,
  SAMPLE_NAMES,
  actionsAbout,
  aboutText,
  declarationOf,
  parseDocument,
  placesLabel,
  placesText,
  postManifest,
  problemsSummary,
  sourceOf,
  type ManifestPreview,
  type PreviewCapability,
  type PreviewIssue,
} from './protocol-preview-model';

/**
 * The manifest preview (D60, D97 slice 9, artboard J): what Clew would do with a manifest before anything is registered.
 * The integrator pastes the document or chooses its file; the page posts it to the instance's dry run
 * (`POST /api/protocol/manifest`) and draws the answer: each capability with what it is about and where it shows, every
 * problem with its place in the document and its entry in the manifest reference, who would see each place, and the row
 * mark, the section and the menu drawn by the product's own components with sample values from the declaration. Public
 * and outside the session's shell like the reference beside it, and English as documentation is. Nothing is fetched,
 * called or stored: a public page never makes the server reach an address someone typed, nor asks a connector or the
 * directory, so the samples are the declaration's, never a person's.
 */
const mobileQuery = '(max-width: 768px)';
type Outcome = { kind: 'invalid'; message: string } | { kind: 'preview'; document: unknown; preview: ManifestPreview };
type Manifest = NonNullable<ManifestPreview['manifest']>;

/** A block of the result as the artboard draws it: a bordered box, its heading over a divider, the body under it. */
function Block({
  title,
  caption,
  headingRef,
  flush,
  children,
}: {
  title: string;
  caption?: string;
  headingRef?: Ref<HTMLHeadingElement>;
  /** The body reaches the box's edges: a table. */
  flush?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card padding={0}>
      <VStack as="section" aria-labelledby={id}>
        <Section variant="transparent" paddingInline={4} paddingBlock={3} dividers={['bottom']}>
          <HStack gap={2} vAlign="center" justify="between" wrap="wrap">
            <Heading
              level={4}
              accessibilityLevel={2}
              id={id}
              {...(headingRef ? { ref: headingRef, tabIndex: -1 } : {})}
            >
              {title}
            </Heading>
            {caption && <Text type="supporting">{caption}</Text>}
          </HStack>
        </Section>
        {flush ? (
          children
        ) : (
          <Section variant="transparent" padding={4}>
            {children}
          </Section>
        )}
      </VStack>
    </Card>
  );
}

interface CapabilityRow extends Record<string, unknown> {
  id: string;
  c: PreviewCapability;
}
/** "What Clew would do with it" (artboard J): each capability, what it is about, where it shows. A list on a phone. */
function WhatClewWouldDo({ manifest, mobile }: { manifest: Manifest; mobile: boolean }) {
  const all = manifest.capabilities;
  return (
    <Block title="What Clew would do with it" caption={`${manifest.id} · ${manifest.source}`} flush>
      {mobile ? (
        <List aria-label="Capabilities" hasDividers>
          {all.map(c => (
            <ListItem
              key={c.name}
              label={<Text type="code">{c.name}</Text>}
              description={
                <VStack gap={0}>
                  <Text type="supporting">About: {aboutText(c, all)}</Text>
                  <Text type="supporting">Places: {placesText(c, all)}</Text>
                </VStack>
              }
            />
          ))}
        </List>
      ) : (
        <Table<CapabilityRow>
          data={all.map(c => ({ id: c.name, c }))}
          idKey="id"
          density="balanced"
          columns={[
            {
              key: 'capability',
              header: 'Capability',
              width: proportional(4, { minWidth: 230 }),
              renderCell: r => <Text type="code">{r.c.name}</Text>,
            },
            {
              key: 'about',
              header: 'About',
              width: proportional(3, { minWidth: 120 }),
              renderCell: r => <Text>{aboutText(r.c, all)}</Text>,
            },
            {
              key: 'places',
              header: 'Places',
              width: proportional(3, { minWidth: 120 }),
              renderCell: r => <Text>{placesText(r.c, all)}</Text>,
            },
          ]}
        />
      )}
    </Block>
  );
}

/** The problems (artboard J): each with its place in the document, the loader's sentence and the reference's entry for it. */
function Problems({
  title,
  issues,
  headingRef,
}: {
  title: string;
  issues: PreviewIssue[];
  headingRef: Ref<HTMLHeadingElement>;
}) {
  return (
    <Block title={title} headingRef={headingRef}>
      <List aria-label="Problems" hasDividers edge="flush">
        {issues.map((issue, i) => (
          <ListItem
            key={i}
            align="start"
            label={
              <VStack gap={1}>
                <Text type="code">{issue.path || 'The document'}</Text>
                <Text>{issue.problem}</Text>
                <Link href={`/protocol/manifest#${issue.anchor}`} weight="semibold" isStandalone>
                  {`Manifest reference: ${issue.rule?.title ?? (issue.field || 'the fields')}`}
                </Link>
              </VStack>
            }
          />
        ))}
      </List>
    </Block>
  );
}

/** "Who would see it" (artboard J): for each capability about an entity, place by place, as the dry run says it. */
function WhoWouldSee({ about }: { about: PreviewCapability[] }) {
  return (
    <Block title="Who would see it">
      {about.length === 0 ? (
        <Text as="p">No capability is about a person or a unit, so none has a place on one.</Text>
      ) : (
        <VStack gap={5}>
          {about.map(c => (
            <VStack key={c.name} gap={2}>
              <Heading level={5} accessibilityLevel={3}>
                <Text type="code">{c.name}</Text>
              </Heading>
              <MetadataList label={{ position: 'start', width: 160 }}>
                {c.audience.map(a => (
                  <MetadataListItem key={a.places.join()} label={placesLabel(a.places)}>
                    <Text>{a.who}</Text>
                  </MetadataListItem>
                ))}
              </MetadataList>
            </VStack>
          ))}
        </VStack>
      )}
    </Block>
  );
}

/** The marks one sample row puts on the entity's row (D97 item 2), in the product's words and tones. */
const marksOf = (view: View, row: Record<string, unknown>) =>
  markFields(view).flatMap(f => {
    const tone = fieldTone(f, row[f.key]);
    return needsPerson(tone) ? [{ key: f.key, tone, text: markText(view, f, row[f.key]) }] : [];
  });

/** A label over one drawn place, as the artboard's small grey headings. */
const PlaceLabel = ({ children }: { children: string }) => (
  <Text type="supporting" weight="semibold">
    {children}
  </Text>
);

/** One read about an entity, drawn with its samples: the row mark and the section, one sample row at a time. */
function DrawnRead({
  manifest,
  c,
  view,
  name,
  several,
}: {
  manifest: Manifest;
  c: PreviewCapability;
  view: View;
  name: string;
  several: boolean;
}) {
  const samples = c.samples ?? [];
  const [chosen, setChosen] = useState('0');
  const row = samples[Number(chosen)] ?? samples[0];
  if (!row || (view.kind !== 'table' && view.kind !== 'list')) return null;
  const title = view.title;
  const marks = marksOf(view, row);
  return (
    <VStack gap={3}>
      {samples.length > 1 && (
        <Selector
          label={several ? `Sample row: ${c.name}` : 'Sample row'}
          options={samples.map((s, i) => ({ value: String(i), label: `${i + 1}: ${String(s[title] ?? s.key)}` }))}
          value={chosen}
          onChange={setChosen}
        />
      )}
      <PlaceLabel>Row mark</PlaceLabel>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <div lang="sv">
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text weight="semibold">{name}</Text>
            {marks.map(m => (
              <Badge key={m.key} variant={badgeVariant(m.tone)} label={m.text} />
            ))}
            <Text type="supporting">{manifest.source}</Text>
          </HStack>
        </div>
        {marks.length === 0 && <Text type="supporting">No mark: nothing in this sample row needs the reader.</Text>}
      </HStack>
      <PlaceLabel>Section</PlaceLabel>
      <div lang="sv">
        <SectionFrame title={c.title} caption={manifest.source} headingLevel={3}>
          <SectionRow source={sourceOf(manifest, c, view)} row={row} />
        </SectionFrame>
      </div>
    </VStack>
  );
}

/**
 * The places drawn (artboard J's right column), one box per kind of entity: each read's row mark and section, then the
 * menu of every action about that kind, with the product's own components and the dry run's sample rows. Choosing an
 * action in the sample menu says what it would do; nothing runs.
 */
function Drawn({ manifest, document }: { manifest: Manifest; document: unknown }) {
  const announce = useAnnounce();
  const kinds = [...new Set(manifest.capabilities.flatMap(c => (c.about ? [c.about.entity] : [])))] as EntityKind[];
  return (
    <VStack gap={4}>
      <VStack gap={1}>
        <Heading level={4} accessibilityLevel={2}>
          Drawn with sample values
        </Heading>
        <Text as="p" type="supporting">
          The values are samples made from the declaration: each value a status field gives a tone, in turn, and a fixed
          time for an instant. No connector is called and nothing is stored.
        </Text>
      </VStack>
      {kinds.map(entity => {
        const name = SAMPLE_NAMES[entity];
        const reads = manifest.capabilities.filter(c => c.about?.entity === entity && c.kind === 'read');
        const actions = actionsAbout(manifest, entity);
        return (
          <Card key={entity}>
            <VStack gap={4}>
              <Text weight="semibold">{entity === 'person' ? 'About a person' : 'About a unit'}</Text>
              {reads.map(c => {
                const view = declarationOf(document, c.name)?.view;
                return view ? (
                  <DrawnRead
                    key={c.name}
                    manifest={manifest}
                    c={c}
                    view={view}
                    name={name}
                    several={reads.length > 1}
                  />
                ) : null;
              })}
              <PlaceLabel>Menu</PlaceLabel>
              {actions.length > 0 ? (
                <div lang="sv">
                  <DropdownMenu
                    renderTrigger={trigger => (
                      <Button {...trigger} variant="secondary" label="Åtgärder" aria-label={`Åtgärder för ${name}`} />
                    )}
                    presentation="adaptive"
                    items={actionMenuItems(actions, a =>
                      announce(
                        `${a.title}: in Clew this starts a card for ${name}, run after their decision. Nothing runs here.`,
                      ),
                    )}
                  />
                </div>
              ) : (
                <Text type="supporting">No action is about a {entity}.</Text>
              )}
            </VStack>
          </Card>
        );
      })}
    </VStack>
  );
}

/** What happened, for the status line: said once per run, and the problems' heading takes focus where there are any. */
function statusOf(outcome: Outcome | null, pending: boolean): string {
  if (pending) return 'Running the dry run …';
  if (!outcome) return '';
  if (outcome.kind === 'invalid') return 'The document is not JSON.';
  const { preview } = outcome;
  if (!preview.ok)
    return `Clew would refuse it: ${preview.problems.length === 1 ? '1 problem' : `${preview.problems.length} problems`}.`;
  const count = preview.manifest!.capabilities.length;
  const about = preview.manifest!.capabilities.filter(c => c.about).length;
  return `Clew would load it: ${count === 1 ? '1 capability' : `${count} capabilities`}, ${about} about a person or a unit.`;
}

function Page() {
  usePageTitle('Clew manifest preview');
  // 3.1.2: the page is English inside a Swedish product; the document says so while it is shown.
  useEffect(() => {
    const was = document.documentElement.lang;
    document.documentElement.lang = 'en';
    return () => {
      document.documentElement.lang = was;
    };
  }, []);
  const mobile = useMediaQuery(mobileQuery);
  const announce = useAnnounce();
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [runs, setRuns] = useState(0);
  const field = useRef<HTMLTextAreaElement>(null);
  const problemsHeading = useRef<HTMLHeadingElement>(null);
  const dryRun = useMutation({
    mutationFn: (body: { text: string; document: unknown }) => postManifest(body.text),
    onSuccess: (preview, body) => {
      setOutcome({ kind: 'preview', document: body.document, preview });
      setRuns(n => n + 1);
    },
  });
  const failed = outcome?.kind === 'invalid' || (outcome?.kind === 'preview' && !outcome.preview.ok) ? outcome : null;
  // A refused or unreadable document moves focus to the summary of its problems, which says how many there are.
  useEffect(() => {
    if (runs && failed) problemsHeading.current?.focus();
  }, [runs]);
  const run = () => {
    if (!text.trim()) {
      setEmpty(true);
      field.current?.focus();
      return;
    }
    setEmpty(false);
    const parsed = text.length > MANIFEST_MAX ? null : parseDocument(text);
    if (!parsed || !parsed.ok) {
      dryRun.reset();
      setOutcome({
        kind: 'invalid',
        message: parsed ? parsed.message : 'The manifest is larger than 500 kB, the most the dry run takes.',
      });
      setRuns(n => n + 1);
      return;
    }
    dryRun.mutate({ text, document: parsed.document });
  };
  const choose = (chosen: File | File[] | null) => {
    const one = Array.isArray(chosen) ? (chosen[0] ?? null) : chosen;
    setFile(one);
    setFileProblem(null);
    if (!one) return;
    if (one.size > MANIFEST_MAX) {
      setFileProblem('The file is larger than 500 kB, the most the dry run takes.');
      return;
    }
    void one.text().then(
      content => {
        setText(content);
        setEmpty(false);
        announce(`${one.name} is in the manifest field.`);
      },
      () => setFileProblem('The file could not be read.'),
    );
  };
  const preview = outcome?.kind === 'preview' && outcome.preview.ok ? outcome : null;
  const about = preview ? preview.preview.manifest!.capabilities.filter(c => c.about) : [];
  return (
    <Layout
      height="auto"
      contentWidth={1280}
      content={
        <LayoutContent role="main" isScrollable={false} padding={mobile ? 4 : 8}>
          <VStack gap={8}>
            <VStack gap={2}>
              <Heading level={1}>Manifest preview</Heading>
              <Text as="p" color="secondary">
                What Clew would do with a connector manifest before anything is registered: what each capability is
                about and where it shows, who would see it, and every problem Clew would refuse it for. No sign-in. The
                document goes to this instance's dry run and nowhere else; nothing is fetched, called or stored.
              </Text>
              <Text as="p" color="secondary">
                Every field and rule is in <Link href="/protocol/manifest">the manifest reference</Link>. The same dry
                run answers <Text type="code">POST /api/protocol/manifest</Text>.
              </Text>
            </VStack>
            <VStack gap={4}>
              <TextArea
                ref={field}
                label="Manifest"
                description="The JSON your connector serves at /clew/manifest: paste it here, or choose its file below."
                value={text}
                onChange={value => {
                  setText(value);
                  if (value.trim()) setEmpty(false);
                }}
                rows={8}
                hasSpellCheck={false}
                autoCapitalize="off"
                hasAutoCorrect={false}
                width="100%"
                {...(empty
                  ? { status: { type: 'error' as const, message: 'Paste a manifest or choose its file.' } }
                  : {})}
              />
              <FileInput
                label="Manifest file"
                placeholder="Choose a file"
                accept=".json,application/json"
                value={file}
                onChange={choose}
                {...(fileProblem ? { status: { type: 'error' as const, message: fileProblem } } : {})}
              />
              <HStack gap={3} vAlign="center" wrap="wrap">
                <Button label="Run the dry run" variant="primary" isLoading={dryRun.isPending} onClick={run} />
                <Text as="p" role="status" type="supporting">
                  {statusOf(outcome, dryRun.isPending)}
                </Text>
              </HStack>
              {dryRun.isError && (
                <Banner status="error" title={errorMessage(dryRun.error, 'The dry run could not be run.')}>
                  <Button label="Try again" size="sm" variant="secondary" onClick={run} />
                </Banner>
              )}
            </VStack>
            {outcome && (
              <Grid columns={{ minWidth: 440, max: 2 }} gap={8} align="start">
                <VStack gap={6}>
                  {preview && <WhatClewWouldDo manifest={preview.preview.manifest!} mobile={mobile} />}
                  {failed?.kind === 'invalid' && (
                    <Block title="The document is not JSON" headingRef={problemsHeading}>
                      <VStack gap={2}>
                        <Text as="p">{failed.message}</Text>
                        <Link href="/protocol/manifest#fields" weight="semibold" isStandalone>
                          Manifest reference: the fields
                        </Link>
                      </VStack>
                    </Block>
                  )}
                  {failed?.kind === 'preview' && (
                    <Problems
                      title={problemsSummary(failed.preview.problems.length)}
                      issues={failed.preview.issues}
                      headingRef={problemsHeading}
                    />
                  )}
                  {preview && <WhoWouldSee about={about} />}
                </VStack>
                {preview && about.length > 0 && (
                  <Drawn manifest={preview.preview.manifest!} document={preview.document} />
                )}
              </Grid>
            )}
          </VStack>
        </LayoutContent>
      }
    />
  );
}

export function ManifestPreviewPage() {
  const [client] = useState(createQueryClient);
  return (
    <QueryClientProvider client={client}>
      <Page />
    </QueryClientProvider>
  );
}
