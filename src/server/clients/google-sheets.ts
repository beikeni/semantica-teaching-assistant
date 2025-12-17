import { google, sheets_v4 } from "googleapis";

export type SheetRange = {
  spreadsheetId: string;
  range: string; // A1 notation, e.g., "Sheet1!A1:B10" or just "A1:B10" for first sheet
};

export type RangeValues = {
  spreadsheetId: string;
  range: string;
  values: string[][] | null;
};

class GoogleSheetsClient {
  private sheetsClient: sheets_v4.Sheets | null = null;

  private async getClient(): Promise<sheets_v4.Sheets> {
    if (this.sheetsClient) {
      return this.sheetsClient;
    }

    const credentials = await Bun.file("google-creds.json").json();

    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });

    this.sheetsClient = google.sheets({ version: "v4", auth });
    return this.sheetsClient;
  }

  /**
   * Read a single range from a spreadsheet
   * @param spreadsheetId - The ID of the spreadsheet (from the URL)
   * @param range - A1 notation range, e.g., "Sheet1!A1:B10"
   * @returns The values in the range as a 2D array
   */
  async getRange(
    spreadsheetId: string,
    range: string
  ): Promise<string[][] | null> {
    const sheets = await this.getClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    return (response.data.values as string[][]) ?? null;
  }

  /**
   * Read multiple ranges from a single spreadsheet
   * @param spreadsheetId - The ID of the spreadsheet
   * @param ranges - Array of A1 notation ranges
   * @returns Array of range results with their values
   */
  async getRanges(
    spreadsheetId: string,
    ranges: string[]
  ): Promise<RangeValues[]> {
    const sheets = await this.getClient();

    const response = await sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges,
    });

    return (
      response.data.valueRanges?.map((vr) => ({
        spreadsheetId,
        range: vr.range ?? "",
        values: (vr.values as string[][]) ?? null,
      })) ?? []
    );
  }

  /**
   * Read ranges from multiple different spreadsheets
   * @param requests - Array of spreadsheet ID and range pairs
   * @returns Array of results with spreadsheet ID, range, and values
   */
  async getRangesFromMultipleSheets(
    requests: SheetRange[]
  ): Promise<RangeValues[]> {
    const sheets = await this.getClient();

    // Group requests by spreadsheetId for efficiency
    const groupedBySpreadsheet = requests.reduce((acc, req) => {
      (acc[req.spreadsheetId] ??= []).push(req.range);
      return acc;
    }, {} as Record<string, string[]>);

    // Execute batch requests for each spreadsheet in parallel
    const results = await Promise.all(
      Object.entries(groupedBySpreadsheet).map(
        async ([spreadsheetId, ranges]) => {
          const response = await sheets.spreadsheets.values.batchGet({
            spreadsheetId,
            ranges,
          });

          return (
            response.data.valueRanges?.map((vr) => ({
              spreadsheetId,
              range: vr.range ?? "",
              values: (vr.values as string[][]) ?? null,
            })) ?? []
          );
        }
      )
    );

    return results.flat();
  }

  /**
   * Get spreadsheet metadata (title, sheets, etc.)
   * @param spreadsheetId - The ID of the spreadsheet
   * @returns Spreadsheet metadata
   */
  async getSpreadsheetInfo(spreadsheetId: string) {
    const sheets = await this.getClient();

    const response = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "properties.title,sheets.properties",
    });

    return {
      title: response.data.properties?.title ?? "",
      sheets:
        response.data.sheets?.map((s) => ({
          sheetId: s.properties?.sheetId,
          title: s.properties?.title,
          index: s.properties?.index,
        })) ?? [],
    };
  }
}

export const googleSheetsClient = new GoogleSheetsClient();
