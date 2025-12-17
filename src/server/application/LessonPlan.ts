import { zodTextFormat } from "openai/helpers/zod.mjs";
import {
  CONVERT_LESSON_PLAN_TO_READABLE_FORMAT_PROMPT_ID,
  GRAMMAR_SHEET_RANGE,
  LESSON_PLANNER_PROMPT_ID,
  VOCAB_GRAMMAR_SHEET_ID,
  VOCAB_SHEET_RANGE,
} from "../lib/constants";
import { openai } from "../clients/openai-client";
import { googleSheetsClient } from "../clients/google-sheets";
import {
  GrammarSchema,
  LessonPlanSchema,
  VocabSchema,
  type CleanedGrammar,
  type CleanedVocab,
  type Grammar,
  type Vocab,
} from "../models/LessonPlan";
import { z } from "zod";
import { notionClient } from "../clients/notion-client";

export class LessonPlan {
  public static async generateLessonPLan({
    scripts,
    grammar,
    vocab,
  }: {
    scripts: string[];
    grammar: CleanedGrammar[];
    vocab: CleanedVocab[];
  }) {
    console.log("generateLessonPLan");
    const response = await openai.responses.parse({
      text: {
        format: zodTextFormat(LessonPlanSchema, "lesson_plan"),
      },
      prompt: {
        id: LESSON_PLANNER_PROMPT_ID,
        variables: {
          scripts: scripts.join("\n"),
          grammar: JSON.stringify(grammar),
          vocab: JSON.stringify(vocab),
        },
      },
    });

    console.log("response.output_parsed", response.output_parsed);
    return response.output_parsed;
  }

  public static async convertToReadableFormat({
    lessonPlan,
  }: {
    lessonPlan: LessonPlan;
  }) {
    console.log("convertToReadableFormat");
    console.log(JSON.stringify(lessonPlan, null, 2));
    const response = await openai.responses.create({
      prompt: {
        id: CONVERT_LESSON_PLAN_TO_READABLE_FORMAT_PROMPT_ID,
        variables: {
          lesson_plan_object: JSON.stringify(lessonPlan),
        },
      },
    });
    return response.output_text;
  }

  public static async getChapterGrammar({
    level,
    story,
    chapter,
  }: {
    level: string;
    story: string;
    chapter: string;
  }) {
    const sheet = await googleSheetsClient.getRange(
      VOCAB_GRAMMAR_SHEET_ID,
      GRAMMAR_SHEET_RANGE
    );
    if (!sheet || sheet.length < 2) {
      return [];
    }

    const headers = sheet[0];
    const rows = sheet.slice(1);

    if (!headers) {
      return [];
    }

    // Find column indices for filtering
    const levelIndex = headers.indexOf("level");
    const storyIndex = headers.indexOf("story");
    const chapterIndex = headers.indexOf("chapter");

    const chapterNumber = this.extractChapterNumber(chapter);

    if (!chapterNumber) {
      return [];
    }

    // Filter rows that match the criteria
    const matchingRows = rows.filter((row) => {
      return (
        row[levelIndex] === level &&
        row[storyIndex] === story &&
        row[chapterIndex] === chapterNumber.toString()
      );
    });

    // Convert matching rows to objects using headers as keys
    const rawObjects = matchingRows.map((row) => {
      return headers.reduce((obj, header, index) => {
        const value = row[index];
        obj[header] = value === "" ? null : value;
        return obj;
      }, {} as Record<string, string | null | undefined>);
    });

    // Parse and validate using the schema
    return z.array(GrammarSchema).parse(rawObjects);
  }

  public static async getChapterVocab({
    level,
    story,
    chapter,
  }: {
    level: string;
    story: string;
    chapter: string;
  }) {
    const sheet = await googleSheetsClient.getRange(
      VOCAB_GRAMMAR_SHEET_ID,
      VOCAB_SHEET_RANGE
    );
    if (!sheet || sheet.length < 2) {
      return [];
    }

    const headers = sheet[0];
    const rows = sheet.slice(1);

    if (!headers) {
      return [];
    }

    // Find column indices for filtering
    const levelIndex = headers.indexOf("level");
    const storyIndex = headers.indexOf("story");
    const chapterIndex = headers.indexOf("chapter");

    const chapterNumber = this.extractChapterNumber(chapter);

    if (!chapterNumber) {
      return [];
    }

    // Filter rows that match the criteria
    const matchingRows = rows.filter((row) => {
      return (
        row[levelIndex] === level &&
        row[storyIndex] === story &&
        row[chapterIndex] === chapterNumber.toString()
      );
    });

    // Convert matching rows to objects using headers as keys
    const rawObjects = matchingRows.map((row) => {
      return headers.reduce((obj, header, index) => {
        const value = row[index];
        obj[header] = value === "" ? null : value;
        return obj;
      }, {} as Record<string, string | null | undefined>);
    });

    // Parse and validate using the schema
    return z.array(VocabSchema).parse(rawObjects);
  }

  public static async getChapterLessonPlan({
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
    const lessonPlan = await notionClient.getLessonPlan({
      level,
      story,
      chapter,
      section,
    });
  }

  public static extractChapterNumber(filename: string): number | null {
    const match = filename.match(/-(\d+)-/);
    return match?.[1] ? parseInt(match[1], 10) : null;
  }
}
