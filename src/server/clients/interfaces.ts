import type { LessonPlanType } from "../models/LessonPlan";
import type { RangeValues, SheetRange, SpreadsheetInfo } from "./google-sheets";

/**
 * Standardized transcription response - simple text output
 */
export interface TranscriptionResponse {
  /** The transcribed text */
  text: string;
  /** Error message if transcription failed */
  error?: string;
}

/**
 * Configuration options for transcription
 */
export interface TranscriptionOptions {
  /** Audio sample rate in Hz (default: 16000) */
  sampleRate?: number;
  /** Primary language code (e.g., "pt-BR", "en-US") */
  language?: string;
  /** Additional languages for auto-detection */
  additionalLanguages?: string[];
}

/**
 * Transcription provider interface for audio-to-text conversion.
 * Implementations should return standardized simple text responses.
 */
export interface ITranscriptionProvider {
  /**
   * Transcribe audio buffer to text
   * @param audioBuffer - Raw audio data (PCM 16-bit mono)
   * @param options - Transcription configuration options
   * @returns Promise with transcribed text or error
   */
  transcribe(
    audioBuffer: ArrayBuffer,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResponse>;

  /**
   * Check if the provider is properly configured
   * @returns true if credentials and configuration are valid
   */
  isConfigured(): boolean;

  /**
   * Get provider name for logging/debugging
   */
  readonly name: string;
}

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
