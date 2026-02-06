import { useGitHubStore, type PrFilterState } from "../../../stores/useGitHubStore";

const FILTERS: Array<{ value: PrFilterState; label: string }> = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
  { value: "merged", label: "Merged" },
  { value: "all", label: "All" },
];

interface PullRequestFiltersProps {
  repoPath: string;
}

export function PullRequestFilters({ repoPath }: PullRequestFiltersProps) {
  const { prFilter, fetchPullRequests } = useGitHubStore();

  const handleFilterChange = (filter: PrFilterState) => {
    fetchPullRequests(repoPath, filter);
  };

  return (
    <div className="flex shrink-0 items-center gap-1 border-b border-maestro-border px-3 py-2">
      {FILTERS.map((filter) => (
        <button
          key={filter.value}
          type="button"
          onClick={() => handleFilterChange(filter.value)}
          className={`rounded-full px-2 py-0.5 text-xs transition-colors ${
            prFilter === filter.value
              ? "bg-maestro-accent text-white"
              : "bg-maestro-card text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
          }`}
        >
          {filter.label}
        </button>
      ))}
    </div>
  );
}
