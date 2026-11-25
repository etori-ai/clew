import { Fragment, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
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
  LINK_CHANNEL,
  LOST_BADGE,
  accountLine,
  accountLines,
  accountReturn,
  linkReturnAddress,
  readLinkMessage,
  returnAddress,
  returnMessage,
  type AccountLine,
  type AccountOutcome,
} from '../../linked-accounts';
import { linkWindow, type LinkOrigin } from './link-window';

/**
 * A system that needs the person's account (D147), said where its content is missing and nowhere else (the pattern of
 * D116): under the rows of "Behöver dig" on Hem and in the system's own list, never as a banner over a page. The words
 * and the rules for one system, several, a first link and a lost one are `linked-accounts.ts`; this file draws them and
 * runs the three presses: signing in at the system, "Inte nu", and the way to the page that lists every account.
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
 * Signing in at a system, in a window of its own (D147 item 6): the page stays as it is, and the shell says what
 * happened when the window is gone (`useAccountReturn`). The button that was pressed shows that the link is under way
 * for as long as the window stands; pressed again, or another system's, it brings that window forward. `focus` names
 * what takes the focus if the pressed button is gone once the account is linked, as a line on Hem is.
 *
 * A browser that will not open the window leaves the redirect: the page leaves for the system in the same tab and
 * comes back to this address. A start that fails is said in a toast and the button is as before.
 */
export function useLinkAccount() {
  const { pathname, search } = useLocation();
  const toast = useToast();
  const inWindow = useSyncExternalStore(linkWindow.subscribe, linkWindow.connector);
  const [leaving, setLeaving] = useState<string | null>(null);
  // Back from the system's page without signing in there: the browser may show this page as it was left.
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) setLeaving(null);
    };
    window.addEventListener('pageshow', shown);
    return () => window.removeEventListener('pageshow', shown);
  }, []);
  const link = useCallback(
    async (connectorId: string, options: { focus?: string } = {}) => {
      if (linkWindow.show()) return;
      // Opened by the press itself, before the server is asked: a browser lets no later window through.
      const opened = linkWindow.open(connectorId, options.focus);
      if (!opened) setLeaving(connectorId);
      try {
        const { url } = await api.linkAccount(
          connectorId,
          opened ? linkReturnAddress(opened.id) : returnAddress(pathname, search),
        );
        if (opened) opened.go(url);
        else window.location.assign(url);
      } catch (error) {
        opened?.abandon();
        setLeaving(null);
        toast({ body: errorMessage(error, 'Det gick inte att koppla ditt konto. Försök igen.'), type: 'error' });
      }
    },
    [pathname, search, toast],
  );
  return { link, linking: inWindow ?? leaving };
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
function Line({
  line,
  onLater,
  focusAfter,
}: {
  line: AccountLine;
  onLater?: ((connectors: string[]) => void) | undefined;
  /** The id of what takes the focus when linking takes the line, and its button, away (2.4.3). */
  focusAfter: string;
}) {
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
            onClick={() => void link(target.connectorId, { focus: focusAfter })}
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
  /** The id of what takes the focus when "Inte nu" or linking takes a line's button away (2.4.3): the card's heading. */
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
          <Line line={line} onLater={later} focusAfter={focusAfter} />
        </Fragment>
      ))}
    </VStack>
  );
}

/**
 * In a system's own list, where its rows would have been: the one line and its button, and nothing else. No empty
 * state says there is nothing to show, because Clew does not know that.
 */
export function NeedsAccountNotice({
  account,
  focusAfter,
}: {
  account: LinkedAccountEntry;
  /** The id of what takes the focus when the account is linked and the rows stand where this line was. */
  focusAfter: string;
}) {
  return <Line line={accountLine(account)} focusAfter={focusAfter} />;
}

/**
 * Once a link that this page started has ended and its lists are read again: if the pressed button went with its line
 * the focus is nowhere, and goes where the press said. A focus that stands somewhere is left alone.
 */
function refocus(focus: string | undefined) {
  if (!focus) return;
  requestAnimationFrame(() =>
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      document.getElementById(focus)?.focus();
    }, 0),
  );
}

/**
 * Mounted by the shell on every page: what happened to a link is said once, by the system's name, in a toast (which a
 * screen reader hears). A person who declined at the system is told nothing: nothing changed.
 *
 * It arrives one of two ways. From the window the person signed in in, over Clew's own broadcast channel
 * (`linked-accounts.ts`): the page that started the link says it and puts the focus right, and every page of Clew in
 * the browser reads again what a newly linked system changes. Or, where the browser opened no window, in this page's
 * own address (`?account=linked&system=<id>`), which is then the page's own again, so a reload or a shared link says
 * nothing twice.
 */
export function useAccountReturn() {
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const client = useQueryClient();
  const { accounts, settled } = useAccounts();
  const known = useRef(accounts);
  known.current = accounts;
  const say = useCallback(
    (outcome: AccountOutcome, system: string | null) => {
      // The system's name comes with the list; a list that cannot be read still lets the person be told.
      const message = returnMessage(outcome, known.current.find(a => a.connectorId === system)?.source ?? null);
      if (message) toast({ body: message, type: outcome === 'failed' ? 'error' : 'info', uniqueID: 'account-return' });
    },
    [toast],
  );
  useEffect(() => {
    // The window closed with nothing said: the list is read again all the same, in case the account was linked.
    const closed = linkWindow.onClosed(origin => {
      void client.invalidateQueries({ queryKey: keys.linkedAccounts }).then(() => refocus(origin.focus));
    });
    if (typeof BroadcastChannel === 'undefined') return closed;
    const channel = new BroadcastChannel(LINK_CHANNEL);
    channel.onmessage = event => {
      const message = readLinkMessage(event.data);
      if (!message) return;
      const origin: LinkOrigin | null = linkWindow.take(message.link);
      // Linked: the system is read for the person now, so whatever a page shows of it is read again, as a page that
      // came back from a redirect would have read it.
      const read = message.outcome === 'linked' ? client.invalidateQueries() : Promise.resolve();
      if (!origin) return;
      say(message.outcome, message.system ?? origin.connectorId);
      void read.then(() => refocus(origin.focus));
    };
    return () => {
      closed();
      channel.close();
    };
  }, [client, say]);
  const back = accountReturn(search);
  const outcome = back?.outcome;
  useEffect(() => {
    if (!back || !settled) return;
    say(back.outcome, back.system);
    // Linked: the system is read for the person now, and its work comes with the cards.
    if (back.outcome === 'linked') {
      void client.invalidateQueries({ queryKey: keys.linkedAccounts });
      void client.invalidateQueries({ queryKey: keys.threads });
    }
    navigate(pathname + back.rest + hash, { replace: true });
  }, [outcome, settled]);
}
