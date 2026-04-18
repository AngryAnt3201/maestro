import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useOpsStore } from "@/stores/useOpsStore";
import type { Job } from "@/types/ops";
import { JobRow } from "../JobRow";

const baseJob: Job = {
  id: "j1",
  name: "ghd-daily",
  enabled: true,
  scope: "project",
  projectHash: "abc123",
  tags: [],
  driver: "maestro",
  schedule: "0 9 * * *",
  maestro: { command: "ghd", args: ["list"], env: {} },
  notifyOnFailure: false,
  createdAt: 0,
  updatedAt: 0,
};

describe("JobRow", () => {
  beforeEach(() => {
    useOpsStore.setState({
      jobsByScope: {},
      dispatchesByScope: {},
      tools: [],
      live: {},
      caps: undefined,
      scopeFilter: "all",
    });
  });

  it("shows the job name and schedule collapsed", () => {
    render(<JobRow job={baseJob} />);
    expect(screen.getByText("ghd-daily")).toBeInTheDocument();
    expect(screen.getByText(/cron: 0 9 \* \* \*/)).toBeInTheDocument();
  });

  it("reveals details on click", () => {
    render(<JobRow job={baseJob} />);
    fireEvent.click(screen.getByText("ghd-daily"));
    expect(screen.getByText("ghd list")).toBeInTheDocument();
  });

  it("invokes runNow when play is clicked", async () => {
    const runNow = vi.fn(async () => {});
    useOpsStore.setState({ runNow } as unknown as Parameters<typeof useOpsStore.setState>[0]);
    render(<JobRow job={baseJob} />);
    fireEvent.click(screen.getByLabelText("Run now"));
    expect(runNow).toHaveBeenCalledWith("project", "j1", "abc123");
  });
});
