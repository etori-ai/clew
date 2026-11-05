import type { Connector } from '@clew/connectors';
import type { ConnectorManifest } from '@clew/connectors/protocol';

/**
 * A bundled connector (people, the calendar, the mocks) described in the manifest's shape, so the administration page
 * shows it the way it shows a remote one (D23). Schemas and function scopes do not serialise; the manifest form carries
 * `{}` and an empty scope for them, and the page says "varierar" where a scope is code.
 */
export function describeBundled(connector: Connector): ConnectorManifest {
  return {
    protocol: 2, id: connector.id, kind: connector.kind === 'core' ? 'passthrough' : connector.kind, source: connector.source,
    areas: connector.areas.map(a => ({ id: a.id, title: a.title, roles: [...a.roles], standing: [...a.standing], schedules: a.schedules.map(s => ({ ...s })), ...(a.figure ? { figure: true } : {}), ...(a.icon ? { icon: a.icon } : {}) })),
    capabilities: connector.capabilities.map(c => ({ name: c.name, kind: c.kind, title: c.title, description: c.description, input: {}, output: {}, model: c.model,
      scope: typeof c.scope === 'function' ? {} : c.scope.roles ? { roles: [...c.scope.roles] } : {}, ...(c.view ? { view: c.view } : {}), ...(c.menu ? { menu: c.menu } : {}) })),
    scan: !!connector.scan,
  };
}
