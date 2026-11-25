import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LinkedAccountEntry, LinkedAccountsView } from '@clew/contracts';
import { Badge, Button, Divider, HStack, Text, VStack, useToast } from '@clew/ui';
import { api } from '../../api';
import { keys } from '../../query-keys';
import { linkedAccountsQuery, threadsQuery } from '../../queries';
import { errorMessage } from '../../query-policy';
import {
  ACCOUNTS_PATH,
  LOST_BADGE,
  accountLine,
  accountLines,
  accountReturn,
  returnAddress,
  returnMessage,
  type AccountLine,
} from '../../linked-accounts';

/**
 * A system that needs the person's account (D147), said where its content is missing and nowhere else (the pattern of
 * D116): under the rows of "Behöver dig" on Hem and in the system's own list, never as a banner over a page. The words
 * and the rules for one system, several, a first link and a lost one are `linked-accounts.ts`; this file draws them and
 * runs the three presses: leaving for the system, "Inte nu", and the way to the page that lists every account.
 */
const EMPTY: LinkedAccountEntry[] = [];
/** The systems the person can link an account at, with what each link is; empty until they are read. */
export function useAccounts() {
  const read = useQuery(linkedAccountsQuery);
  return { accounts: read.data?.accounts ?? EMPTY, settled: !read.isPending };
}

/**
 * Mounted by the shell on every page: when the cards' read says another set of systems needs the person's account
 * than before (a link was lost, or works again), the list is read again, so the line stands where the work is missing
 * without a reload.
 */
export function useFollowAccounts() {
  const client = useQueryClient();
  const sources = useQuery(threadsQuery).data?.sources;
  const blocked = sources
    ?.filter(s => s.error === 'authorization-required')
    .map(s => s.connector)
    .sort()
    .join(' ');
  const seen = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (blocked === undefined) return;
    if (seen.current !== undefined && seen.current !== blocked)
      void client.invalidateQueries({ queryKey: keys.linkedAccounts });
    seen.current = blocked;
  }, [blocked, client]);
}

/**
 * Leaving for a system's own sign-in, in the same tab, to come back to this page. The button that was pressed shows
 * that it is on its way until the page is left; a start that fails is said in a toast and the button is as before.
 */
export function useLinkAccount() {
  const { pathname, search } = useLocation();
  const toast = useToast();
  const [linking, setLinking] = useState<string | null>(null);
  // Back from the system's page without signing in there: the browser may show this page as it was left.
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) setLinking(null);
    };
    window.addEventListener('pageshow', shown);
    return () => window.removeEventListener('pageshow', shown);
  }, []);
  const link = useCallback(
    async (connectorId: string) => {
      setLinking(connectorId);
      try {
        const { url } = await api.linkAccount(connectorId, returnAddress(pathname, search));
        window.location.assign(url);
      } catch (error) {
        setLinking(null);
        toast({ body: errorMessage(error, 'Det gick inte att koppla ditt konto. Försök igen.'), type: 'error' });
      }
    },
    [pathname, search, toast],
  );
  return { link, linking };
}

/**
 * "Inte nu": the systems leave Hem at once and stay on the page that lists every account, which the toast names. The
 * line's button is gone with the line, so the focus goes where the caller says.
 */
export function usePutOff() {
  const client = useQueryClient();
  const toast = useToast();
  return useCallback(
    async (connectors: string[]) => {
      client.setQueryData<LinkedAccountsView>(keys.linkedAccounts, old =>
        old
          ? { accounts: old.accounts.map(a => (connectors.includes(a.connectorId) ? { ...a, putOff: true } : a)) }
          : old,
      );
      try {
        await api.putOffAccounts(connectors);
        toast({ body: `Du kan koppla ditt konto senare under Kopplade konton.` });
      } catch (error) {
        toast({ body: errorMessage(error, 'Det gick inte att spara. Försök igen.'), type: 'error' });
      } finally {
        void client.invalidateQueries({ queryKey: keys.linkedAccounts });
      }
    },
    [client, toast],
  );
}

