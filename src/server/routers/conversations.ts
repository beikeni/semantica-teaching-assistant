import { z } from "zod";
import { trpc } from "../trpc";

import { openai } from "../clients/openai-client";
import {
  CEFR_LESSON_CLASSIFICATION_SHEET_ID,
  CEFR_LESSON_CLASSIFIER_PROMPT_ID,
  CEFR_SHEET_RANGE,
  TEACHER_CHAT_PROMPT_ID,
} from "../lib/constants";
import fs from "fs/promises";
import { LessonPlan } from "../application/LessonPlan";
import {
  type CleanedGrammar,
  type CleanedVocab,
  type Grammar,
  type LessonPlanType,
  type Vocab,
} from "../models/LessonPlan";
import { notionClient } from "../clients/notion-client";
import { CefrClassificationSchema, type UserContext } from "../models/app";
import { zodTextFormat } from "openai/helpers/zod.mjs";

const streamResponseInput = z.object({
  level: z.string(),
  story: z.string(),
  chapter: z.string(),
  section: z.string(),
  query: z.string().nullish(),
  conversationId: z.string().nullish(),
  userId: z.string(),
});

export const conversationsRouter = trpc.router({
  streamResponse: trpc.procedure
    .input(streamResponseInput)
    .mutation(async function* ({ input, ctx }) {
      yield { type: "status" as const, status: "loading" };

      try {
        const { level, story, chapter, section, query, userId } = input;
        const instructions = await fs.readFile(
          `src/server/agents/chat-agent/${level}-instructions.md`,
          "utf8"
        );

        let { conversationId } = input;
        if (!conversationId) {
          ({ id: conversationId } = await openai.conversations.create({}));
        }

        // Yield the conversation ID
        yield { type: "conversation_id" as const, conversationId };

        yield { type: "status" as const, status: "fetching_content" };

        const script = await ctx.s3Manager.getChapterText({
          level,
          story,
          chapter,
          section,
        });

        const grammar = await LessonPlan.getChapterGrammar({
          level,
          story,
          chapter,
        });

        const cleanedGrammar = grammar.map((g: Grammar) => ({
          grammar: g.grammar,
          examplesFromScript: g.examples_from_script,
          contextualExplanations: g.contextual_explanations,
        }));

        const vocab = await LessonPlan.getChapterVocab({
          level,
          story,
          chapter,
        });

        const cleanedVocab = vocab.map((v: Vocab) => ({
          vocab: v.portuguese_primary,
          english: v.english_primary,
          alternative: v.portuguese_alternative,
          primaryPlusAlternative: v.portuguese_primary_plus_alternative,
          englishPlusAlternative: v.english_primary_plus_alternative,
          englishHint: v.english_hint,
        }));

        yield { type: "status" as const, status: "preparing_lesson" };

        let lessonPlan = await ctx.notionClient.getLessonPlan({
          level,
          story,
          chapter,
          section,
        });
        if (!lessonPlan) {
          yield { type: "status" as const, status: "generating_lesson_plan" };
          const newLessonPlan: LessonPlanType | null =
            await LessonPlan.generateLessonPLan({
              scripts: [script ?? ""],
              grammar: cleanedGrammar,
              vocab: cleanedVocab,
            });

          const markdownLessonPlan = await LessonPlan.convertToMarkdown({
            lessonPlan: newLessonPlan,
          });
          await notionClient.storeLessonPlan({
            level,
            story,
            chapter,
            section,
            markdownLessonPlan,
          });
          lessonPlan = markdownLessonPlan;
        }

        // TODO: At the moment, the grammar points and vocab come from both google sheets and the lesson plan.

        // let cefrLessonClassification = await ctx.makeClient.getRecord({
        //   key: `cefrLessonClassification:${level}/${story}/${section}/${chapter}`,
        // });
        // console.log("cefrLessonClassification", cefrLessonClassification);
        // if (!cefrLessonClassification) {
        //   console.log("no cefrLessonClassification, generating...");
        //   const cefrResponse = await openai.responses.parse({
        //     text: {
        //       format: zodTextFormat(
        //         CefrClassificationSchema,
        //         "cefr_classification"
        //       ),
        //     },
        //     prompt: {
        //       id: CEFR_LESSON_CLASSIFIER_PROMPT_ID,
        //     },
        //     input: JSON.stringify({
        //       script: script,
        //       lessonPlan: lessonPlan,
        //       grammar: cleanedGrammar,
        //       vocab: cleanedVocab,
        //     }),
        //   });

        //   console.log("cefrResponse", cefrResponse.output_parsed);

        //   await ctx.makeClient.setRecord({
        //     key: `cefrLessonClassification:${level}/${story}/${section}/${chapter}`,
        //     value: JSON.stringify(cefrResponse.output_parsed),
        //   });
        //   cefrLessonClassification = cefrResponse.output_parsed;
        // }

        yield { type: "status" as const, status: "streaming_response" };

        const worker = new Worker(
          new URL("../workers/evaluation-worker.ts", import.meta.url).href
        );

        const userContext: UserContext = {
          level,
          story,
          chapter,
          section,
          relevant_kb_info: {
            grammar: cleanedGrammar,
            vocab: cleanedVocab,
            scripts: [script],
            lesson_plan: lessonPlan,
          },
        };
        worker.postMessage({
          query,
          userContext,
          userId,
          conversationId,
        });

        const stream = await openai.responses.create({
          conversation: conversationId ?? undefined,
          stream: true,
          input: query || "Please start the lesson",
          prompt: {
            id: TEACHER_CHAT_PROMPT_ID,
            variables: {
              level_specific_instructions: instructions,
              user_context: JSON.stringify(userContext),
            },
          },
        });

        let response = "";
        for await (const event of stream) {
          if (event.type === "response.output_text.delta") {
            yield {
              type: "response.output_text.delta" as const,
              delta: event.delta,
            };
          }
          if (event.type === "response.output_text.done") {
            console.log("response.output_text.done", event.text);
          }
        }

        yield { type: "status" as const, status: "done" };

        // call to responses api to grade the output
        // aosdasdjaoijsd
      } catch (error) {
        console.error("Stream error:", error);
        console.error("Error details:", JSON.stringify(error, null, 2));
        yield {
          type: "error" as const,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),
});
