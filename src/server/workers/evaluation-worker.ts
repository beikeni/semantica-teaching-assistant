import Alert from "slack-alerts";
import { openai } from "../clients/openai-client";
import {
  CefrClassificationSchema,
  type CefrClassification,
  type UserContext,
} from "../models/app";
import type { AppContext } from "../router";
import {
  CEFR_LESSON_CLASSIFIER_PROMPT_ID,
  CEFR_SHEET_RANGE,
} from "../lib/constants";
import { googleSheetsClient } from "../clients/google-sheets";
import { notionClient } from "../clients/notion-client";
import { s3Manager } from "../clients/s3-client";
import { makeClient } from "../clients/make-client";
import { zodTextFormat } from "openai/helpers/zod.mjs";
import { z } from "zod";

// prevents TS errors
declare var self: Worker;

const createWorkerFunction = ({ ctx }: { ctx: AppContext }) => {
  return async (event: MessageEvent) => {
    const {
      conversationId,
      //   cefrLessonClassification,
      userId,
      userContext,
      query,
    }: {
      conversationId: string;
      //   cefrLessonClassification: CefrClassification;
      userId: string;
      userContext: UserContext;
      query: string;
    } = event.data;

    const { level, story, section, chapter } = userContext;
    const {
      grammar,
      vocab,
      lesson_plan: lessonPlan,
    } = userContext.relevant_kb_info;
    const { scripts } = userContext.relevant_kb_info;

    let cefrLessonClassification = await ctx.makeClient.getRecord({
      key: `cefrLessonClassification:${level}/${story}/${section}/${chapter}`,
    });
    console.log("cefrLessonClassification", cefrLessonClassification);
    if (!cefrLessonClassification) {
      console.log("no cefrLessonClassification, generating...");
      const cefrResponse = await openai.responses.parse({
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
          script: scripts[0],
          lessonPlan: lessonPlan,
          grammar: grammar,
          vocab: vocab,
        }),
      });

      console.log("cefrResponse", cefrResponse.output_parsed);

      await ctx.makeClient.setRecord({
        key: `cefrLessonClassification:${level}/${story}/${section}/${chapter}`,
        value: JSON.stringify(cefrResponse.output_parsed),
      });
      cefrLessonClassification = cefrResponse.output_parsed;
    }
  };
};

self.onmessage = createWorkerFunction({
  ctx: {
    googleSheetsClient,
    notionClient,
    s3Manager,
    makeClient,
  },
});

// self.onmessage = async (event: MessageEvent) => {
//   console.log("event", event);
// };
