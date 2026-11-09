import { Navigate, useParams, useSearchParams } from 'react-router';
import { withService, withServices } from '../../service-address';

/** Previously shared service-page links now open the same content over Home. */
export default function McpServiceRedirect() {
  const { connectionId } = useParams();
  const [search] = useSearchParams();
  const deliveryId = search.get('delivery') ?? undefined;
  return (
    <Navigate replace to={connectionId ? withService('/', '', { connectionId, deliveryId }) : withServices('/', '')} />
  );
}
