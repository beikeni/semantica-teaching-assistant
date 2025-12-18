/**
 * Mock implementations for all external clients.
 * Use these to isolate your tRPC integration tests from external dependencies.
 */

export {
  createMockGoogleSheetsClient,
  type RangeValues,
  type SheetRange,
  type SpreadsheetInfo,
} from "./google-sheets.mock";

export { createMockNotionClient } from "./notion.mock";

export { createMockS3Manager } from "./s3.mock";

export { createMockMakeClient, clearMockMakeStore } from "./make.mock";

