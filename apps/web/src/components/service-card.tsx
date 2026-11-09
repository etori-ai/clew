import type { McpDelivery } from '@clew/contracts';
import { Button, Card, Heading, HStack, Text, VStack } from '@clew/ui';

export const serviceCardHref = (delivery: McpDelivery) =>
  `/chat/services/${encodeURIComponent(delivery.connectionId)}?delivery=${encodeURIComponent(delivery.id)}`;

/** The same surface, source line, heading and action anatomy as Clew's work cards; MCP owns the content. */
export function ServiceCard({ delivery }: { delivery: McpDelivery }) {
  const when = new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Stockholm',
  }).format(new Date(delivery.createdAt));
  return (
    <Card padding={3} elevation="low">
      <VStack as="article" aria-label={`Kort från ${delivery.title}: ${delivery.text}`} gap={3}>
        <VStack gap={1.5}>
          <Text type="supporting">
            {delivery.title} · {when}
          </Text>
          <Heading level={3}>{delivery.text}</Heading>
        </VStack>
        <HStack>
          <Button label={`Öppna ${delivery.title}`} href={serviceCardHref(delivery)} variant="primary" />
        </HStack>
      </VStack>
    </Card>
  );
}
