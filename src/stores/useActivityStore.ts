import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { ClaudeEvent } from "@/types/claude-events";

interface SessionActivity {
  events: ClaudeEvent[];
  totalInputTokens: number;
  totalOutputTokens: number;
  filesModified: string[];
}

interface ActivityState {
  sessions: Record<number, SessionActivity>;
  addEvent: (event: ClaudeEvent) => void;
  getSession: (sessionId: number) => SessionActivity;
  clearSession: (sessionId: number) => void;
}

const MAX_EVENTS_PER_SESSION = 500;

function createEmptySession(): SessionActivity {
  return {
    events: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    filesModified: [],
  };
}

export const useActivityStore = create<ActivityState>((set, get) => ({
  sessions: {},

  getSession: (sessionId: number) => {
    return get().sessions[sessionId] ?? createEmptySession();
  },

  addEvent: (event: ClaudeEvent) => {
    set((state) => {
      const sessionId = event.session_id;
      const session = state.sessions[sessionId] ?? createEmptySession();

      // Add event with cap
      const events = [...session.events, event];
      if (events.length > MAX_EVENTS_PER_SESSION) {
        events.splice(0, events.length - MAX_EVENTS_PER_SESSION);
      }

      // Update aggregates
      let { totalInputTokens, totalOutputTokens, filesModified } = session;

      if (event.event_type === "TokenUsageUpdate") {
        totalInputTokens += event.input_tokens;
        totalOutputTokens += event.output_tokens;
      } else if (event.event_type === "FileEdited" || event.event_type === "FileCreated") {
        if (!filesModified.includes(event.file_path)) {
          filesModified = [...filesModified, event.file_path];
        }
      }

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            events,
            totalInputTokens,
            totalOutputTokens,
            filesModified,
          },
        },
      };
    });
  },

  clearSession: (sessionId: number) => {
    set((state) => {
      const { [sessionId]: _, ...rest } = state.sessions;
      return { sessions: rest };
    });
  },
}));

// Global event listener
let unlisten: UnlistenFn | null = null;

export async function initActivityListener(): Promise<void> {
  if (unlisten) return;
  unlisten = await listen<ClaudeEvent>("claude-event", (event) => {
    useActivityStore.getState().addEvent(event.payload);
  });
}

export function stopActivityListener(): void {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}
