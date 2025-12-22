import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import type {
  ITranscriptionProvider,
  TranscriptionOptions,
  TranscriptionResponse,
} from "./interfaces";

/**
 * Azure Speech Services transcription provider.
 * Implements ITranscriptionProvider for Azure Cognitive Services Speech-to-Text.
 */
export class AzureTranscriptionProvider implements ITranscriptionProvider {
  readonly name = "Azure Speech Services";

  private readonly speechKey: string;
  private readonly speechRegion: string;
  private readonly defaultLanguage: string;
  private readonly defaultAdditionalLanguages: string[];

  constructor(config?: {
    speechKey?: string;
    speechRegion?: string;
    defaultLanguage?: string;
    additionalLanguages?: string[];
  }) {
    this.speechKey = config?.speechKey ?? process.env.AZURE_SPEECH_KEY ?? "";
    this.speechRegion =
      config?.speechRegion ?? process.env.AZURE_SPEECH_REGION ?? "";
    this.defaultLanguage = config?.defaultLanguage ?? "pt-BR";
    this.defaultAdditionalLanguages = config?.additionalLanguages ?? ["en-US"];
  }

  /**
   * Check if Azure credentials are properly configured
   */
  isConfigured(): boolean {
    return Boolean(this.speechKey && this.speechRegion);
  }

  /**
   * Transcribe audio buffer to text using Azure Speech Services
   */
  async transcribe(
    audioBuffer: ArrayBuffer,
    options?: TranscriptionOptions
  ): Promise<TranscriptionResponse> {
    if (!this.isConfigured()) {
      return {
        text: "",
        error: "Azure Speech credentials not configured",
      };
    }

    const sampleRate = options?.sampleRate ?? 16000;
    const primaryLanguage = options?.language ?? this.defaultLanguage;
    const additionalLanguages =
      options?.additionalLanguages ?? this.defaultAdditionalLanguages;

    return new Promise((resolve) => {
      const textSegments: string[] = [];

      // Create speech config
      const speechConfig = sdk.SpeechConfig.fromSubscription(
        this.speechKey,
        this.speechRegion
      );
      speechConfig.setProfanity(sdk.ProfanityOption.Raw);

      // Set primary language
      speechConfig.speechRecognitionLanguage = primaryLanguage;

      // Enable continuous language identification for mixed-language utterances
      speechConfig.setProperty(
        sdk.PropertyId.SpeechServiceConnection_LanguageIdMode,
        "Continuous"
      );

      // Explicitly prioritize primary language at the start of recognition
      speechConfig.setProperty(
        "SpeechServiceConnection_AtStartLanguageIdPriority",
        primaryLanguage
      );

      // Set primary language as the priority for single-language segments
      speechConfig.setProperty(
        "SpeechServiceConnection_SingleLanguageIdPriority",
        primaryLanguage
      );

      // Configure auto-detection with all languages
      const allLanguages = [primaryLanguage, ...additionalLanguages];
      const languageConfigs = allLanguages.map((lang) =>
        sdk.SourceLanguageConfig.fromLanguage(lang)
      );
      const autoDetectConfig =
        sdk.AutoDetectSourceLanguageConfig.fromSourceLanguageConfigs(
          languageConfigs
        );

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

        const text = textSegments.join(" ").trim();
        resolve({
          text,
          error: error || undefined,
        });
      };

      // Event: Final recognition results
      recognizer.recognized = (_s, e) => {
        if (
          e.result.reason === sdk.ResultReason.RecognizedSpeech &&
          e.result.text
        ) {
          textSegments.push(e.result.text);
        }
      };

      // Event: Recognition canceled (error or end of stream)
      recognizer.canceled = (_s, e) => {
        if (e.reason === sdk.CancellationReason.Error) {
          console.error(
            `[${this.name}] Transcription error: ${e.errorDetails}`
          );
          resolveResult(e.errorDetails || "Unknown transcription error");
        } else if (e.reason === sdk.CancellationReason.EndOfStream) {
          // Normal end of audio - resolve with collected results
          console.log(`[${this.name}] EndOfStream received - complete`);
          resolveResult();
        }
      };

      // Event: Session stopped
      recognizer.sessionStopped = () => {
        console.log(`[${this.name}] Session stopped - complete`);
        resolveResult();
      };

      // Start continuous recognition
      recognizer.startContinuousRecognitionAsync(
        () => {
          console.log(`[${this.name}] Transcription started`);

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
            `[${this.name}] Audio: ${audioSeconds.toFixed(1)}s, timeout: ${(
              processingTimeout / 1000
            ).toFixed(1)}s`
          );

          // Explicitly stop recognition after processing time
          setTimeout(() => {
            if (!resolved) {
              console.log(
                `[${this.name}] Stopping recognition after processing timeout`
              );
              recognizer.stopContinuousRecognitionAsync(
                () => resolveResult(),
                (err) => {
                  console.error(
                    `[${this.name}] Error stopping recognition:`,
                    err
                  );
                  resolveResult();
                }
              );
            }
          }, processingTimeout);
        },
        (err) => {
          console.error(`[${this.name}] Failed to start transcription:`, err);
          resolveResult(String(err));
        }
      );

      // Hard timeout after 45 seconds as a safety net
      setTimeout(() => {
        if (!resolved) {
          console.error(`[${this.name}] Hard timeout`);
          resolveResult("Transcription timeout");
        }
      }, 45000);
    });
  }
}

/**
 * Default Azure transcription provider instance
 */
export const azureTranscriptionProvider = new AzureTranscriptionProvider();
