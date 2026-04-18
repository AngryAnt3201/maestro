import { ChevronDown, ChevronRight, RotateCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useMcpStore } from "@/stores/useMcpStore";
import type { McpServerConfig } from "@/lib/mcp";

const EMPTY_SERVERS: McpServerConfig[] = [];

interface Props {
  projectPath?: string;
}

export function McpSubSection({ projectPath }: Props) {
  const [open, setOpen] = useState(false);
  const fetchServers = useMcpStore((s) => s.fetchProjectServers);
  const refresh = useMcpStore((s) => s.refreshProjectServers);
  const servers = useMcpStore((s) =>
    projectPath ? (s.projectServers[projectPath] ?? EMPTY_SERVERS) : EMPTY_SERVERS,
  );
  const loading = useMcpStore((s) => (projectPath ? (s.isLoading[projectPath] ?? false) : false));

  useEffect(() => {
    if (open && projectPath) fetchServers(projectPath);
  }, [open, projectPath, fetchServers]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-default items-center gap-1.5 px-4 py-1.5 text-left text-[11px] text-maestro-muted hover:bg-maestro-card/30"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="flex-1">MCP</span>
        <span className="text-[10.5px] text-maestro-muted/60">{servers.length}</span>
      </button>
      {open && (
        <div>
          {!projectPath && (
            <p className="px-4 py-2 text-[10.5px] text-maestro-muted/60">
              Open a project to see MCP servers.
            </p>
          )}
          {projectPath && (
            <>
              <div className="flex items-center gap-2 border-b border-maestro-border/20 px-4 py-1">
                <button
                  type="button"
                  onClick={() => refresh(projectPath)}
                  disabled={loading}
                  className="flex items-center gap-1 text-[10.5px] text-maestro-accent disabled:opacity-50"
                >
                  <RotateCw size={10} className={loading ? "animate-spin" : ""} /> Refresh
                </button>
              </div>
              {servers.length === 0 ? (
                <p className="px-4 py-2 text-[10.5px] text-maestro-muted/60">
                  No MCP servers configured.
                </p>
              ) : (
                <ul>
                  {servers.map((s) => (
                    <li
                      key={s.name}
                      className="flex items-center gap-2 border-t border-maestro-border/10 px-4 py-1"
                    >
                      <span className="w-16 text-[9.5px] uppercase tracking-wider text-maestro-muted">
                        {s.source ?? "—"}
                      </span>
                      <span className="flex-1 truncate text-[11px] text-maestro-text">
                        {s.name}
                      </span>
                      <span className="truncate font-mono text-[10.5px] text-maestro-muted/70">
                        {s.type === "stdio" ? s.command : s.url}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
