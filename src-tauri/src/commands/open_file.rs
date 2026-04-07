//! IPC commands for reading and writing UTF-8 text files.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTextFileResponse {
    pub path: String,
    pub content: String,
}

fn canonicalize_file_path(file_path: &str) -> Result<std::path::PathBuf, String> {
    let canonical = std::fs::canonicalize(file_path)
        .map_err(|e| format!("Invalid file path '{}': {}", file_path, e))?;

    if !canonical.is_file() {
        return Err(format!("Path '{}' is not a file", canonical.display()));
    }

    Ok(canonical)
}

/// Reads an existing UTF-8 text file.
#[tauri::command]
pub async fn read_text_file(file_path: String) -> Result<OpenTextFileResponse, String> {
    let canonical = canonicalize_file_path(&file_path)?;
    let content = tokio::fs::read_to_string(&canonical)
        .await
        .map_err(|e| format!("Failed to read text file '{}': {}", canonical.display(), e))?;

    Ok(OpenTextFileResponse {
        path: canonical.to_string_lossy().into_owned(),
        content,
    })
}

/// Writes content back to an existing UTF-8 text file.
#[tauri::command]
pub async fn write_text_file(file_path: String, content: String) -> Result<(), String> {
    let canonical = canonicalize_file_path(&file_path)?;
    tokio::fs::write(&canonical, content)
        .await
        .map_err(|e| format!("Failed to write text file '{}': {}", canonical.display(), e))
}

#[cfg(test)]
mod tests {
    use super::{read_text_file, write_text_file};

    #[tokio::test]
    async fn reads_and_writes_text_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.md");
        std::fs::write(&path, "# Hello\n").unwrap();

        let opened = read_text_file(path.to_string_lossy().into_owned())
            .await
            .unwrap();
        assert_eq!(opened.content, "# Hello\n");

        write_text_file(path.to_string_lossy().into_owned(), "# Updated\n".to_string())
            .await
            .unwrap();

        let updated = std::fs::read_to_string(&path).unwrap();
        assert_eq!(updated, "# Updated\n");
    }

    #[tokio::test]
    async fn rejects_directories() {
        let dir = tempfile::tempdir().unwrap();
        let err = read_text_file(dir.path().to_string_lossy().into_owned())
            .await
            .unwrap_err();
        assert!(err.contains("is not a file"));
    }
}
