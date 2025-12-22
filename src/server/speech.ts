import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { ServerWebSocket } from "bun";
import type {
  ITranscriptionProvider,
  TranscriptionOptions,
  TranscriptionResponse,
} from "./clients/interfaces";
import { AzureTranscriptionProvider } from "./clients/azure-transcription-client";
import {
  OpenAITranscriptionProvider,
  type OpenAITranscriptionModel,
} from "./clients/openai-transcription-client";
import {
  ElevenLabsTranscriptionProvider,
  type ElevenLabsTranscriptionModel,
} from "./clients/elevenlabs-transcription-client";

// Re-export types for convenience
export type {
  ITranscriptionProvider,
  TranscriptionOptions,
  TranscriptionResponse,
  OpenAITranscriptionModel,
  ElevenLabsTranscriptionModel,
};
export {
  AzureTranscriptionProvider,
  OpenAITranscriptionProvider,
  ElevenLabsTranscriptionProvider,
};

// Azure Speech Config from environment (Bun loads .env automatically)
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY ?? "";
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION ?? "";

/**
 * @deprecated Use TranscriptionResponse from interfaces instead
 * Kept for backward compatibility with existing code
 */
export interface TranscriptionResult {
  success: boolean;
  text: string;
  segments: Array<{
    text: string;
    language: string | null;
  }>;
  error?: string;
}

// Default transcription provider instance
let transcriptionProvider: ITranscriptionProvider =
  new AzureTranscriptionProvider();

/**
 * Set the transcription provider to use for audio transcription
 * @param provider - Provider implementing ITranscriptionProvider
 */
export function setTranscriptionProvider(
  provider: ITranscriptionProvider
): void {
  transcriptionProvider = provider;
  console.log(`🔄 Transcription provider set to: ${provider.name}`);
}

/**
 * Get the current transcription provider
 */
export function getTranscriptionProvider(): ITranscriptionProvider {
  return transcriptionProvider;
}

// Validate credentials on startup
if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
  console.error(
    "⚠️  Azure Speech credentials not found in environment variables"
  );
  console.error("   Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in .env");
}

/**
 * Speech event types sent to client as JSON
 */
export type SpeechEvent =
  | { event: "recognizing"; text: string }
  | { event: "recognized"; text: string; detectedLanguage?: string }
  | { event: "nomatch" }
  | { event: "canceled"; reason: string; error?: string }
  | { event: "sessionStopped" }
  | { event: "started" }
  | { event: "error"; message: string };

/**
 * WebSocket data attached to each connection
 */
export interface SpeechSocketData {
  sampleRate: number;
  languageCode: string | undefined;
  pushStream: sdk.PushAudioInputStream | null;
  recognizer: sdk.SpeechRecognizer | null;
  cleanedUp: boolean;
}

/**
 * Get speech service status (for tRPC endpoint)
 */
export function getSpeechStatus() {
  return {
    configured: Boolean(AZURE_SPEECH_KEY && AZURE_SPEECH_REGION),
    region: AZURE_SPEECH_REGION || "not configured",
  };
}

/**
 * Initialize speech recognition for a WebSocket connection
 */
