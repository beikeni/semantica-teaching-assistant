import type { INotionClient } from "../../src/server/clients/interfaces";
import type { LessonPlanType } from "../../src/server/models/LessonPlan";

/**
 * Creates a mock Notion client for testing.
 * Override specific methods to customize behavior for your tests.
 */
export function createMockNotionClient(
  overrides: Partial<INotionClient> = {}
): INotionClient {
  return {
    getItems: async () => {
      return [];
    },

    getLessonPlan: async (_params: {
      level: string;
      story: string;
      chapter: string;
      section: string;
    }) => {
      return null;
    },

    createLessonPlan: async (_params: {
      level: string;
      story: string;
      chapter: string;
      section: string;
      lessonPlan: LessonPlanType;
    }) => {
      // No-op for testing
    },

    getPage: async (_params: { id: string }) => {
      return { id: "mock-page-id", properties: {} };
    },

    ...overrides,
  };
}
