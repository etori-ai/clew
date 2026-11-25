import { useEffect, useState } from 'react';
import { usePageTitle } from '../page-title';
import { useBranding } from '../branding';
import {
  Avatar,
  Button,
  Card,
  Divider,
  Heading,
  Layout,
  LayoutContent,
  List,
  ListItem,
  Text,
  VStack,
  signInHref,
  signInTarget,
} from '@clew/ui';
/** Why the sign-in came back here, in the installation's name (D98) where the sentence names it. */
const reasons: Record<string, (site: string) => string> = {
  expired: () => 'Din inloggning har gått ut.',
  denied: site => `Kontot saknar behörighet till ${site}.`,
  unavailable: () => 'Inloggningstjänsten går inte att nå just nu.',
  invalid: () => 'Inloggningen kunde inte slutföras. Försök igen.',
};
type DevAccount = { userName: string; name: string };
/** The development sign-in (D6): the server answers 404 unless it is switched on, on the local stack only. */
function useDevAccounts() {
  const [accounts, setAccounts] = useState<DevAccount[]>([]);
  useEffect(() => {
    let current = true;
    fetch('/api/auth/dev', { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : { accounts: [] }))
      .then((data: { accounts?: DevAccount[] }) => {
        if (current && Array.isArray(data.accounts)) setAccounts(data.accounts);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, []);
  return accounts;
}
/**
 * The sign-in page. `returnTo` is the whole address the person was on, its query included, so a link followed before
 * signing in lands where it led (D116); one outside Clew's own paths is home (`signInTarget`, as the server's own check).
 */
export function LoginPage({ returnTo }: { returnTo: string }) {
  const reason = new URLSearchParams(window.location.search).get('reason');
  const target = signInTarget(returnTo);
  const accounts = useDevAccounts();
  // The page is headed by the installation's name (D98), read before anyone has signed in.
  const site = useBranding().name;
  // The tab is named for this page, never for the page a session that has ended was on (2.4.2).
  usePageTitle('Logga in', false);
  return (
    <Layout
      height="fill"
      padding={4}
      content={
        <LayoutContent role="main">
          <VStack height="100%" vAlign="center" hAlign="center">
            <Card padding={8} width="100%" maxWidth={420}>
              <VStack gap={4}>
                <Heading level={1}>{site}</Heading>
                <Text as="p">Logga in med ditt kommunkonto för att se vad som behöver dig i dag.</Text>
                {reason && Object.hasOwn(reasons, reason) && (
                  <Text as="p" color="secondary" role="status">
                    {reasons[reason]!(site)}
                  </Text>
                )}
                <Button variant="primary" label="Logga in" href={signInHref(target)} />
                {accounts.length > 0 && (
                  <>
                    <Divider />
                    <List
                      edge="outset"
                      hasDividers
                      header={
                        <VStack gap={1}>
                          <Heading level={2}>Logga in som</Heading>
                          <Text as="p" color="secondary">
                            Bara i utvecklingsmiljön.
                          </Text>
                        </VStack>
                      }
                    >
                      {accounts.map(account => (
                        <ListItem
                          key={account.userName}
                          label={account.name}
                          description={account.userName}
                          startContent={<Avatar name={account.name} tooltip={false} aria-hidden />}
                          href={
                            '/api/auth/dev/login?as=' +
                            encodeURIComponent(account.userName) +
                            '&returnTo=' +
                            encodeURIComponent(target)
                          }
                        />
                      ))}
                    </List>
                  </>
                )}
              </VStack>
            </Card>
          </VStack>
        </LayoutContent>
      }
    />
  );
}