function initSpeechRecognition(ws: ServerWebSocket<SpeechSocketData>) {
  const { sampleRate } = ws.data;

  // Create speech config for this session
  const speechConfig = sdk.SpeechConfig.fromSubscription(
    AZURE_SPEECH_KEY,
    AZURE_SPEECH_REGION
  );

  speechConfig.setProfanity(sdk.ProfanityOption.Raw);

  // Set Portuguese as the default/fallback language (prioritized)
  speechConfig.speechRecognitionLanguage = "pt-BR";

  // Enable continuous language identification for mid-session language switching
  speechConfig.setProperty(
    sdk.PropertyId.SpeechServiceConnection_LanguageIdMode,
    "Continuous"
  );

  // Explicitly prioritize Portuguese at the start of recognition
  speechConfig.setProperty(
    "SpeechServiceConnection_AtStartLanguageIdPriority",
    "pt-BR"
  );

  // Set Portuguese as the priority for single-language segments
  speechConfig.setProperty(
    "SpeechServiceConnection_SingleLanguageIdPriority",
    "pt-BR"
  );

  // Configure auto-detection with Portuguese explicitly prioritized
  const ptBRConfig = sdk.SourceLanguageConfig.fromLanguage("pt-BR");
  const enUSConfig = sdk.SourceLanguageConfig.fromLanguage("en-US");
  const autoDetectConfig =
    sdk.AutoDetectSourceLanguageConfig.fromSourceLanguageConfigs([
      ptBRConfig,
      enUSConfig,
    ]);

  // Create push stream for audio input (16-bit PCM, mono)
  const format = sdk.AudioStreamFormat.getWaveFormatPCM(sampleRate, 16, 1);
  const pushStream = sdk.AudioInputStream.createPushStream(format);
  ws.data.pushStream = pushStream;

  // Create recognizer with auto language detection
  const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
  const recognizer = sdk.SpeechRecognizer.FromConfig(
    speechConfig,
    autoDetectConfig,
    audioConfig
  );
  ws.data.recognizer = recognizer;

  const sendEvent = (event: SpeechEvent) => {
    try {
      ws.send(JSON.stringify(event));
    } catch {
      // WebSocket may be closed
    }
  };

  // Event: Interim results (partial recognition as user speaks)
  recognizer.recognizing = (_s, e) => {
    if (e.result.text) {
      sendEvent({ event: "recognizing", text: e.result.text });
    }
  };

  // Event: Final recognition results
  recognizer.recognized = (_s, e) => {
    if (e.result.reason === sdk.ResultReason.RecognizedSpeech) {
      // Get the detected language from auto-detection
      const autoDetectResult = sdk.AutoDetectSourceLanguageResult.fromResult(
        e.result
      );
      const detectedLanguage = autoDetectResult.language;
      sendEvent({
        event: "recognized",
        text: e.result.text,
        detectedLanguage: detectedLanguage || undefined,
      });
    } else if (e.result.reason === sdk.ResultReason.NoMatch) {
      sendEvent({ event: "nomatch" });
    }
  };

  // Event: Recognition canceled (error or end of stream)
  recognizer.canceled = (_s, e) => {
    const reasonMap: Record<number, string> = {
      [sdk.CancellationReason.Error]: "Error",
      [sdk.CancellationReason.EndOfStream]: "EndOfStream",
    };

    const event: SpeechEvent = {
      event: "canceled",
      reason: reasonMap[e.reason] ?? `Unknown(${e.reason})`,
    };

    if (e.reason === sdk.CancellationReason.Error && e.errorDetails) {
      event.error = e.errorDetails;
      console.error(`Speech canceled: ${e.errorDetails}`);
    }

    sendEvent(event);
  };

  // Event: Session stopped
  recognizer.sessionStopped = () => {
    sendEvent({ event: "sessionStopped" });
    cleanupSpeech(ws);
  };

  // Start continuous recognition
  recognizer.startContinuousRecognitionAsync(
    () => {
      console.log("🎤 Speech recognition started");
      sendEvent({ event: "started" });
    },
    (err) => {
      console.error("Failed to start recognition:", err);
      sendEvent({
        event: "canceled",
        reason: "Error",
        error: String(err),
      });
      cleanupSpeech(ws);
    }
  );
}

/**
 * Cleanup speech recognition resources
 */
function cleanupSpeech(ws: ServerWebSocket<SpeechSocketData>) {
  if (ws.data.cleanedUp) return;
  ws.data.cleanedUp = true;

  const { recognizer, pushStream } = ws.data;

  if (recognizer) {
    try {
      recognizer.stopContinuousRecognitionAsync(
        () => recognizer.close(),
        (err) => console.error("Error stopping recognition:", err)
      );
    } catch {
      // Ignore cleanup errors
    }
    ws.data.recognizer = null;
  }

  if (pushStream) {
    try {
      pushStream.close();
    } catch {
      // Ignore cleanup errors
    }
    ws.data.pushStream = null;
  }
}

/**
 * WebSocket handlers for speech recognition
 */
export const speechWebSocket = {
  open(ws: ServerWebSocket<SpeechSocketData>) {
    console.log("🔌 Speech WebSocket connected");

    // Check credentials
    if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
      ws.send(
        JSON.stringify({
          event: "error",
          message: "Azure Speech credentials not configured",
        })
      );
      ws.close(1008, "Azure credentials not configured");
      return;
    }

    // Initialize speech recognition
    initSpeechRecognition(ws);
  },

  message(
    ws: ServerWebSocket<SpeechSocketData>,
    message: string | ArrayBuffer | Buffer
  ) {
    // Handle binary audio data
    if (typeof message !== "string") {
      if (ws.data.pushStream && !ws.data.cleanedUp) {
        let buffer: ArrayBuffer;
        if (message instanceof ArrayBuffer) {
          buffer = message;
        } else {
          // Buffer type
          buffer = message.buffer.slice(
            message.byteOffset,
            message.byteOffset + message.byteLength
          ) as ArrayBuffer;
        }
        ws.data.pushStream.write(buffer);
      }
      return;
    }

    // Handle text commands (e.g., configuration)
    try {
      const cmd = JSON.parse(message);
      if (cmd.type === "config") {
        // Allow runtime config updates
        if (cmd.sampleRate) ws.data.sampleRate = cmd.sampleRate;
        if (cmd.languageCode) ws.data.languageCode = cmd.languageCode;
      }
    } catch {
      // Not JSON, ignore
    }
  },

  close(ws: ServerWebSocket<SpeechSocketData>) {
    console.log("🔌 Speech WebSocket closed");
    cleanupSpeech(ws);
  },
};

