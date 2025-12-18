import type { IMakeClient } from "../../src/server/clients/interfaces";

/**
 * In-memory store for the mock Make client.
 * Useful for testing record creation and retrieval.
 */
const mockStore = new Map<string, any>();

/**
 * Creates a mock Make client for testing.
 * Uses an in-memory store by default, override methods as needed.
 */
export function createMockMakeClient(
  overrides: Partial<IMakeClient> = {}
): IMakeClient {
  return {
    setRecord: async ({ key, value }: { key: string; value: string }) => {
      mockStore.set(key, JSON.parse(value));
    },

    getRecord: async ({ key }: { key: string }) => {
      return mockStore.get(key) ?? null;
    },

    ...overrides,
  };
}

/**
 * Clears the mock store between tests.
 */
export function clearMockMakeStore(): void {
  mockStore.clear();
}
