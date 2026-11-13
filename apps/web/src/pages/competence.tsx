import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { viewRows, type CompetenceOwnPending, type CompetenceOwnSkill, type SessionUser } from '@clew/contracts';
import {
  AlertDialog,
  Badge,
  Button,
  Card,
  EmptyState,
  HStack,
  Heading,
  Layout,
  LayoutContent,
  List,
  ListItem,
  MoreMenu,
  Text,
  Toolbar,
  VStack,
  useMediaQuery,
} from '@clew/ui';
import { api } from '../api';
import { addHref, adding, skillHref, skillOf, withoutAdd, withoutSkill } from '../competence-address';
import { useAdminAction } from '../mutations';
import { competenceMatrixQuery, competenceOwnQuery, viewQuery } from '../queries';
import { keys } from '../query-keys';
import { errorMessage, refused } from '../query-policy';
import { usePageTitle } from '../page-title';
import { useRail } from '../components/nav';
import { useHeldRelations } from '../capabilities';
import { Shell, mobileQuery, shortQuery } from '../components/shell';
import { AsyncContent, ContentSkeleton } from '../components/loading';
import { usePagePanel } from '../components/page-panel';
import { AddOwnHolding, ChangeOwnSkill, levelLabel } from '../components/register-holding';
import { DeclaredView } from '../components/view';
import { CompetenceHeader, cellDay } from './competence-parts';

