import { z } from "zod";
import { trpc } from "../trpc";

import { openai } from "../clients/openai-client";
import { TEACHER_CHAT_PROMPT_ID } from "../lib/constants";
import fs from "fs/promises";
import { S3Manager } from "../clients/s3-client";
import { LessonPlan } from "../application/LessonPlan";
import {
  LessonPlanSchema,
  type Grammar,
  type Vocab,
} from "../models/LessonPlan";
import { MakeClient } from "../clients/make-client";
import { notionClient } from "../clients/notion-client";

const streamResponseInput = z.object({
  level: z.string(),
  story: z.string(),
  chapter: z.string(),
  section: z.string(),
  query: z.string().nullish(),
  conversationId: z.string().nullish(),
});

export const conversationsRouter = trpc.router({
  streamResponse: trpc.procedure
    .input(streamResponseInput)
    .mutation(async function* ({ input }) {
      // Yield immediately to keep connection alive
      yield { type: "status" as const, status: "loading" };

      try {
        const { level, story, chapter, section, query } = input;
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

        const script = await S3Manager.getChapterText({
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

        let lessonPlan = await MakeClient.getRecord({
          key: `lesson-plan:${level}:${story}:${section}:${chapter}`,
        });

        if (!lessonPlan) {
          yield { type: "status" as const, status: "generating_lesson_plan" };
          lessonPlan = await LessonPlan.generateLessonPLan({
            scripts: [script ?? ""],
            grammar: cleanedGrammar,
            vocab: cleanedVocab,
          });
          await MakeClient.setRecord({
            key: `lesson-plan:${level}:${story}:${section}:${chapter}`,
            value: JSON.stringify(lessonPlan),
          });
          await notionClient.createLessonPlan({
            level,
            story,
            chapter,
            section,
            lessonPlan,
          });
        }

        const verifiedLessonPlan = LessonPlanSchema.parse(lessonPlan);

        // TODO: At the moment, the grammar points and vocab come from both google sheets and the lesson plan.

        const userContext = {
          level,
          story,
          chapter,
          section,
          relevant_kb_info: {
            grammar: cleanedGrammar,
            vocab: cleanedVocab,
            scripts: [script],
            story_summary: verifiedLessonPlan.story_summary,
            grammar_points: verifiedLessonPlan.grammar_points,
            vocab_to_review: verifiedLessonPlan.vocab_to_review,
            potential_difficulties: verifiedLessonPlan.potential_difficulties,
            teaching_plan: verifiedLessonPlan.teaching_plan,
          },
        };

        yield { type: "status" as const, status: "streaming_response" };

        const stream = await openai.responses.create({
          conversation: conversationId ?? undefined,
          stream: true,
          prompt: {
            id: TEACHER_CHAT_PROMPT_ID,
            variables: {
              level_3_specific_instructions: instructions,
              user_context: JSON.stringify(userContext),
              user_message: query ?? "",
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
            console.log("delta", event.delta);
          }
          if (event.type === "response.output_text.done") {
            console.log("response.output_text.done", event.text);
          }
        }

        yield { type: "status" as const, status: "done" };
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
