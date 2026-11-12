import { useQuery } from '@tanstack/react-query';
import { viewRows, type SessionUser } from '@clew/contracts';
import { Button, Card, EmptyState, HStack, Layout, LayoutContent, Text, VStack, useMediaQuery } from '@clew/ui';
import { viewQuery } from '../queries';
import { errorMessage, refused } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useRail } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import { usePagePanel } from '../components/page-panel';
import { DeclaredView } from '../components/view';
import { CompetenceHeader } from './competence-parts';

/** The read behind the page: `competence.holdings` with no input answers the reader's own (D108, relation `self`). */
const HOLDINGS = 'competence.holdings';
/** The page's column at its widest: the width every page has (1216 px) less its padding on each side. */
const COLUMN = 1216 - 2 * 32;
const TITLE_ID = 'kompetens-rubrik';

/**
 * Mina kompetenser at `/competence` (D120 item 8), the first page of the place Kompetens in the rail: what the reader
 * holds and what their positions, units and manager require of them, a required type they lack as "Saknas", drawn by
 * the one renderer from the module's own declared view (D38), as the person's list is on every other surface. The
 * header holds the place's pages as tabs for a manager, so the matrix is one link away, and leaves the end of its line
 * for the page's primary action (a person's own registration comes in a later stage). With nothing held and nothing
 * required the page says so; with the module off for the reader the read is refused and the page says that instead. It
 * holds the panel beside it as every page with a column does, so a work item opened from the bell lies beside it.
 */
export function CompetencePage({ user, admin }: { user: SessionUser; admin: boolean }) {
  usePageTitle('Mina kompetenser');
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const manager = user.role === 'manager';
  const nav = useRail({ current: { surface: 'competence' }, admin, manager });
  const panel = usePagePanel({ overlayOnly: short });
  const read = useQuery({ ...viewQuery(HOLDINGS, null), retry: false });
  const off = read.isError && refused(read.error);
  const view = read.data?.view;
  const rows = view ? (viewRows(view, read.data?.output) ?? []) : [];
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <Layout
        height={short ? 'auto' : 'fill'}
        padding={mobile ? 3 : 8}
        end={panel.end}
        content={
          <LayoutContent isScrollable={!short}>
            <VStack hAlign="center">
              <VStack gap={5} width="100%" maxWidth={COLUMN}>
                <CompetenceHeader title="Mina kompetenser" titleId={TITLE_ID} page="own" manager={manager && !off} />
                {off ? (
                  <Card>
                    <EmptyState
                      headingLevel={2}
                      title="Kompetens är inte påslaget för dig"
                      description="En administratör slår på Kompetens under Anslutna system."
                      actions={<Button label="Till startsidan" href="/" />}
                    />
                  </Card>
                ) : read.isError ? (
                  <VStack gap={2}>
                    <Text as="p" role="alert">
                      {errorMessage(read.error, 'Dina kompetenser kunde inte läsas.')}
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
                ) : (
                  <AsyncContent pending={read.isPending} fallback={<ContentSkeleton heading={false} />}>
                    {view && rows.length > 0 ? (
                      <DeclaredView view={view} output={read.data?.output} headingLevel={2} />
                    ) : (
                      <Card>
                        <EmptyState
                          headingLevel={2}
                          title="Inget registrerat och inget som krävs"
                          description="Här ser du dina intyg och kompetenser, när de går ut och vad som krävs i ditt arbete. Din chef registrerar intyg åt dig."
                        />
                      </Card>
                    )}
                  </AsyncContent>
                )}
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
      {panel.overlay}
    </Shell>
  );
}