/** The read behind the page: `competence.holdings` with no input answers the reader's own (D108, relation `self`). */
const HOLDINGS = 'competence.holdings';
/** A row of the reader's own registration that waits for a decision: drawn in its own card, with "Ta tillbaka". */
const AWAITING = 'awaiting-approval';
/** A row of the reader's own registration their manager rejected: drawn in its own card, with "Ta bort". */
const REJECTED = 'rejected';
/** The page's column at its widest: the width every page has (1216 px) less its padding on each side. */
const COLUMN = 1216 - 2 * 32;
const TITLE_ID = 'kompetens-rubrik';
const PENDING_ID = 'kompetens-vantar';
const REJECTED_ID = 'kompetens-avvisade';
const SKILLS_ID = 'kompetens-fardigheter';
/** A row of the declared view that is a skill the reader holds (D120): drawn in its own card, with its actions. */
const heldSkill = (row: unknown) => {
  const r = row as { kind?: unknown; level?: unknown } | null;
  return r?.kind === 'skill' && typeof r.level === 'string';
};

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
  title = 'Väntar på godkännande',
  id = PENDING_ID,
  action = 'Ta tillbaka',
}: {
  rows: CompetenceOwnPending[];
  busy: string | null;
  headingRef: Ref<HTMLHeadingElement>;
  onWithdraw: (row: CompetenceOwnPending) => void;
  title?: string;
  id?: string;
  action?: string;
}) {
  return (
    <Card padding={0}>
      <Toolbar
        label={title}
        size="sm"
        dividers={['bottom']}
        startContent={
          <Heading ref={headingRef} id={id} tabIndex={-1} level={2}>
            {title}
          </Heading>
        }
      />
      <List aria-labelledby={id} hasDividers>
        {rows.map(row => (
          <ListItem
            key={row.holdingId}
            label={<Text weight="semibold">{row.competence}</Text>}
            description={<Text type="supporting">{days(row)}</Text>}
            endContent={
              <Button
                size="sm"
                variant="secondary"
                label={action}
                aria-label={`${action} ${row.competence}`}
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

/** What a skill's row says (D120): its level, what a requirement asks where it is not met, and its marks. */
function SkillLine({ row }: { row: CompetenceOwnSkill }) {
  return (
    <HStack gap={2} vAlign="center" wrap="wrap">
      {row.short !== undefined && <Badge variant="error" label="Saknas" />}
      <Text type="supporting">
        {row.short !== undefined ? `${levelLabel(row.level)}, kräver ${levelLabel(row.short)}` : levelLabel(row.level)}
      </Text>
      {!row.validated && <Badge variant="neutral" label="Egen bedömning" />}
      {row.interest && <Badge variant="neutral" label="Vill utveckla" />}
    </HStack>
  );
}

/**
 * The reader's own skills (D120 items 2 and 3), as Astryx's card with a toolbar and a list: each with its level, "Saknas"
 * and the level asked where a requirement is not met, "Egen bedömning" until a manager confirms it, and "Vill utveckla";
 * its menu changes it in a dialog named in the address (`skill`) or removes it, which is asked first.
 */
function Skills({
  rows,
  search,
  headingRef,
  control,
  onRemove,
}: {
  rows: CompetenceOwnSkill[];
  search: URLSearchParams;
  headingRef: Ref<HTMLHeadingElement>;
  control: (holdingId: string) => (el: HTMLButtonElement | null) => void;
  onRemove: (row: CompetenceOwnSkill) => void;
}) {
  return (
    <Card padding={0}>
      <Toolbar
        label="Färdigheter"
        size="sm"
        dividers={['bottom']}
        startContent={
          <Heading ref={headingRef} id={SKILLS_ID} tabIndex={-1} level={2}>
            Färdigheter
          </Heading>
        }
      />
      <List aria-labelledby={SKILLS_ID} hasDividers>
        {rows.map(row => (
          <ListItem
            key={row.holdingId}
            label={<Text weight="semibold">{row.competence}</Text>}
            description={<SkillLine row={row} />}
            endContent={
              <MoreMenu
                ref={control(row.holdingId)}
                label={`Åtgärder: ${row.competence}`}
                size="sm"
                alignment="end"
                presentation="adaptive"
                items={[
                  {
                    type: 'section',
                    id: 'skill',
                    title: row.competence,
                    items: [
                      { id: 'change', label: 'Ändra nivå', href: skillHref(row.holdingId, search) },
                      { id: 'remove', label: 'Ta bort', onClick: () => onRemove(row) },
                    ],
                  },
                ]}
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
 * counts. What waits for that decision is a card of its own above the list, each row with "Ta tillbaka"; what the manager
 * rejected is another, each row with "Ta bort", seen by the reader alone. The skills the reader holds (D120) are a card of their own, each with its level and
 * marks and a menu that changes it (`skill=<holding id>`, a dialog over the page) or removes it, asked first in Astryx's
 * confirmation; a skill required of the reader that they hold nothing of stays in the list as "Saknas". With nothing
 * held and nothing required the page says so; with the module off for the reader the read is refused and the page says
 * that instead. It holds the panel beside it as every page with a column does, so a work item opened from the bell
 * lies beside it.
 *
 * Closing the dialog gives the focus to "Lägg till", also when the address opened it; closing a skill's gives it to that
 * skill's menu. A row taken back or removed takes its control with it, so the focus goes to its card's heading, or to
 * the page's when the card went with the last row (D83 rule 7).
 */
export function CompetencePage({ user, admin }: { user: SessionUser; admin: boolean }) {
  usePageTitle('Mina kompetenser');
  const mobile = useMediaQuery(mobileQuery);
  const short = useMediaQuery(shortQuery);
  const nav = useRail({ current: { surface: 'competence' }, admin, manager: user.role === 'manager' });
  const panel = usePagePanel({ overlayOnly: short });
  // D121: Kompetenssökning is a page of the place for someone who holds the relation; the server checks every read.
  const searcher = useHeldRelations().includes('registrar');
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
  const rejected = own.data?.rejected ?? [];
  const skills = own.data?.skills ?? [];
  const view = read.data?.view;
  // What waits for a decision and the skills held are the cards' above, with their actions; the list draws the rest.
  const output = (() => {
    const o = read.data?.output as { rows?: unknown } | undefined;
    return o && Array.isArray(o.rows)
      ? {
          ...o,
          rows: o.rows.filter(r => {
            const status = (r as { status?: unknown })?.status;
            return status !== AWAITING && status !== REJECTED && !heldSkill(r);
          }),
        }
      : o;
  })();
  const rows = view ? (viewRows(view, output) ?? []) : [];

  // The focus after the dialog or a row taken back, once the page has drawn what changed (D83 rule 7). It waits for the
  // dialog to have closed: the address changes after the press that closed it, and nothing under a modal can take it.
  const addButton = useRef<HTMLButtonElement>(null);
  const pendingHeading = useRef<HTMLHeadingElement>(null);
  const rejectedHeading = useRef<HTMLHeadingElement>(null);
  const skillsHeading = useRef<HTMLHeadingElement>(null);
  // Each skill's menu, so its dialog or its removal can give the focus back to it.
  const controls = useRef(new Map<string, HTMLElement>());
  const control = useCallback(
    (holdingId: string) => (el: HTMLButtonElement | null) => {
      if (el) controls.current.set(holdingId, el);
      else controls.current.delete(holdingId);
    },
    [],
  );
  const open = adding(search) && !off;
  const changing = skillOf(search);
  const changed = off ? undefined : skills.find(s => s.holdingId === changing);
  // An address for a skill the reader does not hold now (another's, one removed, one that never was) opens nothing:
  // the page says why where it says a refusal, and lets go of the address (D83 rule 7).
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    if (!changing || !own.isSuccess || changed || off) return;
    setRefusal('Du har ingen sådan färdighet att ändra.');
    navigate(withoutSkill(search), { replace: true });
  }, [changing, own.isSuccess, changed, off]);
  useEffect(() => {
    if (changed || adding(search)) setRefusal(null);
  }, [changed, search]);
  const [removing, setRemoving] = useState<CompetenceOwnSkill | null>(null);
  const [focusAfter, setFocusAfter] = useState<'add' | 'pending' | 'rejected' | { skill: string } | null>(null);
  useEffect(() => {
    if (focusAfter === null || open || changed || removing) return;
    setFocusAfter(null);
    // Where the focus goes, in order: the first of these the page still has, else the page's heading.
    const targets =
      focusAfter === 'add'
        ? [addButton.current]
        : focusAfter === 'pending'
          ? [pendingHeading.current]
          : focusAfter === 'rejected'
            ? [rejectedHeading.current]
            : [controls.current.get(focusAfter.skill), skillsHeading.current];
    // A frame later, once a dialog that closed has given the focus back where it took it from.
    requestAnimationFrame(() => (targets.find(t => t?.isConnected) ?? document.getElementById(TITLE_ID))?.focus());
  }, [focusAfter, open, changed, removing, pending.length, rejected.length, skills.length]);

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

  // A registration the manager rejected is removed by the person at once (D108 item 7): it counted towards nothing, and
  // nobody else sees it. Its button goes with its row, so the focus goes to the card's heading, or the page's.
  const [removingRejected, setRemovingRejected] = useState<string | null>(null);
  const dropRejected = async (row: CompetenceOwnPending) => {
    if (withdraw.busy) return;
    setRemovingRejected(row.holdingId);
    await withdraw.run(async () => {
      await api.competence.removeRejected(row.holdingId);
      return `${row.competence} är borttagen.`;
    });
    setRemovingRejected(null);
    setFocusAfter('rejected');
  };

  // A skill removed (D120 item 2), asked first in Astryx's confirmation. Removed, it takes its menu with it, so the
  // focus goes to the card's heading, or to the page's when the card went with the last one.
  const remove = useAdminAction({
    invalidate: [keys.competenceAll, keys.viewAll, keys.entities.all],
    toastId: 'competence:remove-skill',
  });
  const confirmRemove = async () => {
    if (!removing || remove.busy) return;
    const row = removing;
    await remove.run(async () => {
      await api.competence.removeOwnSkill(row.holdingId);
      return `${row.competence} är borttagen.`;
    });
    setRemoving(null);
    setFocusAfter({ skill: row.holdingId });
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
                  hasSearch={searcher && !off}
                  {...(actions ? { end: actions } : {})}
                />
                {(withdraw.error ?? remove.error ?? refusal) && (
                  <Text as="p" role="alert" color="accent">
                    {withdraw.error ?? remove.error ?? refusal}
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
                    {rejected.length > 0 && (
                      <Pending
                        rows={rejected}
                        busy={removingRejected}
                        headingRef={rejectedHeading}
                        onWithdraw={row => void dropRejected(row)}
                        title="Avvisade av din chef"
                        id={REJECTED_ID}
                        action="Ta bort"
                      />
                    )}
                    {skills.length > 0 && (
                      <Skills
                        rows={skills}
                        search={search}
                        headingRef={skillsHeading}
                        control={control}
                        onRemove={row => {
                          remove.reset();
                          setRemoving(row);
                        }}
                      />
                    )}
                    {view && rows.length > 0 ? (
                      <DeclaredView view={view} output={output} headingLevel={2} />
                    ) : pending.length === 0 && rejected.length === 0 && skills.length === 0 ? (
                      <Card>
                        <EmptyState
                          headingLevel={2}
                          title="Inget registrerat och inget som krävs"
                          description="Här ser du dina intyg, kompetenser och färdigheter, när de går ut och vad som krävs i ditt arbete. Lägg till ett intyg du har, så godkänner din chef det, eller en färdighet med din egen bedömning."
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
        held={skills.map(k => k.typeId)}
        onClose={() => {
          navigate(withoutAdd(search));
          setFocusAfter('add');
        }}
      />
      <ChangeOwnSkill
        skill={changed}
        onClose={() => {
          navigate(withoutSkill(search));
          if (changed) setFocusAfter({ skill: changed.holdingId });
        }}
      />
      <AlertDialog
        isOpen={!!removing}
        onOpenChange={next => {
          if (!next && removing) {
            setFocusAfter({ skill: removing.holdingId });
            setRemoving(null);
          }
        }}
        title={removing ? `Ta bort ${removing.competence}?` : 'Ta bort färdigheten?'}
        description={
          removing?.validated
            ? 'Färdigheten tas bort från din lista, och med den nivån din chef har bekräftat.'
            : 'Färdigheten tas bort från din lista.'
        }
        actionLabel="Ta bort"
        cancelLabel="Avbryt"
        isActionLoading={remove.busy}
        onAction={() => void confirmRemove()}
      />
    </Shell>
  );
}
