import {
  Registry as BaseRegistry,
  openGovernance,
  type Connector,
  type RelationResolver,
  type RegistryOptions,
} from '../packages/connectors/src/index';
import type { Relation } from '../packages/contracts/src/index';

/**
 * Who may be asked about, trusted (D117): every key is let through under the first relation the capability admits, the
 * caller's own user name as `self` when it admits that, as the open governance below lets every connector through. The
 * suites that test a connector's own narrowing keep sending it what they choose; the suites of the rule itself
 * (`tests/unit/asked-about.test.ts`) pass the real one, over a directory.
 */
export const trustingRelations: RelationResolver = async (actor, entity, keys, admits) =>
  keys.flatMap(asked => {
    const own = entity === 'person' && !!actor.userName && actor.userName.toLowerCase() === asked.toLowerCase();
    const relation: Relation | undefined =
      entity === 'unit' ? admits[0] : own ? admits.find(r => r === 'self') : admits.find(r => r !== 'self');
    return relation ? [{ asked, key: asked, relation }] : [];
  });

/** Test fixtures explicitly grant access on registration. Production Registry defaults to deny. */
export class Registry extends BaseRegistry {
  constructor(options: RegistryOptions = {}) {
    super({ relations: trustingRelations, ...options });
  }
  override replace(connector: Connector) {
    if (!this.connector(connector.id)) return this.register(connector);
    return super.replace({ uses: ['*'], ...connector });
  }
  override register(connector: Connector) {
    super.register({ uses: ['*'], ...connector });
    this.govern(connector.id, openGovernance());
    return this;
  }
}
