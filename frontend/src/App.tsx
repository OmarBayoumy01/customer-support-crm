import { HealthStatusSchema, type HealthStatus } from '@crm/shared';

/**
 * Placeholder view. Proves AC2 from the frontend side: the same `HealthStatus`
 * the backend uses is imported here from `@crm/shared`, with no duplicated
 * definition. Real UI work begins in Phase P03.
 *
 * `initial` is annotated with the shared type deliberately. Passing the literal
 * straight to `HealthStatusSchema.parse()` would NOT catch a field rename in the
 * shared DTO, because `parse` accepts `unknown` — the type-check would stay green
 * while the contract had already drifted.
 */
const initial: HealthStatus = {
  status: 'ok',
  service: 'frontend',
  timestamp: new Date().toISOString(),
};

HealthStatusSchema.parse(initial);

export default function App(): React.JSX.Element {
  return <pre>{JSON.stringify(initial, null, 2)}</pre>;
}
