import { z } from "zod";

// Helper schemas
const RequirementSchema = z.object({
  requirement: z.string(),
  met: z.boolean(),
  evidence: z.string(),
});

const GoalSchema = z.object({
  goal: z.string(),
  status: z.enum(["not_started", "in_progress", "completed"]),
  progress: z.number().min(0).max(100).nullable(),
  evidence: z.string().nullable(),
});

const OverallAlignmentSchema = z.object({
  relativeToCefr: z.enum(["below", "at", "above"]),
  confidence: z.number().min(0).max(1),
});

const CefrProgressCheckSchema = z.object({
  status: z.enum(["ok", "warning", "error"]),
  requirements: z.array(RequirementSchema),
  goals: z.array(GoalSchema),
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
export type RequirementMet = z.infer<typeof RequirementSchema>;
export type Goal = z.infer<typeof GoalSchema>;
export type OverallAlignment = z.infer<typeof OverallAlignmentSchema>;

// Example usage
const exampleData = {
  evaluation: {
    chapterComprehension: "partial",
    cefrProgressCheck: {
      status: "ok",
      requirements: [
        {
          requirement: "Use basic present-tense sentences",
          met: true,
          evidence: "Learner produced 'Eu vou ao mercado'.",
        },
      ],
      goals: [
        {
          goal: "Say shopping actions in past or present",
          status: "in_progress",
          progress: 65,
          evidence:
            "Learner translated 'I went shopping' as 'Eu fui ao mercado' with minor pronunciation errors.",
        },
        {
          goal: "Say shopping actions in future",
          status: "completed",
          progress: 100,
          evidence:
            "Learner translated 'I will go shopping' as 'Eu vou ao mercado' with minor pronunciation errors.",
        },
        {
          goal: "Say hello to someone",
          status: "not_started",
          progress: 0,
          evidence: null,
        },
      ],
      overallAlignment: {
        relativeToCefr: "at",
        confidence: 0.5,
      },
      alerts: [],
    },
  },
};
