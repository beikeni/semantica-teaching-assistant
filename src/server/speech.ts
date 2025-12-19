import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { ServerWebSocket } from "bun";

// Azure Speech Config from environment (Bun loads .env automatically)
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY ?? "";
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION ?? "";

/**
 * Transcription result from batch audio processing
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
 * Transcribe a complete audio file using Azure Speech SDK.
 * Uses continuous recognition with auto language detection to handle
 * mixed language utterances (pt-BR and en-US).
 */
export async function transcribeAudioFile(
  audioBuffer: ArrayBuffer,
  sampleRate: number = 48000
): Promise<TranscriptionResult> {
  if (!AZURE_SPEECH_KEY || !AZURE_SPEECH_REGION) {
    return {
      success: false,
      text: "",
      segments: [],
      error: "Azure Speech credentials not configured",
    };
  }

  return new Promise((resolve) => {
    const segments: Array<{ text: string; language: string | null }> = [];
    let fullText = "";

    // Create speech config
    const speechConfig = sdk.SpeechConfig.fromSubscription(
      AZURE_SPEECH_KEY,
      AZURE_SPEECH_REGION
    );
    speechConfig.setProfanity(sdk.ProfanityOption.Raw);

    // Set Portuguese as the default/fallback language (prioritized)
    speechConfig.speechRecognitionLanguage = "pt-BR";

    // Enable continuous language identification for mixed-language utterances
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

    // Create recognizer with auto language detection
    const audioConfig = sdk.AudioConfig.fromStreamInput(pushStream);
    const recognizer = sdk.SpeechRecognizer.FromConfig(
      speechConfig,
      autoDetectConfig,
      audioConfig
    );

    // Track if we've resolved to avoid double resolution
    let resolved = false;

    const cleanup = () => {
      try {
        recognizer.close();
        pushStream.close();
      } catch {
        // Ignore cleanup errors
      }
    };

    const resolveResult = (error?: string) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve({
        success: !error,
        text: fullText.trim(),
        segments,
        error,
      });
    };

    // Event: Final recognition results
    recognizer.recognized = (_s, e) => {
      if (
        e.result.reason === sdk.ResultReason.RecognizedSpeech &&
        e.result.text
      ) {
        const autoDetectResult = sdk.AutoDetectSourceLanguageResult.fromResult(
          e.result
        );
        const detectedLanguage = autoDetectResult.language || null;

        segments.push({
          text: e.result.text,
          language: detectedLanguage,
        });
        fullText += (fullText ? " " : "") + e.result.text;
      }
    };

    // Event: Recognition canceled (error or end of stream)
    recognizer.canceled = (_s, e) => {
      if (e.reason === sdk.CancellationReason.Error) {
        console.error(`Speech transcription error: ${e.errorDetails}`);
        resolveResult(e.errorDetails || "Unknown transcription error");
      } else if (e.reason === sdk.CancellationReason.EndOfStream) {
        // Normal end of audio - resolve with collected results
        console.log("✅ EndOfStream received - transcription complete");
        resolveResult();
      }
    };

    // Event: Session stopped
    recognizer.sessionStopped = () => {
      console.log("✅ Session stopped - transcription complete");
      resolveResult();
    };

    // Start continuous recognition
    recognizer.startContinuousRecognitionAsync(
      () => {
        console.log("🎤 Batch transcription started");

        // Write all audio data to the push stream
        pushStream.write(audioBuffer);

        // Signal end of audio stream
        pushStream.close();

        // Calculate expected processing time based on audio length
        // ~2 bytes per sample (16-bit), mono channel
        const audioSeconds = audioBuffer.byteLength / (sampleRate * 2);
        // Allow audio duration + 3 seconds for processing, minimum 5 seconds
        const processingTimeout = Math.max(5000, (audioSeconds + 3) * 1000);

        console.log(
          `📊 Audio: ${audioSeconds.toFixed(1)}s, timeout: ${(
            processingTimeout / 1000
          ).toFixed(1)}s`
        );

        // Explicitly stop recognition after processing time
        // This ensures we don't hang waiting for events that may not fire
        setTimeout(() => {
          if (!resolved) {
            console.log("⏱️ Stopping recognition after processing timeout");
            recognizer.stopContinuousRecognitionAsync(
              () => {
                // stopContinuousRecognitionAsync completed - resolve with results
                resolveResult();
              },
              (err) => {
                console.error("Error stopping recognition:", err);
                resolveResult();
              }
            );
          }
        }, processingTimeout);
      },
      (err) => {
        console.error("Failed to start batch transcription:", err);
        resolveResult(String(err));
      }
    );

    // Hard timeout after 45 seconds as a safety net
    setTimeout(() => {
      if (!resolved) {
        console.error("Batch transcription hard timeout");
        resolveResult("Transcription timeout");
      }
    }, 45000);
  });
}

/**
 * HTTP handler for POST /api/speech/transcribe
 * Accepts WAV audio file and returns transcription
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
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Get sample rate from query params (default 48000)
    const url = new URL(req.url);
    const sampleRate = parseInt(
      url.searchParams.get("sampleRate") ?? "48000",
      10
    );

    // Get audio data from request body
    const audioBuffer = await req.arrayBuffer();

    if (audioBuffer.byteLength === 0) {
      return new Response(JSON.stringify({ error: "No audio data provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(
      `📤 Received audio for transcription: ${audioBuffer.byteLength} bytes, ${sampleRate}Hz`
    );

    // Transcribe the audio
    const result = await transcribeAudioFile(audioBuffer, sampleRate);

    console.log(
      `📝 Transcription result: "${result.text.slice(0, 50)}${
        result.text.length > 50 ? "..." : ""
      }"`
    );

    return new Response(JSON.stringify(result), {
      status: result.success ? 200 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Transcription request error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        text: "",
        segments: [],
        error: err instanceof Error ? err.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
}
