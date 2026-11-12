import { useQuery } from '@tanstack/react-query';
import type { MenuEntry, SiteHeaderView, SiteMenuLink } from '@clew/contracts';
import { ClickableCard, Grid, Heading, HStack, Icon, Link, StackItem, Text, VStack, clewIcon } from '@clew/ui';
import { areasQuery, headerQuery } from '../queries';
import { toolHref } from './nav';

const EMPTY_MENU: MenuEntry[] = [];

/**
 * The intranet's page of tools, when the shared header (D88) lists one the installation marked as such (`purpose:
 * 'toolbox'`, D111 amended 2026-11-11): the first in the band's order, a place or a page under one. Null without one:
 * Clew never makes up the address.
 */
export function toolboxPage(header: SiteHeaderView | undefined): SiteMenuLink | null {
  for (const place of header?.menu.items ?? []) {
    if (place.purpose === 'toolbox') return place;
    const page = place.children?.find(child => child.purpose === 'toolbox');
    if (page) return page;
  }
  return null;
}

/**
 * Verktygslådan on Hem (D111, amended 2026-11-11, board Hem10): one tile per tool an administrator placed for the
 * person (D40), the same list and order as the rail's Verktyg, each with its icon, its name and the source's name, and
 * each leading to the tool's page (D42). Beside the heading, when the shared header names the intranet's page of tools,
 * a link out to it in a new tab. No tools, no section: the link alone is the header's to give.
 */
export function Toolbox() {
  const menu = useQuery(areasQuery).data?.menu ?? EMPTY_MENU;
  const header = useQuery(headerQuery).data;
  if (!menu.length) return null;
  const more = toolboxPage(header);
  return (
    <VStack gap={2} as="section" aria-labelledby="verktygsladan">
      <HStack justify="between" vAlign="center" gap={2} wrap="wrap">
        <Heading id="verktygsladan" level={3} accessibilityLevel={2}>
          Verktygslådan
        </Heading>
        {more && (
          <Text type="supporting" weight="medium">
            <Link href={more.href} color="primary" hasUnderline isExternalLink>
              Fler verktyg på intranätet
            </Link>
          </Text>
        )}
      </HStack>
      <Grid columns={{ minWidth: 200, max: 6 }} gap={3}>
        {menu.map(e => (
          <ClickableCard key={e.capability} label={e.label} href={toolHref(e.capability)} padding={3} height="100%">
            <HStack gap={3} vAlign="center">
              <Icon icon={clewIcon[e.icon]} size="lg" color="secondary" />
              <StackItem size="fill">
                <VStack gap={0}>
                  <Text weight="semibold">{e.label}</Text>
                  <Text type="supporting" color="secondary">
                    {e.source}
                  </Text>
                </VStack>
              </StackItem>
            </HStack>
          </ClickableCard>
        ))}
      </Grid>
    </VStack>
  );
}
