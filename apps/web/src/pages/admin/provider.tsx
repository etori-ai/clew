import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProviderTestReport, SessionUser } from '@clew/contracts';
import {
  AlertDialog,
  Badge,
  Banner,
  Button,
  Card,
  Dialog,
  DialogHeader,
  EmptyState,
  FormLayout,
  HStack,
  Heading,
  List,
  ListItem,
  MetadataList,
  MetadataListItem,
  StatusDot,
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
import { AddModelDialog, Findings } from './add-model';
import { History } from './model';
import { actorLabel, audienceLabel, modelStatusOf, providerHealthLabel, providerStatusOf } from './labels';
import { AdminShell, PageLead } from './shell';

/**
 * One provider (D24): its endpoint's health, the key (rotated, never shown), the name and the address, the models under
 * it and its history. "Testa" asks the endpoint for its models and offers the ones not added yet.
 */
export function AdminProviderPage({ user }: { user: SessionUser }) {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mobile = useMediaQuery('(max-width: 720px)');
  const client = useQueryClient();
  const detail = useQuery(adminQueries.provider(id));
  const list = useQuery(adminQueries.models);
  const p = detail.data ?? null;
  const missing = detail.isError && detail.error instanceof ApiError && detail.error.status === 400;
  const readError =
    detail.isError && !missing && detail.data === undefined
      ? errorMessage(detail.error, 'Leverantören kunde inte läsas.')
      : null;
  const [report, setReport] = useState<ProviderTestReport | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [key, setKey] = useState('');
  const [removeOpen, setRemoveOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<{ title: string; baseUrl: string } | null>(null);
  useEffect(() => {
    if (p) setDraft({ title: p.title, baseUrl: p.baseUrl });
  }, [p?.id, p?.updatedAt]);
  usePageTitle(p ? p.title : null);
  const { run, busy, error: actionError } = useAdminAction({ toastId: 'provider:' + id });
  const removal = useAdminAction({ invalidate: [keys.admin.models], toastId: 'provider:' + id });
  const error = actionError ?? removal.error ?? readError;
  const crumbs = (label: string) => [{ label: 'Modeller', href: '/admin/models' }, { label }];
  if (missing)
    return (
      <AdminShell user={user} section="modeller" crumbs={crumbs(id)}>
        <EmptyState
          headingLevel={1}
          title="Leverantören finns inte"
          description="Den kan ha tagits bort."
          actions={<Button label="Till listan" href="/admin/models" />}
        />
      </AdminShell>
    );
  if (!p || !draft)
    return (
      <AdminShell user={user} section="modeller" crumbs={crumbs(id)}>
        {error ? (
          <Text as="p" role="alert" color="accent">
            {error}
          </Text>
        ) : (
          <Text type="supporting" role="status">
            Läser leverantören …
          </Text>
        )}
      </AdminShell>
    );
  const s = providerStatusOf(p);
  const models = (list.data?.models ?? []).filter(m => m.providerId === id);
  // After "Testa": the ids the endpoint lists that are not added yet, offered through the same dialog as "Lägg till modell".
  const notAdded = report ? report.models.filter(name => !models.some(m => m.model === name)) : [];
  const changed = draft.title !== p.title || draft.baseUrl !== p.baseUrl;
  const closeKey = () => {
    setKeyOpen(false);
    setKey('');
  };
  // A Toolbar keeps one row, which these buttons cannot at 320 px: on a phone they wrap (1.4.10).
  const actions = (
    <>
      <Button
        variant="secondary"
        label="Testa"
        isDisabled={busy}
        clickAction={() =>
          run(async () => {
            const r = await api.admin.testProvider(id);
            setReport(r);
            return r.ok ? 'Leverantören svarar.' : 'Testet hittade fel, se listan.';
          })
        }
      />
      <Button variant="secondary" label="Byt nyckel" isDisabled={busy} onClick={() => setKeyOpen(true)} />
    </>
  );
  const remove = (
    <Button
      variant="destructive"
      label="Ta bort"
      isDisabled={busy || models.length > 0}
      tooltip={models.length > 0 ? 'Ta bort leverantörens modeller först.' : undefined}
      onClick={() => setRemoveOpen(true)}
    />
  );
  return (
    <AdminShell user={user} section="modeller" crumbs={crumbs(p.title)}>
      <PageLead
        title={p.title}
        actions={<Button variant="primary" label="Lägg till modell" onClick={() => setAdding(true)} />}
      >
        <HStack gap={1} vAlign="center" wrap="wrap">
          <StatusDot variant={s.tone} label={s.label} />
          <Text color="secondary">
            {s.label} · {p.baseUrl}
          </Text>
        </HStack>
      </PageLead>
      {(p.health.status === 'unreachable' || p.health.status === 'key-rejected') && (
        <Banner
          status={p.health.status === 'unreachable' ? 'warning' : 'error'}
          container="section"
          collapsible={false}
          title={p.health.status === 'unreachable' ? `${p.title} svarar inte.` : `${p.title} avvisar nyckeln.`}
          description={`${p.health.detail ?? ''} ${p.health.status === 'key-rejected' ? 'Byt nyckel här, eller kontrollera den hos leverantören.' : 'Rutan hittar bara exakta saker tills den svarar igen.'}`.trim()}
          endContent={<Timestamp value={p.health.at} format="date_time" />}
        />
      )}
      {error && (
        <Text as="p" role="alert" color="accent">
          {error}
        </Text>
      )}
      <Card padding={4}>
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
          {report && (
            <VStack gap={3}>
              <Findings report={report} label="Testets resultat" />
              {notAdded.length > 0 && (
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text>
                    {notAdded.length === 1
                      ? 'En modell som leverantören listar är inte tillagd.'
                      : `${notAdded.length} modeller som leverantören listar är inte tillagda.`}
                  </Text>
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Välj modeller att lägga till"
                    onClick={() => setAdding(true)}
                  />
                </HStack>
              )}
            </VStack>
          )}
          <MetadataList columns={mobile ? 'single' : 'multi'}>
            <MetadataListItem label="Id">{p.id}</MetadataListItem>
            <MetadataListItem label="Adress">{p.baseUrl}</MetadataListItem>
            <MetadataListItem label="Nyckel">
              {p.hasKey ? (
                <>
                  Finns
                  {p.keyChangedAt ? (
                    <>
                      , bytt <Timestamp value={p.keyChangedAt} format="date_time" />
                    </>
                  ) : null}
                </>
              ) : (
                'Ingen'
              )}
            </MetadataListItem>
            <MetadataListItem label="Hälsa">
              {providerHealthLabel[p.health.status]} · <Timestamp value={p.health.at} format="auto" />
            </MetadataListItem>
            <MetadataListItem label="Modeller">{`${p.models} · ${p.enabledModels} påslagna`}</MetadataListItem>
            <MetadataListItem label="Tillagd">
              {actorLabel(p.createdBy)} · <Timestamp value={p.createdAt} format="date_time" />
            </MetadataListItem>
          </MetadataList>
        </VStack>
      </Card>
      <Card padding={4}>
        <VStack gap={3} as="section" aria-labelledby="provider-models">
          <Heading level={2} id="provider-models">
            Modeller
          </Heading>
          {models.length === 0 ? (
            <Text type="supporting">
              Inga modeller ännu. Testa leverantören för att se vilka den listar, eller lägg till en med namn.
            </Text>
          ) : (
            <List aria-label={`Modeller hos ${p.title}`} hasDividers>
              {models.map(m => {
                const ms = modelStatusOf(m);
                return (
                  <ListItem
                    key={m.id}
                    href={`/admin/models/${m.id}`}
                    label={
                      <HStack gap={2} vAlign="center">
                        <Text weight="semibold">{m.title}</Text>
                        {m.isDefault && <Badge variant="neutral" label="Standard" />}
                      </HStack>
                    }
                    description={
                      <VStack gap={0} hAlign="start">
                        <Text type="code" color="secondary">
                          {m.model}
                        </Text>
                        <HStack gap={1} vAlign="center">
                          <StatusDot variant={ms.tone} label={ms.label} />
                          <Text type="supporting">
                            {ms.label} · {audienceLabel(m.audience)}
                          </Text>
                        </HStack>
                      </VStack>
                    }
                  />
                );
              })}
            </List>
          )}
        </VStack>
      </Card>
      <Card padding={4}>
        <VStack gap={3} as="section" aria-labelledby="provider-details">
          <Heading level={2} id="provider-details">
            Uppgifter
          </Heading>
          <VStack maxWidth={560} gap={3}>
            <FormLayout>
              <TextInput
                label="Namn"
                value={draft.title}
                onChange={title => setDraft({ ...draft, title })}
                isRequired
                autoComplete="off"
              />
              <TextInput
                label="Adress"
                type="url"
                value={draft.baseUrl}
                onChange={baseUrl => setDraft({ ...draft, baseUrl })}
                description="Basadressen, oftast slutar den på /v1."
                isRequired
                autoComplete="off"
              />
            </FormLayout>
          </VStack>
          <HStack gap={2}>
            <Button
              variant="primary"
              label="Spara"
              isDisabled={busy || !changed || !draft.title.trim() || !/^https?:\/\/\S+$/.test(draft.baseUrl)}
              clickAction={() =>
                run(async () => {
                  await api.admin.updateProvider(id, draft);
                  return 'Sparat.';
                })
              }
            />
            <Button
              variant="ghost"
              label="Ångra ändringar"
              isDisabled={!changed}
              onClick={() => setDraft({ title: p.title, baseUrl: p.baseUrl })}
            />
          </HStack>
        </VStack>
      </Card>
      <Card padding={4}>
        <VStack gap={3} as="section" aria-labelledby="provider-history">
          <Heading level={2} id="provider-history">
            Historik
          </Heading>
          <History history={p.history} />
        </VStack>
      </Card>
      <Dialog
        isOpen={keyOpen}
        onOpenChange={open => {
          if (!open) closeKey();
        }}
        width={480}
        purpose="form"
        padding={4}
      >
        <VStack gap={4}>
          <DialogHeader
            title="Byt nyckel"
            subtitle="Den nya nyckeln används från nästa fråga. Den gamla raderas."
            onOpenChange={closeKey}
          />
          <FormLayout>
            <TextInput
              label="Ny nyckel"
              type="password"
              value={key}
              onChange={setKey}
              description="Lämna tomt för en adress utan nyckel. Sparas förseglad och visas aldrig igen."
              autoComplete="new-password"
            />
          </FormLayout>
          <HStack justify="end" gap={2}>
            <Button variant="ghost" label="Avbryt" onClick={closeKey} />
            <Button
              variant="primary"
              label={key ? 'Byt nyckel' : 'Ta bort nyckeln'}
              isDisabled={busy}
              clickAction={() =>
                run(async () => {
                  await api.admin.providerKey(id, key);
                  closeKey();
                  return key ? 'Nyckeln är bytt.' : 'Nyckeln är borttagen.';
                })
              }
            />
          </HStack>
        </VStack>
      </Dialog>
      <AlertDialog
        isOpen={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Ta bort ${p.title}`}
        description="Leverantören och dess nyckel raderas."
        actionLabel="Ta bort"
        cancelLabel="Avbryt"
        isActionLoading={removal.busy}
        onAction={() =>
          removal.run(async () => {
            await api.admin.removeProvider(id);
            setRemoveOpen(false);
            client.removeQueries({ queryKey: keys.admin.provider(id) });
            navigate('/admin/models');
            return `${p.title} är borttagen.`;
          })
        }
      />
      <AddModelDialog provider={adding ? p : null} onClose={() => setAdding(false)} />
    </AdminShell>
  );
}
