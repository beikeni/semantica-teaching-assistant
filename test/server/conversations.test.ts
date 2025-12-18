/**
 * Integration tests for the conversations endpoint.
 *
 * These tests hit real services (OpenAI, S3, Google Sheets, etc.)
 * and require valid credentials in the environment.
 *
 * Run with: bun test test/server/conversation.test.ts
 */
import { describe, test, expect } from "bun:test";
import { createCaller, createContext } from "../../src/server/router";

// Use real context with actual clients
const ctx = createContext();
const caller = createCaller(ctx);

describe("conversations.streamResponse", () => {
  test("streams responses and yields expected event types", async () => {
    const events: Array<{ type: string; [key: string]: unknown }> = [];

    // // Call the streaming mutation
    // const stream = await caller.conversations.streamResponse({
    //   level: "level-1",
    //   story: "eduardo-e-monica-1",
    //   chapter: "eem1-chapter-01-dialog",
    //   section: "Scripts",
    //   query: "Hello, please start the lesson.",
    //   conversationId: "conv_6943d50d01988196b835c6f2fb4e62790b5b7e3ca93b9962",
    //   userId: "user_123",
    // });
    const stream = await caller.conversations.streamResponse({
      level: "level-3",
      story: "a-virada",
      chapter: "av-chapter-97-dialog",
      section: "Scripts",
      query: "Hello, please start the lesson.",
      conversationId: "conv_6943d50d01988196b835c6f2fb4e62790b5b7e3ca93b9962",
      userId: "user_123",
    });

    // Collect all yielded events
    for await (const event of stream) {
      events.push(event as { type: string; [key: string]: unknown });
      //   console.log("Received event:", event);
    }

    // Verify we received events
    expect(events.length).toBeGreaterThan(0);

    // Verify the first event is a loading status
    expect(events[0]).toEqual({ type: "status", status: "loading" });

    // Verify we received a conversation_id event
    const conversationIdEvent = events.find(
      (e) => e.type === "conversation_id"
    );
    expect(conversationIdEvent).toBeDefined();
    expect(conversationIdEvent?.conversationId).toBeDefined();

    // Verify we received status progression
    const statusEvents = events.filter((e) => e.type === "status");
    const statuses = statusEvents.map((e) => e.status);

    // Should include these statuses in order
    expect(statuses).toContain("loading");
    expect(statuses).toContain("fetching_content");
    expect(statuses).toContain("preparing_lesson");
    expect(statuses).toContain("streaming_response");

    // Check if we got response deltas (streaming text)
    const deltaEvents = events.filter(
      (e) => e.type === "response.output_text.delta"
    );
    console.log(`Received ${deltaEvents.length} text delta events`);

    // The last status should be "done" (unless there was an error)
    const lastStatusEvent = statusEvents[statusEvents.length - 1];
    const hasError = events.some((e) => e.type === "error");

    if (!hasError) {
      expect(lastStatusEvent?.status).toBe("done");
      // Should have received at least some text deltas
      expect(deltaEvents.length).toBeGreaterThan(0);
    }
  }, 120000); // 60 second timeout for API calls
});

// "evaluation": {
//   "chapter_comprehension": "",
//   "CEFR_progress_check": {
//     "status": "",
//     "ingested": {
//       "CEFR_Level": "",
//       "Requirements": [],
//       "Goals": []
//     },
//     "requirements_met": [
//       {
//         "requirement": "",
//         "met": false,
//         "evidence": ""
//       }
//     ],
//     "goals_in_progress": [
//       {
//         "goal": "",
//         "status": "not_started|in_progress|achieved|regressed",
//         "score_0_100": 0,
//         "evidence": "",
//         "last_updated_step": 1
//       }
//     ],
//     "goals_completed": [
//       {
//         "goal": "",
//         "achieved_on_step": 1,
//         "evidence": ""
//       }
//     ],
//     "overall_alignment": {
//       "relative_to_cefr": "below|at|above",
//       "confidence_0_1": 0
//     },
//     "alerts": []
//   }
// },
