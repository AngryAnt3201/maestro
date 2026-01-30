//
//  QuickActionManager.swift
//  claude-maestro
//
//  Manages persistence and CRUD operations for custom quick actions
//

import Foundation
import SwiftUI
import Combine

/// Manages the lifecycle and persistence of custom quick actions
@MainActor
class QuickActionManager: ObservableObject {
    static let shared = QuickActionManager()

    @Published var quickActions: [QuickAction] = []

    private let storageKey = "claude-maestro-quick-actions"
    private let hasInitializedKey = "claude-maestro-quick-actions-initialized"

    private init() {
        loadActions()
    }

    // MARK: - Default Actions

    /// Default quick actions provided on first launch
    static var defaultActions: [QuickAction] {
        [
            QuickAction(
                name: "Run App",
                icon: "play.fill",
                colorHex: "#34C759",
                prompt: """
                Detect project type and start the application in development mode.

                **Project Detection (check in order):**
                1. package.json → Read scripts, prefer: dev > start > serve
                2. Cargo.toml → `cargo run`
                3. go.mod → `go run .` or `go run main.go`
                4. pyproject.toml → Check for scripts, or `python -m <package>` or `python main.py/app.py`
                5. requirements.txt + manage.py → `python manage.py runserver`
                6. requirements.txt + app.py → `flask run` or `python app.py`
                7. Package.swift → `swift run`
                8. Makefile → Check for `run`, `dev`, `serve` targets
                9. docker-compose.yml → `docker-compose up`
                10. Dockerfile → `docker build && docker run`

                **Pre-run Checks:**
                1. Check if dependencies are installed:
                   - Node: node_modules/ exists? If not, run npm/yarn/pnpm install
                   - Python: venv exists and activated? Dependencies installed?
                   - Rust: Cargo.lock exists?
                   - Go: go.sum exists?

                2. Check if port is available:
                   - Detect expected port from config/scripts
                   - If port in use, offer to kill existing process or use different port

                3. Check for required environment:
                   - .env.example exists but no .env? Warn user
                   - Required env vars referenced but not set?

                **Execution:**
                1. Report detected project type and chosen command
                2. Start the application
                3. For web apps: provide the URL (http://localhost:PORT)
                4. Stream output so errors are visible
                5. If startup fails, analyze the error and suggest fixes

                **Handle Common Failures:**
                - "Port in use" → Offer to find and kill process or use alt port
                - "Module not found" → Run dependency installation
                - "Env var missing" → Show which vars are needed
                - Build errors → Show error and suggest fix
                """,
                sortOrder: 0
            ),
            QuickAction(
                name: "Commit & Push",
                icon: "arrow.up.circle.fill",
                colorHex: "#007AFF",
                prompt: """
                Safely commit and push changes to the remote repository.

                **Pre-flight Checks:**
                1. Run `git status` - verify there are changes to commit
                2. Run `git diff --cached` - review what's actually staged
                3. Check current branch - warn if on main/master
                4. Check for upstream - verify remote tracking branch exists
                5. Check if remote is ahead - pull/rebase if needed before pushing

                **Security Scan (BLOCK if found):**
                - .env files or files matching *.env*
                - Patterns: API_KEY, SECRET, PASSWORD, TOKEN, PRIVATE_KEY in file contents
                - Private key files (id_rsa, *.pem, *.key)
                - Credential files (credentials.json, serviceAccount.json)
                - Hardcoded connection strings with passwords

                **Code Quality Warnings (ask before proceeding):**
                - console.log/print/debugger statements in non-test files
                - .only() or .skip() in test files
                - Large commented-out code blocks (>10 lines)
                - TODO/FIXME comments in the diff

                **Files to Never Stage:**
                - node_modules/, __pycache__/, .venv/, vendor/
                - Build outputs: dist/, build/, *.o, *.pyc
                - IDE files: .idea/, .vscode/settings.json (unless intentional)
                - OS files: .DS_Store, Thumbs.db

                **Commit Message:**
                - Analyze the actual changes to write an accurate message
                - Use conventional commits if the repo already uses them
                - Keep first line under 72 characters
                - Reference issue numbers if apparent from branch name or context

                **Execution:**
                1. Stage appropriate files (prefer explicit paths over -A)
                2. Create commit with descriptive message
                3. Push to current branch's upstream
                4. Report: commit hash, files changed, insertions/deletions

                **Never:**
                - Force push
                - Push to main/master without explicit user confirmation
                - Commit files matching .gitignore patterns
                - Proceed if security scan finds issues
                """,
                sortOrder: 1
            ),
            QuickAction(
                name: "Fix Errors",
                icon: "exclamationmark.triangle.fill",
                colorHex: "#FF9500",
                prompt: """
                Analyze and fix errors from the terminal, build output, or runtime.

                **Error Detection:**
                1. Read recent terminal output for error messages
                2. Look for common error patterns:
                   - Stack traces with file:line references
                   - Compiler/build errors with file paths
                   - Runtime exceptions
                   - Test failures
                   - Lint/type check errors

                **Analysis Process:**
                1. Parse the error to extract:
                   - Error type/message
                   - File path and line number
                   - Stack trace (if present)
                   - Related context

                2. Read the referenced file(s) to understand context

                3. Identify root cause:
                   - Syntax error?
                   - Type mismatch?
                   - Missing import/dependency?
                   - Null/undefined access?
                   - Logic error?
                   - Configuration issue?

                **Fix Strategy:**
                1. Make the minimal change that fixes the error
                2. Don't refactor unrelated code
                3. Don't "improve" code style unless it's the cause
                4. Preserve existing patterns and conventions
                5. If fix is uncertain, explain options and ask

                **Verification:**
                1. After fixing, re-run the command that produced the error
                2. If new errors appear, address them
                3. Report what was fixed and confirm resolution

                **Edge Cases:**
                - Multiple errors: Fix in dependency order (earlier errors often cause later ones)
                - Unclear error: Ask user for more context rather than guessing
                - Error in generated code: Fix the source, not the generated output
                - Error in dependency: Suggest version change or workaround, don't modify node_modules
                """,
                sortOrder: 2
            ),
            QuickAction(
                name: "Lint & Format",
                icon: "wand.and.stars",
                colorHex: "#AF52DE",
                prompt: """
                Run the project's linter and formatter to fix code style issues.

                **Tool Detection (check for config files):**

                Linters:
                - .eslintrc* / eslint.config.* → ESLint
                - .pylintrc / pyproject.toml [tool.pylint] → Pylint
                - pyproject.toml [tool.ruff] / ruff.toml → Ruff (prefer over pylint if both)
                - .rubocop.yml → RuboCop
                - .golangci.yml → golangci-lint
                - clippy (Rust) → `cargo clippy`

                Formatters:
                - .prettierrc* → Prettier
                - pyproject.toml [tool.black] → Black
                - pyproject.toml [tool.ruff.format] → Ruff format
                - rustfmt.toml → `cargo fmt`
                - .clang-format → clang-format
                - gofmt (Go) → `go fmt`

                Type Checkers:
                - tsconfig.json → `tsc --noEmit`
                - pyproject.toml [tool.mypy] → mypy
                - pyrightconfig.json → pyright

                **Execution Order:**
                1. Format first (changes file structure)
                2. Then lint with auto-fix (fixes logical issues)
                3. Then type-check (reports remaining issues)

                **Commands by Stack:**

                Node/TypeScript:
                - npx prettier --write .
                - npx eslint --fix .
                - npx tsc --noEmit

                Python:
                - ruff format . (or black .)
                - ruff check --fix . (or pylint with fixes)
                - mypy . (or pyright)

                Rust:
                - cargo fmt
                - cargo clippy --fix --allow-dirty

                Go:
                - go fmt ./...
                - golangci-lint run --fix

                **Handling Results:**
                1. Report files modified by formatting
                2. List any lint errors that couldn't be auto-fixed
                3. List any type errors found
                4. For unfixable issues: show file:line and the problem

                **Scope Control:**
                - Default: Run on entire project
                - If user specifies file(s): Run only on those
                - Respect .gitignore and tool-specific ignore files
                - Skip node_modules, vendor, build outputs, etc.

                **Never:**
                - Modify third-party code
                - Disable lint rules to make errors go away
                - Change config files unless asked
                """,
                sortOrder: 3
            )
        ]
    }

