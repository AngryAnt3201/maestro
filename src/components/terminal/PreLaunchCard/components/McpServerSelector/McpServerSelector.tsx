import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Search from "lucide-react/dist/esm/icons/search";
import Server from "lucide-react/dist/esm/icons/server";
import { useEffect, useRef, useState } from "react";
import type { McpServerConfig } from "@/lib/mcp";

interface McpServerSelectorProps {
  enabledServerNames: string[];
  servers: McpServerConfig[];
  onToggle: (serverName: string) => void;
  onSelectAll: () => void;
  onUnselectAll: () => void;
}

export function McpServerSelector({
  enabledServerNames,
  servers,
  onToggle,
  onSelectAll,
  onUnselectAll,
}: McpServerSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  const enabledCount = enabledServerNames.length;
  const totalCount = servers.length;
  const hasServers = totalCount > 0;
  const normalizedQuery = searchQuery.toLowerCase();
  const filteredServers = servers.filter((server) =>
    server.name.toLowerCase().includes(normalizedQuery),
  );

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-maestro-muted">
        MCP Servers
      </div>
      {!hasServers ? (
        <div className="flex items-center gap-2 rounded border border-maestro-border bg-maestro-card/50 px-3 py-2 text-sm text-maestro-muted">
          <Server size={14} />
          <span>No MCP servers configured</span>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setIsOpen((current) => !current)}
            className="flex w-full items-center justify-between gap-2 rounded border border-maestro-border bg-maestro-card px-3 py-2 text-left text-sm text-maestro-text transition-colors hover:border-maestro-accent/50"
          >
            <div className="flex items-center gap-2">
              <Server size={14} className="text-maestro-green" />
              <span>
                {enabledCount} of {totalCount} servers
              </span>
            </div>
            <ChevronDown size={14} className="text-maestro-muted" />
          </button>

          {isOpen && (
            <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded border border-maestro-border bg-maestro-card shadow-lg">
              <div className="border-b border-maestro-border p-2">
                <div className="relative">
                  <Search
                    size={12}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-maestro-muted"
                  />
                  <input
                    type="text"
                    placeholder="Search servers..."
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    className="w-full rounded border border-maestro-border bg-maestro-surface py-1.5 pl-7 pr-2 text-xs text-maestro-text placeholder:text-maestro-muted focus:border-maestro-accent focus:outline-none"
                    onClick={(event) => event.stopPropagation()}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between border-b border-maestro-border px-2 py-1.5">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelectAll();
                    }}
                    className="rounded bg-maestro-surface px-2 py-0.5 text-[10px] text-maestro-muted transition-colors hover:bg-maestro-border hover:text-maestro-text"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onUnselectAll();
                    }}
                    className="rounded bg-maestro-surface px-2 py-0.5 text-[10px] text-maestro-muted transition-colors hover:bg-maestro-border hover:text-maestro-text"
                  >
                    Unselect All
                  </button>
                </div>
                <span className="text-[10px] text-maestro-muted">
                  {enabledCount}/{totalCount}
                </span>
              </div>

              <div className="max-h-36 overflow-y-auto">
                {filteredServers.map((server) => {
                  const isEnabled = enabledServerNames.includes(server.name);
                  return (
                    <button
                      key={server.name}
                      type="button"
                      onClick={() => onToggle(server.name)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-maestro-surface"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          isEnabled
                            ? "border-maestro-green bg-maestro-green"
                            : "border-maestro-border bg-transparent"
                        }`}
                      >
                        {isEnabled && <Check size={12} className="text-white" />}
                      </span>
                      <span className={isEnabled ? "text-maestro-text" : "text-maestro-muted"}>
                        {server.name}
                      </span>
                      <span className="ml-auto text-[10px] text-maestro-muted/60">
                        {server.type}
                      </span>
                    </button>
                  );
                })}
                {filteredServers.length === 0 && (
                  <div className="px-3 py-2 text-center text-xs text-maestro-muted">
                    No servers match "{searchQuery}"
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
