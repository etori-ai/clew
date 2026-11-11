import { useEffect, useState } from 'react';
import { Avatar, Button, Card, Divider, Heading, Layout, LayoutContent, List, ListItem, Text, VStack } from '@clew/ui';
const reasons: Record<string, string> = {
  expired: 'Din inloggning har gått ut.',
  denied: 'Kontot saknar behörighet till Startsidan.',
  unavailable: 'Inloggningstjänsten går inte att nå just nu.',
  invalid: 'Inloggningen kunde inte slutföras. Försök igen.',
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
export function LoginPage({ returnTo }: { returnTo: string }) {
  const reason = new URLSearchParams(window.location.search).get('reason');
  const target = returnTo.startsWith('/') && !returnTo.startsWith('/login') ? returnTo : '/';
  const accounts = useDevAccounts();
  return (
    <Layout
      height="fill"
      padding={4}
      content={
        <LayoutContent role="main">
          <VStack height="100%" vAlign="center" hAlign="center">
            <Card padding={8} width="100%" maxWidth={420}>
              <VStack gap={4}>
                <Heading level={1}>Startsidan</Heading>
                <Text as="p">Logga in med ditt kommunkonto för att se vad som behöver dig i dag.</Text>
                {reason && reasons[reason] && (
                  <Text as="p" color="secondary" role="status">
                    {reasons[reason]}
                  </Text>
                )}
                <Button
                  variant="primary"
                  label="Logga in"
                  href={'/api/auth/login?returnTo=' + encodeURIComponent(target)}
                />
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
