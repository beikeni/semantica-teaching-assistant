/**
 * tRPC App Router definition.
 * Separated from server startup for testing purposes.
 */
import { trpc } from "./trpc";
import { conversationsRouter } from "./routers/conversations";
import { s3Router } from "./routers/s3";
import { notionRouter } from "./routers/notion";
import { googleSheetsRouter } from "./routers/google-sheets";
import { testRouter } from "./routers/test";
import type {
  IGoogleSheetsClient,
  IS3Manager,
  INotionClient,
  IMakeClient,
} from "./clients/interfaces";
import { googleSheetsClient } from "./clients/google-sheets";
import { notionClient } from "./clients/notion-client";
import { makeClient } from "./clients/make-client";
import { s3Manager } from "./clients/s3-client";
import { evaluationsRouter } from "./routers/evaluations";

/**
 * The main tRPC router combining all sub-routers.
 */
export const appRouter = trpc.router({
  conversations: conversationsRouter,
  s3: s3Router,
  notion: notionRouter,
  googleSheets: googleSheetsRouter,
  test: testRouter,
  evaluations: evaluationsRouter,
});

/**
 * Type definition for the app router.
 * Use this for type inference in tRPC clients and tests.
 */
export type AppRouter = typeof appRouter;

/**
 * Context type containing all client dependencies.
 * These can be mocked in tests for isolation.
 */
export type AppContext = {
  googleSheetsClient: IGoogleSheetsClient;
  notionClient: INotionClient;
  s3Manager: IS3Manager;
  makeClient: IMakeClient;
};

// Re-export for backwards compatibility
export type Context = AppContext;

/**
 * Creates the default production context with real client implementations.
 */
export const createContext = (): AppContext => {
  return {
    googleSheetsClient: googleSheetsClient,
    notionClient: notionClient,
    s3Manager: s3Manager,
    makeClient: makeClient,
  };
};

/**
 * Creates a caller factory for the app router.
 * Use this in tests to create a caller with a custom context.
 *
 * @example
 * ```ts
 * const caller = createCaller(mockContext);
 * const result = await caller.test.getChapterVocab({ level: "1", story: "test", chapter: "1" });
 * ```
 */
export const createCaller = trpc.createCallerFactory(appRouter);

