import type { CleanedGrammar, CleanedVocab } from "./LessonPlan";
import { z } from "zod";

export type UserContext = {
  level: string;
  story: string;
  chapter: string;
  section: string;
  relevant_kb_info: {
    grammar: CleanedGrammar[];
    vocab: CleanedVocab[];
    scripts: string[];
    lesson_plan: string;
  };
};

export const CefrClassificationSchema = z.object({
  level: z.string(),
  requirements: z.array(z.string()),
  goals: z.array(z.string()),
});

export type CefrClassification = z.infer<typeof CefrClassificationSchema>;
