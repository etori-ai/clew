import { useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Badge, Banner, Button, Card, Heading, HStack, Spinner, Text, VStack } from '@clew/ui';
import { assistantQuery, chatServicesQuery } from '../../queries';
import { ServiceCard } from '../../components/service-card';
import { withService } from '../../service-address';

/** Content inside the service overlay; no page, shell or change to the current conversation. */
export function ServiceCatalogue({ isOpen }: { isOpen: boolean }) {
  const location = useLocation();
  const assistant = useQuery({ ...assistantQuery, enabled: isOpen, refetchInterval: isOpen ? 10_000 : false });
  const active = !!assistant.data?.configured;
  const inbox = useQuery({ ...chatServicesQuery, enabled: isOpen && active, refetchInterval: isOpen ? 10_000 : false });
  return (
    <VStack as="section" aria-label="Anslutna tjänster" tabIndex={-1} data-service-focus-return gap={5}>
      <Text>Tjänster som din organisation har anslutit. Öppna en tjänst eller ett meddelande nedan.</Text>
      {!active && !assistant.isPending && (
        <Banner
          status="info"
          title="AI är avstängd"
          description="Tjänster i samtalet blir tillgängliga när du har en aktiverad AI-modell."
        />
      )}
      {active && inbox.isPending && <Spinner label="Hämtar tjänster …" />}
      {active && inbox.isError && <Text role="alert">Tjänsterna kunde inte hämtas.</Text>}
      {active && inbox.data?.services.length === 0 && <Text>Du har inga anslutna tjänster i samtalet ännu.</Text>}
      {active &&
        inbox.data?.services.map(service => (
          <Card key={service.id} padding={3}>
            <VStack as="article" aria-label={service.title} gap={3}>
              <HStack gap={2} wrap="wrap">
                <Heading level={3}>{service.title}</Heading>
                <Badge
                  variant="neutral"
                  label={
                    service.tools.some(
                      t =>
                        !!(t._meta?.ui as { resourceUri?: string } | undefined)?.resourceUri ||
                        !!t._meta?.['ui/resourceUri'],
                    )
                      ? 'Interaktiv vy'
                      : 'Verktyg i chatten'
                  }
                />
              </HStack>
              {service.tools
                .filter(
                  t => !(t._meta?.ui as { visibility?: string[] } | undefined)?.visibility?.every(v => v === 'app'),
                )
                .map(t => (
                  <Text key={t.name}>{t.description ?? t.title ?? t.name}</Text>
                ))}
              <HStack>
                <Button
                  href={withService(location.pathname, location.search, { connectionId: service.id })}
                  label={`Öppna ${service.title}`}
                  variant="secondary"
                />
              </HStack>
            </VStack>
          </Card>
        ))}
      {active && !!inbox.data?.deliveries.length && (
        <VStack gap={3}>
          <Heading level={3}>Meddelanden från dina tjänster</Heading>
          {inbox.data.deliveries.map(delivery => (
            <ServiceCard key={delivery.id} delivery={delivery} />
          ))}
        </VStack>
      )}
    </VStack>
  );
}
