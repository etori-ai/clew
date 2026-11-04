import { Button, Card, Heading, Layout, LayoutContent, Text, VStack } from '@clew/ui';
const reasons: Record<string, string> = { expired: 'Din inloggning har gått ut.', denied: 'Kontot saknar behörighet till Startsidan.', unavailable: 'Inloggningstjänsten går inte att nå just nu.', invalid: 'Inloggningen kunde inte slutföras. Försök igen.' };
export function LoginPage({ returnTo }: { returnTo: string }) {
  const reason = new URLSearchParams(window.location.search).get('reason');
  const target = returnTo.startsWith('/') && !returnTo.startsWith('/login') ? returnTo : '/';
  return <Layout height="fill" padding={4} content={<LayoutContent role="main">
    <VStack height="100%" vAlign="center" hAlign="center"><Card padding={8} width={420}><VStack gap={4}>
      <Heading level={1}>Startsidan</Heading>
      <Text as="p">Logga in med ditt kommunkonto för att se vad som behöver dig i dag.</Text>
      {reason && reasons[reason] && <Text as="p" color="secondary" role="status">{reasons[reason]}</Text>}
      <Button label="Logga in" href={'/api/auth/login?returnTo=' + encodeURIComponent(target)} />
    </VStack></Card></VStack>
  </LayoutContent>} />;
}
