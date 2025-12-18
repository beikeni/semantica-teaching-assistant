import type { IS3Manager } from "../../src/server/clients/interfaces";

/**
 * Creates a mock S3 manager for testing.
 * Override specific methods to customize behavior for your tests.
 */
export function createMockS3Manager(
  overrides: Partial<IS3Manager> = {}
): IS3Manager {
  return {
    getLevels: async () => {
      return ["level-1", "level-2", "level-3"];
    },

    getLevelStories: async (_params: { level: string }) => {
      return ["story-1", "story-2"];
    },

    getStorySections: async (_params: { level: string; story: string }) => {
      return ["section-1", "section-2"];
    },

    getSectionChapters: async (_params: {
      level: string;
      story: string;
      section: string;
    }) => {
      return ["chapter-1", "chapter-2"];
    },

    getChapterText: async (_params: {
      level: string;
      story: string;
      section: string;
      chapter: string;
    }) => {
      return "Mock chapter text content for testing purposes.";
    },

    ...overrides,
  };
}
