import type { LessonPlanType } from "../models/LessonPlan";
import type { RangeValues, SheetRange, SpreadsheetInfo } from "./google-sheets";

export interface IGoogleSheetsClient {
  getRange: (
    spreadsheetId: string,
    range: string
  ) => Promise<string[][] | null>;
  getRangesFromMultipleSheets: (
    requests: SheetRange[]
  ) => Promise<RangeValues[]>;
  getSpreadsheetInfo: (spreadsheetId: string) => Promise<SpreadsheetInfo>;
}

export interface INotionClient {
  getItems: () => Promise<any[]>;
  getLessonPlan: ({
    level,
    story,
    chapter,
    section,
  }: {
    level: string;
    story: string;
    chapter: string;
    section: string;
  }) => Promise<string | null>;
  storeLessonPlan: ({
    level,
    story,
    chapter,
    section,
    markdownLessonPlan,
  }: {
    level: string;
    story: string;
    chapter: string;
    section: string;
    markdownLessonPlan: string;
  }) => Promise<void>;
  getPage: ({ id }: { id: string }) => Promise<any>;
}

export interface IMakeClient {
  setRecord: ({ key, value }: { key: string; value: string }) => Promise<void>;
  getRecord: ({ key }: { key: string }) => Promise<any>;
}
export interface IS3Manager {
  getLevels: () => Promise<string[]>;
  getLevelStories: ({ level }: { level: string }) => Promise<string[]>;
  getStorySections: ({
    level,
    story,
  }: {
    level: string;
    story: string;
  }) => Promise<string[]>;
  getSectionChapters: ({
    level,
    story,
    section,
  }: {
    level: string;
    story: string;
    section: string;
  }) => Promise<string[]>;
  getChapterText: ({
    level,
    story,
    section,
    chapter,
  }: {
    level: string;
    story: string;
    section: string;
    chapter: string;
  }) => Promise<string>;
}
