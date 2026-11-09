/** MCP views keep the page beneath them, like the other card overlays. */
export type ServiceAddress = { connectionId: string; deliveryId?: string };
const keys = ['open-service', 'open-delivery'];
const address = (pathname: string, search: URLSearchParams) => pathname + (search.size ? '?' + search.toString() : '');

export function serviceOf(search: URLSearchParams): ServiceAddress | null {
  const connectionId = search.get('open-service');
  const deliveryId = search.get('open-delivery');
  return connectionId ? { connectionId, ...(deliveryId ? { deliveryId } : {}) } : null;
}

export function withService(pathname: string, search: string | URLSearchParams, service: ServiceAddress): string {
  const next = new URLSearchParams(search);
  keys.forEach(key => next.delete(key));
  next.set('open-service', service.connectionId);
  if (service.deliveryId) next.set('open-delivery', service.deliveryId);
  return address(pathname, next);
}

export function withoutService(pathname: string, search: string | URLSearchParams): string {
  const next = new URLSearchParams(search);
  keys.forEach(key => next.delete(key));
  return address(pathname, next);
}

export const servicesOpen = (search: URLSearchParams) => search.get('open-services') === '1';

/** The catalogue is a contextual overlay, never a page change. */
export function withServices(pathname: string, search: string | URLSearchParams): string {
  const next = new URLSearchParams(search);
  keys.forEach(key => next.delete(key));
  next.set('open-services', '1');
  return address(pathname, next);
}

export function withoutServices(pathname: string, search: string | URLSearchParams): string {
  const next = new URLSearchParams(search);
  keys.forEach(key => next.delete(key));
  next.delete('open-services');
  return address(pathname, next);
}
