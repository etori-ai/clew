import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { CheckReport, ConnectorAudience, ConnectorDetail, ManifestDiff, SessionUser } from '@clew/contracts';
import { AlertDialog, Badge, Banner, Button, Code, Dialog, DialogHeader, DropdownMenu, EmptyState, FormLayout, HStack, Heading, InfoTip, List, ListItem, MetadataList, MetadataListItem, StatusDot, Switch, Tab, TabList, Table, Text, TextInput, Timestamp, Toolbar, VStack, useMediaQuery, useToast } from '@clew/ui';
import { api, ApiError } from '../../api';
import { usePageTitle } from '../../page-title';
import { AudienceEditor, AudiencePreview } from './audience';
import { actionLabel, actorLabel, audienceLabel, capabilityKindLabel, healthLabel, kindLabel, roleLabel, statusOf } from './labels';
import { AdminShell } from './shell';

/** One connector (D23): overview and actions, capabilities with their switches, areas, who sees it, and its history. */
type TabId = 'oversikt' | 'formagor' | 'omraden' | 'publik' | 'historik';
const tabs: Array<{ id: TabId; label: string }> = [{ id: 'oversikt', label: 'Översikt' }, { id: 'formagor', label: 'Förmågor' }, { id: 'omraden', label: 'Områden' }, { id: 'publik', label: 'Vem ser det' }, { id: 'historik', label: 'Historik' }];
interface CapRow extends Record<string, unknown> { name: string; c: ConnectorDetail['capabilities'][number] }

type CapabilityView = ConnectorDetail['capabilities'][number];
/** The "Assistent" switch of one capability, disabled with its reason when the manifest, the kind or the connector says no. */
function ToolSwitch({ row, toolsEnabled, onChange }: { row: CapabilityView; toolsEnabled: boolean; onChange: (on: boolean) => Promise<void> }) {
  const reason = row.kind === 'execute' ? 'En åtgärd är aldrig ett verktyg för assistenten (D8).' : !row.model ? 'Anslutningen har inte märkt förmågan som verktyg.' : !row.enabled ? 'Förmågan är avstängd.' : 'Assistenten är avstängd för hela anslutningen.';
  const disabled = !row.model || row.kind === 'execute' || !row.enabled || !toolsEnabled;
  return <HStack gap={1} vAlign="center">
    <Switch size="sm" label={row.title + ' till assistenten'} isLabelHidden value={row.tool} isDisabled={disabled} disabledMessage={reason} changeAction={onChange} />
    {row.kind === 'execute' && <InfoTip content="Åtgärder utförs bara genom att en person bekräftar på ett kort, aldrig av assistenten." label="Varför kan åtgärder inte bli verktyg" />}
  </HStack>;
}

