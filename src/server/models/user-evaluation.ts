import { z } from "zod";

// Helper schemas
const RequirementMetSchema = z.object({
  requirement: z.string(),
  met: z.boolean(),
  evidence: z.string(),
});

const GoalInProgressSchema = z.object({
  goal: z.string(),
  status: z.literal("in_progress"),
  score: z.number().min(0).max(100),
  evidence: z.string(),
  lastUpdatedStep: z.number().int().positive(),
});

const GoalCompletedSchema = z.object({
  goal: z.string(),
  status: z.literal("completed"),
  score: z.number().min(0).max(100).nullable(),
  evidence: z.string().nullable(),
  completedAtStep: z.number().int().positive().nullable(),
});

const OverallAlignmentSchema = z.object({
  relativeToCefr: z.enum(["below", "at", "above"]),
  confidence: z.number().min(0).max(1),
});

const IngestedSchema = z.object({
  cefrLevel: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]),
  requirements: z.array(z.string()),
  goals: z.array(z.string()),
});

const CefrProgressCheckSchema = z.object({
  status: z.enum(["ok", "warning", "error"]),
//   ingested: IngestedSchema,
  requirementsMet: z.array(RequirementMetSchema),
  goalsInProgress: z.array(GoalInProgressSchema),
  goalsCompleted: z.array(GoalCompletedSchema),
  overallAlignment: OverallAlignmentSchema,
  alerts: z.array(z.string()),
});

export const UserEvaluationSchema = z.object({
  chapterComprehension: z.enum(["none", "partial", "complete"]),
  cefrProgressCheck: CefrProgressCheckSchema,
});

// Type inference
export type UserEvaluation = z.infer<typeof UserEvaluationSchema>;
export type CEFRProgressCheck = z.infer<typeof CefrProgressCheckSchema>;
export type RequirementMet = z.infer<typeof RequirementMetSchema>;
export type GoalInProgress = z.infer<typeof GoalInProgressSchema>;
export type GoalCompleted = z.infer<typeof GoalCompletedSchema>;
export type OverallAlignment = z.infer<typeof OverallAlignmentSchema>;
export type Ingested = z.infer<typeof IngestedSchema>;

// Example usage
const exampleData = {
  evaluation: {
    chapterComprehension: "partial",
    cefrProgressCheck: {
      status: "ok",
    //   ingested: {
    //     cefrLevel: "A1",
    //     requirements: ["Use basic present-tense sentences"],
    //     goals: ["Say shopping actions in past or present"],
    //   },
      requirementsMet: [
        {
          requirement: "Use basic present-tense sentences",
          met: true,
          evidence: "Learner produced 'Eu vou ao mercado'.",
        },
      ],
      goalsInProgress: [
        {
          goal: "Say shopping actions in past or present",
          status: "in_progress",
          score: 65,
          evidence:
            "Learner translated 'I went shopping' as 'Eu fui ao mercado' with minor pronunciation errors.",
          lastUpdatedStep: 1,
        },
      ],
      goalsCompleted: [],
      overallAlignment: {
        relativeToCefr: "at",
        confidence: 0.5,
      },
      alerts: [],
    },
  },
};
