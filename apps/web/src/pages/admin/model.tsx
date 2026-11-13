import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectorAudience, ModelDetail, ProviderTestReport, SessionUser } from '@clew/contracts';
import {
  AlertDialog,
  Badge,
  Banner,
  Button,
  Card,
  DropdownMenu,
  EmptyState,
  FormLayout,
  HStack,
  Heading,
  Link,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  Section,
  StatusDot,
  Switch,
  Tab,
  TabList,
  Text,
  TextInput,
  Timestamp,
  Toolbar,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { api, ApiError } from '../../api';
import { adminQueries } from '../../queries';
import { keys } from '../../query-keys';
import { useAdminAction } from '../../mutations';
import { errorMessage } from '../../query-policy';
import { usePageTitle } from '../../page-title';
import { Findings } from './add-model';
import { AudienceEditor } from './audience';
import { actionLabel, actorLabel, audienceLabel, modelStatusOf, providerHealthLabel } from './labels';
import { AdminShell } from './shell';
import { PageHeader } from '../../components/page-header';

/** One model (D24): what it is and how it answers, who can pick it in the box, and its history. */
type TabId = 'oversikt' | 'publik' | 'historik';
const tabs: Array<{ id: TabId; label: string }> = [
  { id: 'oversikt', label: 'Översikt' },
  { id: 'publik', label: 'Vem kan välja den' },
  { id: 'historik', label: 'Historik' },
];
type Draft = Pick<ModelDetail, 'title' | 'description' | 'model'>;

export function AdminModelPage({ user }: { user: SessionUser }) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mobile = useMediaQuery('(max-width: 720px)');
  const client = useQueryClient();
  const detail = useQuery(adminQueries.model(id));
  const units = useQuery(adminQueries.units);
  const groups = useQuery(adminQueries.groups);
  const m = detail.data ?? null;
  const missing = detail.isError && detail.error instanceof ApiError && detail.error.status === 400;
  const readError =
    detail.isError && !missing && detail.data === undefined
      ? errorMessage(detail.error, 'Modellen kunde inte läsas.')
      : null;
  const [tab, setTab] = useState<TabId>('oversikt');
  const [report, setReport] = useState<ProviderTestReport | null>(null);
  const [removeOpen, setRemoveOpen] = useState(false);
  // The drafts follow the saved model whenever it changes, never on a refetch that changed nothing.
  const [audience, setAudience] = useState<ConnectorAudience | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  useEffect(() => {
    if (m) {
      setAudience(m.audience);
      setDraft({ title: m.title, description: m.description, model: m.model });
    }
  }, [m?.id, m?.updatedAt]);
  usePageTitle(m ? m.title : null);
  const { run, busy, error: actionError } = useAdminAction({ toastId: 'model:' + id });
  const removal = useAdminAction({ invalidate: [keys.admin.models], toastId: 'model:' + id });
  const error = actionError ?? removal.error ?? readError;
  const crumbs = (label: string) => [{ label: 'Modeller', href: '/admin/models' }, { label }];
  if (missing)
    return (
      <AdminShell user={user} section="modeller" crumbs={crumbs(id)}>
        <EmptyState
          headingLevel={1}
          title="Modellen finns inte"
          description="Den kan ha tagits bort."
          actions={<Button label="Till listan" href="/admin/models" />}
        />
      </AdminShell>
    );
  if (!m || !draft)
    return (
      <AdminShell pending={!error} user={user} section="modeller" crumbs={crumbs(id)}>
        {error ? (
          <Text as="p" role="alert" color="accent">
            {error}
          </Text>
        ) : (
          <Text type="supporting" role="status">
            Läser modellen …
          </Text>
        )}
      </AdminShell>
    );
  const s = modelStatusOf(m);
  const down = m.state === 'enabled' && (m.health.status === 'unreachable' || m.health.status === 'key-rejected');
  const changed = draft.title !== m.title || draft.description !== m.description || draft.model !== m.model;
  const panel = (t: TabId) => `panel-${t}`;
  const role = mobile ? 'region' : 'tabpanel';
  // A Toolbar keeps one row, which these buttons cannot at 320 px: on a phone they wrap (1.4.10).
  const actions = (
    <>
      <Button
        variant="secondary"
        label="Testa"
        isDisabled={busy}
        clickAction={() =>
          run(async () => {
            const r = await api.admin.testModel(id);
            setReport(r);
            return r.ok ? `${m.title} svarar.` : 'Testet hittade fel, se listan.';
          })
        }
      />
      {m.isDefault ? (
        <Button
          variant="secondary"
          label="Ta bort som standard"
          isDisabled={busy}
          clickAction={() =>
            run(async () => {
              await api.admin.updateModel(id, { isDefault: false });
              return 'Ingen modell är standard nu.';
            })
          }
        />
      ) : (
        <Button
          variant="secondary"
          label="Gör till standard"
          isDisabled={busy || m.state !== 'enabled'}
          tooltip={m.state !== 'enabled' ? 'Slå på modellen först.' : undefined}
          clickAction={() =>
            run(async () => {
              await api.admin.updateModel(id, { isDefault: true });
              return `${m.title} är standard.`;
            })
          }
        />
      )}
    </>
  );
  const remove = <Button variant="destructive" label="Ta bort" isDisabled={busy} onClick={() => setRemoveOpen(true)} />;
  return (
    <AdminShell user={user} section="modeller" crumbs={crumbs(m.title)}>
      <PageHeader
        title={m.title}
        end={
          <Switch
            label={m.state === 'enabled' ? 'På' : 'Av'}
            labelPosition="start"
            value={m.state === 'enabled'}
            isDisabled={busy}
            changeAction={on =>
              run(async () => {
                await api.admin.updateModel(id, { state: on ? 'enabled' : 'disabled' });
                return `${m.title} ${on ? 'är på' : 'är avstängd'}.`;
              })
            }
          />
        }
        meta={
          /* The title's line holds the title and the switch alone (D74); "Standard" is a state of the model, so it stands in the line under it. */
          <HStack gap={1} vAlign="center" wrap="wrap">
            <StatusDot variant={s.tone} label={s.label} aria-hidden />
            <Text type="supporting">
              {s.label} ·{' '}
              <Text type="code" color="secondary">
                {m.model}
              </Text>{' '}
              hos {m.providerTitle}
            </Text>
            {m.isDefault && <Badge variant="neutral" label="Standard" />}
          </HStack>
        }
      />
      {down && (
        <Banner
          status={m.health.status === 'unreachable' ? 'warning' : 'error'}
          container="section"
          collapsible={false}
          title={`${m.providerTitle}: ${providerHealthLabel[m.health.status].toLowerCase()}`}
          description={`${m.health.detail ?? ''} Rutan hittar bara exakta saker tills leverantören svarar igen.`.trim()}
          endContent={<Timestamp value={m.health.at} format="date_time" />}
        />
      )}
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      <Card padding={0}>
        {/* Three tabs do not fit 320 px with these words, so a phone gets the sections as a menu with the same panels (1.4.10), as on a connector. */}
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
            <div id={panel('oversikt')} role={role} aria-label="Översikt">
              <VStack gap={4}>
                {mobile ? (
                  <VStack gap={3}>
                    <HStack gap={2} wrap="wrap" role="group" aria-label="Åtgärder">
                      {actions}
                    </HStack>
                    <HStack>{remove}</HStack>
                  </VStack>
                ) : (
                  <Toolbar label="Åtgärder" size="sm" variant="muted" startContent={actions} endContent={remove} />
                )}
                {report && <Findings report={report} label="Testets resultat" />}
                <MetadataList columns={mobile ? 'single' : 'multi'}>
                  <MetadataListItem label="Id">{m.id}</MetadataListItem>
                  <MetadataListItem label="Leverantör">
                    <Link href={`/admin/models/providers/${m.providerId}`}>{m.providerTitle}</Link>
                  </MetadataListItem>
                  <MetadataListItem label="Vem kan välja den">{audienceLabel(m.audience)}</MetadataListItem>
                  <MetadataListItem label="Leverantörens hälsa">
                    {providerHealthLabel[m.health.status]} · <Timestamp value={m.health.at} format="auto" />
                  </MetadataListItem>
                  <MetadataListItem label="Resonemang">
                    {m.reasoning === 'none'
                      ? 'Av, eftersom leverantören inte tar verktyg medan modellen resonerar'
                      : 'Leverantörens standard'}
                  </MetadataListItem>
                  <MetadataListItem label="Tillagd">
                    {actorLabel(m.createdBy)} · <Timestamp value={m.createdAt} format="date_time" />
                  </MetadataListItem>
                </MetadataList>
                {/* It applies at once, so it stands apart from the form that waits for Spara. */}
                <Switch
                  label="Verktyg"
                  description="Assistenten får läsa genom anslutningarnas verktyg. Stäng av för en modell som inte anropar verktyg pålitligt; den svarar då bara ur samtalet."
                  value={m.tools}
                  isDisabled={busy}
                  changeAction={on =>
                    run(async () => {
                      await api.admin.updateModel(id, { tools: on });
                      return on ? 'Modellen får använda verktyg.' : 'Modellen svarar utan verktyg.';
                    })
                  }
                />
                <VStack gap={3} as="section" aria-label="Uppgifter">
                  <Heading level={3} accessibilityLevel={2}>
                    Uppgifter
                  </Heading>
                  <VStack maxWidth={560} gap={3}>
                    <FormLayout>
                      <TextInput
                        label="Namn i frågerutan"
                        value={draft.title}
                        onChange={title => setDraft({ ...draft, title })}
                        isRequired
                        autoComplete="off"
                      />
                      <TextInput
                        label="Beskrivning"
                        value={draft.description}
                        onChange={description => setDraft({ ...draft, description })}
                        description="En rad om vad modellen är bra på. Visas i frågerutans meny."
                        autoComplete="off"
                      />
                      <TextInput
                        label="Modellens id hos leverantören"
                        value={draft.model}
                        onChange={model => setDraft({ ...draft, model })}
                        isRequired
                        autoComplete="off"
                        hasAutoCorrect={false}
                        autoCapitalize="none"
                      />
                    </FormLayout>
                  </VStack>
                  <HStack gap={2}>
                    <Button
                      variant="primary"
                      label="Spara"
                      isDisabled={busy || !changed || !draft.title.trim() || !/^\S+$/.test(draft.model.trim())}
                      clickAction={() =>
                        run(async () => {
                          await api.admin.updateModel(id, draft);
                          return 'Sparat.';
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      label="Ångra ändringar"
                      isDisabled={!changed}
                      onClick={() => setDraft({ title: m.title, description: m.description, model: m.model })}
                    />
                  </HStack>
                </VStack>
              </VStack>
            </div>
          )}
          {tab === 'publik' && audience && (
            <div id={panel('publik')} role={role} aria-label="Vem kan välja den">
              <VStack gap={4}>
                <AudienceEditor of="model" value={audience} onChange={setAudience} units={units} groups={groups} />
                <HStack gap={2}>
                  <Button
                    variant="primary"
                    label="Spara"
                    isDisabled={busy || JSON.stringify(audience) === JSON.stringify(m.audience)}
                    clickAction={() =>
                      run(async () => {
                        await api.admin.updateModel(id, { audience });
                        return 'Sparat: ' + audienceLabel(audience) + '.';
                      })
                    }
                  />
                  <Button
                    variant="ghost"
                    label="Ångra ändringar"
                    isDisabled={JSON.stringify(audience) === JSON.stringify(m.audience)}
                    onClick={() => setAudience(m.audience)}
                  />
                </HStack>
                {m.isDefault && audience.mode === 'selected' && (
                  <Text type="supporting">
                    Den här modellen är standard. Den som inte är med får nästa påslagna modell de får välja, eller så
                    hittar rutan bara exakta saker om de inte får välja någon.
                  </Text>
                )}
              </VStack>
            </div>
          )}
          {tab === 'historik' && (
            <div id={panel('historik')} role={role} aria-label="Historik">
              <History history={m.history} />
            </div>
          )}
        </Section>
      </Card>
      <AlertDialog
        isOpen={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Ta bort ${m.title}`}
        description={`Modellen försvinner ur frågerutan. Den som valt den får standardmodellen i stället. Svar som den redan skrivit finns kvar.`}
        actionLabel="Ta bort"
        cancelLabel="Avbryt"
        isActionLoading={removal.busy}
        onAction={() =>
          removal.run(async () => {
            await api.admin.removeModel(id);
            setRemoveOpen(false);
            client.removeQueries({ queryKey: keys.admin.model(id) });
            navigate('/admin/models');
            return `${m.title} är borttagen.`;
          })
        }
      />
    </AdminShell>
  );
}
/** The audit rows about one model or provider, newest first. Read-only. */
export function History({ history }: { history: ModelDetail['history'] }) {
  if (!history.length) return <Text type="supporting">Ingen historik ännu.</Text>;
  return (
    <List density="compact" aria-label="Historik">
      {[...history].reverse().map((h, i) => (
        <ListItem
          key={i}
          label={<Text>{actionLabel[h.action] ?? h.action}</Text>}
          description={
            <Text type="supporting">
              {actorLabel(h.actor)}
              {Object.keys(h.details).length ? ' · ' + JSON.stringify(h.details) : ''}
            </Text>
          }
          endContent={<Timestamp value={h.at} format="date_time" />}
        />
      ))}
    </List>
  );
}
