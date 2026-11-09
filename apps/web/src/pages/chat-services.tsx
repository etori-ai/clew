import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import {
  Badge,
  Banner,
  Button,
  Card,
  Dialog,
  DialogHeader,
  Heading,
  HStack,
  Layout,
  LayoutContent,
  Link,
  Spinner,
  Text,
  VStack,
} from '@clew/ui';
import { Shell } from '../components/shell';
import { useRail } from '../components/nav';
import { assistantQuery, chatServicesQuery, chatServiceQuery } from '../queries';
import { api } from '../api';
import { AppFrame, type ToolCall, type ToolResult } from '../labs/mcp/app-frame';
import { usePageTitle } from '../page-title';
import { ServiceCard } from '../components/service-card';

type Pending = { params: ToolCall; decisionId: string; resolve(result: ToolResult): void; reject(error: Error): void };

/** Provider content comes from the BFF. No fixture, poll schema, provider id, or person id belongs here. */
export function McpServicesPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const nav = useRail({ current: { surface: 'start' }, admin });
  const { connectionId = '' } = useParams();
  const [search] = useSearchParams();
  const deliveryId = search.get('delivery') ?? undefined;
  const assistant = useQuery({ ...assistantQuery, refetchInterval: 10_000 });
  const active = !!assistant.data?.configured;
  const inbox = useQuery({ ...chatServicesQuery, enabled: active });
  const selected = inbox.data?.services.find(s => s.id === connectionId);
  const delivery = inbox.data?.deliveries.find(d => d.id === deliveryId && d.connectionId === connectionId);
  const admitted = active && !!selected;
  const view = useQuery({ ...chatServiceQuery(connectionId, deliveryId), enabled: admitted && !!connectionId });
  usePageTitle(connectionId ? (selected?.title ?? 'Tjänst') : 'Tjänster i samtalet');
  const heading = useRef<HTMLHeadingElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const decisionIds = useRef(new Map<string, string>());
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const shown = admitted && connectionId ? view.data : undefined;
  const cancel = useCallback(() => {
    pendingRef.current?.reject(new Error('Svaret skickades inte.'));
    pendingRef.current = null;
    setPending(null);
  }, []);
  useEffect(() => {
    cancel();
    setNotice('');
  }, [connectionId, deliveryId, admitted, cancel]);
  useEffect(() => {
    if (connectionId && shown) heading.current?.focus();
  }, [connectionId, deliveryId, shown?.service.title]);
  useEffect(() => () => pendingRef.current?.reject(new Error('Vyn stängdes.')), []);
  const call = useCallback(
    (params: ToolCall) =>
      new Promise<ToolResult>((resolve, reject) => {
        if (pendingRef.current) {
          reject(new Error('En bekräftelse väntar redan.'));
          return;
        }
        const key = JSON.stringify([connectionId, params]);
        const decisionId = decisionIds.current.get(key) ?? crypto.randomUUID();
        decisionIds.current.set(key, decisionId);
        const next = { params: structuredClone(params), decisionId, resolve, reject };
        pendingRef.current = next;
        setPending(next);
      }),
    [connectionId],
  );
  async function confirm() {
    if (!pending || sending) return;
    const decision = pending;
    setSending(true);
    try {
      const result = await api.decideService(connectionId, {
        ...decision.params,
        arguments: decision.params.arguments ?? {},
        decisionId: decision.decisionId,
      });
      decision.resolve(result);
      setNotice(
        result.isError ? 'Tjänsten kunde inte genomföra åtgärden.' : 'Tjänsten har tagit emot din bekräftelse.',
      );
    } catch (error) {
      const failure = error instanceof Error ? error : new Error('Tjänsten kunde inte nås.');
      decision.reject(failure);
      setNotice(failure.message);
    } finally {
      pendingRef.current = null;
      setPending(null);
      setSending(false);
    }
  }
  const requested = shown?.service.tools.find(t => t.name === pending?.params.name);
  return (
    <Shell user={user} nav={nav} height="auto">
      <Layout height="auto" padding={4}>
        <LayoutContent>
          <VStack gap={5} maxWidth={800}>
            <Link href="/">Till Hem</Link>
            <Heading ref={heading} tabIndex={-1} level={1}>
              {connectionId ? (selected?.title ?? 'Tjänst') : 'Tjänster i samtalet'}
            </Heading>
            {!connectionId && (
              <Text>Tjänster som din organisation har anslutit. Öppna en tjänst eller ett meddelande nedan.</Text>
            )}
            {!active && !assistant.isPending && (
              <Banner
                status="info"
                title="AI är avstängd"
                description="Tjänster i samtalet blir tillgängliga när du har en aktiverad AI-modell."
              />
            )}
            {active && inbox.isPending && <Spinner label="Hämtar tjänster …" />}
            {active && inbox.isError && <Text role="alert">Tjänsterna kunde inte hämtas.</Text>}
            {active && !connectionId && inbox.data?.services.length === 0 && (
              <Text>Du har inga anslutna tjänster i samtalet ännu.</Text>
            )}
            {active &&
              !connectionId &&
              inbox.data?.services.map(service => (
                <Card key={service.id} padding={3}>
                  <VStack as="article" aria-label={service.title} gap={3}>
                    <HStack gap={2} wrap="wrap">
                      <Heading level={2}>{service.title}</Heading>
                      <Badge
                        variant="neutral"
                        label={
                          service.tools.some(
                            t =>
                              !!(t._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri ||
                              !!t._meta?.['ui/resourceUri'],
                          )
                            ? 'Interaktiv vy'
                            : 'Verktyg i chatten'
                        }
                      />
                    </HStack>
                    {service.tools
                      .filter(
                        t =>
                          !(t._meta?.ui as { visibility?: string[] } | undefined)?.visibility?.every(v => v === 'app'),
                      )
                      .map(t => (
                        <Text key={t.name}>{t.description ?? t.title ?? t.name}</Text>
                      ))}
                    <HStack>
                      <Button
                        href={'/chat/services/' + encodeURIComponent(service.id)}
                        label={`Öppna ${service.title}`}
                        variant="secondary"
                      />
                    </HStack>
                  </VStack>
                </Card>
              ))}
            {active && connectionId && inbox.isSuccess && !admitted && (
              <Banner status="info" title="Tjänsten är inte tillgänglig." />
            )}
            {admitted && connectionId && view.isPending && <Spinner label="Öppnar tjänsten …" />}
            {active && view.isError && <Text role="alert">{view.error.message}</Text>}
            {shown && (
              <VStack as="article" aria-label={`Kort från ${shown.service.title}`} gap={3}>
                <Text type="supporting">Innehåll från {shown.service.title}</Text>
                {shown.html ? (
                  <Card padding={3}>
                    <AppFrame
                      key={connectionId + ':' + (deliveryId ?? '')}
                      title={shown.service.title}
                      html={shown.html}
                      result={shown.result}
                      call={call}
                    />
                  </Card>
                ) : (
                  <Banner
                    status="info"
                    title={
                      delivery?.text ??
                      shown.result.content
                        .filter(c => c.type === 'text')
                        .map(c => c.text)
                        .join('\n')
                    }
                  />
                )}
                {shown.isCurrent === false ? (
                  <VStack gap={2}>
                    <Text type="supporting">Det här är ett tidigare meddelande. Tjänsten har nyare uppgifter.</Text>
                    <HStack>
                      <Button
                        label="Visa senaste från tjänsten"
                        href={'/chat/services/' + encodeURIComponent(connectionId)}
                      />
                    </HStack>
                  </VStack>
                ) : (
                  <HStack>
                    <Button
                      label="Hämta senaste från tjänsten"
                      variant="secondary"
                      isDisabled={!!pending}
                      isLoading={view.isFetching}
                      onClick={() => void view.refetch()}
                    />
                  </HStack>
                )}
              </VStack>
            )}
            {notice && (
              <VStack role="status">
                <Banner status="info" title={notice} />
              </VStack>
            )}
            {active && !connectionId && !!inbox.data?.deliveries.length && (
              <VStack gap={3}>
                <Heading level={2}>Meddelanden från dina tjänster</Heading>
                {inbox.data.deliveries.map(delivery => (
                  <ServiceCard key={delivery.id} delivery={delivery} />
                ))}
              </VStack>
            )}
          </VStack>
        </LayoutContent>
      </Layout>
      <Dialog
        isOpen={!!pending}
        onOpenChange={open => {
          if (!open && !sending) cancel();
        }}
        purpose="form"
      >
        <DialogHeader
          title="Bekräfta hos tjänsten"
          onOpenChange={() => {
            if (!sending) cancel();
          }}
        />
        <VStack gap={4}>
          <Text>
            {requested?.title ?? 'Utför åtgärden'} hos {shown?.service.title}?
          </Text>
          <Text>Uppgifterna du har valt i tjänstens vy skickas när du bekräftar.</Text>
          <HStack gap={2} wrap="wrap">
            <Button label="Bekräfta och skicka" isLoading={sending} onClick={() => void confirm()} />
            <Button label="Avbryt" variant="secondary" isDisabled={sending} onClick={cancel} />
          </HStack>
        </VStack>
      </Dialog>
    </Shell>
  );
}
