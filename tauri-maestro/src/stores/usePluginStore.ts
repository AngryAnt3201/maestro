/**
 * Zustand store for plugin/skill discovery and session-enabled state.
 *
 * Tracks discovered plugins and skills per project and which are enabled
 * for each session.
 */

import { create } from "zustand";

import {
  getProjectPlugins,
  refreshProjectPlugins,
  setSessionSkills as setSessionSkillsApi,
  setSessionPlugins as setSessionPluginsApi,
  saveProjectSkillDefaults,
  loadProjectSkillDefaults,
  saveProjectPluginDefaults,
  loadProjectPluginDefaults,
  type PluginConfig,
  type SkillConfig,
} from "@/lib/plugins";

/** Key for session-enabled lookup: "projectPath:sessionId" */
function sessionKey(projectPath: string, sessionId: number): string {
  return `${projectPath}:${sessionId}`;
}

interface PluginState {
  /** Skills discovered per project path. */
  projectSkills: Record<string, SkillConfig[]>;

  /** Plugins discovered per project path. */
  projectPlugins: Record<string, PluginConfig[]>;

  /** Enabled skill IDs per session (keyed by "projectPath:sessionId"). */
  sessionEnabledSkills: Record<string, string[]>;

  /** Enabled plugin IDs per session (keyed by "projectPath:sessionId"). */
  sessionEnabledPlugins: Record<string, string[]>;

  /** Persisted default skill IDs per project (loaded from store). */
  projectDefaultSkills: Record<string, string[] | null>;

  /** Persisted default plugin IDs per project (loaded from store). */
  projectDefaultPlugins: Record<string, string[] | null>;

  /** Loading state per project. */
  isLoading: Record<string, boolean>;

  /** Error state per project. */
  errors: Record<string, string | null>;

  /**
   * Fetches plugins/skills for a project (uses cache on backend).
   * Updates the store with discovered items.
   */
  fetchProjectPlugins: (projectPath: string) => Promise<void>;

  /**
   * Refreshes plugins/skills for a project (re-parses .plugins.json).
   */
  refreshProjectPlugins: (projectPath: string) => Promise<void>;

  /**
   * Gets the enabled skill IDs for a session.
   * Returns all skills if not explicitly set.
   */
  getSessionEnabledSkills: (projectPath: string, sessionId: number) => string[];

  /**
   * Sets the enabled skill IDs for a session.
   * Updates both local state and backend.
   */
  setSessionEnabledSkills: (
    projectPath: string,
    sessionId: number,
    enabled: string[]
  ) => Promise<void>;

  /**
   * Toggles a specific skill for a session.
   */
  toggleSessionSkill: (
    projectPath: string,
    sessionId: number,
    skillId: string
  ) => Promise<void>;

  /**
   * Gets the enabled plugin IDs for a session.
   * Returns plugins with enabled_by_default if not explicitly set.
   */
  getSessionEnabledPlugins: (projectPath: string, sessionId: number) => string[];

  /**
   * Sets the enabled plugin IDs for a session.
   * Updates both local state and backend.
   */
  setSessionEnabledPlugins: (
    projectPath: string,
    sessionId: number,
    enabled: string[]
  ) => Promise<void>;

  /**
   * Toggles a specific plugin for a session.
   */
  toggleSessionPlugin: (
    projectPath: string,
    sessionId: number,
    pluginId: string
  ) => Promise<void>;

  /**
   * Gets the count of enabled skills for a session.
   */
  getEnabledSkillsCount: (projectPath: string, sessionId: number) => number;

  /**
   * Gets the count of enabled plugins for a session.
   */
  getEnabledPluginsCount: (projectPath: string, sessionId: number) => number;

  /**
   * Gets the total count of available skills for a project.
   */
  getTotalSkillsCount: (projectPath: string) => number;

  /**
   * Gets the total count of available plugins for a project.
   */
  getTotalPluginsCount: (projectPath: string) => number;

  /**
   * Clears session state when a session is closed.
   */
  clearSession: (projectPath: string, sessionId: number) => void;
}

