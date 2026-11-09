import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banner,
  BottomSheet,
  Button,
  Dialog,
  DialogHeader,
  Drawer,
  DrawerHeader,
  Heading,
  HStack,
  Icon,
  IconButton,
  Layout,
  LayoutContent,
  LayoutHeader,
  Spinner,
  StackItem,
  Text,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { mobileQuery, shortQuery } from '../../components/shell';
import { assistantQuery, chatServicesQuery, chatServiceQuery } from '../../queries';
import { api } from '../../api';
import { keys } from '../../query-keys';
import { serviceOf, withoutService, withService, type ServiceAddress } from '../../service-address';
import { AppFrame, type ToolCall, type ToolResult } from './app-frame';

type Pending = { params: ToolCall; decisionId: string; resolve(result: ToolResult): void; reject(error: Error): void };

/** Same Drawer/BottomSheet composition as card reviews; the provider owns only the sandboxed inner view. */
export default function ServiceOverlay() {
  const client = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const selection = serviceOf(search);
  // Keep the selected item while the existing overlay animates out. No source reads run while closed.
  const [held, setHeld] = useState<ServiceAddress | null>(null);
  if (selection && (selection.connectionId !== held?.connectionId || selection.deliveryId !== held.deliveryId))
    setHeld(selection);
  const { connectionId = '', deliveryId } = held ?? {};
  const isOpen = !!selection;
  const openRef = useRef(isOpen);
  openRef.current = isOpen;
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const sheetPanel = useCallback((panel: HTMLDivElement | null) => setDialog(panel?.closest('dialog') ?? null), []);
  useEffect(() => {
    if (!dialog) return;
    const closed = () => {
      if (!openRef.current) {
        setHeld(null);
        // Astryx restores the opener. If source completion removed that card, return to its service section.
        requestAnimationFrame(() => {
          if (!openRef.current && (document.activeElement === document.body || dialog.contains(document.activeElement)))
            (
              document.querySelector<HTMLElement>('dialog[open] [data-service-focus-return]') ??
              document.querySelector<HTMLElement>('[data-service-focus-return]')
            )?.focus();
        });
      }
    };
    dialog.addEventListener('close', closed);
    return () => dialog.removeEventListener('close', closed);
  }, [dialog]);
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const assistant = useQuery({ ...assistantQuery, enabled: isOpen, refetchInterval: isOpen ? 10_000 : false });
  const active = !!assistant.data?.configured;
  const inbox = useQuery({ ...chatServicesQuery, enabled: isOpen && active, refetchInterval: isOpen ? 10_000 : false });
  const selected = inbox.data?.services.find(s => s.id === connectionId);
  const delivery = inbox.data?.deliveries.find(d => d.id === deliveryId && d.connectionId === connectionId);
  const admitted = active && !!selected;
  const view = useQuery({ ...chatServiceQuery(connectionId, deliveryId), enabled: isOpen && admitted, staleTime: 0 });
  useEffect(() => {
    // Opening/refreshing a source view can resolve attention, including work finished outside Clew.
    if (isOpen && view.isSuccess) void client.invalidateQueries({ queryKey: keys.chatServices });
  }, [client, isOpen, view.isSuccess, view.dataUpdatedAt]);
  const shown = admitted ? view.data : undefined;
  const title = selected?.title ?? 'Tjänst';
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const decisionIds = useRef(new Map<string, string>());
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const mayCall = useRef(false);
  mayCall.current = isOpen && admitted;
  const cancel = useCallback(() => {
    pendingRef.current?.reject(new Error('Svaret skickades inte.'));
    pendingRef.current = null;
    setPending(null);
  }, []);
  useEffect(() => {
    cancel();
    setNotice('');
  }, [connectionId, deliveryId, admitted, isOpen, cancel]);
  useEffect(() => () => pendingRef.current?.reject(new Error('Vyn stängdes.')), []);
  const call = useCallback(
    (params: ToolCall) =>
      new Promise<ToolResult>((resolve, reject) => {
        if (!mayCall.current) {
          reject(new Error('Tjänstens vy är inte öppen.'));
          return;
        }
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
    if (!pending || sending || !mayCall.current) return;
    const decision = pending;
    setSending(true);
    try {
      const result = await api.decideService(connectionId, {
        ...decision.params,
        arguments: decision.params.arguments ?? {},
        decisionId: decision.decisionId,
      });
      void client.invalidateQueries({ queryKey: keys.chatServices });
      if (pendingRef.current !== decision) return;
      decision.resolve(result);
      setNotice(
        result.isError ? 'Tjänsten kunde inte genomföra åtgärden.' : 'Tjänsten har tagit emot din bekräftelse.',
      );
    } catch (error) {
      if (pendingRef.current !== decision) return;
      const failure = error instanceof Error ? error : new Error('Tjänsten kunde inte nås.');
      decision.reject(failure);
      setNotice(failure.message);
    } finally {
      if (pendingRef.current === decision) {
        pendingRef.current = null;
        setPending(null);
      }
      setSending(false);
    }
  }
  const onOpenChange = (open: boolean) => {
    if (!open && !sending) navigate(withoutService(location.pathname, search), { replace: true });
  };
  const requested = shown?.service.tools.find(t => t.name === pending?.params.name);
  const body = held ? (
    <Layout
      height={short ? 'auto' : 'fill'}
      header={
        mobile ? (
          <LayoutHeader>
            <HStack justify="between" vAlign="center" gap={2}>
              <StackItem size="fill">
                <Heading level={2}>{title}</Heading>
              </StackItem>
              <IconButton
                label="Stäng"
                variant="ghost"
                icon={<Icon icon="close" />}
                onClick={() => onOpenChange(false)}
              />
            </HStack>
          </LayoutHeader>
        ) : (
          <DrawerHeader title={title} onOpenChange={onOpenChange} />
        )
      }
      content={
        <LayoutContent>
          <VStack gap={3}>
            {!active && !assistant.isPending && (
              <Banner
                status="info"
                title="AI är avstängd"
                description="Tjänster i samtalet kräver en aktiverad AI-modell."
              />
            )}
            {(assistant.isPending || (active && inbox.isPending) || (admitted && view.isPending)) && (
              <Spinner label="Öppnar tjänsten …" />
            )}
            {active && inbox.isError && <Text role="alert">Tjänsterna kunde inte hämtas.</Text>}
            {active && inbox.isSuccess && !selected && <Banner status="info" title="Tjänsten är inte tillgänglig." />}
            {active && view.isError && <Text role="alert">{view.error.message}</Text>}
            {shown && (
              <VStack as="article" aria-label={`Kort från ${shown.service.title}`} gap={3}>
                <Text type="supporting">Innehåll från {shown.service.title}</Text>
                {shown.html ? (
                  <AppFrame
                    key={connectionId + ':' + (deliveryId ?? '')}
                    title={shown.service.title}
                    html={shown.html}
                    result={shown.result}
                    call={call}
                  />
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
                        href={withService(location.pathname, search, { connectionId })}
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
          </VStack>
        </LayoutContent>
      }
    />
  ) : null;
  return (
    <>
      {mobile ? (
        <BottomSheet ref={sheetPanel} isOpen={isOpen} onOpenChange={onOpenChange} label={title} height="tall">
          {body}
        </BottomSheet>
      ) : (
        <Drawer ref={setDialog} isOpen={isOpen} onOpenChange={onOpenChange} label={title} side="end" width={800}>
          {body}
        </Drawer>
      )}
      <Dialog
        isOpen={!!pending && isOpen && admitted}
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
    </>
  );
}
