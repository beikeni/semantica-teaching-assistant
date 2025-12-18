/**
 * Test context utilities for tRPC integration testing.
 *
 * Provides helpers to create mock contexts and callers for testing
 * tRPC procedures without starting a server or making HTTP requests.
 */
import type { AppContext } from "../../src/server/router";
import { createCaller } from "../../src/server/router";
import {
  createMockGoogleSheetsClient,
  createMockNotionClient,
  createMockS3Manager,
  createMockMakeClient,
} from "../mocks";
import type { IGoogleSheetsClient, INotionClient, IS3Manager, IMakeClient } from "../../src/server/clients/interfaces";

/**
 * Options for creating a test context.
 * Provide partial implementations to override default mock behavior.
 */
export type TestContextOptions = {
  googleSheetsClient?: Partial<IGoogleSheetsClient>;
  notionClient?: Partial<INotionClient>;
  s3Manager?: Partial<IS3Manager>;
  makeClient?: Partial<IMakeClient>;
};

/**
 * Creates a test context with mock clients.
 * All dependencies are mocked by default, but you can provide overrides.
 *
 * @example
 * ```ts
 * const ctx = createTestContext({
 *   s3Manager: {
 *     getChapterText: async () => "Custom chapter text"
 *   }
 * });
 * ```
 */
export function createTestContext(options: TestContextOptions = {}): AppContext {
  return {
    googleSheetsClient: createMockGoogleSheetsClient(options.googleSheetsClient),
    notionClient: createMockNotionClient(options.notionClient),
    s3Manager: createMockS3Manager(options.s3Manager),
    makeClient: createMockMakeClient(options.makeClient),
  };
}

/**
 * Creates a tRPC caller with a test context.
 * This is the primary way to test tRPC procedures.
 *
 * @example
 * ```ts
 * const caller = createTestCaller();
 * const result = await caller.s3.getLevels();
 * expect(result).toEqual(["level-1", "level-2", "level-3"]);
 * ```
 *
 * @example
 * ```ts
 * // With custom mock overrides
 * const caller = createTestCaller({
 *   s3Manager: {
 *     getLevels: async () => ["custom-level"]
 *   }
 * });
 * const result = await caller.s3.getLevels();
 * expect(result).toEqual(["custom-level"]);
 * ```
 */
export function createTestCaller(options: TestContextOptions = {}) {
  const ctx = createTestContext(options);
  return createCaller(ctx);
}

/**
 * Type alias for the test caller return type.
 * Useful for typing test helper functions.
 */
export type TestCaller = ReturnType<typeof createTestCaller>;

