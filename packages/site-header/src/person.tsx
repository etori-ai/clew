import { useState } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { Divider } from '@astryxdesign/core/Divider';
import { Heading } from '@astryxdesign/core/Heading';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { ChevronDownIcon, UserCircleIcon } from '@heroicons/react/24/outline';
import type { ColorMode } from '@clew/ui/appearance-preference';
import { Flyout, useCompactTouch } from '@clew/ui/flyout';
import { useCompactSiteHeader } from './site-header';

export type SiteHeaderAppearance = Readonly<{
  mode: ColorMode;
  onChange: (mode: ColorMode) => void;
  /** False when the browser refuses to keep the choice (D39): the settings then say so instead of claiming it was saved. */
  isPersistent?: boolean;
}>;

type PersonProps = {
  name: string;
  /** Under the name on the band and in the settings: the person's unit or role, as the host knows it. */
  description?: string;
  /**
   * In the settings in place of `description`, when the band's short form leaves something out: every unit of a person
   * who holds several, where the band says the first and how many more (D135).
   */
  detail?: string;
  onSignOut?: () => void;
  appearance?: SiteHeaderAppearance;
  /**
   * The person's own page in the host, when it has one (D130): "Min sida" in the settings, through the host's router.
   * Without a rail the band's person is the one place of the shell that leads there.
   */
  pageHref?: string;
  /**
   * Further pages of the person's own in the host, after "Min sida": the web app's "Kopplade konton" (D147), when the
   * person has a system to link. Each is a way on through the host's router, as `pageHref` is.
   */
  ways?: ReadonlyArray<{ label: string; href: string }> | undefined;
  /** What the settings open in: under the person (the web app), or a dialog where a popover cannot hold the focus (the embed). */
  surface?: 'popover' | 'dialog';
};

/**
 * The signed-in person at the end of the shared header (D87), one composition for every host so the portal and the
 * intranet draw the same control, and the one way to the person's settings (D39, amended 2026-11-23). Three parts,
 * each with one job:
 *
 * - `PersonButton`: the control on the band, one button for the whole of the person.
 * - `AppearanceChoice` and the two ways on (`pageHref`, `onSignOut`): what the settings hold.
 * - The surface they open in. In the web app a `Flyout` (`@clew/ui`): directly under the person with a pointer, a low
 *   sheet with a visible "Stäng" on a touch phone. Inside the intranet's shadow root an Astryx `Dialog`
 *   (`surface="dialog"`): Astryx's popover and its `DropdownMenu` find the focus through `document.activeElement`,
 *   which in a shadow root is the `<site-header>` element, so a popover there opens with the focus on its surface,
 *   does not keep Tab inside and leaves the focus on the page's body when Esc closes it (2.4.3). A native `<dialog>`
 *   and native radios work by keyboard in both places.
 *
 * With neither a colour choice nor a way to sign out, the person is shown, not offered.
 */