    // MARK: - Computed Properties

    /// Returns all actions sorted by sortOrder
    var sortedActions: [QuickAction] {
        quickActions.sorted { $0.sortOrder < $1.sortOrder }
    }

    // MARK: - CRUD Operations

    /// Add a new quick action
    func addAction(_ action: QuickAction) {
        var newAction = action
        // Set sort order to be last
        newAction.sortOrder = (quickActions.map { $0.sortOrder }.max() ?? -1) + 1
        quickActions.append(newAction)
        persistActions()
    }

    /// Update an existing quick action
    func updateAction(_ action: QuickAction) {
        if let index = quickActions.firstIndex(where: { $0.id == action.id }) {
            quickActions[index] = action
            persistActions()
        }
    }

    /// Delete a quick action by ID
    func deleteAction(id: UUID) {
        quickActions.removeAll { $0.id == id }
        persistActions()
    }

    /// Reorder actions (used for drag-and-drop)
    func reorderActions(from source: IndexSet, to destination: Int) {
        quickActions.move(fromOffsets: source, toOffset: destination)
        // Update sort orders
        for (index, _) in quickActions.enumerated() {
            quickActions[index].sortOrder = index
        }
        persistActions()
    }

    // MARK: - Persistence

    private func persistActions() {
        if let encoded = try? JSONEncoder().encode(quickActions) {
            UserDefaults.standard.set(encoded, forKey: storageKey)
        }
    }

    private func loadActions() {
        if let data = UserDefaults.standard.data(forKey: storageKey),
           let decoded = try? JSONDecoder().decode([QuickAction].self, from: data) {
            quickActions = decoded.sorted { $0.sortOrder < $1.sortOrder }
        } else if !UserDefaults.standard.bool(forKey: hasInitializedKey) {
            // First launch - add default actions
            quickActions = Self.defaultActions
            UserDefaults.standard.set(true, forKey: hasInitializedKey)
            persistActions()
        }
    }

    /// Reset quick actions to defaults
    func resetToDefaults() {
        quickActions = Self.defaultActions
        persistActions()
    }
}