/** One line: what holds, what the button does, the button, and "Inte nu" where the line can be put off. */
function Line({ line, onLater }: { line: AccountLine; onLater?: ((connectors: string[]) => void) | undefined }) {
  const { link, linking } = useLinkAccount();
  const target = line.link;
  return (
    <HStack gap={3} vAlign="center" justify="between" wrap="wrap">
      <VStack gap={0.5}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Text as="p" weight="semibold">
            {line.title}
          </Text>
          {line.weight === 'lost' ? <Badge variant="warning" label={LOST_BADGE} /> : null}
        </HStack>
        <Text as="p" type="supporting" color="secondary">
          {line.line}
        </Text>
      </VStack>
      <HStack gap={2} vAlign="center" wrap="wrap">
        {target ? (
          <Button
            size="sm"
            variant="secondary"
            label={line.action}
            aria-label={`${line.action}: ${target.source}`}
            isLoading={linking === target.connectorId}
            onClick={() => void link(target.connectorId)}
          />
        ) : (
          <Button size="sm" variant="secondary" label={line.action} href={ACCOUNTS_PATH} />
        )}
        {line.later.length > 0 && onLater ? (
          <Button
            size="sm"
            variant="ghost"
            label="Inte nu"
            aria-label={`Inte nu: ${line.title}`}
            onClick={() => onLater(line.later)}
          />
        ) : null}
      </HStack>
    </HStack>
  );
}

/** The lines under the rows of "Behöver dig" (Hem): none, one or two, a rule between two. */
export function useAccountLines() {
  return accountLines(useAccounts().accounts);
}
export function AccountLines({
  lines,
  focusAfter,
}: {
  lines: AccountLine[];
  /** The id of what takes the focus when "Inte nu" takes its own button away (2.4.3): the card's heading. */
  focusAfter: string;
}) {
  const putOff = usePutOff();
  const later = (connectors: string[]) => {
    document.getElementById(focusAfter)?.focus();
    void putOff(connectors);
  };
  return (
    <VStack gap={3}>
      {lines.map((line, i) => (
        <Fragment key={line.key}>
          {i > 0 ? <Divider /> : null}
          <Line line={line} onLater={later} />
        </Fragment>
      ))}
    </VStack>
  );
}

/**
 * In a system's own list, where its rows would have been: the one line and its button, and nothing else. No empty
 * state says there is nothing to show, because Clew does not know that.
 */
export function NeedsAccountNotice({ account }: { account: LinkedAccountEntry }) {
  return <Line line={accountLine(account)} />;
}

/**
 * Mounted by the shell on every page: the person comes back from a system with what happened in the address
 * (`?account=linked&system=<id>`). It is said once, by the system's name, in a toast (which a screen reader hears), and
 * the address is then the page's own again, so a reload or a shared link says nothing twice. A person who declined at
 * the system is told nothing: nothing changed.
 */
export function useAccountReturn() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const { accounts, settled } = useAccounts();
  const back = accountReturn(search);
  const outcome = back?.outcome;
  useEffect(() => {
    // The system's name comes with the list; a list that cannot be read still lets the person be told.
    if (!back || !settled) return;
    const message = returnMessage(back.outcome, accounts.find(a => a.connectorId === back.system)?.source ?? null);
    if (message)
      toast({ body: message, type: back.outcome === 'failed' ? 'error' : 'info', uniqueID: 'account-return' });
    // Linked: the system is read for the person now, and its work comes with the cards.
    if (back.outcome === 'linked') {
      void client.invalidateQueries({ queryKey: keys.linkedAccounts });
      void client.invalidateQueries({ queryKey: keys.threads });
    }
    navigate(pathname + back.rest + hash, { replace: true });
  }, [outcome, settled]);
}
