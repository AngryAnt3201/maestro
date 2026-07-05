import Check from "lucide-react/dist/esm/icons/check";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right";
import Package from "lucide-react/dist/esm/icons/package";
import Search from "lucide-react/dist/esm/icons/search";
import Store from "lucide-react/dist/esm/icons/store";
import Zap from "lucide-react/dist/esm/icons/zap";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PluginConfig, SkillConfig } from "@/lib/plugins";

interface PluginsSkillsSelectorProps {
  enabledPluginIds: string[];
  enabledSkillIds: string[];
  plugins: PluginConfig[];
  skills: SkillConfig[];
  onPluginToggle: (pluginId: string) => void;
  onSkillToggle: (skillId: string) => void;
  onSelectAll: () => void;
  onUnselectAll: () => void;
}

function getSkillBaseName(skillId: string): string {
  const colonIndex = skillId.indexOf(":");
  return colonIndex >= 0 ? skillId.slice(colonIndex + 1) : skillId;
}

export function PluginsSkillsSelector({
  enabledPluginIds,
  enabledSkillIds,
  plugins,
  skills,
  onPluginToggle,
  onSkillToggle,
  onSelectAll,
  onUnselectAll,
}: PluginsSkillsSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedPlugins, setExpandedPlugins] = useState<Set<string>>(new Set());
  const dropdownRef = useRef<HTMLDivElement>(null);

  const pluginSkillsMap = useMemo(() => {
    const skillByBaseName = new Map(skills.map((skill) => [getSkillBaseName(skill.id), skill]));
    const next = new Map<string, SkillConfig[]>();

    for (const plugin of plugins) {
      const pluginSkills: SkillConfig[] = [];
      for (const skillId of plugin.skills) {
        const skill = skillByBaseName.get(getSkillBaseName(skillId));
        if (skill) {
          pluginSkills.push(skill);
        }
      }
      if (pluginSkills.length > 0) {
        next.set(plugin.name, pluginSkills);
      }
    }

    return next;
  }, [plugins, skills]);

  const normalizedQuery = searchQuery.toLowerCase();
  const filteredPlugins = plugins.filter((plugin) => {
    if (!normalizedQuery) return true;
    if (plugin.name.toLowerCase().includes(normalizedQuery)) return true;
    const pluginSkills = pluginSkillsMap.get(plugin.name) ?? [];
    return pluginSkills.some((skill) => skill.name.toLowerCase().includes(normalizedQuery));
  });

  const hasPluginsOrSkills = plugins.length > 0 || skills.length > 0;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const togglePluginExpanded = (pluginId: string) => {
    setExpandedPlugins((current) => {
      const next = new Set(current);
      if (next.has(pluginId)) {
        next.delete(pluginId);
      } else {
        next.add(pluginId);
      }
      return next;
    });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-maestro-muted">
        Plugins & Skills
      </div>
      {!hasPluginsOrSkills ? (
        <div className="flex items-center gap-2 rounded border border-maestro-border bg-maestro-card/50 px-3 py-2 text-sm text-maestro-muted">
          <Store size={14} />
          <span>No plugins or skills configured</span>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setIsOpen((current) => !current)}
            className="flex w-full items-center justify-between gap-2 rounded border border-maestro-border bg-maestro-card px-3 py-2 text-left text-sm text-maestro-text transition-colors hover:border-maestro-accent/50"
          >
            <div className="flex items-center gap-2">
              <Store size={14} className="text-maestro-purple" />
              <span>
                {enabledPluginIds.length} plugins, {enabledSkillIds.length} skills
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
                    placeholder="Search plugins & skills..."
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
                  {enabledPluginIds.length}P / {enabledSkillIds.length}S
                </span>
              </div>

              <div className="max-h-52 overflow-y-auto">
                {plugins.length > 0 && (
                  <>
                    <div className="border-b border-maestro-border px-3 py-1.5 text-[9px] font-medium uppercase tracking-wide text-maestro-muted">
                      Plugins ({plugins.length})
                    </div>
                    {filteredPlugins.map((plugin) => {
                      const isPluginEnabled = enabledPluginIds.includes(plugin.id);
                      const pluginSkills = pluginSkillsMap.get(plugin.name) ?? [];
                      const isExpanded = expandedPlugins.has(plugin.id);
                      const hasSkillsToShow = pluginSkills.length > 0;
                      const filteredPluginSkills = normalizedQuery
                        ? pluginSkills.filter((skill) =>
                            skill.name.toLowerCase().includes(normalizedQuery),
                          )
                        : pluginSkills;

                      return (
                        <div key={plugin.id}>
                          <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-maestro-surface">
                            {hasSkillsToShow ? (
                              <button
                                type="button"
                                onClick={() => togglePluginExpanded(plugin.id)}
                                className="shrink-0 rounded p-0.5 hover:bg-maestro-border/40"
                              >
                                {isExpanded ? (
                                  <ChevronDown size={12} className="text-maestro-muted" />
                                ) : (
                                  <ChevronRight size={12} className="text-maestro-muted" />
                                )}
                              </button>
                            ) : (
                              <span className="w-5" />
                            )}
                            <button
                              type="button"
                              onClick={() => onPluginToggle(plugin.id)}
                              className="flex flex-1 items-center gap-2 text-left text-sm"
                            >
                              <span
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                  isPluginEnabled
                                    ? "border-maestro-purple bg-maestro-purple"
                                    : "border-maestro-border bg-transparent"
                                }`}
                              >
                                {isPluginEnabled && <Check size={12} className="text-white" />}
                              </span>
                              <Package size={12} className="shrink-0 text-maestro-purple" />
                              <span
                                className={`flex-1 truncate ${isPluginEnabled ? "text-maestro-text" : "text-maestro-muted"}`}
                              >
                                {plugin.name}
                              </span>
                              {hasSkillsToShow && (
                                <span className="text-[10px] text-maestro-muted">
                                  {pluginSkills.length}
                                </span>
                              )}
                              <span className="text-[10px] text-maestro-muted/60">
                                v{plugin.version}
                              </span>
                            </button>
                          </div>

                          {isExpanded && hasSkillsToShow && (
                            <div className="ml-5 border-l border-maestro-border/40 pl-2">
                              {filteredPluginSkills.map((skill) => {
                                const isSkillEnabled = enabledSkillIds.includes(skill.id);
                                return (
                                  <button
                                    key={skill.id}
                                    type="button"
                                    onClick={() => onSkillToggle(skill.id)}
                                    className="flex w-full items-center gap-2 px-2 py-1 text-left text-sm transition-colors hover:bg-maestro-surface"
                                    title={skill.description || undefined}
                                  >
                                    <span
                                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                                        isSkillEnabled
                                          ? "border-maestro-orange bg-maestro-orange"
                                          : "border-maestro-border bg-transparent"
                                      }`}
                                    >
                                      {isSkillEnabled && <Check size={10} className="text-white" />}
                                    </span>
                                    <Zap size={11} className="shrink-0 text-maestro-orange" />
                                    <span
                                      className={`flex-1 truncate text-xs ${isSkillEnabled ? "text-maestro-text" : "text-maestro-muted"}`}
                                    >
                                      {skill.name}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}

                {searchQuery && filteredPlugins.length === 0 && (
                  <div className="px-3 py-2 text-center text-xs text-maestro-muted">
                    No results match "{searchQuery}"
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
