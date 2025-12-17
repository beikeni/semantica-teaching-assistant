import { z } from "zod";

export type CleanedGrammar = {
  grammar: string;
  examplesFromScript: string | null | undefined;
  contextualExplanations: string | null | undefined;
};
export type CleanedVocab = {
  vocab: string;
  english: string;
  alternative: string | null | undefined;
  primaryPlusAlternative: string | null | undefined;
  englishPlusAlternative: string | null | undefined;
  englishHint: string | null | undefined;
};

export const VocabSchema = z.object({
  level: z.string(),
  story: z.string(),
  chapter: z.string(),
  sequence: z.string(),
  id: z.string(),
  type: z.string(),
  portuguese_primary: z.string(),
  english_primary: z.string(),
  slug: z.string().nullish(),
  english_alternative: z.string().nullish(),
  portuguese_alternative: z.string().nullish(),
  portuguese_primary_plus_alternative: z.string().nullish(),
  english_primary_plus_alternative: z.string().nullish(),
  english_hint: z.string().nullish(),
});

export type Vocab = z.infer<typeof VocabSchema>;

export const GrammarSchema = z.object({
  level: z.string(),
  story: z.string(),
  chapter: z.string(),
  sequence: z.string(),
  id: z.string(),
  slug: z.string(),
  grammar: z.string(),
  "Pinecone vector ID": z.string().nullish(),
  examples_from_script: z.string().nullish(),
  contextual_explanations: z.string().nullish(),
});

export type Grammar = z.infer<typeof GrammarSchema>;

export const PotentialDifficultySchema = z.object({
  item: z.string(),
  type: z.enum(["grammar", "vocabulary"]),
  reason: z.string(),
});

export const TeachingStepSchema = z.object({
  step: z.number().int().positive(),
  action: z.string(),
  instruction: z.string(),
  focus: z.string().nullish(),
  grammar_opportunity: z.string().nullish(),
  vocab_opportunity: z.string().nullish(),
});

export const LessonPlanSchema = z.object({
  story_summary: z.string(),
  grammar_points: z.array(z.string()),
  vocab_to_review: z.array(z.string()),
  potential_difficulties: z.array(PotentialDifficultySchema),
  teaching_plan: z.array(TeachingStepSchema),
});

export type PotentialDifficulty = z.infer<typeof PotentialDifficultySchema>;
export type TeachingStep = z.infer<typeof TeachingStepSchema>;
export type LessonPlan = z.infer<typeof LessonPlanSchema>;
