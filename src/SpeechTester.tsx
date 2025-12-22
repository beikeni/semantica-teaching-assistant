import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { skipToken, useMutation, useQuery } from "@tanstack/react-query";
import {
  Loader2,
  Mic,
  RefreshCcw,
  Send,
  Square,
  FileText,
  X,
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Target,
  TrendingUp,
  BookOpen,
  GraduationCap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { marked } from "marked";
import { useTRPC } from "./lib/trpc";
import { useConversationStore } from "./store/conversation";

type StreamStatus =
  | "idle"
  | "loading"
  | "fetching_content"
  | "preparing_lesson"
  | "generating_lesson_plan"
  | "streaming_response"
  | "done"
  | "evaluation_complete";

type RecordingStatus = "idle" | "recording" | "transcribing";

/**
 * Available transcription provider types
 */
type TranscriptionProviderType =
  | "azure"
  | "openai"
  | "openai-whisper"
  | "elevenlabs";

/**
 * Provider display information
 */
const TRANSCRIPTION_PROVIDERS: Array<{
  id: TranscriptionProviderType;
  name: string;
  description: string;
}> = [
  {
    id: "azure",
    name: "Azure Speech",
    description: "Microsoft Azure Speech Services",
  },
  {
    id: "openai",
    name: "OpenAI GPT-4o",
    description: "GPT-4o Mini Transcribe",
  },
  {
    id: "openai-whisper",
    name: "OpenAI Whisper",
    description: "Original Whisper model",
  },
  {
    id: "elevenlabs",
    name: "ElevenLabs",
    description: "ElevenLabs Scribe v2",
  },
];

/**
 * Standardized transcription response - simple text output
 */
interface TranscriptionResponse {
  text: string;
  error?: string;
}

// Configure marked for safe rendering
marked.setOptions({
  breaks: true,
  gfm: true,
});

// Markdown renderer component
function Markdown({ content }: { content: string }) {
  const html = useMemo(() => marked.parse(content) as string, [content]);
  return (
    <div
      className="[&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_pre]:my-2 [&_pre]:bg-black/10 [&_pre]:p-2 [&_pre]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:rounded [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-medium [&_a]:text-primary [&_a]:underline [&_table]:w-full [&_table]:my-3 [&_table]:border-collapse [&_table]:text-sm [&_thead]:bg-muted/50 [&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-2 [&_tr:nth-child(even)]:bg-muted/30"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const SAMPLE_RATE = 48000;
const MAX_RECORDING_SECONDS = 30;

// Waveform visualization component
function Waveform({
  analyser,
  isActive,
}: {
  analyser: AnalyserNode | null;
  isActive: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (!analyser || !isActive || !canvasRef.current) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!isActive) return;

      animationRef.current = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      // Clear canvas with transparent background
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw waveform
      ctx.lineWidth = 2;
      ctx.strokeStyle = "hsl(var(--primary))";
      ctx.beginPath();

      const sliceWidth = canvas.width / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray[i] ?? 128) / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [analyser, isActive]);

  return (
    <canvas
      ref={canvasRef}
      width={300}
      height={60}
      className="w-full h-[60px] rounded-md bg-muted/30"
    />
  );
}

// Recording timer display component
function RecordingTimer({
  seconds,
  maxSeconds,
}: {
  seconds: number;
  maxSeconds: number;
}) {
  const remaining = maxSeconds - seconds;
  const progress = (seconds / maxSeconds) * 100;
  const isNearLimit = remaining <= 5;

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-3">
      <div className="relative w-full h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-1000 ease-linear rounded-full ${
            isNearLimit ? "bg-destructive" : "bg-primary"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
      <span
        className={`text-sm font-mono tabular-nums min-w-[48px] text-right ${
          isNearLimit
            ? "text-destructive font-semibold"
            : "text-muted-foreground"
        }`}
      >
        {formatTime(seconds)}
      </span>
    </div>
  );
}

