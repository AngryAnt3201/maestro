import { MessageCircle, MessageCircleOff } from "lucide-react";
import { useGitHubStore } from "../../../stores/useGitHubStore";
import { DiscussionRow } from "./DiscussionRow";

interface DiscussionListProps {
  repoPath: string;
  onSelectDiscussion: (discussionNumber: number) => void;
  selectedDiscussionNumber: number | null;
}

export function DiscussionList({
  onSelectDiscussion,
  selectedDiscussionNumber,
}: DiscussionListProps) {
  const { discussions, isDiscussionsLoading, discussionsError, discussionsEnabled } =
    useGitHubStore();

  if (!discussionsEnabled) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center">
        <div className="flex flex-col items-center gap-3">
          <MessageCircleOff
            size={32}
            className="text-maestro-muted/30"
            strokeWidth={1}
          />
          <p className="text-xs text-maestro-muted/60">
            Discussions are not enabled for this repository
          </p>
        </div>
      </div>
    );
  }

  if (discussionsError) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center text-sm text-maestro-red">
          <p>Failed to load discussions</p>
          <p className="mt-1 text-xs text-maestro-muted">{discussionsError}</p>
        </div>
      </div>
    );
  }

  if (isDiscussionsLoading && discussions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-maestro-muted">Loading discussions...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {discussions.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 text-center">
          <div className="flex flex-col items-center gap-3">
            <MessageCircle
              size={32}
              className="text-maestro-muted/30"
              strokeWidth={1}
            />
            <p className="text-xs text-maestro-muted/60">
              No discussions found
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto" style={{ scrollbarWidth: "thin" }}>
          {discussions.map((discussion) => (
            <DiscussionRow
              key={discussion.number}
              discussion={discussion}
              isSelected={discussion.number === selectedDiscussionNumber}
              onClick={() => onSelectDiscussion(discussion.number)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
