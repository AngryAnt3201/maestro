import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useOpsStore } from "@/stores/useOpsStore";
import { LiveSection } from "../sections/LiveSection";

describe("LiveSection", () => {
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

  it("renders nothing when no runs are active", () => {
    const { container } = render(<LiveSection />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders one row per live run", () => {
    useOpsStore.setState({
      live: {
        d1: { dispatchId: "d1", jobId: "j1", startedAt: Date.now(), lastLine: "ok" },
      },
      jobsByScope: {
        global: [
          {
            id: "j1",
            name: "my-job",
            enabled: true,
            scope: "global",
            tags: [],
            driver: "maestro",
            notifyOnFailure: false,
            createdAt: 0,
            updatedAt: 0,
          } as unknown as import("@/types/ops").Job,
        ],
      },
    });
    render(<LiveSection />);
    expect(screen.getByText("my-job")).toBeInTheDocument();
    expect(screen.getByText(/Live/i)).toBeInTheDocument();
  });
});
