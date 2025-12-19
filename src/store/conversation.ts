import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Message = {
  id: string;
  text: string;
  isAgent: boolean;
  timestamp: number;
};

export type ConversationData = {
  conversationId: string;
  level: string;
  story: string;
  chapter: string;
  section: string;
  mode: string;
  messages: Message[];
};

type ConversationState = {
  // Form fields
  learnerId: string;
  level: string;
  story: string;
  chapter: string;
  section: string;
  mode: string;
  lastClientStatus: "" | "Dialogue Reading complete";
  conversationId: string;
  transcriptionLanguage: "pt-BR" | "en-US" | undefined;

  // Saved conversations
  conversations: Record<string, ConversationData>;

  // Chat
  messages: Message[];
  isSubmitting: boolean;

  // Actions
  setLevel: (level: string) => void;
  setStory: (story: string) => void;
  setSection: (section: string) => void;
  setChapter: (chapter: string) => void;
  setLearnerId: (id: string) => void;
  setLastClientStatus: (status: "" | "Dialogue Reading complete") => void;
  setConversationId: (id: string) => void;
  setTranscriptionLanguage: (lang: "pt-BR" | "en-US" | undefined) => void;
  saveConversation: (conversationId: string) => void;
  addMessage: (text: string, isAgent: boolean) => void;
  setIsSubmitting: (v: boolean) => void;
  clearMessages: () => void;
  reset: () => void;
};

export const useConversationStore = create<ConversationState>()(
  persist(
    (set, get) => ({
      learnerId: "L001",
      level: "",
      story: "",
      chapter: "",
      section: "",
      mode: "Teacher[Script]",
      lastClientStatus: "",
      conversationId: "",
      transcriptionLanguage: undefined,
      conversations: {},
      messages: [],
      isSubmitting: false,

      setLevel: (level) => set({ level, story: "", section: "", chapter: "" }),

      setStory: (story) => set({ story, section: "", chapter: "" }),

      setSection: (section) => set({ section, chapter: "" }),

      setChapter: (chapter) => set({ chapter }),

      setLearnerId: (learnerId) => set({ learnerId }),

      setLastClientStatus: (lastClientStatus) => set({ lastClientStatus }),

      setTranscriptionLanguage: (transcriptionLanguage) =>
        set({ transcriptionLanguage }),

      setConversationId: (newConversationId) => {
        const {
          conversationId: currentId,
          conversations,
          messages,
          level,
          story,
          section,
          chapter,
          mode,
        } = get();

        // If setting to the same ID, do nothing
        if (newConversationId === currentId) {
          return;
        }

        // Save current conversation's messages before switching (if we have messages)
        let updatedConversations = { ...conversations };
        if (currentId && messages.length > 0) {
          updatedConversations[currentId] = {
            ...updatedConversations[currentId],
            conversationId: currentId,
            level,
            story,
            section,
            chapter,
            mode,
            messages,
          };
        }

        // Load the new conversation's data (if it exists)
        const conversationData = updatedConversations[newConversationId];
        if (conversationData) {
          // Switching to existing conversation - restore its state
          set({
            conversationId: newConversationId,
            level: conversationData.level,
            story: conversationData.story,
            section: conversationData.section || "",
            chapter: conversationData.chapter,
            mode: conversationData.mode,
            messages: conversationData.messages || [],
            conversations: updatedConversations,
          });
        } else if (newConversationId === "") {
          // Explicitly starting a new conversation - clear messages
          set({
            conversationId: newConversationId,
            messages: [],
            conversations: updatedConversations,
          });
        } else {
          // Assigning ID to current conversation (from server) - keep current messages
          set({
            conversationId: newConversationId,
            conversations: updatedConversations,
          });
        }
      },

      saveConversation: (conversationId) => {
        const {
          level,
          story,
          section,
          chapter,
          mode,
          messages,
          conversations,
        } = get();
        set({
          conversationId,
          conversations: {
            ...conversations,
            [conversationId]: {
              conversationId,
              level,
              story,
              section,
              chapter,
              mode,
              messages,
            },
          },
        });
      },

      addMessage: (text, isAgent) =>
        set((s) => ({
          messages: [
            ...s.messages,
            { id: crypto.randomUUID(), text, isAgent, timestamp: Date.now() },
          ],
        })),

      setIsSubmitting: (isSubmitting) => set({ isSubmitting }),

      clearMessages: () => set({ messages: [] }),

      reset: () =>
        set({
          level: "",
          story: "",
          section: "",
          chapter: "",
          conversationId: "",
          lastClientStatus: "",
          messages: [],
          conversations: {},
        }),
    }),
    { name: "sta-conversation" }
  )
);
