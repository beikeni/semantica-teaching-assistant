import { Client } from "@notionhq/client";
import { openai } from "./openai-client";
import { LESSON_PLANNER_PROMPT_ID } from "../lib/constants";
import { zodTextFormat } from "openai/helpers/zod";
// import { LessonPlanSchema } from "../models/lessonPlan";
import { LessonPlan } from "../application/LessonPlan";

const NOTION_TEXT_LIMIT = 2000;

/** Split text into chunks that fit within Notion's 2000 char limit */
function splitTextIntoChunks(text: string): string[] {
  // First split by paragraphs (double newlines)
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= NOTION_TEXT_LIMIT) {
      chunks.push(paragraph);
    } else {
      // Split long paragraphs by sentences or at limit
      let remaining = paragraph;
      while (remaining.length > NOTION_TEXT_LIMIT) {
        // Try to split at a sentence boundary
        let splitIndex = remaining.lastIndexOf(". ", NOTION_TEXT_LIMIT);
        if (splitIndex === -1 || splitIndex < NOTION_TEXT_LIMIT / 2) {
          // No good sentence boundary, split at word boundary
          splitIndex = remaining.lastIndexOf(" ", NOTION_TEXT_LIMIT);
        }
        if (splitIndex === -1) {
          // No spaces, hard split
          splitIndex = NOTION_TEXT_LIMIT;
        }
        chunks.push(remaining.slice(0, splitIndex + 1).trim());
        remaining = remaining.slice(splitIndex + 1).trim();
      }
      if (remaining) {
        chunks.push(remaining);
      }
    }
  }

  return chunks.filter((chunk) => chunk.length > 0);
}

class NotionClient {
  private readonly client = new Client({
    auth: process.env.NOTION_API_KEY!,
  });
  private readonly databaseId = process.env.NOTION_DATABASE_ID;
  private readonly dataSourceId = process.env.NOTION_DATA_SOURCE_ID!;
  public async getItems() {
    let cursor = undefined;
    const items = [];
    while (true) {
      const datasource = await this.client.dataSources.query({
        data_source_id: this.dataSourceId,
        start_cursor: cursor ?? undefined,
      });

      items.push(...datasource.results);
      if (datasource.has_more) {
        cursor = datasource.next_cursor ?? "";
      } else {
        break;
      }
    }

    return items;
  }

  public async getLessonPlan({
    level,
    story,
    chapter,
    section,
  }: {
    level: string;
    story: string;
    chapter: string;
    section: string;
  }) {
    const datasource = await this.client.dataSources.query({
      data_source_id: this.dataSourceId,
      filter: {
        property: "Lesson/chapter",
        title: {
          equals: `${level}/${story}/${section}/${chapter}`,
        },
      },
    });

    if (datasource.results.length === 0) {
      return null;
    }

    return datasource.results[0];
  }

  public async createLessonPlan({
    level,
    story,
    chapter,
    section,
    lessonPlan,
  }: {
    level: string;
    story: string;
    chapter: string;
    section: string;
    lessonPlan: LessonPlan;
  }) {
    const datasource = await this.client.dataSources.query({
      data_source_id: this.dataSourceId,
      filter: {
        property: "Lesson/chapter",
        title: {
          equals: `${level}/${story}/${section}/${chapter}`,
        },
      },
    });

    if (datasource.results.length > 0) {
      return null;
    }

    const readableLessonPlan = await LessonPlan.convertToReadableFormat({
      lessonPlan,
    });

    // Split content into chunks that fit Notion's 2000 char limit
    const textChunks = splitTextIntoChunks(readableLessonPlan);
    const paragraphBlocks = textChunks.map((chunk) => ({
      type: "paragraph" as const,
      paragraph: {
        rich_text: [
          {
            text: {
              content: chunk,
            },
          },
        ],
      },
    }));

    const page = await this.client.pages.create({
      parent: {
        type: "data_source_id",
        data_source_id: this.dataSourceId,
      },
      properties: {
        "Lesson/chapter": {
          title: [
            {
              text: {
                content: `${level}/${story}/${section}/${chapter}`,
              },
            },
          ],
        },
        "Uploaded date": {
          date: {
            start: new Date().toISOString(),
          },
        },
        Status: {
          status: {
            id: "777fc5ec-d962-4f8d-bce3-59945585923b",
          },
        },
      },
      children: paragraphBlocks,
    });

    return page;
  }

  public async getPage({ id }: { id: string }) {
    return await this.client.pages.retrieve({ page_id: id });
  }
}

export const notionClient = new NotionClient();
