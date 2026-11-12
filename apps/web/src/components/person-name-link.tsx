import { ENTITY_KEY_MAX } from '@clew/contracts';
import { Link, Text } from '@clew/ui';
import { useLocation } from 'react-router';
import { personPageFrom } from '../person-address';

/** Only active directory accounts have a profile address. Keep the list's filters in the return link. */
export function PersonNameLink({ person }: { person: { name: string; userName: string | null; enabled: boolean } }) {
  const location = useLocation();
  if (!person.enabled || !person.userName || [...person.userName].length > ENTITY_KEY_MAX)
    return <Text weight="semibold">{person.name}</Text>;
  return (
    <Link href={personPageFrom(location.pathname, location.search, person.userName)} weight="semibold" hasUnderline>
      {person.name}
    </Link>
  );
}
