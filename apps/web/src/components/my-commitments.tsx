import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { today } from '@clew/calendar/dates';
import { Badge, Button, Card, Heading, HStack, Link, List, ListItem, Text, VStack, useToast } from '@clew/ui';
import { api } from '../api';
import { useTalkAction } from '../mutations';
import { commitmentsQuery } from '../queries';
import { dueText, isOverdue, splitMine, type CommitmentEntry } from '../talks';
import { personPageHref } from '../person-address';
import { ContentArrival } from './loading';
import { DOT } from '../dot';

/** The area of the talks domain (D96 item 7): with it chosen, Hem still shows the person's action points. */
export const TALKS_AREA = 'talks';
/** How many action points Hem shows before the person asks for the rest. */
const ROWS = 5;
const DONE = 'Åtgärdspunkten är klar.';
const REOPENED = 'Åtgärdspunkten är öppen igen.';
/** One toast per action point: ticking it off, its Ångra and opening it again replace each other. */
const toastFor = (id: string) => 'commitment:' + id;

/** Where the focus goes once the list has changed under it: after a row left, or to a row that came back. */
type FocusAfter = { left: string; index: number } | { back: string };

/**
 * Mina åtgärdspunkter on Hem (D96 item 7): the open action points the person owns and those about them, under Nyheter,
 * the first five and the rest in place. The person reads the text and ticks their own off here; the card in their stream
 * carries no text and opens this list (D96 items 5 and 6). Drawn as Hem's other blocks are (D126, board Hem): the h2
 * with the count beside it and "Visa alla" at the end of its line, the points as a `List` in a `Card`.
 *
 * It is drawn only when there is something open. Without a talks system (`null`), with nothing open and while the first
 * read is on its way, nothing is drawn; a read that fails is an alert with the server's sentence and Försök igen in the
 * block's card. Read-only (another system answers, D96 item 9): no controls, and a row's text opens that system.
 */
export function MyCommitments() {
  const read = useQuery(commitmentsQuery());
  const [all, setAll] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const focusAfter = useRef<FocusAfter | null>(null);
  const result = read.data;
  const { mine, theirs } = splitMine((result?.rows ?? []).filter(row => !row.done));
  const open = [...mine, ...theirs];
  // The row and its button are gone (or back) once the read is fresh again; the focus follows to the next row's own
  // control, else the section's heading, else the day's work when the section has left with its last row.
  useEffect(() => {
    const target = focusAfter.current;
    if (!target) return;
    const section = heading.current?.closest('section');
    const rows = [...(section?.querySelectorAll('li') ?? [])];
    // The row's own control: its Klar, else its link out; the name of the person it concerns is not the row's control.
    const control = (row?: Element) =>
      row?.querySelector<HTMLElement>('button') ?? row?.querySelector<HTMLElement>('a') ?? null;
    if ('back' in target) {
      if (!open.some(row => row.id === target.back)) return;
      focusAfter.current = null;
      const at = (all ? open : open.slice(0, ROWS)).findIndex(row => row.id === target.back);
      (control(rows[at]) ?? heading.current)?.focus();
      return;
    }
    if (open.some(row => row.id === target.left)) return;
    focusAfter.current = null;
    (
      control(rows[target.index] ?? rows[target.index - 1]) ??
      heading.current ??
      document.getElementById('behover-dig')
    )?.focus();
  }, [result]);
  if (read.isPending || result === null) return null;
  /**
   * The block's heading line, as Hem's other blocks draw theirs (board Hem): the heading, how many are open beside it,
   * and at the end of the line what leads on, here the rest of the points shown in place.
   */
  const head = (count: number | null, end?: ReactNode) => (
    <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
      <HStack gap={2} vAlign="center">
        <Heading ref={heading} id="mina-atgardspunkter" tabIndex={-1} level={2}>
          Mina åtgärdspunkter
        </Heading>
        {count !== null && <Badge variant="neutral" label={String(count)} />}
      </HStack>
      {end}
    </HStack>
  );
  if (!result && read.isError)
    return (
      <VStack gap={3} as="section" aria-labelledby="mina-atgardspunkter">
        {head(null)}
        {/* The failure stands where the points would be, in the block's card, as Behöver dig says its own. */}
        <Card padding={0}>
          <VStack gap={2} padding={4}>
            <Text as="p" role="alert">
              {read.error instanceof Error ? read.error.message : 'Åtgärdspunkterna kunde inte hämtas just nu.'}
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
        </Card>
      </VStack>
    );
  if (!result || open.length === 0) return null;
  const shown = all ? open : open.slice(0, ROWS);
  const day = today();
  const showAll = () => {
    setAll(true);
    // The control is gone once every row is shown, so the focus goes to the section's heading and not to the page's top.
    heading.current?.focus();
  };
  return (
    <VStack gap={3} as="section" aria-labelledby="mina-atgardspunkter">
      {head(
        open.length,
        // The rest in place, where the other blocks have their way on: Astryx's link drawn as a button, since it
        // leads nowhere (the points have no page of their own to list them all).
        !all && open.length > ROWS ? <Link onClick={showAll}>{`Visa alla (${open.length})`}</Link> : undefined,
      )}
      <ContentArrival>
        <Card padding={0}>
          <List
            hasDividers
            {...(result.writable
              ? { 'aria-label': result.source }
              : { header: <Text type="supporting">{result.source}</Text> })}
          >
            {shown.map((row, index) => (
              <CommitmentRow
                key={row.ref}
                row={row}
                writable={result.writable}
                day={day}
                onLeave={() => {
                  if (row.id) focusAfter.current = { left: row.id, index };
                }}
                onBack={id => {
                  focusAfter.current = { back: id };
                }}
                onSettled={() => {
                  focusAfter.current = null;
                }}
              />
            ))}
          </List>
        </Card>
      </ContentArrival>
    </VStack>
  );
}

