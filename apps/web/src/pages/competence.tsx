import { useEffect, useRef, useState, type Ref } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { viewRows, type CompetenceOwnPending, type SessionUser } from '@clew/contracts';
import {
  Button,
  Card,
  EmptyState,
  HStack,
  Heading,
  Layout,
  LayoutContent,
  List,
  ListItem,
  Text,
  Toolbar,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { api } from '../api';
import { addHref, adding, withoutAdd } from '../competence-address';
import { useAdminAction } from '../mutations';
import { competenceMatrixQuery, competenceOwnQuery, viewQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage, refused } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useRail } from '../components/nav';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import { usePagePanel } from '../components/page-panel';
import { AddOwnHolding } from '../components/register-holding';
import { DeclaredView } from '../components/view';
import { CompetenceHeader, cellDay } from './competence-parts';

/** The read behind the page: `competence.holdings` with no input answers the reader's own (D108, relation `self`). */
const HOLDINGS = 'competence.holdings';
/** A row of the reader's own registration that waits for a decision: drawn in its own card, with "Ta tillbaka". */
const AWAITING = 'awaiting-approval';
/** The page's column at its widest: the width every page has (1216 px) less its padding on each side. */
const COLUMN = 1216 - 2 * 32;
const TITLE_ID = 'kompetens-rubrik';
const PENDING_ID = 'kompetens-vantar';

/** A registration's days as a row says them: "Utfärdat 1 okt. 2026 · Giltigt till 1 okt. 2028". */
const days = (p: CompetenceOwnPending) =>
  [`Utfärdat ${cellDay(p.issuedOn)}`, p.expiresOn ? `Giltigt till ${cellDay(p.expiresOn)}` : 'Inget slutdatum'].join(
    ' · ',
  );

/**
 * The reader's own registrations that wait for their manager's decision (D108 item 7), as Astryx's card with a toolbar
 * and a list, each row with its dates and "Ta tillbaka", which takes it back at once (it can be registered again).
 */
function Pending({
  rows,
  busy,
  headingRef,
  onWithdraw,
}: {
  rows: CompetenceOwnPending[];
  busy: string | null;
  headingRef: Ref<HTMLHeadingElement>;
  onWithdraw: (row: CompetenceOwnPending) => void;
}) {
  return (
    <Card padding={0}>
      <Toolbar
        label="Väntar på godkännande"
        size="sm"
        dividers={['bottom']}
        startContent={
          <Heading ref={headingRef} id={PENDING_ID} tabIndex={-1} level={2}>
            Väntar på godkännande
          </Heading>
        }
      />
      <List aria-labelledby={PENDING_ID} hasDividers>
        {rows.map(row => (
          <ListItem
            key={row.holdingId}
            label={<Text weight="semibold">{row.competence}</Text>}
            description={<Text type="supporting">{days(row)}</Text>}
            endContent={
              <Button
                size="sm"
                variant="secondary"
                label="Ta tillbaka"
                aria-label={`Ta tillbaka ${row.competence}`}
                isLoading={busy === row.holdingId}
                onClick={() => onWithdraw(row)}
              />
            }
          />
        ))}
      </List>
    </Card>
  );
}

/**
 * Mina kompetenser at `/competence` (D120 item 8), the first page of the place Kompetens in the rail: what the reader
 * holds and what their positions, units and manager require of them, a required type they lack as "Saknas", drawn by
 * the one renderer from the module's own declared view (D38), as the person's list is on every other surface. The
 * header holds the place's pages as tabs for someone the server lets read the matrix (anyone with a report, D99), so
 * the matrix is one link away, and "Lägg till" as the page's primary action: the reader registers a certificate of their
 * own in a dialog named in the address (`add=new`, D108 item 7), which the manager they report to approves before it
 * counts. What waits for that decision is a card of its own above the list, each row with "Ta tillbaka"; a rejected one
 * stays in the list as "avvisat". With nothing held and nothing required the page says so; with the module off for the
 * reader the read is refused and the page says that instead. It holds the panel beside it as every page with a column
 * does, so a work item opened from the bell lies beside it.
 *
 * Closing the dialog gives the focus to "Lägg till", also when the address opened it; a row taken back takes its button
 * with it, so the focus goes to the card's heading, or to the page's when the card went with the last row (D83 rule 7).
 */
