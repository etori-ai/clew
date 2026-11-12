import { ENTITY_KEY_MAX } from '@clew/contracts';
import { Link, Text } from '@clew/ui';
import { useLocation } from 'react-router';
import { personPageFrom } from '../person-address';

/**
 * Only active directory accounts that a source can be asked about have a profile page, and its address is the person's id
 * (D116). Keep the list's filters in the return link.
 */
export function PersonNameLink({
  person,
}: {
  person: { id: string; name: string; userName: string | null; enabled: boolean };
}) {
  const location = useLocation();
  if (!person.enabled || !person.userName || [...person.userName].length > ENTITY_KEY_MAX)
    return <Text weight="semibold">{person.name}</Text>;
  return (
    <Link href={personPageFrom(location.pathname, location.search, person.id)} weight="semibold" hasUnderline>
      {person.name}
    </Link>
  );
}
