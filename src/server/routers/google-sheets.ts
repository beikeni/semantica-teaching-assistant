import { googleSheetsClient } from "../clients/google-sheets";
import { z } from "zod";
import { trpc } from "../trpc";

export const googleSheetsRouter = trpc.router({
  getSheet: trpc.procedure
    .input(
      z.object({
        spreadsheetId: z.string(),
        range: z.string(),
      })
    )
    .query(async ({ input }) => {
      const { spreadsheetId, range } = input;
      const sheet = await googleSheetsClient.getRange(spreadsheetId, range);
      return sheet;
    }),
});