/**
 * Transcribe a complete audio file using the configured transcription provider.
 * Uses continuous recognition with auto language detection to handle
 * mixed language utterances (pt-BR and en-US).
 *
 * @param audioBuffer - Raw audio data (PCM 16-bit mono)
 * @param sampleRate - Audio sample rate in Hz (default: 16000)
 * @returns Promise with transcription result
 */
export async function transcribeAudioFile(
  audioBuffer: ArrayBuffer,
  sampleRate: number = 16000
): Promise<TranscriptionResponse> {
  const provider = getTranscriptionProvider();

  if (!provider.isConfigured()) {
    return {
      text: "",
      error: `${provider.name} is not configured`,
    };
  }

  return provider.transcribe(audioBuffer, {
    sampleRate,
    language: "pt-BR",
    additionalLanguages: ["en-US"],
  });
}

/**
 * @deprecated Use transcribeAudioFile which returns TranscriptionResponse
 * Legacy function for backward compatibility
 */
export async function transcribeAudioFileLegacy(
  audioBuffer: ArrayBuffer,
  sampleRate: number = 48000
): Promise<TranscriptionResult> {
  const response = await transcribeAudioFile(audioBuffer, sampleRate);

  return {
    success: !response.error,
    text: response.text,
    segments: response.text ? [{ text: response.text, language: null }] : [],
    error: response.error,
  };
}

/**
 * Available transcription provider types
 */
export type TranscriptionProviderType =
  | "azure"
  | "openai"
  | "openai-whisper"
  | "elevenlabs";

/**
 * Provider instances cache
 */
const providerInstances: Record<
  TranscriptionProviderType,
  ITranscriptionProvider
> = {
  azure: new AzureTranscriptionProvider(),
  openai: new OpenAITranscriptionProvider({ model: "gpt-4o-mini-transcribe" }),
  "openai-whisper": new OpenAITranscriptionProvider({ model: "whisper-1" }),
  elevenlabs: new ElevenLabsTranscriptionProvider(),
};

/**
 * Get a transcription provider by type
 */
export function getProviderByType(
  type: TranscriptionProviderType
): ITranscriptionProvider {
  return providerInstances[type];
}

/**
 * Get list of available providers with their status
 */
export function getAvailableProviders(): Array<{
  id: TranscriptionProviderType;
  name: string;
  configured: boolean;
}> {
  return [
    {
      id: "azure",
      name: "Azure Speech Services",
      configured: providerInstances.azure.isConfigured(),
    },
    {
      id: "openai",
      name: "OpenAI GPT-4o Transcribe",
      configured: providerInstances.openai.isConfigured(),
    },
    {
      id: "openai-whisper",
      name: "OpenAI Whisper",
      configured: providerInstances["openai-whisper"].isConfigured(),
    },
    {
      id: "elevenlabs",
      name: "ElevenLabs Scribe",
      configured: providerInstances.elevenlabs.isConfigured(),
    },
  ];
}

/**
 * HTTP handler for POST /api/speech/transcribe
 * Accepts WAV audio file and returns transcription as simple text
 *
 * Query params:
 * - sampleRate: Audio sample rate in Hz (default: 16000)
 * - provider: Transcription provider to use (azure | openai | openai-whisper)
 */
export async function handleTranscribeRequest(req: Request): Promise<Response> {
  // CORS headers for the response
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ text: "", error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    // Get params from query string
    const url = new URL(req.url);
    const sampleRate = parseInt(
      url.searchParams.get("sampleRate") ?? "16000",
      10
    );
    const providerType = (url.searchParams.get("provider") ??
      "azure") as TranscriptionProviderType;

    // Get the appropriate provider
    const provider = providerInstances[providerType] ?? providerInstances.azure;

    // Get audio data from request body
    const audioBuffer = await req.arrayBuffer();

    if (audioBuffer.byteLength === 0) {
      return new Response(
        JSON.stringify({ text: "", error: "No audio data provided" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!provider.isConfigured()) {
      return new Response(
        JSON.stringify({
          text: "",
          error: `${provider.name} is not configured`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(
      `📤 [${provider.name}] Received audio: ${audioBuffer.byteLength} bytes, ${sampleRate}Hz`
    );

    // Transcribe the audio using the selected provider
    const result = await provider.transcribe(audioBuffer, {
      sampleRate,
      language: "pt-BR",
      additionalLanguages: ["en-US"],
    });

    console.log(
      `📝 [${provider.name}] Result: "${result.text.slice(0, 50)}${
        result.text.length > 50 ? "..." : ""
      }"`
    );

    // Return standardized simple text response
    return new Response(JSON.stringify(result), {
      status: result.error ? 500 : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Transcription request error:", err);
    return new Response(
      JSON.stringify({
        text: "",
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}
