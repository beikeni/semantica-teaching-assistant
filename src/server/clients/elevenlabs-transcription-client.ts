import type {
  ITranscriptionProvider,
  TranscriptionOptions,
  TranscriptionResponse,
} from "./interfaces";

/**
 * Available ElevenLabs transcription models
 */
export type ElevenLabsTranscriptionModel =
  | "scribe_v1"
  | "scribe_v1_experimental"
  | "scribe_v2";

/**
 * ElevenLabs Scribe transcription provider.
 * Implements ITranscriptionProvider for ElevenLabs Speech-to-Text API.
 *
 * API Reference: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 */
export class ElevenLabsTranscriptionProvider implements ITranscriptionProvider {
  readonly name = "ElevenLabs Scribe";

  private readonly apiKey: string;
  private readonly model: ElevenLabsTranscriptionModel;
  private readonly defaultLanguage: string | undefined;

  constructor(config?: {
    apiKey?: string;
    model?: ElevenLabsTranscriptionModel;
    defaultLanguage?: string;
  }) {
    this.apiKey = config?.apiKey ?? process.env.ELEVENLABS_API_KEY ?? "";
    this.model = config?.model ?? "scribe_v2";
    this.defaultLanguage = config?.defaultLanguage;
  }

  /**
   * Check if ElevenLabs API key is properly configured
   */
  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  /**
   * Transcribe audio buffer to text using ElevenLabs Speech-to-Text API
   */
  async transcribe(
    audioBuffer: ArrayBuffer,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResponse> {
    if (!this.isConfigured()) {
      console.error(`[${this.name}] API key not configured`);
      return {
        text: "",
        error: "ElevenLabs API key not configured",
      };
    }

    try {
      const sampleRate = options?.sampleRate ?? 16000;
      const language = options?.language ?? this.defaultLanguage;

      console.log(
        `[${this.name}] Starting transcription: ${audioBuffer.byteLength} bytes, ${sampleRate}Hz, model: ${this.model}`
      );

      // Always convert to WAV for maximum compatibility
      // ElevenLabs accepts WAV files at any sample rate
      const wavBuffer = this.pcmToWav(audioBuffer, sampleRate);
      const audioBlob = new Blob([wavBuffer], { type: "audio/wav" });

      console.log(
        `[${this.name}] Converted to WAV: ${wavBuffer.byteLength} bytes`
      );

      // Create form data for multipart request
      const formData = new FormData();
      formData.append("model_id", this.model);
      formData.append("file", audioBlob, "audio.wav");

      // Set language if provided (ISO-639-1 format)
      if (language) {
        const langCode = this.normalizeLanguageCode(language);
        formData.append("language_code", langCode);
        console.log(`[${this.name}] Language: ${langCode}`);
      }

      console.log(`[${this.name}] Sending request to ElevenLabs API...`);

      const response = await fetch(
        "https://api.elevenlabs.io/v1/speech-to-text",
        {
          method: "POST",
          headers: {
            "xi-api-key": this.apiKey,
          },
          body: formData,
        }
      );

      console.log(`[${this.name}] Response status: ${response.status}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[${this.name}] API error response: ${errorText}`);
        throw new Error(
          `ElevenLabs API error (${response.status}): ${errorText}`
        );
      }

      const result = await response.json();
      console.log(
        `[${this.name}] API response:`,
        JSON.stringify(result).slice(0, 200)
      );

      // ElevenLabs returns { text: string, ... }
      const text = result.text ?? "";

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
      console.error(`[${this.name}] Full error:`, err);

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
   * Normalize language code for ElevenLabs API
   * ElevenLabs uses ISO-639-1 or ISO-639-3 codes
   */
  private normalizeLanguageCode(code: string): string {
    // Extract base language code (e.g., "pt-BR" -> "pt")
    const [baseCode] = code.split("-");
    return (baseCode ?? code).toLowerCase();
  }
}

/**
 * Default ElevenLabs transcription provider instance
 */
export const elevenLabsTranscriptionProvider =
  new ElevenLabsTranscriptionProvider();

// Log configuration status on module load
if (elevenLabsTranscriptionProvider.isConfigured()) {
  console.log("📊 ElevenLabs: ✅ API key configured");
} else {
  console.log(
    "📊 ElevenLabs: ⚠️ API key NOT configured (set ELEVENLABS_API_KEY)"
  );
}
