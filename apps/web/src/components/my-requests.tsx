import { useQuery } from '@tanstack/react-query';
import { viewRows, type Area, type ViewRef } from '@clew/contracts';
import { Button, Card, Heading, HStack, Text, VStack } from '@clew/ui';
import { viewQuery } from '../queries';
import { AsyncContent, ContentSkeleton } from './loading';
import { DeclaredView } from './view';

/** The combined list of what a person ordered or reported (D123) and the area that offers it. */
export const REQUESTS_CAPABILITY = 'clew.requests';
/** The section's name on Hem, and the read's own title, which names its page. */
export const REQUESTS_TITLE = 'Beställningar och felanmälningar';
/** How many Hem shows before the way to the list's page: what waits on the person comes first, so these are the ones that matter. */
const ROWS = 5;

/** Whether the person has a source of requests: the server offers the area only then (D123). */
export const hasRequests = (areas: Area[]) =>
  areas.some(a => a.standing.some(s => s.capability === REQUESTS_CAPABILITY));

/**
 * Beställningar och felanmälningar on Hem (D123): what the person ordered or reported in a service desk and waits for,
 * from every such system as one list in the page's own column, right after Mina ärenden and apart from it. It is the
 * combined list's declared view drawn by the one renderer, the first five rows and, when there are more, the view's own
 * "Visa allt" to the list's page (D116: a list is a page), as under an answer. A row opens the request beside the
 * page, in the system it came from. Nothing is stored: the list is read as the person each time Hem is.
 *
 * It is drawn only for a person with a source, and it never says there is nothing when the systems did not answer:
 * the read fails then, and the section says so with a way to try again.
 */
export function MyRequests({
  areas,
  hrefFor,
  listHref,
}: {
  areas: Area[];
  hrefFor: (view: ViewRef) => string;
  /** The list's own page, with Hem as the way back. */
  listHref: string;
}) {
  const offered = hasRequests(areas);
  const read = useQuery({ ...viewQuery(REQUESTS_CAPABILITY, null), enabled: offered, retry: false });
  if (!offered) return null;
  const view = read.data?.view;
  const total = view ? (viewRows(view, read.data?.output)?.length ?? 0) : 0;
  return (
    <VStack gap={2} as="section" aria-labelledby="my-requests">
      <Heading id="my-requests" tabIndex={-1} level={3} accessibilityLevel={2}>
        {REQUESTS_TITLE}
      </Heading>
      <AsyncContent
        pending={read.isPending}
        fallback={<ContentSkeleton label="Hämtar dina beställningar och felanmälningar …" rows={3} heading={false} />}
        gap={2}
      >
        {view ? (
          <Card>
            <DeclaredView
              view={view}
              output={read.data?.output}
              hrefFor={hrefFor}
              limit={ROWS}
              showAllHref={total > ROWS ? listHref : undefined}
            />
          </Card>
        ) : (
          <VStack gap={2}>
            <Text as="p" role="alert">
              {read.error instanceof Error
                ? read.error.message
                : 'Beställningarna och felanmälningarna kunde inte hämtas just nu.'}
            </Text>
            <HStack>
              <Button
                size="sm"
                variant="secondary"
                label="Försök igen"
                isLoading={read.isFetching}
                onClick={() => void read.refetch()}
              />
            </HStack>
          </VStack>
        )}
      </AsyncContent>
    </VStack>
  );
}
