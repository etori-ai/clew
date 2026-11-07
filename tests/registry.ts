import { Registry as BaseRegistry, openGovernance, type Connector } from '../packages/connectors/src/index';

/** Test fixtures explicitly grant access on registration. Production Registry defaults to deny. */
export class Registry extends BaseRegistry {
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
