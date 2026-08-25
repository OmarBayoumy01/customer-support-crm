import { HealthStatusSchema, type HealthStatus } from '@crm/shared';

/**
 * Placeholder entry point. US-4 replaces this with the NestJS bootstrap.
 *
 * Its job today is to prove AC2 from the backend side: `HealthStatus` is defined
 * once in `@crm/shared`, and renaming a field there breaks the type-check here.
 */
const sample: HealthStatus = {
  status: 'ok',
  service: 'backend',
  timestamp: new Date().toISOString(),
};

HealthStatusSchema.parse(sample);

console.log(JSON.stringify(sample));
