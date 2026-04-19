import { X } from "lucide-react";
import { useState } from "react";
import { useOpsStore } from "@/stores/useOpsStore";
import type { Job, JobDriver, Scope } from "@/types/ops";
import { ClaudeTriggerForm } from "./wizard/ClaudeTriggerForm";
import { LoopForm } from "./wizard/LoopForm";
import { MaestroJobForm } from "./wizard/MaestroJobForm";

interface Props {
  open: boolean;
  onClose: () => void;
  projectHash?: string;
}

type Step = "driver" | "form";

export function NewJobWizard({ open, onClose, projectHash }: Props) {
  const [step, setStep] = useState<Step>("driver");
  const [driver, setDriver] = useState<JobDriver>("maestro");
  const [scope, setScope] = useState<Scope>("project");
  const saveJob = useOpsStore((s) => s.saveJob);

  if (!open) return null;

  const reset = () => {
    setStep("driver");
    setDriver("maestro");
    setScope("project");
  };
  const close = () => {
    reset();
    onClose();
  };

  const submit = async (partial: Partial<Job>) => {
    const job: Job = {
      id: "",
      name: partial.name ?? "untitled",
      enabled: partial.enabled ?? true,
      scope,
      projectHash: scope === "project" ? projectHash : undefined,
      tags: partial.tags ?? [],
      driver,
      schedule: partial.schedule,
      maestro: partial.maestro,
      claudeTrigger: partial.claudeTrigger,
      loop: partial.loop,
      toolId: partial.toolId,
      notifyOnFailure: partial.notifyOnFailure ?? false,
      createdAt: 0,
      updatedAt: 0,
    };
    try {
      await saveJob(scope, job, projectHash);
      close();
    } catch (e) {
      window.alert(`Failed to create job: ${e}`);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={close}
    >
      <div
        className="w-[520px] max-h-[80vh] overflow-y-auto rounded border border-maestro-border bg-maestro-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-4 flex items-center">
          <h2 className="text-[13px] font-semibold text-maestro-text">New job</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="ml-auto text-maestro-muted hover:text-maestro-text"
          >
            <X size={14} />
          </button>
        </header>

        {step === "driver" ? (
          <DriverPicker
            driver={driver}
            onDriver={setDriver}
            scope={scope}
            onScope={setScope}
            canProject={!!projectHash}
            onNext={() => setStep("form")}
          />
        ) : driver === "maestro" ? (
          <MaestroJobForm onCancel={() => setStep("driver")} onSubmit={submit} />
        ) : driver === "claude-trigger" ? (
          <ClaudeTriggerForm onCancel={() => setStep("driver")} onSubmit={submit} />
        ) : (
          <LoopForm onCancel={() => setStep("driver")} onSubmit={submit} />
        )}
      </div>
    </div>
  );
}

function DriverPicker({
  driver,
  onDriver,
  scope,
  onScope,
  canProject,
  onNext,
}: {
  driver: JobDriver;
  onDriver: (d: JobDriver) => void;
  scope: Scope;
  onScope: (s: Scope) => void;
  canProject: boolean;
  onNext: () => void;
}) {
  return (
    <>
      <div className="mb-4">
        <p className="mb-2 text-[10.5px] uppercase tracking-wider text-maestro-muted">Driver</p>
        <div className="grid grid-cols-3 gap-2">
          <DriverCard
            selected={driver === "maestro"}
            onSelect={() => onDriver("maestro")}
            title="Maestro"
            desc="Runs a local command on schedule while Maestro is open."
          />
          <DriverCard
            selected={driver === "claude-trigger"}
            onSelect={() => onDriver("claude-trigger")}
            title="Claude Trigger"
            desc="Remote Claude agent via /schedule. Runs even when Maestro is closed."
          />
          <DriverCard
            selected={driver === "loop"}
            onSelect={() => onDriver("loop")}
            title="Loop"
            desc="/loop inside a Maestro-managed Claude session. Local, continuous."
          />
        </div>
      </div>
      <div className="mb-4">
        <p className="mb-2 text-[10.5px] uppercase tracking-wider text-maestro-muted">Scope</p>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onScope("project")}
            disabled={!canProject}
            className={`rounded px-3 py-1 text-[11px] ${
              scope === "project"
                ? "bg-maestro-accent/15 text-maestro-accent"
                : "text-maestro-muted disabled:opacity-40"
            }`}
          >
            Project
          </button>
          <button
            type="button"
            onClick={() => onScope("global")}
            className={`rounded px-3 py-1 text-[11px] ${
              scope === "global" ? "bg-maestro-accent/15 text-maestro-accent" : "text-maestro-muted"
            }`}
          >
            Global
          </button>
        </div>
      </div>
      <button
        type="button"
        onClick={onNext}
        className="rounded bg-maestro-accent/20 px-3 py-1.5 text-[11px] text-maestro-accent"
      >
        Next →
      </button>
    </>
  );
}

function DriverCard({
  selected,
  onSelect,
  title,
  desc,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`rounded border px-3 py-2 text-left ${
        selected
          ? "border-maestro-accent bg-maestro-accent/5"
          : "border-maestro-border hover:border-maestro-accent/40"
      }`}
    >
      <div className="text-[12px] text-maestro-text">{title}</div>
      <div className="mt-1 text-[10.5px] text-maestro-muted">{desc}</div>
    </button>
  );
}
