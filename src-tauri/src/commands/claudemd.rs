//! IPC commands for CLAUDE.md file detection and editing.

use serde::Serialize;

/// Status of CLAUDE.md file at project root.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeMdStatus {
    pub exists: bool,
    pub path: String,
    pub content: Option<String>,
}

/// Check if CLAUDE.md exists at project root and optionally return its content.
#[tauri::command]
pub async fn check_claude_md(project_path: String) -> Result<ClaudeMdStatus, String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?;

    let claude_md_path = canonical.join("CLAUDE.md");
    let path_str = claude_md_path.to_string_lossy().into_owned();

    if claude_md_path.exists() {
        // Read content if file exists
        let content = tokio::fs::read_to_string(&claude_md_path).await.ok();

        Ok(ClaudeMdStatus {
            exists: true,
            path: path_str,
            content,
        })
    } else {
        Ok(ClaudeMdStatus {
            exists: false,
            path: path_str,
            content: None,
        })
    }
}

/// Read CLAUDE.md content from project root.
#[tauri::command]
pub async fn read_claude_md(project_path: String) -> Result<String, String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?;

    let claude_md_path = canonical.join("CLAUDE.md");

    tokio::fs::read_to_string(&claude_md_path)
        .await
        .map_err(|e| format!("Failed to read CLAUDE.md: {}", e))
}

/// Write content to CLAUDE.md at project root (creates if doesn't exist).
#[tauri::command]
pub async fn write_claude_md(project_path: String, content: String) -> Result<(), String> {
    let canonical = std::fs::canonicalize(&project_path)
        .map_err(|e| format!("Invalid project path '{}': {}", project_path, e))?;

    let claude_md_path = canonical.join("CLAUDE.md");

    tokio::fs::write(&claude_md_path, content)
        .await
        .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))
}