export const usePluginStore = create<PluginState>()((set, get) => ({
  projectSkills: {},
  projectPlugins: {},
  sessionEnabledSkills: {},
  sessionEnabledPlugins: {},
  projectDefaultSkills: {},
  projectDefaultPlugins: {},
  isLoading: {},
  errors: {},

  fetchProjectPlugins: async (projectPath: string) => {
    set((state) => ({
      isLoading: { ...state.isLoading, [projectPath]: true },
      errors: { ...state.errors, [projectPath]: null },
    }));

    try {
      // Fetch plugins and load persisted defaults in parallel
      const [result, skillDefaults, pluginDefaults] = await Promise.all([
        getProjectPlugins(projectPath),
        loadProjectSkillDefaults(projectPath),
        loadProjectPluginDefaults(projectPath),
      ]);

      set((state) => ({
        projectSkills: { ...state.projectSkills, [projectPath]: result.skills },
        projectPlugins: { ...state.projectPlugins, [projectPath]: result.plugins },
        projectDefaultSkills: { ...state.projectDefaultSkills, [projectPath]: skillDefaults },
        projectDefaultPlugins: { ...state.projectDefaultPlugins, [projectPath]: pluginDefaults },
        isLoading: { ...state.isLoading, [projectPath]: false },
      }));
    } catch (err) {
      const errorMsg = String(err);
      console.error("Failed to fetch plugins:", err);
      set((state) => ({
        isLoading: { ...state.isLoading, [projectPath]: false },
        errors: { ...state.errors, [projectPath]: errorMsg },
      }));
    }
  },

  refreshProjectPlugins: async (projectPath: string) => {
    set((state) => ({
      isLoading: { ...state.isLoading, [projectPath]: true },
      errors: { ...state.errors, [projectPath]: null },
    }));

    try {
      const result = await refreshProjectPlugins(projectPath);
      set((state) => ({
        projectSkills: { ...state.projectSkills, [projectPath]: result.skills },
        projectPlugins: { ...state.projectPlugins, [projectPath]: result.plugins },
        isLoading: { ...state.isLoading, [projectPath]: false },
      }));
    } catch (err) {
      const errorMsg = String(err);
      console.error("Failed to refresh plugins:", err);
      set((state) => ({
        isLoading: { ...state.isLoading, [projectPath]: false },
        errors: { ...state.errors, [projectPath]: errorMsg },
      }));
    }
  },

  getSessionEnabledSkills: (projectPath: string, sessionId: number) => {
    const key = sessionKey(projectPath, sessionId);
    const state = get();

    // If explicitly set for this session, return that
    if (state.sessionEnabledSkills[key] !== undefined) {
      return state.sessionEnabledSkills[key];
    }

    // Use persisted project defaults if available
    const defaults = state.projectDefaultSkills[projectPath];
    if (defaults !== undefined && defaults !== null) {
      return defaults;
    }

    // Final fallback: all skills enabled
    const skills = state.projectSkills[projectPath] ?? [];
    return skills.map((s) => s.id);
  },

  setSessionEnabledSkills: async (
    projectPath: string,
    sessionId: number,
    enabled: string[]
  ) => {
    const key = sessionKey(projectPath, sessionId);

    // Update local state optimistically (both session and project defaults)
    set((state) => ({
      sessionEnabledSkills: { ...state.sessionEnabledSkills, [key]: enabled },
      projectDefaultSkills: { ...state.projectDefaultSkills, [projectPath]: enabled },
    }));

    // Persist to backend (session state and project defaults)
    try {
      await Promise.all([
        setSessionSkillsApi(projectPath, sessionId, enabled),
        saveProjectSkillDefaults(projectPath, enabled),
      ]);
    } catch (err) {
      console.error("Failed to save session skills:", err);
    }
  },

  toggleSessionSkill: async (
    projectPath: string,
    sessionId: number,
    skillId: string
  ) => {
    const currentEnabled = get().getSessionEnabledSkills(projectPath, sessionId);
    const isEnabled = currentEnabled.includes(skillId);

    const newEnabled = isEnabled
      ? currentEnabled.filter((id) => id !== skillId)
      : [...currentEnabled, skillId];

    await get().setSessionEnabledSkills(projectPath, sessionId, newEnabled);
  },

  getSessionEnabledPlugins: (projectPath: string, sessionId: number) => {
    const key = sessionKey(projectPath, sessionId);
    const state = get();

    // If explicitly set for this session, return that
    if (state.sessionEnabledPlugins[key] !== undefined) {
      return state.sessionEnabledPlugins[key];
    }

    // Use persisted project defaults if available
    const defaults = state.projectDefaultPlugins[projectPath];
    if (defaults !== undefined && defaults !== null) {
      return defaults;
    }

    // Final fallback: plugins with enabled_by_default
    const plugins = state.projectPlugins[projectPath] ?? [];
    return plugins.filter((p) => p.enabled_by_default).map((p) => p.id);
  },

  setSessionEnabledPlugins: async (
    projectPath: string,
    sessionId: number,
    enabled: string[]
  ) => {
    const key = sessionKey(projectPath, sessionId);

    // Update local state optimistically (both session and project defaults)
    set((state) => ({
      sessionEnabledPlugins: { ...state.sessionEnabledPlugins, [key]: enabled },
      projectDefaultPlugins: { ...state.projectDefaultPlugins, [projectPath]: enabled },
    }));

    // Persist to backend (session state and project defaults)
    try {
      await Promise.all([
        setSessionPluginsApi(projectPath, sessionId, enabled),
        saveProjectPluginDefaults(projectPath, enabled),
      ]);
    } catch (err) {
      console.error("Failed to save session plugins:", err);
    }
  },

  toggleSessionPlugin: async (
    projectPath: string,
    sessionId: number,
    pluginId: string
  ) => {
    const currentEnabled = get().getSessionEnabledPlugins(projectPath, sessionId);
    const isEnabled = currentEnabled.includes(pluginId);

    const newEnabled = isEnabled
      ? currentEnabled.filter((id) => id !== pluginId)
      : [...currentEnabled, pluginId];

    await get().setSessionEnabledPlugins(projectPath, sessionId, newEnabled);
  },

  getEnabledSkillsCount: (projectPath: string, sessionId: number) => {
    return get().getSessionEnabledSkills(projectPath, sessionId).length;
  },

  getEnabledPluginsCount: (projectPath: string, sessionId: number) => {
    return get().getSessionEnabledPlugins(projectPath, sessionId).length;
  },

  getTotalSkillsCount: (projectPath: string) => {
    return (get().projectSkills[projectPath] ?? []).length;
  },

  getTotalPluginsCount: (projectPath: string) => {
    return (get().projectPlugins[projectPath] ?? []).length;
  },

  clearSession: (projectPath: string, sessionId: number) => {
    const key = sessionKey(projectPath, sessionId);
    set((state) => {
      const { [key]: _skills, ...restSkills } = state.sessionEnabledSkills;
      const { [key]: _plugins, ...restPlugins } = state.sessionEnabledPlugins;
      return {
        sessionEnabledSkills: restSkills,
        sessionEnabledPlugins: restPlugins,
      };
    });
  },
}));
