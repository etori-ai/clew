import { useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import { BreadcrumbItem, Breadcrumbs, Button, Card, EmptyState, Heading, Skeleton, VStack } from '@clew/ui';
import { areasQuery, cardViewQuery, threadsQuery } from '../../../web/src/queries';
import { applyThread } from '../../../web/src/thread-cache';
import { GenericCard } from '../../../web/src/components/card';
import { ThreadCard } from '../../../web/src/components/thread';
import { DeclaredView } from '../../../web/src/components/view';
import { usePageTitle } from '../../../web/src/page-title';
import { PortalShell } from '../shell';
import { cardHref, viewHref } from '../hrefs';

const noop = () => undefined;

/**
 * A card as a page (D67 item 5): the proof of concept's "Öppna" leads to a page of its own, where Hem opens the card
 * beside the column (D50). The card is the web app's (`GenericCard`, or the proposal card for a calendar thread), so
 * its actions, Inte nu, Avfärda and "Varför nu?" are the same. A read action named in the address (`action`) opens
 * its view under the card; an execute action's answer goes into the cache; a link opens in a new tab.
 */
export function CardPage({ user }: { user: SessionUser }) {
  const { threadId = '' } = useParams<{ threadId: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const threadsQ = useQuery(threadsQuery);
  const areasQ = useQuery(areasQuery);
  const thread = threadsQ.data?.threads.find(t => t.id === threadId) ?? null;
  const actionId = search.get('action');
  const cardView = useQuery({ ...cardViewQuery(threadId, actionId ?? ''), enabled: !!actionId && !!thread });
  const acted = useRef<unknown>(null);
  useEffect(() => {
    const result = cardView.data;
    if (!result || acted.current === result) return;
    acted.current = result;
    if (result.kind === 'execute') void applyThread(client, result.thread);
    else if (typeof (result.output as { url?: string }).url === 'string')
      window.open((result.output as { url: string }).url, '_blank', 'noopener');
  }, [cardView.data, client]);
  const areaTitle = thread ? (areasQ.data?.areas.find(a => a.id === thread.area)?.title ?? thread.area) : '';
  usePageTitle(thread ? thread.title : threadsQ.data ? 'Kortet finns inte' : null);
  const result = cardView.data;
  const view =
    result && result.kind !== 'execute' && result.view && typeof (result.output as { url?: string }).url !== 'string'
      ? { spec: result.view, output: result.output }
      : null;
  return (
    <PortalShell user={user} current={{ page: 'other' }}>
      <VStack gap={4}>
        <Breadcrumbs label="Du är här" variant="supporting">
          <BreadcrumbItem href="/">Startsidan</BreadcrumbItem>
          <BreadcrumbItem href="/activities">Mina aktiviteter</BreadcrumbItem>
          <BreadcrumbItem href={cardHref(threadId)} isCurrent>
            {thread?.title ?? 'Kort'}
          </BreadcrumbItem>
        </Breadcrumbs>
        {thread ? (
          <>
            <Heading level={1}>{areaTitle}</Heading>
            {thread.proposals.length ? (
              <ThreadCard thread={thread} compact={false} headingLevel={2} onChange={noop} />
            ) : (
              <GenericCard
                thread={thread}
                areaTitle={areaTitle}
                headingLevel={2}
                autoFocusTitle
                onChange={noop}
                onOpenCardView={(id, action) => navigate(cardHref(id, action), { replace: true })}
              />
            )}
            {actionId &&
              (cardView.isPending ? (
                <Skeleton height={120} />
              ) : (
                view && (
                  <Card padding={4}>
                    <DeclaredView view={view.spec} output={view.output} headingLevel={2} hrefFor={v => viewHref(v)} />
                  </Card>
                )
              ))}
          </>
        ) : threadsQ.data ? (
          <EmptyState
            headingLevel={1}
            title="Kortet finns inte"
            description="Det är borta, eller så har adressen ändrats."
            actions={<Button label="Till startsidan" href="/" />}
          />
        ) : (
          <Skeleton height={160} />
        )}
      </VStack>
    </PortalShell>
  );
}
