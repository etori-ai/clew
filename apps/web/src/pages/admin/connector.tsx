import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ENTITY_COLUMNS_MAX } from '@clew/contracts';
import type {
  CheckReport,
  ConnectorAudience,
  ConnectorDetail,
  ConnectorPatchInput,
  ManifestDiff,
  SessionUser,
} from '@clew/contracts';
import {
  AlertDialog,
  AreaChip,
  Badge,
  Banner,
  Button,
  Card,
  Collapsible,
  Dialog,
  DialogHeader,
  DropdownMenu,
  EmptyState,
  FormLayout,
  HStack,
  Heading,
  InfoTip,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  Section,
  Selector,
  StatusDot,
  Switch,
  SystemSwatch,
  Tab,
  TabList,
  Table,
  Text,
  TextInput,
  Timestamp,
  Toolbar,
  VStack,
  swatchWords,
  useMediaQuery,
  useToast,
  proportional,
} from '@clew/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api';
import { adminQueries } from '../../queries';
import { keys } from '../../query-keys';
import { useAdminAction } from '../../mutations';
import { errorMessage } from '../../query-policy';
import { usePageTitle } from '../../page-title';
import { AudienceEditor, AudiencePreview } from './audience';
import { CheckResult, TechnicalCause } from './check-result';
import { useBranding } from '../../branding';
import {
  historyLabel,
  historyWords,
  actorLabel,
  areaFieldLabel,
  audienceLabel,
  capabilityFieldLabel,
  capabilityKindLabel,
  fieldList,
  healthLabel,
  manifestFieldLabel,
  kindLabel,
  roleLabel,
  statusOf,
} from './labels';
import { AdminShell } from './shell';
import { mobileQuery } from '../../media';
import { DialogFrame } from '../../components/shell/dialog-frame';
import { DOT } from '../../dot';

/** One connector (D23): overview and actions, capabilities with their switches, areas, who sees it, and its history. */
type TabId = 'oversikt' | 'formagor' | 'omraden' | 'publik' | 'historik';
const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'oversikt', label: 'Översikt' },
  { id: 'formagor', label: 'Funktioner' },
  { id: 'omraden', label: 'Områden' },
  { id: 'publik', label: 'Vem ser det' },
  { id: 'historik', label: 'Historik' },
];
interface CapRow extends Record<string, unknown> {
  name: string;
  c: ConnectorDetail['capabilities'][number];
}
/** The choice "Ingen kolumn" in the column selector: never a field's key, which a view keeps to letters and digits. */
const NO_COLUMN = '-';

type CapabilityView = ConnectorDetail['capabilities'][number];
/** The "Assistent" switch of one capability, disabled with its reason when the manifest, the kind or the connector says no. */
function ToolSwitch({
  row,
  toolsEnabled,
  onChange,
}: {
  row: CapabilityView;
  toolsEnabled: boolean;
  onChange: (on: boolean) => Promise<void>;
}) {
  const reason =
    row.kind === 'execute'
      ? 'En åtgärd är aldrig ett verktyg för assistenten (D8).'
      : !row.model
        ? 'Anslutningen har inte märkt funktionen som verktyg.'
        : !row.enabled
          ? 'Funktionen är avstängd.'
          : 'Assistenten är avstängd för hela anslutningen.';
  const disabled = !row.model || row.kind === 'execute' || !row.enabled || !toolsEnabled;
  return (
    <HStack gap={1} vAlign="center">
      <Switch
        size="sm"
        label={row.title + ' till assistenten'}
        isLabelHidden
        value={row.tool}
        isDisabled={disabled}
        disabledMessage={reason}
        changeAction={onChange}
      />
      {row.kind === 'execute' && (
        <InfoTip
          content="Åtgärder utförs bara genom att en person bekräftar i ett ärende, aldrig av assistenten."
          label="Varför kan åtgärder inte bli verktyg"
        />
      )}
    </HStack>
  );
}