export function CompetencePage({ user, admin }: { user: SessionUser; admin: boolean }) {
  usePageTitle('Mina kompetenser');
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const nav = useRail({ current: { surface: 'competence' }, admin, manager: user.role === 'manager' });
  const panel = usePagePanel({ overlayOnly: short });
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const read = useQuery({ ...viewQuery(HOLDINGS, null), retry: false });
  const off = read.isError && refused(read.error);
  // Whether the reader has anyone reporting to them is the server's answer, not the session's role (D99): the matrix's
  // read, which the matrix's page reads the same way, so the tab leads to a page already read. Refused, there is no tab.
  const matrix = useQuery(competenceMatrixQuery({}));
  const manages = matrix.isSuccess || (matrix.isError && !refused(matrix.error));
  const own = useQuery(competenceOwnQuery);
  const pending = own.data?.pending ?? [];
  const view = read.data?.view;
  // What waits for a decision is the card's above, with its action; the list draws the rest.
  const output = (() => {
    const o = read.data?.output as { rows?: unknown } | undefined;
    return o && Array.isArray(o.rows)
      ? { ...o, rows: o.rows.filter(r => (r as { status?: unknown })?.status !== AWAITING) }
      : o;
  })();
  const rows = view ? (viewRows(view, output) ?? []) : [];

  // The focus after the dialog or a row taken back, once the page has drawn what changed (D83 rule 7). It waits for the
  // dialog to have closed: the address changes after the press that closed it, and nothing under a modal can take it.
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingHeading = useRef<HTMLHeadingElement>(null);
  const open = adding(search) && !off;
  const [focusAfter, setFocusAfter] = useState<'add' | 'pending' | null>(null);
  useEffect(() => {
    if (focusAfter === null || open) return;
    setFocusAfter(null);
    const target = focusAfter === 'add' ? addButton.current : pendingHeading.current;
    (target?.isConnected ? target : document.getElementById(TITLE_ID))?.focus();
  }, [focusAfter, open, pending.length]);

  const withdraw = useAdminAction({
    invalidate: [keys.competenceAll, keys.viewAll, keys.entities.all],
    toastId: 'competence:withdraw',
  });
  const [withdrawing, setWithdrawing] = useState<string | null>(null);
  const takeBack = async (row: CompetenceOwnPending) => {
    if (withdraw.busy) return;
    setWithdrawing(row.holdingId);
    await withdraw.run(async () => {
      await api.competence.withdrawOwn(row.holdingId);
      return `${row.competence} är tagen tillbaka.`;
    });
    setWithdrawing(null);
    setFocusAfter('pending');
  };

  const actions =
    read.isSuccess && !off ? (
      <Button ref={addButton} variant="primary" label="Lägg till" href={addHref(search)} />
    ) : undefined;
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
                <CompetenceHeader
                  title="Mina kompetenser"
                  titleId={TITLE_ID}
                  page="own"
                  hasTabs={manages && !off}
                  {...(actions ? { end: actions } : {})}
                />
                {withdraw.error && (
                  <Text as="p" role="alert" color="accent">
                    {withdraw.error}
                  </Text>
                )}
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
                  <AsyncContent pending={read.isPending} fallback={<ContentSkeleton heading={false} />} gap={5}>
                    {pending.length > 0 && (
                      <Pending
                        rows={pending}
                        busy={withdrawing}
                        headingRef={pendingHeading}
                        onWithdraw={row => void takeBack(row)}
                      />
                    )}
                    {view && rows.length > 0 ? (
                      <DeclaredView view={view} output={output} headingLevel={2} />
                    ) : pending.length === 0 ? (
                      <Card>
                        <EmptyState
                          headingLevel={2}
                          title="Inget registrerat och inget som krävs"
                          description="Här ser du dina intyg och kompetenser, när de går ut och vad som krävs i ditt arbete. Lägg till ett intyg du har, så godkänner din chef det."
                        />
                      </Card>
                    ) : null}
                  </AsyncContent>
                )}
              </VStack>
            </VStack>
          </LayoutContent>
        }
      />
      {panel.overlay}
      <AddOwnHolding
        isOpen={open}
        approver={own.data?.approver}
        onClose={() => {
          navigate(withoutAdd(search));
          setFocusAfter('add');
        }}
      />
    </Shell>
  );
}
