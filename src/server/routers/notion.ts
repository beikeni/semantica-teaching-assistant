import { notionClient } from "../clients/notion-client";
import { trpc } from "../trpc";
import { z } from "zod";

export const notionRouter = trpc.router({
  getDatabaseItems: trpc.procedure.query(async () => {
    return await notionClient.getItems();
  }),
  getLessonPlan: trpc.procedure
    .input(z.object({ level: z.string(), story: z.string(), chapter: z.string(), section: z.string() }))
    .query(async ({ input }) => {
      return await notionClient.getLessonPlan({ level: input.level, story: input.story, chapter: input.chapter, section: input.section });
    }),
  getPage: trpc.procedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      return await notionClient.getPage({ id: input.id });
    }),
});
// "parent": {
//         "type": "data_source_id",
//         "data_source_id": "2388e9f5-0c8e-81d1-a3a5-000b64f95780",
//         "database_id": "2388e9f5-0c8e-80a2-8f13-e7a495225c27"
//       },
