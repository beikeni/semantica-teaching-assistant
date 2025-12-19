import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type { ServerWebSocket } from "bun";

// Azure Speech Config from environment (Bun loads .env automatically)
const AZURE_SPEECH_KEY = process.env.AZURE_SPEECH_KEY ?? "";
const AZURE_SPEECH_REGION = process.env.AZURE_SPEECH_REGION ?? "";

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

  // Configure auto-detection for Portuguese (Brazil) and English (US)
  const autoDetectConfig = sdk.AutoDetectSourceLanguageConfig.fromLanguages([
    "pt-BR",
    "en-US",
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