export function AdminConnectorPage({ user }: { user: SessionUser }) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const site = useBranding().name;
  const mobile = useMediaQuery(mobileQuery);
  // The connector and the units from the admin cache (D33); a 400 is the one answer the page turns into "finns inte".
  const client = useQueryClient();
  const detail = useQuery(adminQueries.connector(id));
  const units = useQuery(adminQueries.units);
  const groups = useQuery(adminQueries.groups);
  const c = detail.data ?? null;
  const missing = detail.isError && detail.error instanceof ApiError && detail.error.status === 400;
  const readError =
    detail.isError && !missing && detail.data === undefined
      ? errorMessage(detail.error, 'Anslutningen kunde inte läsas.')
      : null;
  const [tab, setTab] = useState<TabId>('oversikt');
  const [report, setReport] = useState<CheckReport | null>(null);
  // The change under review and when the service first offered it, which approving names so nothing else goes live (D144).
  const [review, setReview] = useState<{ diff: ManifestDiff; offered: string } | null>(null);
  const [secretOpen, setSecretOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [removeOpen, setRemoveOpen] = useState(false);
  // The audience draft follows the saved one whenever the connector itself changes, never on a refetch that changed nothing.
  const [audience, setAudience] = useState<ConnectorAudience | null>(null);
  useEffect(() => {
    if (c) setAudience(c.audience);
  }, [c?.id, c?.updatedAt]);
  usePageTitle(c ? c.source : readError ? 'Anslutningen kunde inte läsas' : null);
  // Every action re-reads the admin queries and then says what it did; removing re-reads the list alone and drops this page's own read before leaving.
  const {
    run,
    busy,
    error: actionError,
  } = useAdminAction({ invalidate: [keys.admin.all, keys.areas], toastId: 'connector:' + id });
  const removal = useAdminAction({ invalidate: [keys.admin.connectors], toastId: 'connector:' + id });
  const error = actionError ?? removal.error ?? readError;
  if (missing)
    return (
      <AdminShell user={user} section="anslutningar" title={null} thing={{}}>
        <EmptyState
          headingLevel={1}
          title="Anslutningen finns inte"
          description="Den kan ha tagits bort."
          actions={<Button label="Till listan" href="/admin/connectors" />}
        />
      </AdminShell>
    );
  if (!c)
    return (
      <AdminShell pending={!error} user={user} section="anslutningar" title={null} thing={{}}>
        {error ? (
          <>
            {/* The page keeps its one level-1 heading when the connector cannot be read: what is missing, the alert why. */}
            <Heading level={1}>Anslutningen kunde inte läsas</Heading>
            <Text as="p" role="alert" color="accent">
              {error}
            </Text>
          </>
        ) : (
          <Text type="supporting" role="status">
            Läser anslutningen …
          </Text>
        )}
      </AdminShell>
    );
  const s = statusOf(c);
  const unhealthy = c.state === 'enabled' && !c.bundled && c.health.status !== 'ok';
  const panel = (t: TabId) => `panel-${t}`;
  const capRows: CapRow[] = c.capabilities.map(x => ({ name: x.name, c: x }));
  // The views that can be tools in the menu (D40), each with the row it would be.
  const tools = c.capabilities.flatMap(x => (x.menu ? [{ ...x, menu: x.menu }] : []));
  // The reads about an entity that can be a lens or give a column on "Alla" (D97 items 3 and 4), as the server says.
  const lists = c.capabilities.filter(x => x.about && (x.lens || x.column));
  // Every change names the version of the connector this page shows (DE-M5). One saved since, by another administrator
  // or in another tab, is refused; the page reads the connector again, so the alert stands over what it now is.
  const save = async (patch: Omit<ConnectorPatchInput, 'version'>) => {
    try {
      return await api.admin.update(id, { ...patch, version: c.version });
    } catch (error) {
      void client.invalidateQueries({ queryKey: keys.admin.all });
      throw error;
    }
  };
  const setCap = (name: string, patch: { enabled?: false; model?: false }) =>
    run(async () => {
      await save({ capabilities: { [name]: patch } });
    });
  // Off is the only value an override can hold (narrowing only, D23); on clears it.
  const capPatch = (on: boolean, key: 'enabled' | 'model'): { enabled?: false; model?: false } =>
    on ? {} : key === 'enabled' ? { enabled: false } : { model: false };
  const capColumns = [
    // An id is one word in a typewriter face: its column holds it, so it does not break in the middle.
    {
      key: 'title',
      header: 'Funktion',
      width: proportional(1.5, { minWidth: 240 }),
      renderCell: (r: CapRow) => (
        <VStack gap={0}>
          <Text>{r.c.title}</Text>
          <Text type="code" color="secondary">
            {r.c.name}
          </Text>
        </VStack>
      ),
    },
    {
      key: 'kind',
      header: 'Typ',
      renderCell: (r: CapRow) => (
        <Text weight={r.c.kind === 'execute' ? 'semibold' : undefined}>{capabilityKindLabel[r.c.kind]}</Text>
      ),
    },
    {
      key: 'roles',
      header: 'Roller enligt systemet',
      width: proportional(1.5, { minWidth: 190 }),
      renderCell: (r: CapRow) => (
        <Text type="supporting">
          {r.c.roles ? r.c.roles.map(x => roleLabel[x]).join(', ') : 'Alla (regeln ligger i koden)'}
        </Text>
      ),
    },
    {
      key: 'on',
      header: 'På',
      renderCell: (r: CapRow) => (
        <Switch
          size="sm"
          label={`${r.c.title} på`}
          isLabelHidden
          value={r.c.enabled}
          changeAction={on => setCap(r.name, capPatch(on, 'enabled'))}
        />
      ),
    },
    {
      key: 'tool',
      header: 'Assistent',
      renderCell: (r: CapRow) => (
        <ToolSwitch row={r.c} toolsEnabled={c.toolsEnabled} onChange={on => setCap(r.name, capPatch(on, 'model'))} />
      ),
    },
  ];
  const removeLabel = `Ta bort ${c.source}`;
  // The actions directly under the title (D126 rule 1, board Arende): the switch first, then what an administrator does
  // to a remote system, and last, set apart, the one action that cannot be taken back. They wrap on a phone (1.4.10).
  const actions = (
    <>
      <Switch
        label={c.state === 'enabled' ? 'På' : 'Av'}
        labelPosition="start"
        value={c.state === 'enabled'}
        isDisabled={busy || (c.state !== 'enabled' && !c.manifestAt)}
        disabledMessage="Anslutningen har ingen godkänd beskrivning: läs in den från systemet och godkänn den först."
        changeAction={on =>
          run(async () => {
            await save({ state: on ? 'enabled' : 'disabled' });
            return `${c.source} ${on ? 'är på' : 'är avstängd'}.`;
          })
        }
      />
      {!c.bundled && (
        <>
          <Button
            variant="secondary"
            label="Testa anslutning"
            isDisabled={busy}
            clickAction={() =>
              run(async () => {
                const r = await api.admin.test(id);
                setReport(r);
                // A change the check found waits in the banner; it is spoken here, where the person is (4.1.3).
                const offered = r.offered ? ' Systemet erbjuder en ändring som väntar på ditt godkännande.' : '';
                return (r.ok ? 'Kontrollen gick bra.' : 'Kontrollen hittade fel, se listan.') + offered;
              })
            }
          />
          <Button
            variant="secondary"
            label="Läs in igen från systemet"
            isDisabled={busy}
            clickAction={() =>
              run(async () => {
                // The review is the stored offer, its diff and its instant from one read, so approving names what was shown.
                const offer = (await api.admin.refresh(id, false)).connector.offered;
                if (!offer) return 'Inget har ändrats i systemet.';
                setReview({ diff: offer.diff, offered: offer.at });
              })
            }
          />
          <Button variant="secondary" label="Byt nyckel" isDisabled={busy} onClick={() => setSecretOpen(true)} />
          <Button variant="destructive" label="Ta bort" isDisabled={busy} onClick={() => setRemoveOpen(true)} />
        </>
      )}
    </>
  );
  return (
    <AdminShell
      user={user}
      section="anslutningar"
      title={c.source}
      thing={{
        // The system's colour beside its name, its place in the order and its address on the trail's line (artboard 9, D71).
        icon: <SystemSwatch ordinal={c.ordinal} />,
        place: (
          <>
            <Text type="supporting" color="secondary">
              {[
                swatchWords(c.ordinal),
                c.kind ? kindLabel(c.kind, site).toLowerCase() : null,
                c.protocol ? `protokoll ${c.protocol}` : null,
              ]
                .filter(Boolean)
                .join('\u00a0· ')}
            </Text>
            <Text type="supporting" color="secondary">
              {c.bundled ? `Körs i ${site}` : c.url}
            </Text>
          </>
        ),
        status: <Badge variant={s.tone} label={s.label} />,
        actions,
      }}
    >
      {unhealthy && (
        <Banner
          status={c.health.status === 'unreachable' ? 'warning' : 'error'}
          container="section"
          collapsible={false}
          title={`${c.source}: ${healthLabel[c.health.status].toLowerCase()}${c.health.at ? ' sedan ' : ''}`}
          description={
            <>
              Ärenden och figurer visas från senast kända läge.
              {c.health.detail && (
                <>
                  {' '}
                  <TechnicalCause detail={c.health.detail} />
                </>
              )}
            </>
          }
          endContent={<Timestamp value={c.health.at} format="date_time" />}
        />
      )}
      {c.offered && (
        // A manifest the service serves that differs from the approved one is never live until an administrator approves it (D144).
        <Banner
          status="warning"
          container="section"
          collapsible={false}
          title={`${c.source}: en ändring väntar på ditt godkännande`}
          description="Systemet beskriver sig annorlunda än det du har godkänt. Ändringen används inte förrän du har granskat och godkänt den."
          endContent={
            <Button
              variant="secondary"
              size="sm"
              label="Granska ändringen"
              onClick={() => setReview({ diff: c.offered!.diff, offered: c.offered!.at })}
            />
          }
        />
      )}
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      <Card padding={0}>
        {/* Five tabs do not fit 320 px without scrolling (1.4.10), so a phone gets the sections as a menu with the same panels. */}
        <Section variant="transparent" paddingInline={4} paddingBlock={mobile ? 3 : 0}>
          {mobile ? (
            <DropdownMenu
              button={{ label: `Visa: ${tabs.find(t => t.id === tab)!.label}`, size: 'sm', variant: 'secondary' }}
              presentation="adaptive"
              items={tabs.map(t => ({ id: t.id, label: t.label, onClick: () => setTab(t.id) }))}
            />
          ) : (
            <TabList value={tab} onChange={v => setTab(v as TabId)} role="tablist" hasDivider>
              {tabs.map(t => (
                <Tab key={t.id} value={t.id} label={t.label} panelId={panel(t.id)} />
              ))}
            </TabList>
          )}
        </Section>
        <Section variant="transparent" padding={4}>
          {tab === 'oversikt' && (
            <div id={panel('oversikt')} role={mobile ? 'region' : 'tabpanel'} aria-label="Översikt">
              <VStack gap={4}>
                {/* What an administrator acts on stands open; what a technician looks up when something is wrong folds away. The name, the status and the address are in the page's head. */}
                <MetadataList columns={mobile ? 'single' : 'multi'}>
                  <MetadataListItem label="Vem ser det">{audienceLabel(c.audience)}</MetadataListItem>
                  <MetadataListItem label="Skickar ärenden">
                    {c.scan ? (c.scanEnabled ? 'Ja' : 'Avstängt') : 'Anslutningen skickar inga ärenden'}
                  </MetadataListItem>
                  <MetadataListItem label="Ger sidhuvudet">
                    {c.header ? 'Ja' : c.headerCapability ? 'Kan ge sidhuvudet' : 'Anslutningen kan inte ge sidhuvudet'}
                  </MetadataListItem>
                  <MetadataListItem label="I menyn">
                    {tools.some(t => t.menu.on)
                      ? tools
                          .filter(t => t.menu.on)
                          .map(t => t.menu.label)
                          .join(', ')
                      : tools.length
                        ? 'Ingen vy vald'
                        : 'Ingen vy kan ligga i menyn'}
                  </MetadataListItem>
                  <MetadataListItem label="Läser andra system">
                    {c.uses.length ? c.uses.join(', ') : 'Nej'}
                  </MetadataListItem>
                  <MetadataListItem label="Får personens inloggning">
                    {c.delegation ? `Ja, för ${c.delegation}` : 'Nej'}
                  </MetadataListItem>
                  <MetadataListItem label="Funktioner">{`${c.counts.capabilities}\u00a0· ${c.counts.execute} utför\u00a0· ${c.counts.tools} för assistenten`}</MetadataListItem>
                </MetadataList>
                <Collapsible
                  defaultIsOpen={false}
                  chevronPosition="start"
                  trigger={<Text type="supporting">Tekniska uppgifter</Text>}
                >
                  <MetadataList columns={mobile ? 'single' : 'multi'}>
                    <MetadataListItem label="Id">{c.id}</MetadataListItem>
                    <MetadataListItem label="Typ">
                      {c.kind ? kindLabel(c.kind, site) : '–'}
                      {c.bundled ? '\u00a0· inbyggd' : ''}
                    </MetadataListItem>
                    <MetadataListItem label="Hälsa">
                      {healthLabel[c.health.status]}
                      {c.bundled ? '' : '\u00a0· '}
                      {!c.bundled && <Timestamp value={c.health.at} format="auto" />}
                    </MetadataListItem>
                    <MetadataListItem label="Protokoll">{c.protocol ? `Version ${c.protocol}` : '–'}</MetadataListItem>
                    {c.manifestAt && (
                      <MetadataListItem label="Senast inläst">
                        <Timestamp value={c.manifestAt} format="date_time" />
                      </MetadataListItem>
                    )}
                    {c.secretChangedAt && (
                      <MetadataListItem label="Nyckel bytt">
                        <Timestamp value={c.secretChangedAt} format="date_time" />
                      </MetadataListItem>
                    )}
                    <MetadataListItem label="Tillagd">
                      {actorLabel(c.createdBy)}
                      {DOT}
                      <Timestamp value={c.createdAt} format="date_time" />
                    </MetadataListItem>
                  </MetadataList>
                </Collapsible>
                {report && (
                  <VStack gap={2}>
                    <Heading level={3} accessibilityLevel={2}>
                      Senaste kontroll
                    </Heading>
                    <CheckResult report={report} />
                  </VStack>
                )}
              </VStack>
            </div>
          )}
          {tab === 'formagor' && (
            <div id={panel('formagor')} role={mobile ? 'region' : 'tabpanel'} aria-label="Funktioner">
              <VStack gap={3}>
                <Toolbar
                  label="Funktioner"
                  size="sm"
                  startContent={
                    <Switch
                      size="sm"
                      label="Erbjud assistenten"
                      value={c.toolsEnabled}
                      isDisabled={busy}
                      changeAction={on =>
                        run(async () => {
                          await save({ toolsEnabled: on });
                        })
                      }
                    />
                  }
                  endContent={
                    c.counts.execute > 0 && c.capabilities.some(x => x.kind === 'execute' && x.enabled) ? (
                      <Button
                        variant="secondary"
                        label="Stäng av alla åtgärder"
                        isDisabled={busy}
                        clickAction={() =>
                          run(async () => {
                            await save({
                              capabilities: Object.fromEntries(
                                c.capabilities
                                  .filter(x => x.kind === 'execute')
                                  .map(x => [x.name, { enabled: false as const }]),
                              ),
                            });
                            return 'Alla åtgärder är avstängda: anslutningen är skrivskyddad.';
                          })
                        }
                      />
                    ) : undefined
                  }
                />
                {mobile ? (
                  <List aria-label="Funktioner">
                    {capRows.map(r => (
                      <ListItem
                        key={r.name}
                        label={<Text>{r.c.title}</Text>}
                        description={
                          <VStack gap={0}>
                            <Text type="code" color="secondary">
                              {r.c.name}
                            </Text>
                            <Text type="supporting">{capabilityKindLabel[r.c.kind]}</Text>
                          </VStack>
                        }
                        endContent={
                          <Switch
                            size="sm"
                            label={`${r.c.title} på`}
                            isLabelHidden
                            value={r.c.enabled}
                            changeAction={on => setCap(r.name, capPatch(on, 'enabled'))}
                          />
                        }
                      />
                    ))}
                  </List>
                ) : (
                  <Table<CapRow> data={capRows} idKey="name" columns={capColumns} density="compact" />
                )}
              </VStack>
            </div>
          )}
          {tab === 'omraden' && (
            <div id={panel('omraden')} role={mobile ? 'region' : 'tabpanel'} aria-label="Områden">
              <VStack gap={3}>
                <Switch
                  label="Skicka ärenden"
                  description="Anslutningen får föreslå ärenden till Att göra."
                  value={c.scanEnabled}
                  isDisabled={busy || !c.scan}
                  disabledMessage="Anslutningen skickar inga ärenden."
                  changeAction={on =>
                    run(async () => {
                      await save({ scanEnabled: on });
                    })
                  }
                />
                {/* The shared header (D88): one connector gives it; switching it on here takes it from the one that held it. */}
                <Switch
                  label="Ger sidhuvudet"
                  description="Anslutningens platser och logotyp ritas i sidhuvudet på varje sida. Bara en anslutning i taget; den som hade det släpper det."
                  value={c.header}
                  isDisabled={busy || !c.headerCapability}
                  disabledMessage="Anslutningens beskrivning pekar inte ut någon förmåga för sidhuvudet."
                  changeAction={on =>
                    run(async () => {
                      await save({ header: on });
                      return on
                        ? 'Anslutningen ger sidhuvudet nu.'
                        : 'Anslutningen ger inte längre sidhuvudet; Clews eget visas.';
                    })
                  }
                />
                {/* Verktyg i menyn (D40): every view that can be a tool, with its own switch. The same list on a phone. */}
                {tools.length === 0 ? (
                  <Text type="supporting">
                    Ingen av anslutningens vyer kan ligga i menyn. Det kan en läsning med en vy som öppnas utan indata.
                  </Text>
                ) : (
                  <List
                    aria-label="Verktyg i menyn"
                    header={
                      <VStack gap={0}>
                        <Text weight="semibold">Verktyg i menyn</Text>
                        <Text type="supporting">
                          Välj vilka av anslutningens vyer som ligger under Verktyg i menyn, för alla som ser
                          anslutningen.
                        </Text>
                      </VStack>
                    }
                  >
                    {tools.map(t => (
                      <ListItem
                        key={t.name}
                        label={<Text>{t.menu.label}</Text>}
                        description={
                          <Text type="supporting">
                            Öppnar {t.title}
                            {t.enabled ? '' : '\u00a0· funktionen är avstängd'}
                          </Text>
                        }
                        endContent={
                          <Switch
                            size="sm"
                            label={`Visa ${t.menu.label} i menyn`}
                            isLabelHidden
                            value={t.menu.on}
                            isDisabled={busy || !t.enabled}
                            disabledMessage="Funktionen är avstängd under Funktioner."
                            changeAction={on =>
                              run(async () => {
                                await save({ menu: { [t.name]: on } });
                                return on
                                  ? `${t.menu.label} visas i menyn under Verktyg.`
                                  : `${t.menu.label} visas inte längre i menyn.`;
                              })
                            }
                          />
                        }
                      />
                    ))}
                  </List>
                )}
                {/* På Personal och andra listor (D97 items 3 and 4): every read about a person or a unit, offered under Visa on the list and as one column on Alla. Choosing places it; it gives no one access. */}
                {lists.length > 0 && (
                  <List
                    aria-label="På Personal och andra listor"
                    header={
                      <VStack gap={0}>
                        <Text weight="semibold">På Personal och andra listor</Text>
                        <Text type="supporting">
                          Välj vilka av anslutningens läsningar om en person eller en enhet som går att välja under
                          Visa, och vilket fält som visas som kolumn under Alla. Högst {ENTITY_COLUMNS_MAX} kolumner
                          visas, från alla anslutningar tillsammans.
                        </Text>
                      </VStack>
                    }
                  >
                    {lists.map(l => (
                      <ListItem
                        key={l.name}
                        align="start"
                        label={<Text>{l.title}</Text>}
                        description={
                          <VStack gap={2}>
                            <Text type="supporting">
                              {l.about === 'unit' ? 'Om en enhet' : 'Om en person'}
                              {l.enabled ? '' : '\u00a0· funktionen är avstängd'}
                            </Text>
                            {l.column && (
                              <HStack>
                                <Selector
                                  size="sm"
                                  label="Kolumn på Alla"
                                  value={l.column.on ?? NO_COLUMN}
                                  isDisabled={busy || !l.enabled}
                                  disabledMessage="Funktionen är avstängd under Funktioner."
                                  options={[
                                    { value: NO_COLUMN, label: 'Ingen kolumn' },
                                    ...l.column.fields.map(f => ({ value: f.key, label: f.label })),
                                  ]}
                                  onChange={value =>
                                    void run(async () => {
                                      const field = value === NO_COLUMN ? null : value;
                                      await save({ column: { [l.name]: field } });
                                      const label = l.column!.fields.find(f => f.key === field)?.label;
                                      return label
                                        ? `${label} ur ${l.title} visas som kolumn under Alla.`
                                        : `${l.title} visas inte längre som kolumn under Alla.`;
                                    })
                                  }
                                />
                              </HStack>
                            )}
                          </VStack>
                        }
                        endContent={
                          l.lens && (
                            <Switch
                              size="sm"
                              label={`Visa ${l.title} under Visa`}
                              isLabelHidden
                              value={l.lens.on}
                              isDisabled={busy || !l.enabled}
                              disabledMessage="Funktionen är avstängd under Funktioner."
                              changeAction={on =>
                                run(async () => {
                                  await save({ lens: { [l.name]: on } });
                                  return on
                                    ? `${l.title} går att välja under Visa.`
                                    : `${l.title} går inte längre att välja under Visa.`;
                                })
                              }
                            />
                          )
                        }
                      />
                    ))}
                  </List>
                )}
                {/* Each area with its chip, where the area is governed (artboard 9): the system's colour, the area's icon and word, and "Visa nyckeltalet" (D54) for an area with a figure. */}
                {c.areas.length === 0 ? (
                  <Text type="supporting">Anslutningen har inga områden i sidopanelen.</Text>
                ) : (
                  <List aria-label="Områden">
                    {c.areas.map(a => (
                      <ListItem
                        key={a.id}
                        label={
                          <HStack>
                            <AreaChip ordinal={c.ordinal} icon={a.icon} label={a.title} />
                          </HStack>
                        }
                        description={
                          <Text type="supporting">
                            {a.roles.map(r => roleLabel[r]).join(', ')}
                            {a.standing.length ? `\u00a0· Gör själv: ${a.standing.join(', ')}` : ''}
                            {a.figure
                              ? a.figureShown
                                ? '\u00a0· nyckeltalet är en ruta på Hem'
                                : '\u00a0· nyckeltalet visas inte'
                              : ''}
                          </Text>
                        }
                        endContent={
                          a.figure ? (
                            <Switch
                              size="sm"
                              label="Visa nyckeltalet"
                              labelPosition="start"
                              value={a.figureShown}
                              isDisabled={busy}
                              changeAction={on =>
                                run(async () => {
                                  await save({ figures: { [a.id]: on } });
                                  return on
                                    ? `Nyckeltalet för ${a.title} visas på Hem.`
                                    : `Nyckeltalet för ${a.title} visas inte längre på Hem.`;
                                })
                              }
                            />
                          ) : undefined
                        }
                      />
                    ))}
                  </List>
                )}
              </VStack>
            </div>
          )}
          {tab === 'publik' && audience && (
            <div id={panel('publik')} role={mobile ? 'region' : 'tabpanel'} aria-label="Vem ser det">
              <VStack gap={4}>
                <AudienceEditor value={audience} onChange={setAudience} units={units} groups={groups} />
                <HStack gap={2}>
                  <Button
                    variant="primary"
                    label="Spara"
                    isDisabled={busy || JSON.stringify(audience) === JSON.stringify(c.audience)}
                    clickAction={() =>
                      run(async () => {
                        await save({ audience });
                        return 'Sparat: ' + audienceLabel(audience) + '.';
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    label="Ångra ändringar"
                    isDisabled={JSON.stringify(audience) === JSON.stringify(c.audience)}
                    onClick={() => setAudience(c.audience)}
                  />
                </HStack>
                <AudiencePreview connectorId={id} />
              </VStack>
            </div>
          )}
          {tab === 'historik' && (
            <div id={panel('historik')} role={mobile ? 'region' : 'tabpanel'} aria-label="Historik">
              {c.history.length === 0 ? (
                <Text type="supporting">Ingen historik ännu.</Text>
              ) : (
                <List density="compact" aria-label="Historik">
                  {[...c.history].reverse().map((h, i) => (
                    <ListItem
                      key={i}
                      label={<Text>{historyLabel(h.action)}</Text>}
                      description={
                        <Text type="supporting">
                          {[actorLabel(h.actor), historyWords(h.details)].filter(Boolean).join('\u00a0· ')}
                        </Text>
                      }
                      endContent={<Timestamp value={h.at} format="date_time" />}
                    />
                  ))}
                </List>
              )}
            </div>
          )}
        </Section>
      </Card>
      <Dialog
        isOpen={secretOpen}
        onOpenChange={open => {
          if (!open) {
            setSecretOpen(false);
            setSecret('');
          }
        }}
        width={480}
        purpose="form"
        padding={4}
      >
        <VStack gap={4}>
          <DialogHeader
            title="Byt nyckel"
            subtitle="Den gamla nyckeln slutar gälla direkt. Starta om tjänsten med den nya."
            onOpenChange={() => {
              setSecretOpen(false);
              setSecret('');
            }}
          />
          <FormLayout>
            <TextInput
              label="Ny delad nyckel"
              type="password"
              value={secret}
              onChange={setSecret}
              description="Minst 16 tecken. Sparas förseglad och visas aldrig igen."
              isRequired
              autoComplete="new-password"
            />
          </FormLayout>
          <HStack justify="end" gap={2}>
            <Button
              variant="ghost"
              label="Avbryt"
              onClick={() => {
                setSecretOpen(false);
                setSecret('');
              }}
            />
            <Button
              variant="primary"
              label="Byt nyckel"
              isDisabled={secret.length < 16 || busy}
              clickAction={() =>
                run(async () => {
                  await api.admin.rotateSecret(id, secret);
                  setSecretOpen(false);
                  setSecret('');
                  return 'Nyckeln är bytt.';
                })
              }
            />
          </HStack>
        </VStack>
      </Dialog>
      {/* Astryx's form-wizard-dialog frame: a manifest with many changes scrolls its list, the two choices stay pinned in the
        footer. The frame and its DialogHeader are always rendered: the Dialog takes its name from a title present when it mounts. */}
      <Dialog
        isOpen={!!review}
        onOpenChange={open => {
          if (!open) setReview(null);
        }}
        width={520}
      >
        <DialogFrame
          error={actionError}
          scrollLabel="Ändringarna i systemet"
          header={
            <DialogHeader
              title="Systemet har ändrats"
              subtitle="Så här skiljer sig systemet från det du har godkänt. Inget av det används förrän du godkänner det."
              onOpenChange={() => setReview(null)}
              hasDivider={false}
            />
          }
          secondary={<Button variant="ghost" label="Behåll det gamla" onClick={() => setReview(null)} />}
          primary={
            <Button
              variant="primary"
              label="Använd det nya"
              isDisabled={busy || !review}
              clickAction={() =>
                run(async () => {
                  if (review) await api.admin.refresh(id, true, review.offered);
                  setReview(null);
                  return 'Uppdaterat från systemet.';
                })
              }
            />
          }
        >
          {review && (
            // Each row begins with its dot's word ("Ny funktion: …"), so the dot is decoration and is heard once.
            <List density="compact" aria-label="Ändringar">
              {review.diff.added.map(n => (
                <ListItem
                  key={'a' + n}
                  startContent={<StatusDot variant="success" label="Ny" aria-hidden />}
                  label={<Text>Ny funktion: {n}</Text>}
                />
              ))}
              {review.diff.removed.map(n => (
                <ListItem
                  key={'r' + n}
                  startContent={<StatusDot variant="error" label="Borttagen" aria-hidden />}
                  label={<Text>Borttagen funktion: {n}</Text>}
                  description={<Text type="supporting">Ärenden som pekar på den slutar fungera.</Text>}
                />
              ))}
              {review.diff.changed.map(c => (
                <ListItem
                  key={'c' + c.name}
                  startContent={<StatusDot variant="warning" label="Ändrad" aria-hidden />}
                  label={<Text>Ändrad funktion: {c.name}</Text>}
                  description={<Text type="supporting">Ändrat: {fieldList(c.fields, capabilityFieldLabel)}.</Text>}
                />
              ))}
              {review.diff.areasAdded.map(n => (
                <ListItem
                  key={'aa' + n}
                  startContent={<StatusDot variant="success" label="Nytt" aria-hidden />}
                  label={<Text>Nytt område: {n}</Text>}
                />
              ))}
              {review.diff.areasRemoved.map(n => (
                <ListItem
                  key={'ar' + n}
                  startContent={<StatusDot variant="error" label="Borttaget" aria-hidden />}
                  label={<Text>Borttaget område: {n}</Text>}
                />
              ))}
              {review.diff.areasChanged.map(a => (
                <ListItem
                  key={'ac' + a.id}
                  startContent={<StatusDot variant="warning" label="Ändrat" aria-hidden />}
                  label={<Text>Ändrat område: {a.id}</Text>}
                  description={<Text type="supporting">Ändrat: {fieldList(a.fields, areaFieldLabel)}.</Text>}
                />
              ))}
              {/* What the connector reads through Clew as the person, and whose token it gets (D144): what an administrator weighs. */}
              {review.diff.usesAdded.map(n => (
                <ListItem
                  key={'ua' + n}
                  startContent={<StatusDot variant="warning" label="Läser" aria-hidden />}
                  label={<Text>Läser som personen: {n}</Text>}
                  description={
                    <Text type="supporting">
                      Anslutningen får läsa detta i ett annat system som den person den svarar.
                    </Text>
                  }
                />
              ))}
              {review.diff.usesRemoved.map(n => (
                <ListItem
                  key={'ur' + n}
                  startContent={<StatusDot variant="success" label="Läser inte" aria-hidden />}
                  label={<Text>Läser inte längre: {n}</Text>}
                />
              ))}
              {review.diff.delegation && (
                <ListItem
                  key="delegation"
                  startContent={<StatusDot variant="warning" label="Inloggning" aria-hidden />}
                  label={
                    <Text>
                      {review.diff.delegation.to
                        ? `Får personens inloggning för ${review.diff.delegation.to}`
                        : 'Får inte längre personens inloggning'}
                    </Text>
                  }
                  description={
                    review.diff.delegation.from && review.diff.delegation.to ? (
                      <Text type="supporting">I dag: {review.diff.delegation.from}.</Text>
                    ) : undefined
                  }
                />
              )}
              {review.diff.fields.map(f => (
                <ListItem
                  key={'f' + f}
                  startContent={<StatusDot variant="warning" label="Ändrat" aria-hidden />}
                  label={<Text>Ändrat: {manifestFieldLabel[f] ?? f}</Text>}
                />
              ))}
            </List>
          )}
        </DialogFrame>
      </Dialog>
      <AlertDialog
        isOpen={removeOpen}
        onOpenChange={setRemoveOpen}
        title={removeLabel}
        description={`Anslutningen försvinner från alla sidor och dess öppna ärenden stängs. Kvitton under Klart finns kvar. Nyckeln raderas.`}
        actionLabel="Ta bort"
        cancelLabel="Avbryt"
        isActionLoading={removal.busy}
        onAction={() =>
          removal.run(async () => {
            const r = await api.admin.remove(id);
            setRemoveOpen(false);
            client.removeQueries({ queryKey: keys.admin.connector(id) });
            navigate('/admin/connectors');
            return `${c.source} är borttagen${r.closedCards ? `, ${r.closedCards} ${r.closedCards === 1 ? 'ärende' : 'ärenden'} stängdes` : ''}.`;
          })
        }
      />
    </AdminShell>
  );
}
