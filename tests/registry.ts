import { Registry as BaseRegistry, openGovernance, type Connector } from '../packages/connectors/src/index';

/** Test fixtures explicitly grant access on registration. Production Registry defaults to deny. */
export class Registry extends BaseRegistry {
  override register(connector: Connector) {
    super.register({ uses: ['*'], ...connector });
    this.govern(connector.id, openGovernance());
    return this;
  }
}
