import { openai } from "./openai-client";
import type {
  ITranscriptionProvider,
  TranscriptionOptions,
  TranscriptionResponse,
} from "./interfaces";

/**
 * Available OpenAI transcription models
 */
export type OpenAITranscriptionModel =
  | "whisper-1"
  | "gpt-4o-transcribe"
  | "gpt-4o-mini-transcribe";

/**
 * OpenAI Whisper transcription provider.
 * Implements ITranscriptionProvider for OpenAI's Speech-to-Text API.
 *
 * Supports models:
 * - whisper-1: Original Whisper model
 * - gpt-4o-transcribe: Higher quality GPT-4o based model
 * - gpt-4o-mini-transcribe: Faster, smaller GPT-4o based model
 */
export class OpenAITranscriptionProvider implements ITranscriptionProvider {
  readonly name = "OpenAI Whisper";

  private readonly apiKey: string;
  private readonly model: OpenAITranscriptionModel;
  private readonly defaultLanguage: string | undefined;

  constructor(config?: {
    apiKey?: string;
    model?: OpenAITranscriptionModel;
    defaultLanguage?: string;
  }) {
    this.apiKey = config?.apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = config?.model ?? "gpt-4o-mini-transcribe";
    this.defaultLanguage = config?.defaultLanguage;
  }

  /**
   * Check if OpenAI API key is properly configured
   */
  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Transcribe audio buffer to text using OpenAI's Speech-to-Text API
   */
  async transcribe(
    audioBuffer: ArrayBuffer,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResponse> {
    if (!this.isConfigured()) {
      return {
        text: "",
        error: "OpenAI API key not configured",
      };
    }

    try {
      // Convert ArrayBuffer to a File object
      // OpenAI API expects audio files in formats like mp3, mp4, wav, webm, etc.
      // Since we're receiving raw PCM data, we need to convert it to WAV format
      const wavBuffer = this.pcmToWav(
        audioBuffer,
        options?.sampleRate ?? 16000
      );
      const audioFile = new File([wavBuffer], "audio.wav", {
        type: "audio/wav",
      });

      const language = options?.language ?? this.defaultLanguage;

      console.log(
        `[${this.name}] Transcribing ${audioBuffer.byteLength} bytes with model ${this.model}`
      );

      const transcription = await openai.audio.transcriptions.create({
        model: this.model,
        file: audioFile,
        response_format: "text",
        ...(language && { language: this.normalizeLanguageCode(language) }),
      });

      // The response is just the text when response_format is "text"
      const text =
        typeof transcription === "string"
          ? transcription
          : (transcription as { text: string }).text;

      console.log(
        `[${this.name}] Transcription complete: "${text.slice(0, 50)}${
          text.length > 50 ? "..." : ""
        }"`
      );

      return {
        text: text.trim(),
      };
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Unknown transcription error";
      console.error(`[${this.name}] Transcription error:`, errorMessage);

      return {
        text: "",
        error: errorMessage,
      };
    }
  }

  /**
   * Convert raw PCM audio data to WAV format
   * PCM data is expected to be 16-bit signed integers, mono channel
   */
  private pcmToWav(pcmBuffer: ArrayBuffer, sampleRate: number): ArrayBuffer {
    const pcmData = new Int16Array(pcmBuffer);
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmData.length * 2; // 2 bytes per sample (16-bit)
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);

    // RIFF header
    this.writeString(view, 0, "RIFF");
    view.setUint32(4, totalSize - 8, true); // File size - 8
    this.writeString(view, 8, "WAVE");

    // fmt sub-chunk
    this.writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true); // Sub-chunk size (16 for PCM)
    view.setUint16(20, 1, true); // Audio format (1 = PCM)
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);

    // data sub-chunk
    this.writeString(view, 36, "data");
    view.setUint32(40, dataSize, true);

    // Write PCM samples
    const output = new Int16Array(buffer, headerSize);
    output.set(pcmData);

    return buffer;
  }

  /**
   * Write a string to a DataView at a given offset
   */
  private writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  /**
   * Normalize language code for OpenAI API
   * OpenAI uses ISO 639-1 codes (e.g., "pt" instead of "pt-BR")
   */
  private normalizeLanguageCode(code: string): string {
    // Extract base language code (e.g., "pt-BR" -> "pt")
    const [baseCode] = code.split("-");
    return (baseCode ?? code).toLowerCase();
  }
}

/**
 * Default OpenAI transcription provider instance
 */
export const openAITranscriptionProvider = new OpenAITranscriptionProvider();