export function SpeechTester() {
  const trpc = useTRPC();
  const store = useConversationStore();

  // Recording state
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus>("idle");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");

  // Streaming/chat state
  const [streamingText, setStreamingText] = useState("");
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [handsOffMode, setHandsOffMode] = useState(false);
  const [autoSendCountdown, setAutoSendCountdown] = useState<number | null>(
    null
  );

  // Transcription provider state
  const [transcriptionProvider, setTranscriptionProvider] =
    useState<TranscriptionProviderType>("azure");

  // Audio recording refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Int16Array[]>([]);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // UI refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingTextRef = useRef("");
  const handsOffTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTranscriptRef = useRef("");

  // Modal state
  const [showTranscriptModal, setShowTranscriptModal] = useState(false);
  const [showEvaluationModal, setShowEvaluationModal] = useState(false);
  const [evaluationUpdated, setEvaluationUpdated] = useState(false);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);

  // tRPC queries for dynamic data using TanStack Query native pattern
  const levelsQuery = useQuery(trpc.s3.getLevels.queryOptions());

  const storiesQuery = useQuery(
    trpc.s3.getLevelStories.queryOptions(
      store.level ? { level: store.level } : skipToken
    )
  );

  const sectionsQuery = useQuery(
    trpc.s3.getStorySections.queryOptions(
      store.level && store.story
        ? { level: store.level, story: store.story }
        : skipToken
    )
  );

  const chaptersQuery = useQuery(
    trpc.s3.getSectionChapters.queryOptions(
      store.level && store.story && store.section
        ? { level: store.level, story: store.story, section: store.section }
        : skipToken
    )
  );

  const lessonCefrLevelQuery = useQuery(
    trpc.lessons.getLessonCefrLevel.queryOptions(
      {
        level: store.level,
        story: store.story,
        section: store.section,
        chapter: store.chapter,
      },
      {
        enabled:
          !!store.level && !!store.story && !!store.section && !!store.chapter,
      }
    )
  );
  console.log("lessonCefrLevelQuery", lessonCefrLevelQuery.data);

  const chapterTextQuery = useQuery(
    trpc.s3.getChapterText.queryOptions(
      store.level && store.story && store.section && store.chapter
        ? {
            level: store.level,
            story: store.story,
            section: store.section,
            chapter: store.chapter,
          }
        : skipToken
    )
  );

  const evaluationQuery = useQuery(
    trpc.evaluations.getEvaluation.queryOptions(
      {
        userId: store.learnerId,
        conversationId: store.conversationId,
      },
      {
        enabled: !!store.learnerId && !!store.conversationId,
      }
    )
  );

  const lessonPlanQuery = useQuery(
    trpc.notion.getLessonPlan.queryOptions(
      store.level && store.story && store.section && store.chapter
        ? {
            level: store.level,
            story: store.story,
            section: store.section,
            chapter: store.chapter,
          }
        : skipToken
    )
  );

  const conversationOptions = Object.entries(store.conversations);

  // Derived loading states for cascading dropdowns
  const isStoriesDisabled = !store.level || storiesQuery.isLoading;
  const isSectionsDisabled =
    !store.story || sectionsQuery.isLoading || isStoriesDisabled;
  const isChaptersDisabled =
    !store.section || chaptersQuery.isLoading || isSectionsDisabled;

  const isDialogueComplete =
    store.lastClientStatus === "Dialogue Reading complete";
  const isChatEmpty = store.messages.length === 0 && !streamingText;
  const canSubmit = isDialogueComplete || transcript.trim() || isChatEmpty;

  // tRPC mutation for sending messages

  const streamResponseMutation = useMutation(
    trpc.conversations.streamResponse.mutationOptions()
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [store.messages, streamingText]);

  // Cleanup audio resources
  const cleanupAudio = useCallback(() => {
    // Stop recording timer
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    // Disconnect audio nodes
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();

    // Stop media stream tracks
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());

    // Close audio context
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close();
    }

    // Clear refs
    processorRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    mediaStreamRef.current = null;
    audioCtxRef.current = null;
  }, []);

  // Send recorded audio to server for transcription
  const transcribeAudio =
    useCallback(async (): Promise<TranscriptionResponse> => {
      const chunks = audioChunksRef.current;
      if (chunks.length === 0) {
        return {
          text: "",
          error: "No audio recorded",
        };
      }

      // Combine all chunks into a single buffer
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combinedBuffer = new Int16Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combinedBuffer.set(chunk, offset);
        offset += chunk.length;
      }

      // Get base path from current location
      const basePath =
        window.location.pathname
          .replace(/\/$/, "")
          .split("/")
          .slice(0, 2)
          .join("/") || "";

      const url = `${window.location.origin}${basePath}/api/speech/transcribe?sampleRate=${SAMPLE_RATE}&provider=${transcriptionProvider}`;

      try {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
          },
          body: combinedBuffer.buffer,
        });

        const result: TranscriptionResponse = await response.json();
        return result;
      } catch (err) {
        return {
          text: "",
          error: err instanceof Error ? err.message : "Network error",
        };
      }
    }, [transcriptionProvider]);

  // Stop recording and transcribe
  const stopRecording = useCallback(async () => {
    if (recordingStatus !== "recording") return;

    setRecordingStatus("transcribing");
    cleanupAudio();

    // Transcribe the recorded audio
    const result = await transcribeAudio();

    if (result.text) {
      setTranscript(result.text);
    } else if (result.error) {
      console.error("Transcription error:", result.error);
    }

    // Clear audio chunks for next recording
    audioChunksRef.current = [];
    setRecordingSeconds(0);
    setRecordingStatus("idle");
  }, [recordingStatus, cleanupAudio, transcribeAudio]);

  // Start recording audio locally
  const startRecording = useCallback(async () => {
    if (recordingStatus !== "idle") return;

    setTranscript("");
    audioChunksRef.current = [];
    setRecordingSeconds(0);

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: SAMPLE_RATE },
      });
      mediaStreamRef.current = mediaStream;

      const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = audioCtx;

      // Create source from microphone
      const source = audioCtx.createMediaStreamSource(mediaStream);
      sourceRef.current = source;

      // Create analyser for waveform visualization
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyserRef.current = analyser;

      // Create processor to capture PCM data
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        const input = event.inputBuffer.getChannelData(0);
        const pcm = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const sample = input[i] ?? 0;
          const s = Math.max(-1, Math.min(1, sample));
          pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        audioChunksRef.current.push(pcm);
      };

      // Connect audio graph: source -> analyser -> processor -> destination
      source.connect(analyser);
      analyser.connect(processor);
      processor.connect(audioCtx.destination);

      setRecordingStatus("recording");

      // Start recording timer
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => {
          const next = prev + 1;
          // Auto-stop at max duration
          if (next >= MAX_RECORDING_SECONDS) {
            stopRecording();
          }
          return next;
        });
      }, 1000);
    } catch (err) {
      console.error("Failed to start recording:", err);
      cleanupAudio();
      setRecordingStatus("idle");
    }
  }, [recordingStatus, cleanupAudio, stopRecording]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupAudio();
      audioChunksRef.current = [];
    };
  }, [cleanupAudio]);

  // Hands-off mode: auto-send after 3 seconds of pause with countdown
  useEffect(() => {
    // Clear any existing timeout
    if (handsOffTimeoutRef.current) {
      clearTimeout(handsOffTimeoutRef.current);
      handsOffTimeoutRef.current = null;
    }
    setAutoSendCountdown(null);

    // Only auto-send if:
    // - Hands-off mode is enabled
    // - Not currently recording
    // - There's transcript text
    // - Not currently submitting
    // - Transcript has changed (new speech detected)
    if (
      handsOffMode &&
      recordingStatus === "idle" &&
      transcript.trim() &&
      !store.isSubmitting &&
      transcript !== lastTranscriptRef.current
    ) {
      lastTranscriptRef.current = transcript;

      // Start countdown
      setAutoSendCountdown(3);

      // Countdown interval
      let countdown = 3;
      const countdownInterval = setInterval(() => {
        countdown -= 1;
        if (countdown > 0) {
          setAutoSendCountdown(countdown);
        } else {
          clearInterval(countdownInterval);
          setAutoSendCountdown(null);
        }
      }, 1000);

      handsOffTimeoutRef.current = setTimeout(() => {
        clearInterval(countdownInterval);
        setAutoSendCountdown(null);
        // Double-check conditions haven't changed
        if (handsOffMode && transcript.trim() && !store.isSubmitting) {
          handleSubmit();
        }
      }, 3000);

      return () => {
        clearInterval(countdownInterval);
        if (handsOffTimeoutRef.current) {
          clearTimeout(handsOffTimeoutRef.current);
          handsOffTimeoutRef.current = null;
        }
        setAutoSendCountdown(null);
      };
    }

    return () => {
      if (handsOffTimeoutRef.current) {
        clearTimeout(handsOffTimeoutRef.current);
        handsOffTimeoutRef.current = null;
      }
    };
  }, [transcript, handsOffMode, recordingStatus, store.isSubmitting]);

  const handleSubmit = async () => {
    if (store.isSubmitting || !canSubmit) return;
    if (!store.level || !store.story || !store.section || !store.chapter)
      return;

    // Track if we should restart recording after (hands-off mode)
    const shouldRestartRecording =
      handsOffMode && recordingStatus === "idle" && transcript.trim();

    // Clear hands-off timeout
    if (handsOffTimeoutRef.current) {
      clearTimeout(handsOffTimeoutRef.current);
      handsOffTimeoutRef.current = null;
    }
    lastTranscriptRef.current = "";

    store.setIsSubmitting(true);
    setStreamStatus("loading");
    setIsWaitingForResponse(true);

    const query = transcript.trim();
    if (query) {
      store.addMessage(query, false);
    } else if (isDialogueComplete) {
      store.addMessage("Dialogue Reading completed", false);
    }
    // Note: When initializing (empty chat), we don't add a user message

    setTranscript("");
    setStreamingText("");
    streamingTextRef.current = "";

    try {
      const result = await streamResponseMutation.mutateAsync({
        level: store.level,
        story: store.story,
        chapter: store.chapter,
        section: store.section,
        query,
        conversationId: store.conversationId || undefined,
        userId: store.learnerId,
      });

      // Handle streaming response from generator mutation
      for await (const chunk of result) {
        if (chunk.type === "status") {
          const status = chunk.status as StreamStatus;
          setStreamStatus(status);

          // When "done" is received, finalize the message and allow recording again
          if (status === "done") {
            // IMPORTANT: Capture and save the message NOW, before enabling the button
            // This prevents a race condition where a new request could clear streamingTextRef
            const finalText = streamingTextRef.current;
            streamingTextRef.current = "";
            setStreamingText("");

            if (finalText) {
              store.addMessage(finalText, true);
              // Save the conversation with all messages after streaming completes
              const conversationId =
                useConversationStore.getState().conversationId;
              if (conversationId) {
                store.saveConversation(conversationId);
              }
            }

            // Now it's safe to enable the button
            setIsWaitingForResponse(false);
            store.setIsSubmitting(false);

            // In hands-off mode, automatically restart recording after response completes
            if (shouldRestartRecording && handsOffMode) {
              setTimeout(() => {
                startRecording();
              }, 300);
            }
          }

          // When evaluation completes, mark it as updated and refetch
          if (status === "evaluation_complete") {
            setEvaluationUpdated(true);
            evaluationQuery.refetch();
          }
        } else if (chunk.type === "conversation_id") {
          // Update conversation ID in real-time (don't save yet - wait until stream completes)
          store.setConversationId(chunk.conversationId);
        } else if (chunk.type === "response.output_text.delta") {
          streamingTextRef.current += chunk.delta;
          setStreamingText(streamingTextRef.current);
        }
      }
    } catch (err) {
      store.addMessage(
        `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
        true
      );
      // On error, allow recording again
      setIsWaitingForResponse(false);
      store.setIsSubmitting(false);
    } finally {
      // Ensure submitting state is cleared (may already be false from "done" status)
      store.setIsSubmitting(false);
      setStreamStatus("idle");
    }
  };

  const handleReset = () => {
    // Clear hands-off timeout
    if (handsOffTimeoutRef.current) {
      clearTimeout(handsOffTimeoutRef.current);
      handsOffTimeoutRef.current = null;
    }
    lastTranscriptRef.current = "";

    // Cleanup audio
    cleanupAudio();
    audioChunksRef.current = [];
    setRecordingStatus("idle");
    setRecordingSeconds(0);
    setTranscript("");
    setStreamingText("");
    streamingTextRef.current = "";
    setStreamStatus("idle");
    setEvaluationUpdated(false);
    setIsWaitingForResponse(false);

    // Clear all localStorage
    localStorage.clear();

    store.reset();
  };

  return (
    <div className="flex h-[calc(100vh-2rem)] max-h-[800px] bg-background border rounded-lg overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 border-r p-4 flex flex-col gap-4 overflow-y-auto bg-muted/30">
        <h1 className="text-lg font-semibold text-primary">STA AI Agent</h1>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground">
            Session Information
          </h2>

          <div className="space-y-1.5">
            <Label>Conversation ID</Label>
            <Select
              value={store.conversationId || "__new__"}
              onValueChange={(v) =>
                store.setConversationId(v === "__new__" ? "" : v)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="New Conversation" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__new__">New Conversation</SelectItem>
                {conversationOptions.map(([id, data]) => (
                  <SelectItem key={id} value={id}>
                    {id.slice(0, 20)}... ({data.level}/{data.story}/
                    {data.chapter})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Learner ID</Label>
            <Input
              value={store.learnerId}
              onChange={(e) => store.setLearnerId(e.target.value)}
            />
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground">
            Content Information
          </h2>

          <div className="space-y-1.5">
            <Label>Level *</Label>
            <Select
              value={store.level}
              onValueChange={store.setLevel}
              disabled={levelsQuery.isLoading}
            >
              <SelectTrigger className="w-full">
                {levelsQuery.isLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  <SelectValue placeholder="Select Level" />
                )}
              </SelectTrigger>
              <SelectContent>
                {(levelsQuery.data ?? [])
                  .filter((l): l is string => !!l)
                  .map((l) => (
                    <SelectItem key={l} value={l}>
                      {l}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Story *</Label>
            <Select
              value={store.story}
              onValueChange={store.setStory}
              disabled={isStoriesDisabled}
            >
              <SelectTrigger className="w-full">
                {storiesQuery.isLoading && store.level ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  <SelectValue placeholder="Select Story" />
                )}
              </SelectTrigger>
              <SelectContent>
                {(storiesQuery.data ?? [])
                  .filter((s): s is string => !!s)
                  .map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Section *</Label>
            <Select
              value={store.section}
              onValueChange={store.setSection}
              disabled={isSectionsDisabled}
            >
              <SelectTrigger className="w-full">
                {sectionsQuery.isLoading && store.story ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  <SelectValue placeholder="Select Section" />
                )}
              </SelectTrigger>
              <SelectContent>
                {(sectionsQuery.data ?? [])
                  .filter((s): s is string => !!s)
                  .map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Chapter *</Label>
            <Select
              value={store.chapter}
              onValueChange={store.setChapter}
              disabled={isChaptersDisabled}
            >
              <SelectTrigger className="w-full">
                {chaptersQuery.isLoading && store.section ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </span>
                ) : (
                  <SelectValue placeholder="Select Chapter" />
                )}
              </SelectTrigger>
              <SelectContent>
                {(chaptersQuery.data ?? [])
                  .filter((c): c is string => !!c)
                  .map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Mode *</Label>
            <Select value={store.mode} onValueChange={() => {}}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Teacher[Script]">Teacher[Script]</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase text-muted-foreground">
            Input Settings
          </h2>

          <div className="space-y-1.5">
            <Label>Transcription Provider</Label>
            <Select
              value={transcriptionProvider}
              onValueChange={(v) =>
                setTranscriptionProvider(v as TranscriptionProviderType)
              }
              disabled={recordingStatus !== "idle"}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select Provider" />
              </SelectTrigger>
              <SelectContent>
                {TRANSCRIPTION_PROVIDERS.map((provider) => (
                  <SelectItem key={provider.id} value={provider.id}>
                    <div className="flex flex-col">
                      <span>{provider.name}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* <p className="text-xs text-muted-foreground">
              {
                TRANSCRIPTION_PROVIDERS.find(
                  (p) => p.id === transcriptionProvider
                )?.description
              }
            </p> */}
          </div>

          {/* <label className="flex items-center gap-3 cursor-pointer group">
            <div className="relative">
              <input
                type="checkbox"
                checked={handsOffMode}
                onChange={(e) => setHandsOffMode(e.target.checked)}
                className="peer sr-only"
              />
              <div className="w-10 h-6 bg-muted rounded-full peer-checked:bg-primary transition-colors" />
              <div className="absolute left-1 top-1 w-4 h-4 bg-background rounded-full shadow-sm transition-transform peer-checked:translate-x-4" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-medium">Hands-off Mode</span>
              <span className="text-xs text-muted-foreground">
                Auto-send after 3s pause
              </span>
            </div>
          </label> */}

          {handsOffMode && recordingStatus === "idle" && transcript.trim() && (
            <div className="text-xs text-primary bg-primary/10 rounded-md px-3 py-2 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              Will auto-send in a moment...
            </div>
          )}
        </section>
      </aside>

      {/* Main chat area */}
      <main className="flex-1 flex flex-col w-full">
        <header className="border-b p-4 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Conversation</h2>
            <span className="text-xs text-muted-foreground">
              {store.conversationId
                ? `ID: ${store.conversationId.slice(0, 12)}...`
                : "New conversation"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowEvaluationModal(true);
                setEvaluationUpdated(false);
              }}
              disabled={!store.conversationId || !store.learnerId}
              className="text-muted-foreground hover:text-primary relative"
            >
              {evaluationQuery.isFetching ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <ClipboardCheck className="w-4 h-4 mr-1" />
              )}
              View Evaluation
              {evaluationUpdated && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-green-500 items-center justify-center text-[10px] text-white font-bold">
                    !
                  </span>
                </span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowTranscriptModal(true)}
              disabled={!store.chapter || chapterTextQuery.isLoading}
              className="text-muted-foreground hover:text-primary"
            >
              {chapterTextQuery.isLoading ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <FileText className="w-4 h-4 mr-1" />
              )}
              View Chapter Transcript
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={store.isSubmitting}
              className="text-muted-foreground hover:text-destructive"
            >
              <RefreshCcw className="w-4 h-4 mr-1" />
              Reset
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {store.messages.length === 0 &&
          !streamingText &&
          !store.isSubmitting ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <div className="text-4xl mb-2">💬</div>
              <p>Select your content and click "Initialize Chat" to begin</p>
            </div>
          ) : (
            <>
              {store.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex ${
                    msg.isAgent ? "justify-start" : "justify-end"
                  }`}
                >
                  <div
                    className={`max-w-[70%] rounded-lg px-4 py-2 ${
                      msg.isAgent
                        ? "bg-muted"
                        : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {msg.isAgent ? <Markdown content={msg.text} /> : msg.text}
                  </div>
                </div>
              ))}
              {streamingText && (
                <div className="flex justify-start">
                  <div className="max-w-[70%] rounded-lg px-4 py-2 bg-muted">
                    <Markdown content={streamingText} />
                  </div>
                </div>
              )}
              {store.isSubmitting && !streamingText && (
                <div className="flex justify-start">
                  <div className="max-w-[70%] rounded-lg px-4 py-2 bg-muted">
                    <div className="flex items-center gap-2">
                      <span className="flex gap-1">
                        <span className="w-2 h-2 bg-current rounded-full animate-bounce [animation-delay:-0.3s]" />
                        <span className="w-2 h-2 bg-current rounded-full animate-bounce [animation-delay:-0.15s]" />
                        <span className="w-2 h-2 bg-current rounded-full animate-bounce" />
                      </span>
                      {streamStatus === "generating_lesson_plan" && (
                        <span className="text-sm text-muted-foreground ml-2">
                          Preparing lesson materials...
                        </span>
                      )}
                      {(streamStatus === "loading" ||
                        streamStatus === "fetching_content" ||
                        streamStatus === "preparing_lesson") && (
                        <span className="text-sm text-muted-foreground ml-2">
                          Teacher is thinking...
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>

        {transcript && (
          <div className="px-4 py-2 border-t bg-muted/30">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <span className="text-sm text-muted-foreground">
                  {transcript}
                </span>
              </div>
              {handsOffMode && autoSendCountdown !== null && (
                <div className="flex items-center gap-2 text-primary">
                  <div className="relative w-6 h-6">
                    <svg className="w-6 h-6 -rotate-90" viewBox="0 0 24 24">
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="2"
                        fill="none"
                        className="opacity-20"
                      />
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="2"
                        fill="none"
                        strokeDasharray={`${
                          (autoSendCountdown / 3) * 62.83
                        } 62.83`}
                        className="transition-all duration-1000"
                      />
                    </svg>
                    <span className="absolute inset-0 flex items-center justify-center text-xs font-medium">
                      {autoSendCountdown}
                    </span>
                  </div>
                  <span className="text-xs font-medium">Auto-sending...</span>
                </div>
              )}
            </div>
          </div>
        )}

        <footer className="border-t p-4 space-y-3">
          {/* Recording UI with waveform and timer */}
          {recordingStatus === "recording" && (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                </span>
                <span className="text-sm font-medium text-red-600 dark:text-red-400">
                  Recording...
                </span>
              </div>
              <Waveform
                analyser={analyserRef.current}
                isActive={recordingStatus === "recording"}
              />
              <RecordingTimer
                seconds={recordingSeconds}
                maxSeconds={MAX_RECORDING_SECONDS}
              />
            </div>
          )}

          {/* Transcribing indicator */}
          {recordingStatus === "transcribing" && (
            <div className="flex items-center justify-center gap-2 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">
                Transcribing audio...
              </span>
            </div>
          )}

          {/* Action buttons */}
          {isChatEmpty ? (
            <Button
              className="w-full"
              size="lg"
              onClick={handleSubmit}
              disabled={
                store.isSubmitting ||
                !store.level ||
                !store.story ||
                !store.section ||
                !store.chapter ||
                recordingStatus !== "idle"
              }
            >
              {store.isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Initializing...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Initialize Chat
                </>
              )}
            </Button>
          ) : isDialogueComplete ? (
            <Button
              className="w-full"
              size="lg"
              onClick={handleSubmit}
              disabled={
                store.isSubmitting ||
                isWaitingForResponse ||
                recordingStatus !== "idle"
              }
            >
              {isWaitingForResponse ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Waiting for response...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4 mr-2" />
                  Send
                </>
              )}
            </Button>
          ) : recordingStatus === "recording" ? (
            <Button
              className="w-full"
              size="lg"
              variant="destructive"
              onClick={stopRecording}
            >
              <Square className="w-4 h-4 mr-2" />
              Stop Recording
            </Button>
          ) : recordingStatus === "transcribing" ? (
            <Button className="w-full" size="lg" disabled>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Processing...
            </Button>
          ) : transcript ? (
            <div className="flex gap-2">
              <Button
                className="flex-1"
                size="lg"
                onClick={handleSubmit}
                disabled={store.isSubmitting || isWaitingForResponse}
              >
                {isWaitingForResponse ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Waiting for response...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Send Message
                  </>
                )}
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={startRecording}
                disabled={store.isSubmitting || isWaitingForResponse}
              >
                <Mic className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <Button
              className="w-full"
              size="lg"
              onClick={startRecording}
              disabled={
                store.isSubmitting ||
                isWaitingForResponse ||
                !store.level ||
                !store.story ||
                !store.section ||
                !store.chapter
              }
            >
              {isWaitingForResponse ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Waiting for response...
                </>
              ) : (
                <>
                  <Mic className="w-4 h-4 mr-2" />
                  Record Message
                </>
              )}
            </Button>
          )}
        </footer>
      </main>

      {/* Transcript Modal */}
      {showTranscriptModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <h3 className="font-semibold text-lg">Lesson Transcript</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowTranscriptModal(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {chapterTextQuery.isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : chapterTextQuery.error ? (
                <p className="text-destructive">
                  Error loading transcript: {chapterTextQuery.error.message}
                </p>
              ) : chapterTextQuery.data ? (
                <pre className="whitespace-pre-wrap text-sm font-mono bg-muted p-4 rounded-lg">
                  {chapterTextQuery.data}
                </pre>
              ) : (
                <p className="text-muted-foreground">No transcript available</p>
              )}
            </div>
            <div className="p-4 border-t flex justify-end">
              <Button
                variant="outline"
                onClick={() => setShowTranscriptModal(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Evaluation Modal */}
      {showEvaluationModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="w-5 h-5 text-primary" />
                <h3 className="font-semibold text-lg">Learner Evaluation</h3>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowEvaluationModal(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <Tabs
              defaultValue="cefr"
              className="flex-1 flex flex-col overflow-hidden"
            >
              <TabsList className="mx-4 mt-4 w-fit">
                <TabsTrigger value="cefr" className="gap-2">
                  <GraduationCap className="w-4 h-4" />
                  CEFR Evaluation
                </TabsTrigger>
                <TabsTrigger value="lesson-plan" className="gap-2">
                  <BookOpen className="w-4 h-4" />
                  Lesson Plan
                </TabsTrigger>
              </TabsList>

              {/* CEFR Evaluation Tab */}
              <TabsContent
                value="cefr"
                className="flex-1 overflow-y-auto p-4 space-y-6"
              >
                {evaluationQuery.isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : evaluationQuery.error ? (
                  <p className="text-destructive">
                    Error loading evaluation: {evaluationQuery.error.message}
                  </p>
                ) : evaluationQuery.data ? (
                  <>
                    {/* Progress Overview Panel */}
                    <div className="bg-muted/50 rounded-lg p-4">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        {/* CEFR Level */}
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                            CEFR Level
                          </span>
                          <span className="text-xl font-bold text-primary">
                            {lessonCefrLevelQuery.data
                              ? String(lessonCefrLevelQuery.data)
                              : "—"}
                          </span>
                        </div>

                        {/* Comprehension */}
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                            Comprehension
                          </span>
                          <span
                            className={`text-sm font-semibold ${
                              evaluationQuery.data.chapterComprehension ===
                              "complete"
                                ? "text-green-600 dark:text-green-400"
                                : evaluationQuery.data.chapterComprehension ===
                                  "partial"
                                ? "text-yellow-600 dark:text-yellow-400"
                                : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            {evaluationQuery.data.chapterComprehension ===
                            "complete"
                              ? "Complete"
                              : evaluationQuery.data.chapterComprehension ===
                                "partial"
                              ? "Partial"
                              : "None"}
                          </span>
                        </div>

                        {/* Student Alignment */}
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                            Alignment
                          </span>
                          <span
                            className={`text-sm font-semibold ${
                              evaluationQuery.data.cefrProgressCheck
                                .overallAlignment.relativeToCefr === "at"
                                ? "text-green-600 dark:text-green-400"
                                : evaluationQuery.data.cefrProgressCheck
                                    .overallAlignment.relativeToCefr === "above"
                                ? "text-blue-600 dark:text-blue-400"
                                : "text-yellow-600 dark:text-yellow-400"
                            }`}
                          >
                            {evaluationQuery.data.cefrProgressCheck
                              .overallAlignment.relativeToCefr === "at"
                              ? "At CEFR level"
                              : evaluationQuery.data.cefrProgressCheck
                                  .overallAlignment.relativeToCefr === "above"
                              ? "Above CEFR level"
                              : "Below CEFR level"}
                          </span>
                        </div>

                        {/* Status */}
                        <div className="flex flex-col">
                          <span className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                            Status
                          </span>
                          <span
                            className={`text-sm font-semibold ${
                              evaluationQuery.data.cefrProgressCheck.status ===
                              "ok"
                                ? "text-green-600 dark:text-green-400"
                                : evaluationQuery.data.cefrProgressCheck
                                    .status === "warning"
                                ? "text-yellow-600 dark:text-yellow-400"
                                : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            {evaluationQuery.data.cefrProgressCheck.status ===
                            "ok"
                              ? "OK"
                              : evaluationQuery.data.cefrProgressCheck
                                  .status === "warning"
                              ? "Warning"
                              : "Error"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Alerts */}
                    {evaluationQuery.data.cefrProgressCheck.alerts.length >
                      0 && (
                      <div className="space-y-2">
                        <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 text-yellow-500" />
                          Alerts
                        </h4>
                        <div className="space-y-2">
                          {evaluationQuery.data.cefrProgressCheck.alerts.map(
                            (alert, idx) => (
                              <div
                                key={idx}
                                className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 text-sm text-yellow-800 dark:text-yellow-200"
                              >
                                {alert}
                              </div>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {/* Requirements - Grey when not met, Green when met */}
                    <div className="space-y-3">
                      <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        CEFR Requirements
                      </h4>
                      <div className="space-y-2">
                        {evaluationQuery.data.cefrProgressCheck.requirements.map(
                          (req, idx) => (
                            <div
                              key={idx}
                              className={`rounded-lg p-3 border transition-colors ${
                                req.met
                                  ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                                  : "bg-muted/30 border-muted-foreground/20"
                              }`}
                            >
                              <div className="flex items-start gap-2">
                                {req.met ? (
                                  <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                                ) : (
                                  <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 shrink-0 mt-0.5" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p
                                    className={`font-medium text-sm ${
                                      !req.met ? "text-muted-foreground" : ""
                                    }`}
                                  >
                                    {req.requirement}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {req.evidence}
                                  </p>
                                </div>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>

                    {/* Goals Section - Combined view with all goal states */}
                    <div className="space-y-3">
                      <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        CEFR Goals
                      </h4>
                      <div className="space-y-3">
                        {evaluationQuery.data.cefrProgressCheck.goals.map(
                          (goal, idx) => {
                            // Completed Goals - Green
                            if (goal.status === "completed") {
                              return (
                                <div
                                  key={idx}
                                  className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4"
                                >
                                  <div className="flex items-start gap-3">
                                    <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-center justify-between gap-2 mb-2">
                                        <p className="font-medium text-sm text-green-800 dark:text-green-200">
                                          {goal.goal}
                                        </p>
                                        <span className="text-xs px-2 py-1 rounded-full bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-200 font-medium whitespace-nowrap">
                                          ✓ Complete
                                        </span>
                                      </div>
                                      {/* Progress bar at 100% for completed goals */}
                                      <div className="mb-2">
                                        <div className="w-full bg-green-200 dark:bg-green-900 rounded-full h-2">
                                          <div
                                            className="bg-green-600 dark:bg-green-400 h-2 rounded-full"
                                            style={{ width: "100%" }}
                                          />
                                        </div>
                                      </div>
                                      {goal.evidence && (
                                        <p className="text-xs text-green-700 dark:text-green-300">
                                          {goal.evidence}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            // In Progress Goals - Blue with progress bar
                            if (goal.status === "in_progress") {
                              return (
                                <div
                                  key={idx}
                                  className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4"
                                >
                                  <div className="flex items-start gap-3">
                                    <div className="w-5 h-5 rounded-full border-2 border-blue-500 border-t-transparent animate-spin shrink-0 mt-0.5" />
                                    <div className="flex-1 min-w-0">
                                      <div className="flex items-start justify-between gap-4 mb-2">
                                        <p className="font-medium text-sm text-blue-800 dark:text-blue-200">
                                          {goal.goal}
                                        </p>
                                        <span className="text-xs px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 font-medium whitespace-nowrap">
                                          In Progress
                                        </span>
                                      </div>
                                      <div className="mb-2">
                                        <div className="flex items-center justify-between text-xs mb-1">
                                          <span className="text-blue-600 dark:text-blue-300">
                                            Progress
                                          </span>
                                          <span className="font-medium text-blue-700 dark:text-blue-200">
                                            {goal.progress ?? 0}%
                                          </span>
                                        </div>
                                        <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2">
                                          <div
                                            className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all"
                                            style={{
                                              width: `${goal.progress ?? 0}%`,
                                            }}
                                          />
                                        </div>
                                      </div>
                                      {goal.evidence && (
                                        <p className="text-xs text-blue-600 dark:text-blue-300">
                                          {goal.evidence}
                                        </p>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            }

                            // Not Started Goals - Grey
                            return (
                              <div
                                key={idx}
                                className="bg-muted/30 border border-muted-foreground/20 rounded-lg p-4"
                              >
                                <div className="flex items-start gap-3">
                                  <div className="w-5 h-5 rounded-full border-2 border-muted-foreground/30 shrink-0 mt-0.5" />
                                  <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm text-muted-foreground">
                                      {goal.goal}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <ClipboardCheck className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No evaluation data available yet.</p>
                    <p className="text-sm mt-1">
                      Complete some lesson activities to see your progress.
                    </p>
                  </div>
                )}
              </TabsContent>

              {/* Lesson Plan Tab */}
              <TabsContent
                value="lesson-plan"
                className="flex-1 overflow-y-auto p-4"
              >
                {lessonPlanQuery.isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                  </div>
                ) : lessonPlanQuery.error ? (
                  <p className="text-destructive">
                    Error loading lesson plan: {lessonPlanQuery.error.message}
                  </p>
                ) : lessonPlanQuery.data ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <Markdown content={lessonPlanQuery.data} />
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <BookOpen className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>No lesson plan available yet.</p>
                    <p className="text-sm mt-1">
                      Select a chapter and start the lesson to generate a lesson
                      plan.
                    </p>
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <div className="p-4 border-t flex justify-end">
              <Button
                variant="outline"
                onClick={() => setShowEvaluationModal(false)}
              >
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
