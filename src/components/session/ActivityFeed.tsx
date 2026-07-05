import { useEffect, useRef } from "react";
import { useActivityStore } from "@/stores/useActivityStore";
import type { ClaudeEvent } from "@/types/claude-events";

interface ActivityFeedProps {
  sessionId: number;
  maxHeight?: string;
}

export function ActivityFeed({ sessionId, maxHeight = "300px" }: ActivityFeedProps) {
  const session = useActivityStore((state) => state.getSession(sessionId));
  const bottomRef = useRef<HTMLDivElement>(null);
  const eventCount = session.events.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: only the event count should trigger auto-scroll.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [eventCount]);

  return (
    <div
      style={{ maxHeight, overflow: "auto" }}
      className="font-mono text-xs space-y-0.5 p-2 bg-neutral-900/50 rounded border border-neutral-800"
    >
      {session.events.length === 0 && (
        <div className="text-neutral-500 italic text-center py-2">
          Waiting for session activity...
        </div>
      )}
      {session.events.map((event) => (
        <EventRow
          key={`${event.timestamp}-${event.event_type}-${JSON.stringify(event)}`}
          event={event}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function EventRow({ event }: { event: ClaudeEvent }) {
  const time = formatTime(event.timestamp);

  switch (event.event_type) {
    case "ToolUseStarted":
      return (
        <div className="flex gap-2 text-blue-400">
          <span className="text-neutral-600 shrink-0">{time}</span>
          <span className="font-semibold shrink-0">{event.tool_name}</span>
          <span className="text-neutral-400 truncate">{event.input_summary}</span>
        </div>
      );
    case "FileEdited":
      return (
        <div className="flex gap-2 text-yellow-400">
          <span className="text-neutral-600 shrink-0">{time}</span>
          <span className="shrink-0">EDIT</span>
          <span className="truncate">{event.file_path}</span>
        </div>
      );
    case "FileCreated":
      return (
        <div className="flex gap-2 text-green-400">
          <span className="text-neutral-600 shrink-0">{time}</span>
          <span className="shrink-0">CREATE</span>
          <span className="truncate">{event.file_path}</span>
        </div>
      );
    case "SubagentSpawned":
      return (
        <div className="flex gap-2 text-purple-400">
          <span className="text-neutral-600 shrink-0">{time}</span>
          <span className="shrink-0">AGENT</span>
          <span className="font-semibold">{event.agent_type}</span>
          <span className="text-neutral-400 truncate">{event.description}</span>
        </div>
      );
    case "TokenUsageUpdate":
      return (
        <div className="flex gap-2 text-neutral-500">
          <span className="text-neutral-600 shrink-0">{time}</span>
          <span>
            {event.input_tokens.toLocaleString()}in / {event.output_tokens.toLocaleString()}out
          </span>
        </div>
      );
    case "SessionStarted":
      return (
        <div className="flex gap-2 text-green-300">
          <span className="text-neutral-600 shrink-0">{time}</span>
          <span className="font-semibold">SESSION STARTED</span>
        </div>
      );
    case "SessionEnded":
      return (
        <div className="flex gap-2 text-red-300">
          <span className="text-neutral-600 shrink-0">{time}</span>
          <span className="font-semibold">SESSION ENDED</span>
          <span className="text-neutral-400">{event.reason}</span>
        </div>
      );
    default:
      return null;
  }
}

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return timestamp;
  }
}
