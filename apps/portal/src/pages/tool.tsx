import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import { Banner, Button, EmptyState, Heading, Skeleton, Text, VStack } from '@clew/ui';
import { areasQuery, viewQuery } from '../../../web/src/queries';
import { errorMessage } from '../../../web/src/query-policy';
import { DeclaredView } from '../../../web/src/components/view';
import { usePageTitle } from '../../../web/src/page-title';
import { PortalShell } from '../shell';
import { viewHref } from '../hrefs';

/** The table needs its width; narrower than this the same rows are a list. */
const tableQuery = '(min-width: 1100px)';
const parse = (json: string | null): Record<string, unknown> => {
  try {
    const v: unknown = json ? JSON.parse(json) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};

/**
 * A view as a page (D42, D67): a tool from the menu (Personal, Kompetens … in the proof of concept) or a row's own
 * view, drawn by the one renderer (D38) with its search and choice rewriting the address in place. The server decides
 * what the person may read; the page only asks.
 */
export function ViewPage({ user }: { user: SessionUser }) {
  const { capability = '' } = useParams<{ capability: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const areasQ = useQuery(areasQuery);
  const entry = areasQ.data?.menu?.find(e => e.capability === capability) ?? null;
  const title = entry?.label ?? search.get('title') ?? capability;
  const inputJson = search.get('input');
  const input = useMemo(() => parse(inputJson), [inputJson]);
  const query = useQuery({ ...viewQuery(capability, inputJson), placeholderData: keepPreviousData });
  usePageTitle(title);
  const failed = query.isError ? errorMessage(query.error, 'Kunde inte hämta.') : null;
  return (
    <PortalShell user={user} current={entry ? { page: 'tool', capability } : { page: 'other' }}>
      <VStack gap={4}>
        {failed && (
          <Banner status="error" title={failed}>
            <Button
              label="Försök igen"
              size="sm"
              variant="secondary"
              onClick={() => {
                void query.refetch();
              }}
            />
          </Banner>
        )}
        {query.data ? (
          query.data.view ? (
            <DeclaredView
              view={query.data.view}
              output={query.data.output}
              input={input}
              isLoading={query.isFetching && query.isPlaceholderData}
              headingLevel={2}
              tableQuery={tableQuery}
              header={
                <VStack gap={0.5}>
                  <Heading level={2} accessibilityLevel={1}>
                    {title}
                  </Heading>
                  <Text type="supporting">{query.data.view.source}</Text>
                </VStack>
              }
              onInput={next => navigate(viewHref({ capability, title, input: next }), { replace: true })}
              hrefFor={v => viewHref(v)}
            />
          ) : (
            <EmptyState headingLevel={1} title={title} description="Inget att visa." />
          )
        ) : (
          !failed && (
            <VStack gap={3}>
              <Heading level={1}>{title}</Heading>
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} height={20} width={i % 2 ? '70%' : '100%'} index={i} />
              ))}
            </VStack>
          )
        )}
      </VStack>
    </PortalShell>
  );
}