export function SiteHeaderPerson({
  name,
  description,
  onSignOut,
  appearance,
  pageHref,
  ways: more,
  detail,
  surface = 'popover',
}: PersonProps) {
  const compact = useCompactSiteHeader();
  const stacked = useCompactTouch();
  const [isOpen, setIsOpen] = useState(false);
  if (!onSignOut && !appearance && !pageHref)
    return (
      <HStack gap={2} vAlign="center">
        <Avatar name={name} size="sm" tooltip={false} />
        {compact ? null : <Text>{name}</Text>}
      </HStack>
    );
  const line = detail ?? description;
  const close = () => setIsOpen(false);
  // The ways on from the settings. In a sheet each is a row of its own, as wide as the sheet, for a thumb.
  const ways = (width?: '100%') => (
    <>
      {pageHref ? <Button label="Min sida" variant="secondary" href={pageHref} width={width} onClick={close} /> : null}
      {more?.map(way => (
        <Button key={way.href} label={way.label} variant="secondary" href={way.href} width={width} onClick={close} />
      ))}
      {onSignOut ? (
        <Button
          label="Logga ut"
          variant="secondary"
          width={width}
          onClick={() => {
            close();
            onSignOut();
          }}
        />
      ) : null}
    </>
  );
  if (surface === 'dialog')
    return (
      <>
        <PersonButton name={name} description={description} compact={compact} onClick={() => setIsOpen(true)} />
        <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
          <DialogHeader title={name} onOpenChange={setIsOpen} />
          <VStack gap={4} padding={3}>
            {line ? <Text type="supporting">{line}</Text> : null}
            {appearance ? <AppearanceChoice appearance={appearance} /> : null}
            <HStack gap={2} hAlign="end" wrap="wrap">
              {ways()}
              <Button label="Stäng" variant="primary" onClick={close} />
            </HStack>
          </VStack>
        </Dialog>
      </>
    );
  return (
    <Flyout
      label={name}
      closeLabel="Stäng"
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      alignment="end"
      width={320}
      content={
        <VStack>
          <VStack padding={3} gap={1}>
            <Heading level={3} accessibilityLevel={2}>
              {name}
            </Heading>
            {line ? <Text type="supporting">{line}</Text> : null}
          </VStack>
          {appearance ? (
            <>
              <Divider />
              <VStack padding={3}>
                <AppearanceChoice appearance={appearance} />
              </VStack>
            </>
          ) : null}
          {pageHref || onSignOut ? (
            <>
              <Divider />
              {stacked ? (
                <VStack padding={3} gap={2}>
                  {ways('100%')}
                </VStack>
              ) : (
                <HStack padding={3} gap={2} hAlign="end" wrap="wrap">
                  {ways()}
                </HStack>
              )}
            </>
          ) : null}
        </VStack>
      }
      trigger={press => <PersonButton name={name} description={description} compact={compact} onClick={press} />}
    />
  );
}

/**
 * The person on the band: one button, so the hover, the focus ring and the target are the whole of it (product owner,
 * 2026-11-23). `onClick` only where nothing else opens the settings: a `Flyout` presses its own trigger.
 */
function PersonButton({
  name,
  description,
  compact,
  onClick,
}: {
  name: string;
  description?: string;
  compact: boolean;
  onClick?: () => void;
}) {
  if (compact)
    // Below the header's breakpoint, the account glyph alone, the size of the band's other marks. Not the avatar: its
    // initials would be visible text that the accessible name does not contain (axe's label-content-name-mismatch),
    // so the picture is a glyph, and the name is the label.
    return (
      <Button
        label={`${name}, inställningar`}
        variant="ghost"
        icon={<Icon icon={UserCircleIcon} color="inherit" />}
        isIconOnly
        aria-haspopup="dialog"
        onClick={onClick}
      />
    );
  // The avatar, the name in bold over the person's unit, and a mark that it opens something, as the reference draws
  // the person on its band (D130). The avatar is the button's picture and hidden from assistive technology, which
  // reads the name beside it. Both lines are the button's visible text, so both are in its name, in the order they
  // are read (WCAG 2.5.3); the space between them keeps the two from running together as one word for a tool that
  // reads the text and not the layout.
  return (
    <Button
      label={[name, description, 'inställningar'].filter(Boolean).join(', ')}
      variant="ghost"
      size="lg"
      aria-haspopup="dialog"
      icon={<Avatar name={name} size="sm" tooltip={false} aria-hidden />}
      endContent={<Icon icon={ChevronDownIcon} size="sm" color="inherit" />}
      onClick={onClick}
    >
      <VStack gap={0} hAlign="start">
        <Text weight="bold" color="inherit">
          {name}
        </Text>{' '}
        {description ? (
          <Text type="supporting" color="inherit">
            {description}
          </Text>
        ) : null}
      </VStack>
    </Button>
  );
}

/** The colour choice (D39, D48): Samma som datorn, Ljust, Mörkt, shared by every surface on the domain. */
function AppearanceChoice({ appearance }: { appearance: SiteHeaderAppearance }) {
  return (
    <RadioList
      label="Utseende"
      value={appearance.mode}
      onChange={value => {
        if (value === 'system' || value === 'light' || value === 'dark') appearance.onChange(value);
      }}
      description={
        appearance.isPersistent === false
          ? 'Webbläsaren tillåter inte att valet sparas. Det gäller tills du laddar om sidan.'
          : 'Valet gäller startsidan och intranätet i den här webbläsaren.'
      }
    >
      <RadioListItem value="system" label="Samma som datorn" />
      <RadioListItem value="light" label="Ljust" />
      <RadioListItem value="dark" label="Mörkt" />
    </RadioList>
  );
}