/**
 * The words under an action point: when it is due, whether it is from an earlier talk, and whom it concerns. A manager's
 * own point is about an employee, so it names them; one the other party owns says who answers for it; an employee's own
 * point is about themselves and names nobody. The employee's name, where it is said, leads to them (D97 item 6, artboard
 * M): by the person's id, which `clew.commitments` gives every row (D122).
 */
function Meta({ row }: { row: CommitmentEntry }) {
  const { pathname, search } = useLocation();
  const words = [`Senast ${dueText(row)}`];
  if (row.carried) words.push('Från tidigare samtal');
  const lead = words.join('\u00a0· ');
  const name = (
    <Link href={personPageHref(row.personId, { from: pathname + search })} hasUnderline>
      {row.name}
    </Link>
  );
  if (row.mine && row.owner === 'manager')
    return (
      <Text type="supporting">
        {lead}
        {DOT}Samtal med {name}
      </Text>
    );
  if (!row.mine && row.owner === 'employee')
    return (
      <Text type="supporting">
        {lead}
        {DOT}
        {name} ansvarar
      </Text>
    );
  return <Text type="supporting">{row.mine ? lead : `${lead}\u00a0· Din chef ansvarar`}</Text>;
}

/**
 * One action point. The owner ticks it off with Klar when Clew can write: a row carries its `id` only when the reader may
 * change it, which on this list is their own. Read-only, the text opens the other system.
 */
function CommitmentRow({
  row,
  writable,
  day,
  onLeave,
  onBack,
  onSettled,
}: {
  row: CommitmentEntry;
  writable: boolean;
  day: string;
  onLeave: () => void;
  onBack: (id: string) => void;
  onSettled: () => void;
}) {
  const client = useQueryClient();
  const id = row.id;
  const { run, error } = useTalkAction({ ...(id ? { toastId: toastFor(id) } : {}) });
  const complete = async () => {
    if (!id) return;
    onLeave();
    // The completion toast carries Ångra from the start, so its sentence is announced once. It stays until it is used or
    // closed: Hem lists no done points, so Ångra is the only way back here (2.2.1). The toast is drawn outside the
    // page's query client, so Ångra brings it along, as the receipt notice does.
    const undo = (
      <QueryClientProvider client={client}>
        <Reopen id={id} onBack={onBack} onSettled={onSettled} />
      </QueryClientProvider>
    );
    if (!(await run(() => api.talks.complete(id), DONE, { endContent: undo }))) onSettled();
  };
  const overdue = isOverdue(row, day);
  return (
    <ListItem
      align="start"
      label={
        !writable && row.link ? (
          <Link href={row.link} isExternalLink weight="semibold" hasUnderline>
            {row.text}
          </Link>
        ) : (
          <Text weight="semibold">{row.text}</Text>
        )
      }
      description={
        <VStack gap={1}>
          <HStack gap={2} wrap="wrap" vAlign="center">
            <Meta row={row} />
            {overdue && <Badge variant="warning" label="Försenad" />}
          </HStack>
          {error && (
            <Text as="p" role="alert" color="accent">
              {error}
            </Text>
          )}
        </VStack>
      }
      endContent={
        writable && id ? (
          <Button size="sm" variant="secondary" label={`Klar: ${row.text}`} clickAction={complete}>
            Klar
          </Button>
        ) : undefined
      }
    />
  );
}

/** Ångra in the completion toast: opens the action point again, and the toast says so in its place. */
function Reopen({ id, onBack, onSettled }: { id: string; onBack: (id: string) => void; onSettled: () => void }) {
  const toast = useToast();
  const { run, error } = useTalkAction({ toastId: toastFor(id) });
  // A failure keeps this toast and its Ångra; the reason is a toast of its own, as a failed card action's is.
  useEffect(() => {
    if (error) toast({ type: 'error', body: error, uniqueID: 'failed:' + toastFor(id) });
  }, [error, id, toast]);
  return (
    <Button
      size="sm"
      variant="ghost"
      label="Ångra"
      clickAction={async () => {
        onBack(id);
        if (!(await run(() => api.talks.reopen(id), REOPENED))) onSettled();
      }}
    />
  );
}
