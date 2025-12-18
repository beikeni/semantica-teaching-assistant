import type { IGoogleSheetsClient } from "../../src/server/clients/interfaces";
import type {
  RangeValues,
  SheetRange,
  SpreadsheetInfo,
} from "../../src/server/clients/google-sheets";

/**
 * Creates a mock Google Sheets client for testing.
 * Override specific methods to customize behavior for your tests.
 */
export function createMockGoogleSheetsClient(
  overrides: Partial<IGoogleSheetsClient> = {}
): IGoogleSheetsClient {
  return {
    getRange: async (_spreadsheetId: string, _range: string) => {
      return [["mock", "data"]];
    },

    getRangesFromMultipleSheets: async (_requests: SheetRange[]) => {
      return [] as RangeValues[];
    },

    getSpreadsheetInfo: async (_spreadsheetId: string) => {
      return {
        title: "Mock Spreadsheet",
        sheets: [],
      } as SpreadsheetInfo;
    },

    ...overrides,
  };
}

// Re-export types for convenience in tests
export type { RangeValues, SheetRange, SpreadsheetInfo };
