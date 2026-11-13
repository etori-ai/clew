import { createElement, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type {
  CompetenceReadOutcome,
  CompetenceSource,
  CompetenceSourceType,
  CompetenceType,
  SessionUser,
} from '@clew/contracts';
import {
  Badge,
  Button,
  Card,
  CompletionFeedback,
  Dialog,
  DialogHeader,
  EmptyState,
  FormLayout,
  Heading,
  HStack,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  Selector,
  Table,
  Text,
  Toolbar,
  VStack,
  pixel,
  proportional,
  useMediaQuery,
  useToast,
} from '@clew/ui';
import { api } from '../../api';
import { ApiError } from '../../api-error';
import { competenceCatalogueQuery, competenceSourcesQuery } from '../../queries';
import { keys } from '../../query-keys';
import { errorMessage } from '../../query-policy';
import { useAdminAction } from '../../mutations';
import { usePageTitle } from '../../page-title';
import { DialogFrame } from '../../components/dialog-frame';
import { PageHeader } from '../../components/page-header';
import { mobileQuery } from '../../components/shell';
import { AdminShell } from './shell';
import { instantText } from './labels';

/**
 * "Källor" under Administration › Kompetens (D108 item 9): the systems whose holdings Clew copies into its competence
 * register, such as a learning platform. Each source is a card: when it was last read and how that went, a way to read
 * it now, and its types as the source names them, with how many holdings carry each and the catalogue type it is
 * mapped to. A copied holding whose type is not mapped is kept under the source's own words and counts towards nothing,
 * so mapping is what makes a source's holdings count. A type is mapped in a dialog over the list, named in the address
 * (`?source=<connector>&type=<the source's type id>`, D83), where the mapping is also removed.
 *
 * A read runs on the server after the request is answered, so the page follows it: while a source is being read, or a
 * read asked for here has not yet shown its result, the sources are asked for again every few seconds, and the result
 * of a read asked for here is said when it is there. Nothing has to be reloaded to see how a read went.
 *
 * A list that can grow is a page with an address (D116), so the sources have this page of their own under the
 * catalogue's rather than a tab without one. Like the catalogue it is refused while the module is off and to an
 * administrator without `admin.competence`, and says which.
 */
export const SOURCES_PATH = '/admin/competence/sources';
const SOURCE_PARAM = 'source';
const TYPE_PARAM = 'type';
const mapHref = (connectorId: string, sourceType: string) =>
  `${SOURCES_PATH}?${new URLSearchParams({ [SOURCE_PARAM]: connectorId, [TYPE_PARAM]: sourceType })}`;
/** How a read went, in the word the page shows; colour never stands alone. */
const outcomeBadge: Record<CompetenceReadOutcome, { label: string; variant: 'neutral' | 'warning' | 'error' }> = {
  complete: { label: 'Läst', variant: 'neutral' },
  partial: { label: 'Delvis läst', variant: 'warning' },
  failed: { label: 'Kunde inte läsas', variant: 'error' },
};
/** How a read asked for on this page went, as the notice says it. */
const outcomeNotice: Record<CompetenceReadOutcome, (source: string) => string> = {
  complete: source => `${source} är inläst.`,
  partial: source => `${source} är delvis inläst.`,
  failed: source => `${source} kunde inte läsas in.`,
};
/** How often the sources are asked for again while a read is followed. */
const FOLLOW_EVERY_MS = 2000;
/** How long a read asked for here is waited for before the page stops asking: one that never started shows nothing new. */
const FOLLOW_FOR_MS = 10 * 60_000;
const count = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;
const holdingsText = (n: number) => count(n, 'intyg', 'intyg');
interface Row extends Record<string, unknown> {
  id: string;
  t: CompetenceSourceType;
}
/** The catalogue's types a source's type can be mapped to, grouped by area: archived types take nothing new. */
const typeOptions = (types: CompetenceType[]) => {
  const open = types.filter(t => !t.archived);
  return [...new Set(open.map(t => t.area))].map(area => ({
    type: 'section' as const,
    title: area,
    options: open.filter(t => t.area === area).map(t => ({ value: t.id, label: t.name })),
  }));
};

/** Mapping one type of a source to the catalogue, or removing the mapping. `opened` is the type the address names. */
function MappingDialog({
  source,
  opened,
  catalogue,
  onClose,
}: {
  source: CompetenceSource | undefined;
  opened: CompetenceSourceType | undefined;
  catalogue: CompetenceType[];
  onClose: () => void;
}) {
  const mobile = useMediaQuery(mobileQuery);
  const save = useAdminAction({
    invalidate: [keys.competenceAll, keys.entities.all, keys.viewAll],
    toastId: 'competence:mapping',
  });
  const [typeId, setTypeId] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const typeField = useRef<HTMLButtonElement>(null);
  const options = typeOptions(catalogue);
  const key = source && opened ? source.connectorId + '\n' + opened.sourceType : null;
  useEffect(() => {
    setTypeId(opened?.typeId ?? null);
    setTried(false);
    save.reset();
    // Filled once per opened type: a refetch while the dialog is open must not undo the choice being made.
  }, [key]);
  const nameOf = (id: string | undefined) => catalogue.find(t => t.id === id)?.name;
  const map = async (next: string | null) => {
    if (save.busy || !source || !opened) return;
    if (next === null && !opened.typeId) return;
    if (next !== null && next === opened.typeId) {
      onClose();
      return;
    }
    await save.run(async () => {
      const { holdings } = await api.competence.mapSourceType(source.connectorId, {
        sourceType: opened.sourceType,
        typeId: next,
      });
      onClose();
      return next === null
        ? `${opened.label} är inte längre kopplad. ${holdingsText(holdings)} räknas inte.`
        : `${opened.label} är kopplad till ${nameOf(next) ?? 'katalogen'}. ${holdingsText(holdings)} räknas nu.`;
    });
  };
  const submit = () => {
    if (!typeId) {
      setTried(true);
      typeField.current?.focus();
      return;
    }
    void map(typeId);
  };
  const onOpenChange = (next: boolean) => {
    if (!next) onClose();
  };
  return (
    <Dialog
      isOpen={!!key}
      onOpenChange={onOpenChange}
      width={520}
      purpose="form"
      variant={mobile ? 'fullscreen' : 'standard'}
    >
      <DialogFrame
        header={<DialogHeader title="Koppla till katalogen" subtitle={opened?.label} onOpenChange={onOpenChange} />}
        error={save.error}
        secondary={
          opened?.typeId ? (
            <Button
              size="sm"
              variant="ghost"
              label="Ta bort kopplingen"
              isDisabled={save.busy}
              onClick={() => void map(null)}
            />
          ) : undefined
        }
        primary={
          <>
            <Button size="sm" variant="ghost" label="Avbryt" onClick={onClose} />
            <Button size="sm" variant="primary" label="Spara" isLoading={save.busy} onClick={submit} />
          </>
        }
      >
        {source && opened && (
          <VStack gap={3}>
            <MetadataList>
              <MetadataListItem label="Källa">{source.source}</MetadataListItem>
              <MetadataListItem label="Typ i källan">
                <Text type="code">{opened.sourceType}</Text>
              </MetadataListItem>
              <MetadataListItem label="Intyg">{holdingsText(opened.holdings)}</MetadataListItem>
            </MetadataList>
            <FormLayout direction="vertical" defaultOptionality="required">
              <Selector
                ref={typeField}
                label="Kompetens i katalogen"
                description="Intygen räknas som den här kompetensen, med dess giltighetstid där källan inte anger något slutdatum."
                placeholder="Välj kompetens"
                options={options}
                value={(typeId ?? undefined) as never}
                onChange={value => setTypeId(value || null)}
                presentation="adaptive"
                hasSearch={options.reduce((n, section) => n + section.options.length, 0) > 8}
                searchPlaceholder="Sök kompetens"
                emptySearchText="Ingen kompetens matchar"
                emptyText="Katalogen är tom"
                {...(tried && !typeId ? { status: { type: 'error' as const, message: 'Välj en kompetens.' } } : {})}
              />
            </FormLayout>
          </VStack>
        )}
      </DialogFrame>
    </Dialog>
  );
}

/** One source: its last read and a way to read it now, then its types and their mappings. */
function SourceCard({
  source,
  catalogue,
  mobile,
}: {
  source: CompetenceSource;
  catalogue: CompetenceType[];
  mobile: boolean;
}) {
  const read = useAdminAction({ invalidate: [keys.competenceSources], toastId: 'competence:read' });
  const toast = useToast();
  const finishedAt = source.lastRead?.finishedAt ?? null;
  const outcome = source.lastRead?.outcome;
  // The read asked for from this card, by when the source's last read had finished at that moment: it is followed
  // until a later read shows. The request is answered when the read is queued, before it has claimed the source, so
  // `reading` alone does not say it is under way.
  const [asked, setAsked] = useState<{ before: string | null } | null>(null);
  const following = source.reading || asked !== null;
  // A second observer of the page's own query, only for the interval: the card is drawn from the page's data.
  useQuery({
    ...competenceSourcesQuery,
    refetchInterval: following ? FOLLOW_EVERY_MS : false,
    notifyOnChangeProps: [],
  });
  useEffect(() => {
    if (!asked || source.reading || finishedAt === asked.before) return;
    setAsked(null);
    if (outcome)
      toast({
        body: createElement(CompletionFeedback, null, outcomeNotice[outcome](source.source)),
        uniqueID: 'competence:read',
      });
  }, [asked, source.reading, finishedAt, outcome, source.source, toast]);
  useEffect(() => {
    if (!asked) return;
    const timer = setTimeout(() => setAsked(null), FOLLOW_FOR_MS);
    return () => clearTimeout(timer);
  }, [asked]);
  const nameOf = (id: string | undefined) => catalogue.find(t => t.id === id)?.name ?? 'Okänd kompetens';
  const last = source.lastRead;
  const mapping = (t: CompetenceSourceType) =>
    t.typeId ? <Text>{nameOf(t.typeId)}</Text> : <Badge variant="neutral" label="Inte kopplad" />;
  const mapButton = (t: CompetenceSourceType) => (
    <Button
      size="sm"
      variant="secondary"
      label="Koppla"
      aria-label={`Koppla ${t.label}`}
      href={mapHref(source.connectorId, t.sourceType)}
    />
  );
  const columns = [
    {
      key: 'label',
      header: 'Typ i källan',
      width: proportional(3, { minWidth: 220 }),
      renderCell: (r: Row) => (
        <VStack gap={0} hAlign="start">
          <Text weight="semibold">{r.t.label}</Text>
          <Text type="code" color="secondary">
            {r.t.sourceType}
          </Text>
        </VStack>
      ),
    },
    {
      key: 'holdings',
      header: 'Intyg',
      width: pixel(110),
      renderCell: (r: Row) => <Text>{holdingsText(r.t.holdings)}</Text>,
    },
    {
      key: 'mapping',
      header: 'Kopplad till',
      width: proportional(2, { minWidth: 180 }),
      renderCell: (r: Row) => mapping(r.t),
    },
    { key: 'map', header: 'Koppla', width: pixel(110), renderCell: (r: Row) => mapButton(r.t) },
  ];
  return (
    <Card padding={0}>
      <Toolbar
        label={source.source}
        size="sm"
        dividers={['bottom']}
        startContent={
          <VStack gap={1} hAlign="start">
            <Heading level={2}>{source.source}</Heading>
            <HStack gap={1} wrap="wrap" vAlign="center">
              {following && <Badge variant="info" label="Läses in" />}
              {/* Off under Anslutna system, or no longer declaring the read: "Svarar inte" is what that page says of a
                  system it cannot reach, so the badge says what follows for the register instead. */}
              {!source.answering && <Badge variant="neutral" label="Läses inte in" />}
            </HStack>
          </VStack>
        }
        endContent={
          <Button
            variant="secondary"
            label="Läs in nu"
            aria-label={`Läs in nu: ${source.source}`}
            isLoading={read.busy}
            isDisabled={!source.answering || following}
            onClick={() =>
              void read.run(async () => {
                await api.competence.readSource(source.connectorId);
                setAsked({ before: finishedAt });
                return `${source.source} läses in.`;
              })
            }
          />
        }
      />
      <VStack gap={3} padding={4}>
        {read.error && (
          <Text as="p" role="alert" color="accent">
            {read.error}
          </Text>
        )}
        {last ? (
          <MetadataList orientation="horizontal">
            <MetadataListItem label="Senast läst">{instantText(last.finishedAt)}</MetadataListItem>
            <MetadataListItem label="Resultat">
              <Badge variant={outcomeBadge[last.outcome].variant} label={outcomeBadge[last.outcome].label} />
            </MetadataListItem>
            <MetadataListItem label="Lästa intyg">{String(last.counts.read)}</MetadataListItem>
            {last.unmatched > 0 && (
              <MetadataListItem label="Användarnamn utan person">{String(last.unmatched)}</MetadataListItem>
            )}
            {last.counts.outside > 0 && (
              <MetadataListItem label="Utanför målgruppen">{String(last.counts.outside)}</MetadataListItem>
            )}
            {last.counts.invalid > 0 && (
              <MetadataListItem label="Kunde inte användas">{String(last.counts.invalid)}</MetadataListItem>
            )}
            {last.counts.revoked > 0 && (
              <MetadataListItem label="Återkallade">{String(last.counts.revoked)}</MetadataListItem>
            )}
          </MetadataList>
        ) : (
          <Text color="secondary">Inte läst ännu</Text>
        )}
      </VStack>
      {source.types.length === 0 ? (
        <EmptyState isCompact headingLevel={3} title="Inga intyg är inlästa" />
      ) : mobile ? (
        <List aria-label={`Typer i ${source.source}`} hasDividers>
          {source.types.map(t => (
            <ListItem
              key={t.sourceType}
              label={<Text weight="semibold">{t.label}</Text>}
              description={
                <Text type="supporting">
                  {holdingsText(t.holdings)} · {t.typeId ? `Kopplad till ${nameOf(t.typeId)}` : 'Inte kopplad'}
                </Text>
              }
              endContent={mapButton(t)}
            />
          ))}
        </List>
      ) : (
        <Table<Row>
          data={source.types.map(t => ({ id: t.sourceType, t }))}
          idKey="id"
          columns={columns}
          density="balanced"
          hasHover
        />
      )}
    </Card>
  );
}

export function AdminCompetenceSourcesPage({ user }: { user: SessionUser }) {
  usePageTitle('Källor för kompetens');
  const mobile = useMediaQuery(mobileQuery);
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const query = useQuery(competenceSourcesQuery);
  const catalogue = useQuery(competenceCatalogueQuery);
  const sources = query.data?.rows ?? [];
  const refused = query.error instanceof ApiError && query.error.status === 403;
  const error = query.isError && !refused ? errorMessage(query.error, 'Källorna kunde inte läsas.') : null;
  const openedSource = sources.find(s => s.connectorId === search.get(SOURCE_PARAM));
  const openedType = openedSource?.types.find(t => t.sourceType === search.get(TYPE_PARAM));
  const close = () => navigate(SOURCES_PATH);
  return (
    <AdminShell
      user={user}
      section="kompetens"
      crumbs={[{ label: 'Kompetens', href: '/admin/competence' }, { label: 'Källor' }]}
      pending={query.isPending}
    >
      <PageHeader title="Källor för kompetens" />
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      {refused && (
        <Card>
          <EmptyState
            headingLevel={2}
            title="Källorna är inte tillgängliga för dig"
            description={`${errorMessage(query.error, 'Du saknar behörighet för åtgärden.')} Kompetens slås på under Anslutna system, och källorna kräver behörigheten Administrera kompetenskatalogen.`}
            actions={<Button label="Till Anslutna system" href="/admin/connectors" />}
          />
        </Card>
      )}
      {query.data && sources.length === 0 && (
        <Card>
          <EmptyState
            headingLevel={2}
            title="Inget system svarar om intyg"
            description="Ett anslutet system med kurser eller intyg, till exempel en lärplattform, visas här när det är påslaget under Anslutna system."
            actions={<Button label="Till Anslutna system" href="/admin/connectors" />}
          />
        </Card>
      )}
      {sources.map(s => (
        <SourceCard key={s.connectorId} source={s} catalogue={catalogue.data?.rows ?? []} mobile={mobile} />
      ))}
      <MappingDialog source={openedSource} opened={openedType} catalogue={catalogue.data?.rows ?? []} onClose={close} />
    </AdminShell>
  );
}
