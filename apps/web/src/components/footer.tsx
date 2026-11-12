import { useQuery } from '@tanstack/react-query';
import type { SessionUser } from '@clew/contracts';
import { BreadcrumbItem, Breadcrumbs, Divider, HStack, Text, VStack } from '@clew/ui';
import { headerQuery } from '../queries';

/**
 * The trail that opens a page of Clew's own (D115 item 6): the start page, then the page. A page that was opened from
 * another one draws its own trail to where it came from (D97).
 */
export function PageTrail({ current }: { current: string }) {
  return (
    <Breadcrumbs label="Du är här" variant="supporting" separator="›">
      <BreadcrumbItem href="/">Startsidan</BreadcrumbItem>
      <BreadcrumbItem isCurrent>{current}</BreadcrumbItem>
    </Breadcrumbs>
  );
}

/**
 * The line that closes a page (D115 items 4 and 6, as the reference closes every page): the site's name as the header
 * gives it, and whose view this is. Text only: it names nothing the page above does not already hold.
 */
export function PageFooter({ user }: { user: SessionUser }) {
  const site = useQuery(headerQuery).data?.menu.site.name ?? 'Startsidan';
  return (
    // The room under the line keeps the page's last words clear of the floating "Fråga AI" in the corner (2.4.11).
    <VStack gap={3} paddingBlockStart={2} paddingBlockEnd={10}>
      <Divider />
      <HStack gap={3} justify="between" wrap="wrap">
        <Text type="supporting" weight="semibold">
          {site}
        </Text>
        <Text type="supporting">Personlig vy: {user.unitLabel}</Text>
      </HStack>
    </VStack>
  );
}
