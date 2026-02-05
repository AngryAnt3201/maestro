# Fix: macOS repeating permission prompts for external/network drives

## Status: IMPLEMENTED -- PR #120

**Tested on:** Mac Studio M2 Ultra (MQH63LL/A), macOS 26.2 (Tahoe)
**PR:** https://github.com/its-maestro-baby/maestro/pull/120

## The Problem

On macOS 26.2 (Tahoe), Maestro shows the system "allow access to removable volumes" dialog
in a non-stop loop every time it launches. It asks once per drive rather than once total.
The dialog never stops appearing.

**Hardware:** Mac Studio M2 Ultra (MQH63LL/A), macOS 26.2 (Tahoe)

## Why This Happens

This is a **completely different system** from the TCC/FDA permission problem fixed in PR #110.

| System | What it protects | Fixed by |
|--------|-----------------|----------|
| TCC (Transparency, Consent, Control) | ~/Desktop, ~/Documents, ~/Downloads | Full Disk Access (PR #110) |
| Removable Volume Consent | /Volumes/* (USB drives, external SSDs) | `NSRemovableVolumesUsageDescription` in Info.plist |
| Network Volume Consent | /Volumes/* (SMB, NFS, AFP mounts) | `NSNetworkVolumesUsageDescription` in Info.plist |

PR #110 explicitly **skips** `/Volumes/*` paths because they are not TCC-protected:

```typescript
// src/lib/permissions.ts (current code, line 98)
export function pathRequiresFDA(path: string): boolean {
  if (path.startsWith("/Volumes/")) {
    return false;  // <-- External drives bypass ALL permission checks
  }
  // ... only checks ~/Desktop, ~/Documents, ~/Downloads
}
```

This is correct for TCC. But macOS has a separate consent system for removable and
network volumes that requires Info.plist keys to work properly.

## Root Cause

The generated `Info.plist` in the built app (`Maestro.app/Contents/Info.plist`) contains
**no volume access declarations**:

```xml
<!-- Current generated Info.plist (MISSING volume keys) -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>English</string>
  <key>CFBundleDisplayName</key>
  <string>Maestro</string>
  <key>CFBundleExecutable</key>
  <string>maestro</string>
  <key>CFBundleIconFile</key>
  <string>icon.icns</string>
  <key>CFBundleIdentifier</key>
  <string>com.maestro.app</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Maestro</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>CSResourcesFileMapped</key>
  <true/>
  <key>LSMinimumSystemVersion</key>
  <string>10.15</string>
  <key>LSRequiresCarbon</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
```

Without `NSRemovableVolumesUsageDescription` and `NSNetworkVolumesUsageDescription`,
macOS either:
- Shows a generic consent dialog that it cannot properly remember
- Repeats the dialog on every access attempt because the app never declared its intent

## Why It Loops

On app launch, the workspace store restores persisted tabs from the previous session.
Each tab has a `projectPath` on `/Volumes/Jay/`:

```typescript
// src/stores/useWorkspaceStore.ts (line 114-248)
// Zustand persist restores tabs on launch, each with projectPath like:
// "/Volumes/Jay/projects/toolbox"
// "/Volumes/Jay/projects/other-project"
```

The app then immediately tries to access each path:
- `git_current_branch` invoke (App.tsx line 119) for the active tab
- Any other path-dependent operations

Each access attempt triggers macOS consent because the app never declared volume
access intent. Multiple tabs = multiple paths = multiple dialogs.

---

## The Fix

One file needs to be created. No code changes needed.

### Create: `src-tauri/Info.plist`

Tauri v2 automatically merges a custom `src-tauri/Info.plist` into the generated one
at build time. No configuration changes needed in `tauri.conf.json`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSRemovableVolumesUsageDescription</key>
  <string>Maestro needs access to external drives to open and manage projects stored on removable media.</string>
  <key>NSNetworkVolumesUsageDescription</key>
  <string>Maestro needs access to network drives to open and manage projects stored on network shares.</string>
</dict>
</plist>
```

That's it. Two keys.

### What This Does

1. macOS reads the usage descriptions from the app's Info.plist
2. First time Maestro accesses a removable volume, macOS shows ONE dialog with the
   description text explaining why the app needs access
3. User clicks "OK"
4. macOS stores the consent in its TCC database (services
   `SystemPolicyRemovableVolumes` and `SystemPolicyNetworkVolumes`), keyed to the
   app's bundle identifier
5. The dialog should not reappear for that volume and app identity

### What This Does NOT Change

- No Rust code changes
- No TypeScript code changes
- No new dependencies
- No changes to `Cargo.toml`
- No changes to `package.json`
- No changes to `tauri.conf.json`
- The FDA permission system (PR #110) is unaffected

---

## Current File Inventory

| File | Exists? | Needs Change? |
|------|---------|---------------|
| `src-tauri/Info.plist` | NO | CREATE |
| `src-tauri/tauri.conf.json` | Yes | No |
| `src-tauri/Cargo.toml` | Yes | No |
| `src-tauri/src/lib.rs` | Yes | No |
| `src/lib/permissions.ts` | Yes | No |
| `src/lib/useOpenProject.ts` | Yes | No |
| `src/stores/useWorkspaceStore.ts` | Yes | No |
| `package.json` | Yes | No |

---

## Testing

After creating the Info.plist and rebuilding:

- [ ] Build the app: `npm run tauri build`
- [ ] Verify Info.plist merged: check `Maestro.app/Contents/Info.plist` contains
      `NSRemovableVolumesUsageDescription` and `NSNetworkVolumesUsageDescription`
- [ ] Launch app with project on external drive - should show ONE dialog
- [ ] Click OK, relaunch - should NOT show any dialog
- [ ] Open project on network mount (if available) - same behavior
- [ ] Open project in ~/Documents - should still trigger FDA flow (PR #110)

### Reset Test (if needed)

To reset macOS consent and test again:
```bash
tccutil reset SystemPolicyRemovableVolumes com.maestro.app
tccutil reset SystemPolicyNetworkVolumes com.maestro.app
```

---

## Note on tauri-plugin-persisted-scope

This plugin was considered but is NOT needed for this fix.

`tauri-plugin-persisted-scope` persists Tauri's internal webview scope (what the
frontend JS can access via `@tauri-apps/plugin-fs`). Maestro does not use the Tauri
fs plugin. All filesystem operations go through custom Rust invoke commands, which
bypass Tauri's scope system entirely.

The macOS volume consent dialogs are an OS-level system triggered when any process
(including Rust backend code) accesses `/Volumes/*` paths. The fix is the Info.plist
declaration, not a Tauri plugin.

## Sandbox Note

This assumes Maestro is **not sandboxed** (Tauri desktop default). If it were
sandboxed, you would also need entitlements and user-picked access; direct path
access to `/Volumes/*` would be constrained even with usage descriptions.

---

## References

- [Tauri v2: macOS Application Bundle](https://v2.tauri.app/distribute/macos-application-bundle/) - Info.plist merge behavior
- [Tauri v2: Configuration Files](https://v2.tauri.app/develop/configuration-files/) - src-tauri/Info.plist auto-merge
- [Apple: NSRemovableVolumesUsageDescription](https://developer.apple.com/documentation/bundleresources/information_property_list/nsremovablevolumesusagedescription)
- [Apple: NSNetworkVolumesUsageDescription](https://developer.apple.com/documentation/bundleresources/information_property_list/nsnetworkvolumesusagedescription)
- [Tauri example Info.plist](https://github.com/tauri-apps/tauri/blob/dev/examples/api/src-tauri/Info.plist) - Shows pattern for custom plist keys
