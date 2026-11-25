import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LinkedAccountEntry, SessionUser } from '@clew/contracts';
import {
  AlertDialog,
  Badge,
  Button,
  Divider,
  EmptyState,
  HStack,
  StackItem,
  StatusNotice,
  Text,
  VStack,
  useMediaQuery,
  useToast,
} from '@clew/ui';
import { api } from '../api';
import { keys } from '../query-keys';
import { linkedAccountsQuery } from '../queries';
import { errorMessage } from '../query-policy';
import { usePageTitle } from '../page-title';
import { Shell, shortQuery } from '../components/shell/shell';
import { useNav } from '../components/shell/nav';
import { PageFrame } from '../components/shell/page-frame';
import { ContentArrival, ContentSkeleton } from '../components/shell/loading';
import { useLinkAccount } from '../components/accounts/account-lines';
import { ACCOUNTS_TITLE, LINK_AGAIN, LOST_BADGE, accountRowLine } from '../linked-accounts';

/** Where the focus goes once a row's button is gone with the press that changed the row: the row's first button. */
const actionId = (connectorId: string) => `account-${connectorId}`;

/**
 * "Kopplade konton" (D147): the one place a person sees and ends their links, reached from the person's menu. One row
 * per system that works this way and that the person may see, what needs them first: a link the system no longer
 * accepts (the badge, "Koppla igen", "Ta bort"), a system not linked ("Koppla"), then the linked ("Koppla från").
 * Nothing about tokens, scopes or expiry: which systems, since when, and how to stop.
 *
 * Linking opens the system's sign-in in a window of its own and this page stays, where the shell says what happened;
 * with several to link this page is where the person goes through them. Taking a link away is done at once where the system can be
 * told. Where it cannot, the person is asked first, because the account then keeps working at the system until they
 * remove it there themselves. A system the person takes their link away from is not said on Hem again.
 */
export function AccountsPage({ user, admin = false }: { user: SessionUser; admin?: boolean }) {
  const short = useMediaQuery(shortQuery);
  usePageTitle(ACCOUNTS_TITLE);
  const nav = useNav({ current: { surface: 'verktyg' }, admin, manager: user.role === 'manager' });
  const read = useQuery(linkedAccountsQuery);
  const client = useQueryClient();
  const toast = useToast();
  const { link, linking } = useLinkAccount();
  const accounts = read.data?.accounts;
  /** The system whose link is being taken away, and the one the person is asked about first. */
  const [ending, setEnding] = useState<string | null>(null);
  const [asked, setAsked] = useState<LinkedAccountEntry | null>(null);
  /** The row whose button takes the focus once the list has changed under the press (2.4.3). */
  const [focus, setFocus] = useState<string | null>(null);
  useEffect(() => {
    if (!focus || ending) return;
    document.getElementById(actionId(focus))?.focus();
    setFocus(null);
  }, [focus, ending, accounts]);

  const unlink = async (account: LinkedAccountEntry) => {
    setEnding(account.connectorId);
    try {
      const { revocation } = await api.unlinkAccount(account.connectorId);
      await client.invalidateQueries({ queryKey: keys.linkedAccounts });
      toast({
        body:
          account.state === 'linked' && account.revocable && revocation !== 'revoked'
            ? `Ditt konto i ${account.source} är frånkopplat. ${account.source} kunde inte få besked: ta också bort Clew i dina inställningar där.`
            : `Ditt konto i ${account.source} är frånkopplat`,
        ...(account.state === 'linked' && account.revocable && revocation !== 'revoked' ? { isAutoHide: false } : {}),
      });
      setFocus(account.connectorId);
    } catch (error) {
      toast({ body: errorMessage(error, 'Det gick inte att koppla från. Försök igen.'), type: 'error' });
    } finally {
      setEnding(null);
      setAsked(null);
    }
  };

  const row = (account: LinkedAccountEntry) => {
    const busy = ending === account.connectorId;
    const leaving = linking === account.connectorId;
    const start = () => void link(account.connectorId, { focus: actionId(account.connectorId) });
    const end =
      account.state === 'linked' ? (
        <Button
          id={actionId(account.connectorId)}
          size="sm"
          variant="ghost"
          label="Koppla från"
          aria-label={`Koppla från ${account.source}`}
          isLoading={busy && !asked}
          onClick={() => (account.revocable ? void unlink(account) : setAsked(account))}
        />
      ) : account.state === 'needs-link' ? (
        <>
          <Button
            id={actionId(account.connectorId)}
            size="sm"
            variant="secondary"
            label={LINK_AGAIN}
            aria-label={`${LINK_AGAIN}: ${account.source}`}
            isLoading={leaving}
            onClick={start}
          />
          <Button
            size="sm"
            variant="ghost"
            label="Ta bort"
            aria-label={`Ta bort ${account.source}`}
            isLoading={busy}
            onClick={() => void unlink(account)}
          />
        </>
      ) : (
        <Button
          id={actionId(account.connectorId)}
          size="sm"
          variant="secondary"
          label="Koppla"
          aria-label={`Koppla ${account.source}`}
          isLoading={leaving}
          onClick={start}
        />
      );
    return (
      <HStack gap={3} vAlign="center" wrap="wrap">
        <StackItem size="fill">
          <VStack gap={0.5}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text weight="bold">{account.source}</Text>
              {account.state === 'needs-link' ? <Badge variant="warning" label={LOST_BADGE} /> : null}
            </HStack>
            <Text type="supporting" color="secondary">
              {accountRowLine(account)}
            </Text>
          </VStack>
        </StackItem>
        <HStack gap={2} vAlign="center" wrap="wrap">
          {end}
        </HStack>
      </HStack>
    );
  };

  const failed = read.isError && accounts === undefined;
  return (
    <Shell user={user} nav={nav} height={short ? 'auto' : 'fill'}>
      <PageFrame
        ask={{ none: 'account' }}
        back={{ label: 'Start', href: '/' }}
        title={ACCOUNTS_TITLE}
        meta="System där du har loggat in en gång, så att Clew kan visa och skicka det som är ditt där."
        label={ACCOUNTS_TITLE}
      >
        {failed ? (
          <StatusNotice
            kind="failed"
            title={errorMessage(read.error, 'Kunde inte hämta.')}
            action={{ label: 'Försök igen', isLoading: read.isFetching, clickAction: () => void read.refetch() }}
          />
        ) : !accounts ? (
          <ContentSkeleton heading={false} />
        ) : accounts.length === 0 ? (
          <EmptyState
            headingLevel={2}
            title="Inga konton att koppla"
            description="Inget av dina system behöver ett eget konto."
          />
        ) : (
          <ContentArrival>
            <VStack gap={4} role="list" aria-label={ACCOUNTS_TITLE}>
              {accounts.map((account, i) => (
                <VStack key={account.connectorId} gap={4} role="listitem">
                  {i > 0 ? <Divider /> : null}
                  {row(account)}
                </VStack>
              ))}
            </VStack>
          </ContentArrival>
        )}
      </PageFrame>
      <AlertDialog
        isOpen={asked !== null}
        onOpenChange={open => {
          if (!open && !ending) setAsked(null);
        }}
        title={asked ? `Koppla från ${asked.source}?` : ''}
        description={
          asked
            ? `Clew slutar visa och skicka det som är ditt i ${asked.source}. ${asked.source} kan inte få besked om det: ta också bort Clew i dina inställningar där.`
            : ''
        }
        actionLabel="Koppla från"
        cancelLabel="Avbryt"
        isActionLoading={ending !== null}
        onAction={() => {
          if (asked) void unlink(asked);
        }}
      />
    </Shell>
  );
}
