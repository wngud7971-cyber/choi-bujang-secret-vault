import { randomUUID } from 'node:crypto';

// Synthetic values for isolated, mocked tests only. Never read real credentials.
export function makeFixtureValue() {
  return `fixture-${randomUUID()}`;
}
