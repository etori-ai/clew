import type { AuthenticatedContext } from '@clew/contracts';
import { audiencedActorOf, CapabilityError, type Registry, type RunCaller } from '@clew/connectors';
import { InputError } from '../context';

/**
 * What a caller adds to a run: `direct` is for the one caller that is the person's own session asking for a read itself
 * (`POST /api/cap`): only there is a relation the person holds by grant resolved (D121, `RunContext.direct`). `caller` is
 * for the assistant's runner, which reads in a conversation turn for the person (D122 item 6, `RunContext.caller`), and
 * `forModel` for every read of such a turn, whose answer the model is handed now or later in the conversation (D122
 * item 4, `RunContext.forModel`).
 */
export interface CapabilityRunOptions {
  direct?: boolean;
  caller?: RunCaller;
  forModel?: boolean;
}
/**
 * Run a capability through a registry with input validation: the path for REST, cards and tools, as `runCapability` in
 * the server registry is this over the live one. A connector's callback goes through the registry's `clewFor` instead
 * (`routes/connector-callback.ts`), which keeps the protocol's codes. It runs as the person with their provisioned
 * groups, so an audience that names a group admits its members. A refusal becomes an `InputError` in the registry's
 * Swedish words, with the `CapabilityError` as its cause, so the assistant tells its model the kind of failure by its
 * protocol code (`toolFailure`) and never the words.
 */
export function capabilityRunner(registry: Pick<Registry, 'find' | 'run'>) {
  return async function runCapability<O = unknown>(
    persona: AuthenticatedContext,
    name: string,
    input: unknown,
    options: CapabilityRunOptions = {},
  ): Promise<O> {
    const found = registry.find(name);
    if (!found) throw new InputError('Okänd förmåga.');
    try {
      return await registry.run<O>(audiencedActorOf(persona), name, input ?? {}, {
        authorize: () => persona.authorize(),
        delegate: persona.delegate,
        ...(options.direct ? { direct: true } : {}),
        ...(options.caller ? { caller: options.caller } : {}),
        ...(options.forModel ? { forModel: true } : {}),
      });
    } catch (error) {
      if (error instanceof CapabilityError) throw new InputError(error.message, { cause: error });
      throw error;
    }
  };
}
