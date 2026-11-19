import { AtSymbolIcon, Icon, IconButton, useEntryAnimation } from '@clew/ui';

/**
 * The check that takes the `@`'s place once the object is in the box, scaling in on Astryx's entry motion (D92) as the
 * chip does in the drawer: the card and the box say "done" with one movement. It only mounts when the object is added,
 * so a button that is already resting when the page is drawn shows its check at once.
 */
function AddedCheck() {
  const entry = useEntryAnimation('scaleIn');
  return <Icon icon="check" xstyle={entry ?? undefined} />;
}

/**
 * "Lägg till i samtalet" (D12) as one icon, wherever a card, a row, a source or a meeting can go into the box: the `@`
 * the box itself uses for the same thing, as the `ai-chat-landing` template draws its reference button. The words are
 * the button's name and its tooltip; once the object is in the box the check says so and the button rests.
 */
export function AddToConversation({
  added = false,
  onAdd,
  size = 'sm',
}: {
  added?: boolean;
  onAdd: () => void;
  size?: 'sm' | 'md';
}) {
  const label = added ? 'I samtalet' : 'Lägg till i samtalet';
  return (
    <IconButton
      size={size}
      variant="ghost"
      label={label}
      tooltip={label}
      icon={added ? <AddedCheck /> : <Icon icon={AtSymbolIcon} />}
      isDisabled={added}
      onClick={onAdd}
    />
  );
}
