import { S3Manager } from "../clients/s3-client";
import { trpc } from "../trpc";
import { z } from "zod";

export const s3Router = trpc.router({
  getLevels: trpc.procedure.query(async ({ input, ctx }) => {
    return await ctx.s3Manager.getLevels();
  }),
  getLevelStories: trpc.procedure
    .input(z.object({ level: z.string() }))
    .query(async ({ input, ctx }) => {
      return await ctx.s3Manager.getLevelStories({ level: input.level });
    }),
  getStorySections: trpc.procedure
    .input(z.object({ level: z.string(), story: z.string() }))
    .query(async ({ input, ctx }) => {
      return await ctx.s3Manager.getStorySections({
        level: input.level,
        story: input.story,
      });
    }),
  getSectionChapters: trpc.procedure
    .input(
      z.object({ level: z.string(), story: z.string(), section: z.string() })
    )
    .query(async ({ input, ctx }) => {
      return await ctx.s3Manager.getSectionChapters({
        level: input.level,
        story: input.story,
        section: input.section,
      });
    }),
  getChapterText: trpc.procedure
    .input(
      z.object({
        level: z.string(),
        story: z.string(),
        section: z.string(),
        chapter: z.string(),
      })
    )
    .query(async ({ input, ctx }) => {
      return await ctx.s3Manager.getChapterText({
        level: input.level,
        story: input.story,
        section: input.section,
        chapter: input.chapter,
      });
    }),
});
