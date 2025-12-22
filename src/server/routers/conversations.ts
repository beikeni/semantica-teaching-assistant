import { z } from "zod";
import { trpc } from "../trpc";

import { openai } from "../clients/openai-client";
import {
  CEFR_LESSON_CLASSIFICATION_SHEET_ID,
  CEFR_LESSON_CLASSIFIER_PROMPT_ID,
  CEFR_SHEET_RANGE,
  LEARNER_EVALUATION_PROMPT_ID,
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
import { UserEvaluationSchema } from "../models/user-evaluation";

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

        console.log("getting script");
        const script = await ctx.s3Manager.getChapterText({
          level,
          story,
          chapter,
          section,
        });

        console.log("getting grammar");
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

        console.log("getting vocab");
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
        console.log("getting lesson plan");
        let lessonPlan = await ctx.notionClient.getLessonPlan({
          level,
          story,
          chapter,
          section,
        });
        if (!lessonPlan) {
          console.log("no lesson plan, generating...");
          yield { type: "status" as const, status: "generating_lesson_plan" };
          const newLessonPlan: LessonPlanType | null =
            await LessonPlan.generateLessonPLan({
              scripts: [script ?? ""],
              grammar: cleanedGrammar,
              vocab: cleanedVocab,
            });

          console.log("converting to markdown");
          const markdownLessonPlan = await LessonPlan.convertToMarkdown({
            lessonPlan: newLessonPlan,
          });
          console.log("storing lesson plan");
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

        const cefrLessonClassificationPromise = (async () => {
          console.log("getting cefr lesson classification");
          let cefrLessonClassification = await ctx.makeClient.getRecord({
            key: `cefrLessonClassification:${level}/${story}/${section}/${chapter}`,
          });
          if (!cefrLessonClassification) {
            console.log("no cefrLessonClassification, generating...");
            console.log("generating cefr lesson classification");
            const cefrResponse = await openai.responses.parse({
              model: "gpt-5-mini",
              max_output_tokens: 4096,
              text: {
                format: zodTextFormat(
                  CefrClassificationSchema,
                  "cefr_classification"
                ),
              },
              prompt: {
                id: CEFR_LESSON_CLASSIFIER_PROMPT_ID,
              },
              input: JSON.stringify({
                script: script,
                lessonPlan: lessonPlan,
                grammar: cleanedGrammar,
                vocab: cleanedVocab,
              }),
            });

            console.log("storing cefr lesson classification");
            await ctx.makeClient.setRecord({
              key: `cefrLessonClassification:${level}/${story}/${section}/${chapter}`,
              value: JSON.stringify(cefrResponse.output_parsed),
            });
            cefrLessonClassification = cefrResponse.output_parsed;
          }
          const conversationItems = await openai.conversations.items.list(
            conversationId
          );

          const evaluationContext = {
            cefr_classification: cefrLessonClassification,
            lesson_plan: lessonPlan,
            script: script,
            grammar: cleanedGrammar,
            vocab: cleanedVocab,
          };
          console.log("evaluationContext", JSON.stringify(evaluationContext));
          console.log("getting user evaluation");
          const userEvaluationResponse = await openai.responses.parse({
            text: {
              format: zodTextFormat(UserEvaluationSchema, "user_evaluation"),
            },
            model: "gpt-5-mini",
            max_output_tokens: 8192,
            input: JSON.stringify(conversationItems),
            prompt: {
              id: LEARNER_EVALUATION_PROMPT_ID,
              variables: {
                evaluation_context: JSON.stringify(evaluationContext),
              },
            },
          });
          console.log(
            "userEvaluationResponse",
            JSON.stringify(userEvaluationResponse.output_parsed)
          );
          await ctx.makeClient.setRecord({
            key: `userEvaluation:${userId}/${conversationId}`,
            value: JSON.stringify(userEvaluationResponse.output_parsed),
          });

          return cefrLessonClassification;
        })();

        yield { type: "status" as const, status: "streaming_response" };

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

        console.log("streaming response");
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

        console.log("streaming response 2");
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

        await cefrLessonClassificationPromise;

        yield { type: "status" as const, status: "evaluation_complete" };
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
