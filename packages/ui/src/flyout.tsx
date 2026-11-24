import type { ReactNode } from 'react';
import { BottomSheet } from '@astryxdesign/core/BottomSheet';
import { Button } from '@astryxdesign/core/Button';
import { Divider } from '@astryxdesign/core/Divider';
import { VStack } from '@astryxdesign/core/Layout';
import { Popover } from '@astryxdesign/core/Popover';
import { useMediaQuery } from '@astryxdesign/core/hooks';

/**
 * Where Astryx's own adaptive presentations choose the sheet: a finger as the primary pointer on a screen the theme
 * counts as compact (narrower than `md`, or shorter than 500 px, so a phone in either orientation). Which surface a
 * product uses there is its own policy (Astryx's `DropdownMenuBottomSheet` block), and this is Clew's one line for it.
 */
export const COMPACT_TOUCH_QUERY = '(pointer: coarse) and ((max-width: 767px) or (max-height: 499px))';
/** True on a touch phone: what a `Flyout` holds is in a sheet, so it lays its actions out for a thumb. */
export const useCompactTouch = () => useMediaQuery(COMPACT_TOUCH_QUERY);

/**
 * What a control opens under itself (D39): the reminders under the bell, the person's settings under the person.
 *
 * With a pointer it is Astryx's `Popover`, anchored under its trigger. On a touch phone it is Astryx's `BottomSheet`
 * at the height of its content (`height="hug"`), closed by a visible "Stäng" as well as by a swipe, a tap outside and
 * Esc. `Popover`'s own `presentation="adaptive"` chooses the same two surfaces, but its sheet is always the tall one,
 * which leaves a short list at the top of an almost empty screen, and its close is hidden until a keyboard reaches
 * it, so a finger has only the grab bar (review 2026-11-23). This is the one place that makes the choice.
 *
 * The content is drawn flush on both surfaces (`padding={0}`) and pads its own sections. A `Popover` presses its own
 * trigger; a sheet has none, so there the trigger is handed `press` and opens the sheet itself, and the sheet returns
 * the focus to it when it closes.
 */
export function Flyout({
  label,
  closeLabel,
  isOpen,
  onOpenChange,
  alignment = 'start',
  width,
  content,
  trigger,
}: {
  /** The accessible name of the surface, a dialog on both. */
  label: string;
  /** The name of the popover's close for a keyboard, which says what closes ("Stäng påminnelser"). */
  closeLabel: string;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Which edge of the trigger the popover lines up with. */
  alignment?: 'start' | 'end';
  /** The popover's width; a sheet is as wide as the screen. */
  width: number;
  content: ReactNode;
  /** The trigger, one Astryx `Button`. `press` is its `onClick` where it is given, and nothing where a popover owns the press. */
  trigger: (press: (() => void) | undefined) => ReactNode;
}) {
  const sheet = useCompactTouch();
  if (sheet)
    return (
      <>
        {trigger(() => onOpenChange(true))}
        <BottomSheet isOpen={isOpen} onOpenChange={onOpenChange} label={label} height="hug" padding={0}>
          <VStack>
            {content}
            <Divider />
            <VStack padding={3}>
              <Button label="Stäng" variant="secondary" width="100%" onClick={() => onOpenChange(false)} />
            </VStack>
          </VStack>
        </BottomSheet>
      </>
    );
  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      label={label}
      closeButtonLabel={closeLabel}
      placement="below"
      alignment={alignment}
      width={width}
      padding={0}
      content={content}
    >
      {trigger(undefined)}
    </Popover>
  );
}
