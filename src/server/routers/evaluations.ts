import { UserEvaluationSchema } from "../models/user-evaluation";
import { trpc } from "../trpc";
import { z } from "zod";

export const evaluationsRouter = trpc.router({
  getEvaluation: trpc.procedure
    .input(
      z.object({
        userId: z.string(),
        conversationId: z.string(),
      })
    )
    .output(UserEvaluationSchema)
    .query(async ({ input, ctx }) => {
      const { userId, conversationId } = input;
      const evaluation = await ctx.makeClient.getRecord({
        key: `userEvaluation:${userId}/${conversationId}`,
      });
      return evaluation;
    }),
});
