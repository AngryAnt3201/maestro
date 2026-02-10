# Tamagotchi Multi-Provider Usage (Claude + Gemini + Codex)

## Summary
Extend the existing Tamagotchi usage widget to support multiple AI providers (Claude, Gemini, Codex). Add a compact, pill-style provider toggle in the top-left of the widget to switch which provider's usage stats are shown. Keep the current mood/usage metaphor, but make it provider-aware.

## Goals
- Support Claude, Gemini, and Codex usage data in the Tamagotchi widget.
- Allow quick provider switching via a small pill toggle in the widget header.
- Keep the existing daily/weekly toggle behavior where possible.
- Preserve current Claude behavior and visuals as the default.

## Non-Goals
- No cross-provider aggregation view in this iteration.
- No historical charts or export.
- No advanced account management UI; use existing credentials stored by each provider's CLI/tooling.

## UX / UI
- Add a small pill toggle in the top-left corner of the Tamagotchi container.
- Segmented control with 3 options: `Claude`, `Gemini`, `Codex`.
- Active segment is highlighted; inactive segments have low-contrast text/border.
- Placement: inside the Tamagotchi container with `absolute` positioning (top-left), above the character/bar layer.
- Accessibility: keyboard focus ring per segment; `aria-pressed` or `role="tablist"`.
- Behavior:
  - Switching providers updates the usage bar, mood, reset time, and auth messaging.
  - When usage is unavailable for a provider, show a compact hint and keep the character in `sleeping`.

## Data Model
Introduce a provider abstraction.

```ts
export type UsageProvider = "claude" | "gemini" | "codex";

export interface UsageData {
  sessionPercent: number;
  sessionResetsAt: string | null;
  weeklyPercent: number;
  weeklyResetsAt: string | null;
  // Optional: provider-specific fields.
  errorMessage: string | null;
  needsAuth: boolean;
  authHint?: string | null; // e.g. "Run `claude` to wake me"
}

export interface ProviderUsageState {
  usage: UsageData | null;
  mood: TamagotchiMood;
  isLoading: boolean;
  error: string | null;
  lastFetch: Date | null;
  needsAuth: boolean;
}
```

Store updates:
- Add `activeProvider` to the Zustand store.
- Hold per-provider state in `providers` map.
- Fetch/poll only the active provider by default.
- Optional: background refresh for all providers if the user has all three configured (keeps toggle snappy).
- Cache per-provider results and reuse if fetched within `POLL_INTERVAL_MS`.

## Backend (Tauri)
Add provider-specific usage commands and a single frontend dispatch.

### New Commands
- `get_gemini_usage` -> returns `UsageData`
- `get_codex_usage` -> returns `UsageData`

### Frontend Dispatch
```ts
export async function getUsage(provider: UsageProvider): Promise<UsageData> {
  switch (provider) {
    case "claude": return invoke("get_claude_usage");
    case "gemini": return invoke("get_gemini_usage");
    case "codex": return invoke("get_codex_usage");
  }
}
```

### Provider Auth + Storage (verified)
- Claude: existing keychain or `~/.claude/.credentials.json` (current implementation).
- Gemini CLI auth methods (official):
  - Login with Google (OAuth). Credentials are cached locally by the CLI.
  - Gemini API key via `GEMINI_API_KEY`.
  - Vertex AI via ADC/service account/Google Cloud API key with `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION`.
- Gemini CLI settings location: `~/.gemini/settings.json` (user) or `your-project/.gemini/settings.json` (workspace).
- Codex auth methods (official): ChatGPT login or OpenAI API key.
- Codex credentials cache: `~/.codex/auth.json` or OS credential store; storage can be controlled via `cli_auth_credentials_store`.
- Codex config location: `~/.codex/config.toml` (plus optional project overrides in `.codex/config.toml`).

If a provider cannot be authenticated:
- Return `needs_auth: true`.
- Provide an `auth_hint` for the UI.

### Usage Data Sources (per provider)
- Claude: keep current Anthropic OAuth usage endpoint (`get_claude_usage`) as-is.
- Gemini CLI:
  - Documented session-level usage is available via the `/stats` command (token usage, cached token savings, session duration).
  - There is no documented account-level usage API in Gemini CLI docs; treat `/stats` as the primary source until a supported endpoint is confirmed.
  - Session logs are stored under `~/.gemini/tmp/<project_hash>/chats/` and include token usage stats; this is a possible file-based fallback if CLI invocation is not feasible.
- Codex:
  - `/status` displays session configuration and token usage and is recommended for checking remaining limits during an active CLI session.
  - For API-key usage, OpenAI’s Usage API exposes org-wide activity via `/v1/organization/usage/{...}`; this can be filtered by model if we want Codex-only usage.

### Capability Matrix (proposed)
| Provider | Session Usage | Daily/Weekly % | Auth Storage | Notes |
|---|---|---|---|---|
| Claude | Yes (API) | Yes (API) | Keychain / file | Existing implementation |
| Gemini CLI | Yes (`/stats`) | No (undocumented) | Local cache + env vars | Use session stats; no official percent-based limits |
| Codex | Yes (`/status`) | Partial (plan/limits) | `auth.json` or keychain | For API key: Usage API + model filter |

## Tamagotchi Behavior
- `mood` remains derived from `weeklyPercent` and `needsAuth`.
- If a provider only exposes a single window, use it for both session/weekly fields and disable the daily/weekly toggle with a tooltip.
- Errors are provider-specific and only shown for the active provider.

## Styling Guidance
- Use a minimal segmented control with pill radius.
- Keep it small: ~16px height, small font (9-10px).
- Ensure it doesn’t overlap the usage bar (top-left, above character).

## Implementation Plan
1. Add provider types and new `getUsage` abstraction in `src/lib/usageParser.ts`.
2. Update `useUsageStore` to track `activeProvider`, map provider states, and route fetches through `getUsage`.
3. Add provider toggle UI to `src/components/tamagotchi/Tamagotchi.tsx` (top-left pill).
4. Add Tauri commands for Gemini and Codex in `src-tauri/src/commands/usage.rs` and register in `src-tauri/src/lib.rs`.
5. Implement provider-specific usage fetchers (Gemini `/stats`, Codex `/status` or Usage API).
6. Wire provider-specific auth hints and error handling through to the UI.
7. QA: verify provider switching, auth states, and polling behavior.

## Open Questions
- Do we want to implement Gemini usage purely from `/stats` (session-only), or invest in reverse-engineering a backend usage endpoint?
- For Codex ChatGPT login, do we accept `/status` session usage only, or try to map plan limits (if available) to a percent-based bar?
- Should active provider selection persist across app restarts?
- What should the UI show if a provider only supplies monthly usage?
- Should active provider selection persist across app restarts?

## Risks
- Provider usage APIs may be unstable or not publicly documented.
- Different rate-limit windows across providers may make daily/weekly toggle semantics inconsistent.
