import { trpc } from "../trpc";
import { z } from "zod";
import { LessonPlan } from "../application/LessonPlan";
export const testRouter = trpc.router({
  getChapterVocab: trpc.procedure
    .input(
      z.object({ level: z.string(), story: z.string(), chapter: z.string() })
    )
    .query(async ({ input }) => {
      return await LessonPlan.getChapterVocab({
        level: input.level,
        story: input.story,
        chapter: input.chapter,
      });
    }),
});
