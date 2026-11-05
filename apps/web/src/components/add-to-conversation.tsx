import { AtSymbolIcon, Icon, IconButton } from '@clew/ui';

/**
 * "Lägg till i samtalet" (D12) as one icon, wherever a card, a row, a source or a meeting can go into the box: the `@`
 * the box itself uses for the same thing, as the `ai-chat-landing` template draws its reference button. The words are
 * the button's name and its tooltip; once the object is in the box the check says so and the button rests.
 */
export function AddToConversation({ added = false, onAdd, size = 'sm' }: { added?: boolean; onAdd: () => void; size?: 'sm' | 'md' }) {
  const label = added ? 'I samtalet' : 'Lägg till i samtalet';
  return <IconButton size={size} variant="ghost" label={label} tooltip={label} icon={<Icon icon={added ? 'check' : AtSymbolIcon} />} isDisabled={added} onClick={onAdd} />;
}
