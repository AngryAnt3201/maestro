import {
  FolderOpen,
  Loader2,
  Plus,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useMcpStore } from "@/stores/useMcpStore";
import type { McpCustomServer } from "@/lib/mcp";

interface McpServerEditorModalProps {
  /** Existing server to edit, or undefined to create a new one. */
  server?: McpCustomServer;
  onClose: () => void;
  onSaved?: () => void;
}

/**
 * Modal for adding or editing custom MCP servers.
 *
 * Form fields:
 * - Name (text input)
 * - Command (text input, e.g., "npx", "node", "python")
 * - Arguments (text input, space-separated)
 * - Working Directory (text input + Browse button)
 * - Environment Variables (dynamic key-value pairs)
 * - Command preview section
 */
export function McpServerEditorModal({
  server,
  onClose,
  onSaved,
}: McpServerEditorModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const { addCustomServer, updateCustomServer } = useMcpStore();

  const isEditing = !!server;

  // Form state
  const [name, setName] = useState(server?.name ?? "");
  const [command, setCommand] = useState(server?.command ?? "");
  const [argsString, setArgsString] = useState(server?.args.join(" ") ?? "");
  const [workingDirectory, setWorkingDirectory] = useState(
    server?.workingDirectory ?? ""
  );
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>(
    Object.entries(server?.env ?? {}).map(([key, value]) => ({ key, value }))
  );
  const [isEnabled, setIsEnabled] = useState(server?.isEnabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const handleBrowseWorkingDir = async () => {
    try {
      const selected = await openDialog({
        directory: true,
        title: "Select Working Directory",
      });
      if (selected) {
        setWorkingDirectory(selected);
      }
    } catch (err) {
      console.error("Failed to open directory picker:", err);
    }
  };

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: "", value: "" }]);
  };

  const updateEnvVar = (
    index: number,
    field: "key" | "value",
    value: string
  ) => {
    setEnvVars(
      envVars.map((ev, i) => (i === index ? { ...ev, [field]: value } : ev))
    );
  };

  const removeEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  // Parse arguments from space-separated string
  const parseArgs = (argsStr: string): string[] => {
    if (!argsStr.trim()) return [];
    // Simple split by space, but handle quoted strings
    const args: string[] = [];
    let current = "";
    let inQuotes = false;
    let quoteChar = "";

    for (const char of argsStr) {
      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = "";
      } else if (char === " " && !inQuotes) {
        if (current) {
          args.push(current);
          current = "";
        }
      } else {
        current += char;
      }
    }
    if (current) args.push(current);
    return args;
  };

  // Build command preview
  const buildCommandPreview = (): string => {
    const args = parseArgs(argsString);
    const envPrefix = envVars
      .filter((ev) => ev.key.trim())
      .map((ev) => `${ev.key}=${ev.value}`)
      .join(" ");

    let preview = "";
    if (envPrefix) preview += envPrefix + " ";
    preview += command || "<command>";
    if (args.length > 0) preview += " " + args.join(" ");
    return preview;
  };

  const handleSave = async () => {
    setError(null);

    // Validation
    if (!name.trim()) {
      setError("Name is required");
      return;
    }
    if (!command.trim()) {
      setError("Command is required");
      return;
    }

    setSaving(true);
    try {
      const serverData: McpCustomServer = {
        id: server?.id ?? crypto.randomUUID(),
        name: name.trim(),
        command: command.trim(),
        args: parseArgs(argsString),
        env: Object.fromEntries(
          envVars
            .filter((ev) => ev.key.trim())
            .map((ev) => [ev.key.trim(), ev.value])
        ),
        workingDirectory: workingDirectory.trim() || undefined,
        isEnabled,
        createdAt: server?.createdAt ?? new Date().toISOString(),
      };

      if (isEditing) {
        await updateCustomServer(serverData);
      } else {
        await addCustomServer(serverData);
      }

      onSaved?.();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div
        ref={modalRef}
        className="w-full max-w-lg rounded-lg border border-maestro-border bg-maestro-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-maestro-border px-4 py-3">
          <h2 className="text-sm font-semibold text-maestro-text">
            {isEditing ? "Edit MCP Server" : "Add MCP Server"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 hover:bg-maestro-border/40"
          >
            <X size={16} className="text-maestro-muted" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
          {/* Name */}
          <section>
            <label className="mb-1.5 block text-xs font-medium text-maestro-text">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My MCP Server"
              className="w-full rounded border border-maestro-border bg-maestro-surface px-3 py-2 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
              autoFocus
            />
          </section>

          {/* Command */}
          <section>
            <label className="mb-1.5 block text-xs font-medium text-maestro-text">
              Command
            </label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx, node, python, etc."
              className="w-full rounded border border-maestro-border bg-maestro-surface px-3 py-2 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
            />
          </section>

          {/* Arguments */}
          <section>
            <label className="mb-1.5 block text-xs font-medium text-maestro-text">
              Arguments
            </label>
            <input
              type="text"
              value={argsString}
              onChange={(e) => setArgsString(e.target.value)}
              placeholder="-y @modelcontextprotocol/server-filesystem"
              className="w-full rounded border border-maestro-border bg-maestro-surface px-3 py-2 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
            />
            <p className="mt-1 text-[10px] text-maestro-muted">
              Space-separated arguments. Use quotes for values with spaces.
            </p>
          </section>

          {/* Working Directory */}
          <section>
            <label className="mb-1.5 block text-xs font-medium text-maestro-text">
              Working Directory
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={workingDirectory}
                onChange={(e) => setWorkingDirectory(e.target.value)}
                placeholder="(Optional) /path/to/directory"
                className="flex-1 rounded border border-maestro-border bg-maestro-surface px-3 py-2 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={handleBrowseWorkingDir}
                className="rounded border border-maestro-border bg-maestro-card px-3 py-2 text-xs text-maestro-text hover:bg-maestro-surface"
              >
                <FolderOpen size={14} />
              </button>
            </div>
          </section>

          {/* Environment Variables */}
          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="text-xs font-medium text-maestro-text">
                Environment Variables
              </label>
              <button
                type="button"
                onClick={addEnvVar}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-maestro-accent hover:bg-maestro-accent/10"
              >
                <Plus size={10} />
                Add
              </button>
            </div>
            <div className="space-y-2 rounded-lg border border-maestro-border bg-maestro-card p-2">
              {envVars.length === 0 ? (
                <p className="py-1 text-center text-[10px] text-maestro-muted">
                  No environment variables
                </p>
              ) : (
                envVars.map((ev, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={ev.key}
                      onChange={(e) => updateEnvVar(index, "key", e.target.value)}
                      placeholder="KEY"
                      className="w-28 rounded border border-maestro-border bg-maestro-surface px-2 py-1 text-[11px] text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
                    />
                    <span className="text-maestro-muted">=</span>
                    <input
                      type="text"
                      value={ev.value}
                      onChange={(e) => updateEnvVar(index, "value", e.target.value)}
                      placeholder="value"
                      className="flex-1 rounded border border-maestro-border bg-maestro-surface px-2 py-1 text-[11px] text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => removeEnvVar(index)}
                      className="rounded p-1 hover:bg-maestro-red/10"
                    >
                      <Trash2 size={12} className="text-maestro-red" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </section>

          {/* Enabled */}
          <section>
            <label className="flex items-center gap-2 text-xs text-maestro-text">
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => setIsEnabled(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-maestro-border"
              />
              Enable by default
            </label>
            <p className="mt-1 pl-5 text-[10px] text-maestro-muted">
              Enabled servers are included in new sessions automatically.
            </p>
          </section>

          {/* Command Preview */}
          <section>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-maestro-text">
              <Terminal size={12} />
              Command Preview
            </label>
            <div className="rounded-lg border border-maestro-border bg-maestro-surface p-2">
              <code className="text-[11px] text-maestro-accent break-all">
                {buildCommandPreview()}
              </code>
            </div>
          </section>

          {/* Error */}
          {error && (
            <p className="text-xs text-maestro-red">{error}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 border-t border-maestro-border px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-4 py-2 text-xs text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded bg-maestro-accent px-4 py-2 text-xs text-white hover:bg-maestro-accent/80 disabled:opacity-50"
          >
            {saving ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Saving...
              </>
            ) : (
              isEditing ? "Save Changes" : "Add Server"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
