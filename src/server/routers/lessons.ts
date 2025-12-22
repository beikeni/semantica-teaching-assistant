import { trpc } from "../trpc";
import { z } from "zod";

export const lessonsRouter = trpc.router({
  getLessonCefrLevel: trpc.procedure
    .input(
      z.object({
        level: z.string(),
        story: z.string(),
        chapter: z.string(),
        section: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      const { level, story, chapter, section } = input;
      const cefrLessonClassification = await ctx.makeClient.getRecord({
        key: `cefrLessonClassification:${level}/${story}/${section}/${chapter}`,
      });
      return cefrLessonClassification?.level;
    }),
});