export function AdminConnectorPage({ user }: { user: SessionUser }) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mobile = useMediaQuery('(max-width: 720px)');
  const toast = useToast();
  const [c, setC] = useState<ConnectorDetail | null | 'missing'>(null);
  const [tab, setTab] = useState<TabId>('oversikt');
  const [units, setUnits] = useState<Array<{ id: string; label: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<CheckReport | null>(null);
  const [diff, setDiff] = useState<ManifestDiff | null>(null);
  const [secretOpen, setSecretOpen] = useState(false); const [secret, setSecret] = useState('');
  const [removeOpen, setRemoveOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [audience, setAudience] = useState<ConnectorAudience | null>(null);
  const [version, setVersion] = useState(0);
  usePageTitle(c && c !== 'missing' ? c.source : null);
  const load = useCallback(async () => {
    try { const d = await api.admin.connector(id); setC(d); setAudience(d.audience); setError(null); }
    catch (e) { if (e instanceof ApiError && e.status === 400) setC('missing'); else setError(e instanceof ApiError ? e.message : 'Anslutningen kunde inte läsas.'); }
  }, [id]);
  useEffect(() => { void load(); api.admin.units().then(u => setUnits(u.units)).catch(() => undefined); }, [load]);
  const run = async (fn: () => Promise<string | void>) => { if (busy) return; setBusy(true); setError(null); try { const message = await fn(); await load(); setVersion(v => v + 1); if (message) toast({ body: message, uniqueID: 'connector:' + id }); } catch (e) { setError(e instanceof ApiError ? e.message : 'Något gick fel.'); } finally { setBusy(false); } };
  if (c === 'missing') return <AdminShell user={user} crumbs={[{ label: 'Anslutna system', href: '/admin/anslutningar' }, { label: id }]}><EmptyState headingLevel={1} title="Anslutningen finns inte" description="Den kan ha tagits bort." actions={<Button label="Till listan" href="/admin/anslutningar" />} /></AdminShell>;
  if (!c) return <AdminShell user={user} crumbs={[{ label: 'Anslutna system', href: '/admin/anslutningar' }, { label: id }]}>{error ? <Text as="p" role="alert" color="accent">{error}</Text> : <Text type="supporting" role="status">Läser anslutningen …</Text>}</AdminShell>;
  const s = statusOf(c);
  const unhealthy = c.state === 'enabled' && !c.bundled && c.health.status !== 'ok';
  const panel = (t: TabId) => `panel-${t}`;
  const capRows: CapRow[] = c.capabilities.map(x => ({ name: x.name, c: x }));
  const setCap = (name: string, patch: { enabled?: false; model?: false }) => run(async () => { await api.admin.update(id, { capabilities: { [name]: patch } }); });
  // Off is the only value an override can hold (narrowing only, D23); on clears it.
  const capPatch = (on: boolean, key: 'enabled' | 'model'): { enabled?: false; model?: false } => on ? {} : key === 'enabled' ? { enabled: false } : { model: false };
  const capColumns = [
    { key: 'title', header: 'Förmåga', renderCell: (r: CapRow) => <VStack gap={0}><Text>{r.c.title}</Text><Code>{r.c.name}</Code></VStack> },
    { key: 'kind', header: 'Typ', renderCell: (r: CapRow) => <Badge variant={r.c.kind === 'execute' ? 'warning' : 'neutral'} label={capabilityKindLabel[r.c.kind]} /> },
    { key: 'roles', header: 'Roller enligt manifestet', renderCell: (r: CapRow) => <Text type="supporting">{r.c.roles ? r.c.roles.map(x => roleLabel[x]).join(', ') : 'Alla (regeln ligger i koden)'}</Text> },
    { key: 'on', header: 'På', renderCell: (r: CapRow) => <Switch size="sm" label={`${r.c.title} på`} isLabelHidden value={r.c.enabled} changeAction={on => setCap(r.name, capPatch(on, 'enabled'))} /> },
    { key: 'tool', header: 'Assistent', renderCell: (r: CapRow) => <ToolSwitch row={r.c} toolsEnabled={c.toolsEnabled} onChange={on => setCap(r.name, capPatch(on, 'model'))} /> },
  ];
  const removeLabel = `Ta bort ${c.source}`;
  return <AdminShell user={user} crumbs={[{ label: 'Anslutna system', href: '/admin/anslutningar' }, { label: c.source }]}>
    <HStack justify="between" vAlign="center" gap={3} wrap="wrap">
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Heading level={1}>{c.source}</Heading>
        <StatusDot variant={s.tone} label={s.label} /><Text type="supporting">{s.label}</Text>
        {c.kind && <Badge variant="neutral" label={kindLabel[c.kind]} />}{c.bundled && <Badge variant="neutral" label="Inbyggd" />}
      </HStack>
      <Switch label={c.state === 'enabled' ? 'På' : 'Av'} labelPosition="start" value={c.state === 'enabled'} isDisabled={busy || (c.state === 'draft' && !c.counts.capabilities)} disabledMessage="Utkastet saknar manifest: kontrollera anslutningen först." changeAction={on => run(async () => { await api.admin.update(id, { state: on ? 'enabled' : 'disabled' }); return `${c.source} ${on ? 'är på' : 'är avstängd'}.`; })} />
    </HStack>
    {unhealthy && <Banner status={c.health.status === 'unreachable' ? 'warning' : 'error'} container="section" collapsible={false} title={`${c.source}: ${healthLabel[c.health.status].toLowerCase()}${c.health.at ? ' sedan ' : ''}`}
      description={`${c.health.detail ?? ''} Kort och figurer visas från senast kända läge.`.trim()} endContent={<Timestamp value={c.health.at} format="date_time" />} />}
    {error && <Text as="p" role="alert" color="accent">{error}</Text>}
    {/* Five tabs do not fit 320 px without scrolling (1.4.10), so a phone gets the sections as a menu with the same panels. */}
    {mobile
      ? <DropdownMenu button={{ label: `Visa: ${tabs.find(t => t.id === tab)!.label}`, size: 'sm', variant: 'secondary' }} presentation="adaptive" items={tabs.map(t => ({ id: t.id, label: t.label, onClick: () => setTab(t.id) }))} />
      : <TabList value={tab} onChange={v => setTab(v as TabId)} role="tablist" hasDivider>
        {tabs.map(t => <Tab key={t.id} value={t.id} label={t.label} panelId={panel(t.id)} />)}
      </TabList>}
    {tab === 'oversikt' && <div id={panel('oversikt')} role={mobile ? "region" : "tabpanel"} aria-label="Översikt"><VStack gap={4}>
      <MetadataList columns={mobile ? 'single' : 'multi'}>
        <MetadataListItem label="Id">{c.id}</MetadataListItem>
        <MetadataListItem label="Källa">{c.source}</MetadataListItem>
        <MetadataListItem label="Typ">{c.kind ? kindLabel[c.kind] : '–'}{c.bundled ? ' · inbyggd i Clew' : ''}</MetadataListItem>
        {!c.bundled && <MetadataListItem label="Adress">{c.url}</MetadataListItem>}
        <MetadataListItem label="Protokoll">{c.protocol ? `Version ${c.protocol}` : '–'}</MetadataListItem>
        <MetadataListItem label="Hälsa">{healthLabel[c.health.status]}{c.bundled ? '' : ' · '}{!c.bundled && <Timestamp value={c.health.at} format="auto" />}</MetadataListItem>
        <MetadataListItem label="Förmågor">{`${c.counts.capabilities} · ${c.counts.execute} åtgärder · ${c.counts.tools} till assistenten`}</MetadataListItem>
        <MetadataListItem label="Skickar kort">{c.scan ? (c.scanEnabled ? 'Ja' : 'Avstängt') : 'Anslutningen skickar inga kort'}</MetadataListItem>
        <MetadataListItem label="Vem ser det">{audienceLabel(c.audience)}</MetadataListItem>
        {c.manifestAt && <MetadataListItem label="Manifest hämtat"><Timestamp value={c.manifestAt} format="date_time" /></MetadataListItem>}
        {c.secretChangedAt && <MetadataListItem label="Nyckel bytt"><Timestamp value={c.secretChangedAt} format="date_time" /></MetadataListItem>}
        <MetadataListItem label="Tillagd">{actorLabel(c.createdBy)} · <Timestamp value={c.createdAt} format="date_time" /></MetadataListItem>
      </MetadataList>
      {!c.bundled && <HStack gap={2} wrap="wrap">
        <Button variant="secondary" label="Testa anslutning" isDisabled={busy} clickAction={() => run(async () => { const r = await api.admin.test(id); setReport(r); return r.ok ? 'Kontrollen gick bra.' : 'Kontrollen hittade fel, se listan.'; })} />
        <Button variant="secondary" label="Hämta manifest igen" isDisabled={busy} clickAction={() => run(async () => { const r = await api.admin.refresh(id, false); if (r.diff.same) return 'Manifestet är oförändrat.'; setDiff(r.diff); })} />
        <Button variant="secondary" label="Byt nyckel" isDisabled={busy} onClick={() => setSecretOpen(true)} />
        <Button variant="destructive" label="Ta bort" isDisabled={busy} onClick={() => setRemoveOpen(true)} />
      </HStack>}
      {report && <List density="compact" aria-label="Kontrollens resultat" header={<Text type="supporting" weight="semibold">Senaste kontroll</Text>}>
        {report.findings.map((f, i) => <ListItem key={i} startContent={<StatusDot variant={f.level === 'ok' ? 'success' : f.level === 'warn' ? 'warning' : 'error'} label={f.level === 'ok' ? 'Ok' : f.level === 'warn' ? 'Varning' : 'Fel'} />} label={<Text>{f.text}</Text>} />)}
      </List>}
    </VStack></div>}
    {tab === 'formagor' && <div id={panel('formagor')} role={mobile ? "region" : "tabpanel"} aria-label="Förmågor"><VStack gap={3}>
      <Toolbar label="Förmågor" size="sm" startContent={<Switch size="sm" label="Erbjud assistenten" value={c.toolsEnabled} isDisabled={busy} changeAction={on => run(async () => { await api.admin.update(id, { toolsEnabled: on }); })} />}
        endContent={c.counts.execute > 0 && c.capabilities.some(x => x.kind === 'execute' && x.enabled) ? <Button variant="secondary" label="Stäng av alla åtgärder" isDisabled={busy} clickAction={() => run(async () => { await api.admin.update(id, { capabilities: Object.fromEntries(c.capabilities.filter(x => x.kind === 'execute').map(x => [x.name, { enabled: false as const }])) }); return 'Alla åtgärder är avstängda: anslutningen är skrivskyddad.'; })} /> : undefined} />
      {mobile
        ? <List aria-label="Förmågor">{capRows.map(r => <ListItem key={r.name} label={<Text>{r.c.title}</Text>} description={<VStack gap={0}><Code>{r.c.name}</Code><Text type="supporting">{capabilityKindLabel[r.c.kind]}</Text></VStack>} endContent={<Switch size="sm" label={`${r.c.title} på`} isLabelHidden value={r.c.enabled} changeAction={on => setCap(r.name, capPatch(on, 'enabled'))} />} />)}</List>
        : <Table<CapRow> data={capRows} idKey="name" columns={capColumns} density="compact" />}
    </VStack></div>}
    {tab === 'omraden' && <div id={panel('omraden')} role={mobile ? "region" : "tabpanel"} aria-label="Områden"><VStack gap={3}>
      <Switch label="Skicka kort" description="Anslutningen får föreslå kort i strömmen." value={c.scanEnabled} isDisabled={busy || !c.scan} disabledMessage="Anslutningen har ingen genomgång." changeAction={on => run(async () => { await api.admin.update(id, { scanEnabled: on }); })} />
      {c.areas.length === 0 ? <Text type="supporting">Anslutningen har inga områden i sidopanelen.</Text> : <List aria-label="Områden">
        {c.areas.map(a => <ListItem key={a.id} label={<Text>{a.title}</Text>} description={<Text type="supporting">{a.roles.map(r => roleLabel[r]).join(', ')}{a.standing.length ? ` · Gör själv: ${a.standing.join(', ')}` : ''}{a.figure ? ' · med figur' : ''}</Text>} />)}
      </List>}
    </VStack></div>}
    {tab === 'publik' && audience && <div id={panel('publik')} role={mobile ? "region" : "tabpanel"} aria-label="Vem ser det"><VStack gap={4}>
      <AudienceEditor value={audience} onChange={setAudience} units={units} />
      <HStack gap={2}>
        <Button variant="primary" label="Spara" isDisabled={busy || JSON.stringify(audience) === JSON.stringify(c.audience)} clickAction={() => run(async () => { await api.admin.update(id, { audience }); return 'Sparat: ' + audienceLabel(audience) + '.'; })} />
        <Button variant="ghost" label="Ångra ändringar" isDisabled={JSON.stringify(audience) === JSON.stringify(c.audience)} onClick={() => setAudience(c.audience)} />
      </HStack>
      <AudiencePreview connectorId={id} version={version} />
    </VStack></div>}
    {tab === 'historik' && <div id={panel('historik')} role={mobile ? "region" : "tabpanel"} aria-label="Historik">
      {c.history.length === 0 ? <Text type="supporting">Ingen historik ännu.</Text> : <List density="compact" aria-label="Historik">
        {[...c.history].reverse().map((h, i) => <ListItem key={i} label={<Text>{actionLabel[h.action] ?? h.action}</Text>} description={<Text type="supporting">{actorLabel(h.actor)}{Object.keys(h.details).length ? ' · ' + JSON.stringify(h.details) : ''}</Text>} endContent={<Timestamp value={h.at} format="date_time" />} />)}
      </List>}
    </div>}
    <Dialog isOpen={secretOpen} onOpenChange={open => { if (!open) { setSecretOpen(false); setSecret(''); } }} width={480} purpose="form" padding={4}>
      <VStack gap={4}>
        <DialogHeader title="Byt nyckel" subtitle="Den gamla nyckeln slutar gälla direkt. Starta om tjänsten med den nya." onOpenChange={() => { setSecretOpen(false); setSecret(''); }} />
        <FormLayout><TextInput label="Ny delad nyckel" type="password" value={secret} onChange={setSecret} description="Minst 16 tecken. Sparas förseglad och visas aldrig igen." isRequired autoComplete="new-password" /></FormLayout>
        <HStack justify="end" gap={2}>
          <Button variant="ghost" label="Avbryt" onClick={() => { setSecretOpen(false); setSecret(''); }} />
          <Button variant="primary" label="Byt nyckel" isDisabled={secret.length < 16 || busy} clickAction={() => run(async () => { await api.admin.rotateSecret(id, secret); setSecretOpen(false); setSecret(''); return 'Nyckeln är bytt.'; })} />
        </HStack>
      </VStack>
    </Dialog>
    <Dialog isOpen={!!diff} onOpenChange={open => { if (!open) setDiff(null); }} width={520} padding={4}>
      {diff && <VStack gap={4}>
        <DialogHeader title="Manifestet har ändrats" subtitle="Så här skiljer sig tjänstens manifest från det Clew använder." onOpenChange={() => setDiff(null)} />
        <List density="compact" aria-label="Ändringar">
          {diff.added.map(n => <ListItem key={'a' + n} startContent={<StatusDot variant="success" label="Ny" />} label={<Text>Ny förmåga: {n}</Text>} />)}
          {diff.removed.map(n => <ListItem key={'r' + n} startContent={<StatusDot variant="error" label="Borttagen" />} label={<Text>Borttagen förmåga: {n}</Text>} description={<Text type="supporting">Kort som pekar på den slutar fungera.</Text>} />)}
          {diff.changed.map(n => <ListItem key={'c' + n} startContent={<StatusDot variant="warning" label="Ändrad" />} label={<Text>Ändrad förmåga: {n}</Text>} />)}
          {diff.areasAdded.map(n => <ListItem key={'aa' + n} startContent={<StatusDot variant="success" label="Nytt" />} label={<Text>Nytt område: {n}</Text>} />)}
          {diff.areasRemoved.map(n => <ListItem key={'ar' + n} startContent={<StatusDot variant="error" label="Borttaget" />} label={<Text>Borttaget område: {n}</Text>} />)}
        </List>
        <HStack justify="end" gap={2}>
          <Button variant="ghost" label="Behåll det gamla" onClick={() => setDiff(null)} />
          <Button variant="primary" label="Använd det nya" isDisabled={busy} clickAction={() => run(async () => { await api.admin.refresh(id, true); setDiff(null); return 'Manifestet är uppdaterat.'; })} />
        </HStack>
      </VStack>}
    </Dialog>
    <AlertDialog isOpen={removeOpen} onOpenChange={setRemoveOpen} title={removeLabel} description={`Anslutningen försvinner från alla sidor och dess öppna kort stängs. Kvitton i Redan hanterat finns kvar. Nyckeln raderas.`} actionLabel="Ta bort" cancelLabel="Avbryt" isActionLoading={busy}
      onAction={() => run(async () => { const r = await api.admin.remove(id); setRemoveOpen(false); navigate('/admin/anslutningar'); return `${c.source} är borttagen${r.closedCards ? `, ${r.closedCards} kort stängdes` : ''}.`; })} />
  </AdminShell>;
}
