/**
 * tRPC Integration Tests
 *
 * These tests use Bun's test runner with tRPC's createCallerFactory
 * to test procedures directly without HTTP overhead.
 *
 * @see https://trpc.io/docs/server/server-side-calls
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { createTestCaller, createTestContext } from "../utils";
import { clearMockMakeStore } from "../mocks";

describe("tRPC API Integration Tests", () => {
  beforeEach(() => {
    // Clear any shared mock state between tests
    clearMockMakeStore();
  });

  describe("s3Router", () => {
    test("getLevels returns available levels", async () => {
      const caller = createTestCaller();

      const levels = await caller.s3.getLevels();

      expect(levels).toEqual(["level-1", "level-2", "level-3"]);
    });

    test("getLevels with custom mock returns custom data", async () => {
      const caller = createTestCaller({
        s3Manager: {
          getLevels: async () => ["beginner", "intermediate", "advanced"],
        },
      });

      const levels = await caller.s3.getLevels();

      expect(levels).toEqual(["beginner", "intermediate", "advanced"]);
    });

    test("getLevelStories returns stories for a level", async () => {
      const caller = createTestCaller();

      const stories = await caller.s3.getLevelStories({ level: "level-1" });

      expect(stories).toEqual(["story-1", "story-2"]);
    });

    test("getLevelStories with custom mock captures input", async () => {
      let capturedLevel = "";

      const caller = createTestCaller({
        s3Manager: {
          getLevelStories: async ({ level }) => {
            capturedLevel = level;
            return ["custom-story"];
          },
        },
      });

      const stories = await caller.s3.getLevelStories({ level: "advanced" });

      expect(capturedLevel).toBe("advanced");
      expect(stories).toEqual(["custom-story"]);
    });

    test("getStorySections returns sections for a story", async () => {
      const caller = createTestCaller();

      const sections = await caller.s3.getStorySections({
        level: "level-1",
        story: "story-1",
      });

      expect(sections).toEqual(["section-1", "section-2"]);
    });

    test("getSectionChapters returns chapters for a section", async () => {
      const caller = createTestCaller();

      const chapters = await caller.s3.getSectionChapters({
        level: "level-1",
        story: "story-1",
        section: "section-1",
      });

      expect(chapters).toEqual(["chapter-1", "chapter-2"]);
    });

    test("getChapterText returns chapter content", async () => {
      const caller = createTestCaller();

      const text = await caller.s3.getChapterText({
        level: "level-1",
        story: "story-1",
        section: "section-1",
        chapter: "chapter-1",
      });

      expect(text).toBe("Mock chapter text content for testing purposes.");
    });

    test("getChapterText with custom content", async () => {
      const customText = `
        Maria: Olá! Como você está?
        João: Estou bem, obrigado!
      `;

      const caller = createTestCaller({
        s3Manager: {
          getChapterText: async () => customText,
        },
      });

      const text = await caller.s3.getChapterText({
        level: "level-1",
        story: "story-1",
        section: "section-1",
        chapter: "chapter-1",
      });

      expect(text).toContain("Maria:");
      expect(text).toContain("João:");
    });
  });

  describe("Context injection", () => {
    test("createTestContext creates valid context with all mocks", () => {
      const ctx = createTestContext();

      expect(ctx.googleSheetsClient).toBeDefined();
      expect(ctx.notionClient).toBeDefined();
      expect(ctx.s3Manager).toBeDefined();
      expect(ctx.makeClient).toBeDefined();
    });

    test("createTestContext allows partial overrides", () => {
      let called = false;

      const ctx = createTestContext({
        s3Manager: {
          getLevels: async () => {
            called = true;
            return ["overridden"];
          },
        },
      });

      // Other clients should still work with defaults
      expect(ctx.googleSheetsClient.getRange).toBeDefined();
      expect(ctx.notionClient.getItems).toBeDefined();
    });
  });

  describe("Error handling", () => {
    test("procedure throws when mock throws", async () => {
      const caller = createTestCaller({
        s3Manager: {
          getLevels: async () => {
            throw new Error("S3 connection failed");
          },
        },
      });

      expect(caller.s3.getLevels()).rejects.toThrow("S3 connection failed");
    });
  });
});

/**
 * Example of testing input validation.
 * tRPC uses Zod schemas for input validation.
 */
describe("Input validation", () => {
  test("getLevelStories requires level parameter", async () => {
    const caller = createTestCaller();

    // @ts-expect-error - Testing invalid input at runtime
    expect(caller.s3.getLevelStories({})).rejects.toThrow();
  });

  test("getChapterText requires all parameters", async () => {
    const caller = createTestCaller();

    // @ts-expect-error - Testing invalid input at runtime
    expect(caller.s3.getChapterText({ level: "1" })).rejects.toThrow();
  });
});
