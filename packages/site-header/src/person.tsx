import { useState } from 'react';
import { Avatar } from '@astryxdesign/core/Avatar';
import { Button } from '@astryxdesign/core/Button';
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog';
import { HStack, VStack } from '@astryxdesign/core/Layout';
import { RadioList, RadioListItem } from '@astryxdesign/core/RadioList';
import { Text } from '@astryxdesign/core/Text';
import { Icon } from '@astryxdesign/core/Icon';
import { UserCircleIcon } from '@heroicons/react/24/outline';
import type { ColorMode } from '@clew/ui/appearance-preference';
import { useCompactSiteHeader } from './site-header';

export type SiteHeaderAppearance = Readonly<{
  mode: ColorMode;
  onChange: (mode: ColorMode) => void;
  /** False when the browser refuses to keep the choice (D39): the dialog then says so instead of claiming it was saved. */
  isPersistent?: boolean;
}>;

/**
 * The signed-in person at the end of the shared header (D87), one composition for every host so the portal and the
 * intranet draw the same control: the avatar and the name as a button, the avatar alone below the header's breakpoint.
 * It opens the web app's own settings composition (D39): an Astryx `Dialog` with the colour choice as a `RadioList`
 * (Samma som datorn, Ljust, Mörkt), shared by every surface on the domain, and "Logga ut". Not a `DropdownMenu`: Astryx's
 * menu finds its focused row through `document.activeElement`, which inside the intranet's shadow root is the
 * `<site-header>` element, so Enter and the arrow keys did nothing there; native radios and a native `<dialog>` work by
 * keyboard in both places. With neither a colour choice nor a way to sign out, the person is shown, not offered.
 */
export function SiteHeaderPerson({
  name,
  description,
  onSignOut,
  appearance,
}: {
  name: string;
  /** Under the name in the dialog: the person's unit or role, as the host knows it. */
  description?: string;
  onSignOut?: () => void;
  appearance?: SiteHeaderAppearance;
}) {
  const compact = useCompactSiteHeader();
  const [isOpen, setIsOpen] = useState(false);
  const avatar = <Avatar name={name} size="sm" tooltip={false} />;
  if (!onSignOut && !appearance)
    return (
      <HStack gap={2} vAlign="center">
        {avatar}
        {compact ? null : <Text>{name}</Text>}
      </HStack>
    );
  return (
    <>
      <HStack gap={2} vAlign="center">
        {compact ? null : avatar}
        {compact ? (
          // Icon-only with the account glyph D39 used: the avatar's initials would be visible text that the accessible
          // name does not contain (axe's label-content-name-mismatch), so the picture is a glyph, and the name is the label.
          <Button
            label={`${name}, inställningar`}
            variant="ghost"
            size="sm"
            icon={<Icon icon={UserCircleIcon} size="md" color="inherit" />}
            isIconOnly
            aria-haspopup="dialog"
            onClick={() => setIsOpen(true)}
          />
        ) : (
          <Button
            label={`${name}, inställningar`}
            variant="ghost"
            size="sm"
            aria-haspopup="dialog"
            onClick={() => setIsOpen(true)}
          >
            {name}
          </Button>
        )}
      </HStack>
      <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
        <DialogHeader title={name} onOpenChange={setIsOpen} />
        <VStack gap={4} padding={3}>
          {description ? <Text type="supporting">{description}</Text> : null}
          {appearance ? (
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
          ) : null}
          <HStack gap={2} hAlign="end" wrap="wrap">
            {onSignOut ? (
              <Button
                label="Logga ut"
                variant="secondary"
                onClick={() => {
                  setIsOpen(false);
                  onSignOut();
                }}
              />
            ) : null}
            <Button label="Stäng" variant="primary" onClick={() => setIsOpen(false)} />
          </HStack>
        </VStack>
      </Dialog>
    </>
  );
}
