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
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
      className="[&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0 [&_pre]:my-2 [&_pre]:bg-black/10 [&_pre]:p-2 [&_pre]:rounded [&_code]:bg-black/10 [&_code]:px-1 [&_code]:rounded [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-medium [&_a]:text-primary [&_a]:underline"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

const SAMPLE_RATE = 48000;

type SpeechEvent =
  | { event: "recognizing"; text: string }
  | { event: "recognized"; text: string; detectedLanguage?: string }
  | { event: "nomatch" }
  | { event: "canceled"; reason: string; error?: string }
  | { event: "sessionStopped" }
  | { event: "started" }
  | { event: "error"; message: string };

export function SpeechTester() {
  const trpc = useTRPC();
  const store = useConversationStore();
  const [status, setStatusState] = useState<
    "idle" | "recording" | "connecting"
  >("idle");
  const statusRef = useRef<"idle" | "recording" | "connecting">("idle");

  // Wrapper to keep ref in sync with state
  const setStatus = (newStatus: "idle" | "recording" | "connecting") => {
    statusRef.current = newStatus;
    setStatusState(newStatus);
  };

  const [transcript, setTranscript] = useState("");
  const [detectedLanguage, setDetectedLanguage] = useState<string | null>(null);
  const [streamingText, setStreamingText] = useState("");
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [handsOffMode, setHandsOffMode] = useState(false);
  const [autoSendCountdown, setAutoSendCountdown] = useState<number | null>(
    null
  );

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const streamingTextRef = useRef("");
  const handsOffTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTranscriptRef = useRef("");
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

  const cleanupAudio = () => {
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    processorRef.current = null;
    sourceRef.current = null;
    mediaStreamRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
  };

  const stopRecording = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    cleanupAudio();
    setStatus("idle");
  };

  useEffect(() => {
    return () => stopRecording();
  }, []);

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
    // - Currently recording
    // - There's transcript text
    // - Not currently submitting
    // - Transcript has changed (new speech detected)
    if (
      handsOffMode &&
      status === "recording" &&
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
  }, [transcript, handsOffMode, status, store.isSubmitting]);

  const startRecording = async () => {
    // Use ref for synchronous check to handle async restarts properly
    if (statusRef.current !== "idle") return;
    setStatus("connecting");
    setTranscript("");
    setDetectedLanguage(null);

    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, sampleRate: SAMPLE_RATE },
      });
      mediaStreamRef.current = mediaStream;

      const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      audioCtxRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(mediaStream);
      sourceRef.current = source;

      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      // Get base path from current location (e.g., "/sta-demo-3" from "/sta-demo-3/")
      const basePath =
        window.location.pathname
          .replace(/\/$/, "")
          .split("/")
          .slice(0, 2)
          .join("/") || "";
      const wsUrl = `${wsProtocol}//${window.location.host}${basePath}/api/speech/ws?sampleRate=${SAMPLE_RATE}`;
      const ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus("recording");
        processor.onaudioprocess = (event) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const input = event.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const sample = input[i] ?? 0;
            const s = Math.max(-1, Math.min(1, sample));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          ws.send(pcm.buffer);
        };
        source.connect(processor);
        processor.connect(audioCtx.destination);
      };

      ws.onmessage = (event) => {
        try {
          const evt = JSON.parse(event.data) as SpeechEvent;
          if (evt.event === "recognized") {
            setTranscript((prev) => (prev + " " + evt.text).trim());
            if (evt.detectedLanguage) {
              setDetectedLanguage(evt.detectedLanguage);
            }
          }
        } catch {}
      };

      ws.onerror = () => stopRecording();
      ws.onclose = () => {
        cleanupAudio();
        setStatus("idle");
      };
    } catch {
      setStatus("idle");
      cleanupAudio();
    }
  };

  const handleSubmit = async () => {
    if (store.isSubmitting || !canSubmit) return;
    if (!store.level || !store.story || !store.section || !store.chapter)
      return;

    // Track if we should restart recording after (hands-off mode)
    const shouldRestartRecording = handsOffMode && status === "recording";

    // Clear hands-off timeout
    if (handsOffTimeoutRef.current) {
      clearTimeout(handsOffTimeoutRef.current);
      handsOffTimeoutRef.current = null;
    }
    lastTranscriptRef.current = "";

    // Always stop recording during submission to get clean audio boundaries
    stopRecording();

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

    stopRecording();
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

          <label className="flex items-center gap-3 cursor-pointer group">
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
          </label>

          {handsOffMode && status === "recording" && (
            <div className="text-xs text-primary bg-primary/10 rounded-md px-3 py-2 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              Listening... will auto-send on pause
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
              <div className="flex items-center gap-2 flex-1">
                {detectedLanguage && (
                  <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                    {detectedLanguage === "pt-BR"
                      ? "🇧🇷 PT"
                      : detectedLanguage === "en-US"
                      ? "🇺🇸 EN"
                      : detectedLanguage}
                  </span>
                )}
                <p className="text-sm text-muted-foreground">{transcript}</p>
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

        <footer className="border-t p-4">
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
                !store.chapter
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
                  Send
                </>
              )}
            </Button>
          ) : status === "recording" ? (
            <Button
              className="w-full"
              size="lg"
              variant="destructive"
              onClick={stopRecording}
            >
              <Square className="w-4 h-4 mr-2" />
              Stop Recording
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
            <div className="p-4 overflow-y-auto flex-1 space-y-6">
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
                  {/* Chapter Comprehension */}
                  <div className="bg-muted/50 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                        Chapter Comprehension
                      </h4>
                      <span
                        className={`px-3 py-1 rounded-full text-sm font-medium ${
                          evaluationQuery.data.chapterComprehension ===
                          "complete"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : evaluationQuery.data.chapterComprehension ===
                              "partial"
                            ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                            : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                      >
                        {evaluationQuery.data.chapterComprehension ===
                        "complete"
                          ? "✓ Complete"
                          : evaluationQuery.data.chapterComprehension ===
                            "partial"
                          ? "◐ Partial"
                          : "○ None"}
                      </span>
                    </div>
                  </div>

                  {/* CEFR Progress Status */}
                  <div className="bg-muted/50 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide">
                        CEFR Progress Status
                      </h4>
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          evaluationQuery.data.cefrProgressCheck.status === "ok"
                            ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                            : evaluationQuery.data.cefrProgressCheck.status ===
                              "warning"
                            ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400"
                            : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                        }`}
                      >
                        {evaluationQuery.data.cefrProgressCheck.status.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div>
                        <span className="text-muted-foreground">
                          Alignment:{" "}
                        </span>
                        <span className="font-medium capitalize">
                          {
                            evaluationQuery.data.cefrProgressCheck
                              .overallAlignment.relativeToCefr
                          }{" "}
                          CEFR level
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Confidence:{" "}
                        </span>
                        <span className="font-medium">
                          {Math.round(
                            evaluationQuery.data.cefrProgressCheck
                              .overallAlignment.confidence * 100
                          )}
                          %
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Alerts */}
                  {evaluationQuery.data.cefrProgressCheck.alerts.length > 0 && (
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

                  {/* Requirements Met */}
                  <div className="space-y-3">
                    <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                      <Target className="w-4 h-4" />
                      Requirements Assessment
                    </h4>
                    <div className="space-y-2">
                      {evaluationQuery.data.cefrProgressCheck.requirementsMet.map(
                        (req, idx) => (
                          <div
                            key={idx}
                            className={`rounded-lg p-3 border ${
                              req.met
                                ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
                                : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              {req.met ? (
                                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                              ) : (
                                <XCircle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-sm">
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

                  {/* Goals In Progress */}
                  {evaluationQuery.data.cefrProgressCheck.goalsInProgress
                    .length > 0 && (
                    <div className="space-y-3">
                      <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                        <TrendingUp className="w-4 h-4" />
                        Goals In Progress
                      </h4>
                      <div className="space-y-3">
                        {evaluationQuery.data.cefrProgressCheck.goalsInProgress.map(
                          (goal, idx) => (
                            <div
                              key={idx}
                              className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4"
                            >
                              <div className="flex items-start justify-between gap-4 mb-2">
                                <p className="font-medium text-sm flex-1">
                                  {goal.goal}
                                </p>
                                <span className="text-xs px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-200 font-medium whitespace-nowrap">
                                  Step {goal.lastUpdatedStep}
                                </span>
                              </div>
                              <div className="mb-2">
                                <div className="flex items-center justify-between text-xs mb-1">
                                  <span className="text-muted-foreground">
                                    Progress
                                  </span>
                                  <span className="font-medium">
                                    {goal.score}%
                                  </span>
                                </div>
                                <div className="w-full bg-blue-200 dark:bg-blue-900 rounded-full h-2">
                                  <div
                                    className="bg-blue-600 dark:bg-blue-400 h-2 rounded-full transition-all"
                                    style={{ width: `${goal.score}%` }}
                                  />
                                </div>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {goal.evidence}
                              </p>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}

                  {/* Completed Goals */}
                  {evaluationQuery.data.cefrProgressCheck.goalsCompleted
                    .length > 0 && (
                    <div className="space-y-3">
                      <h4 className="font-medium text-sm text-muted-foreground uppercase tracking-wide flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                        Completed Goals
                      </h4>
                      <div className="space-y-2">
                        {evaluationQuery.data.cefrProgressCheck.goalsCompleted.map(
                          (goal, idx) => (
                            <div
                              key={idx}
                              className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3"
                            >
                              <div className="flex items-start gap-2">
                                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="font-medium text-sm">
                                      {goal.goal}
                                    </p>
                                    {goal.progress !== null && (
                                      <span className="text-xs font-medium text-green-700 dark:text-green-300">
                                        {goal.progress}%
                                      </span>
                                    )}
                                  </div>
                                  {goal.evidence && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      {goal.evidence}
                                    </p>
                                  )}
                                  {goal.completedAtStep !== null && (
                                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                                      Completed at step {goal.completedAtStep}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  )}
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
            </div>
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
