use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

#[derive(Debug, Serialize)]
pub struct UpdateInfo {
    pub available: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_notes: Option<String>,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
struct DownloadProgress {
    pub chunk_length: usize,
    pub content_length: Option<u64>,
}

#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    custom_endpoint: Option<String>,
) -> Result<UpdateInfo, String> {
    let current_version = app.package_info().version.to_string();

    let update = if let Some(endpoint) = custom_endpoint {
        let url: Url = endpoint.parse().map_err(|e| format!("Invalid endpoint URL: {e}"))?;
        app.updater_builder()
            .endpoints(vec![url])
            .map_err(|e| format!("Failed to configure updater: {e}"))?
            .build()
            .map_err(|e| format!("Failed to build updater: {e}"))?
            .check()
            .await
            .map_err(|e| format!("Failed to check for updates: {e}"))?
    } else {
        app.updater()
            .map_err(|e| format!("Failed to get updater: {e}"))?
            .check()
            .await
            .map_err(|e| format!("Failed to check for updates: {e}"))?
    };

    match update {
        Some(update) => Ok(UpdateInfo {
            available: true,
            current_version,
            latest_version: update.version.clone(),
            release_notes: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
        }),
        None => Ok(UpdateInfo {
            available: false,
            current_version: current_version.clone(),
            latest_version: current_version,
            release_notes: None,
            date: None,
        }),
    }
}

#[tauri::command]
pub async fn download_and_install_update(
    app: AppHandle,
    custom_endpoint: Option<String>,
) -> Result<(), String> {
    let update = if let Some(endpoint) = custom_endpoint {
        let url: Url = endpoint.parse().map_err(|e| format!("Invalid endpoint URL: {e}"))?;
        app.updater_builder()
            .endpoints(vec![url])
            .map_err(|e| format!("Failed to configure updater: {e}"))?
            .build()
            .map_err(|e| format!("Failed to build updater: {e}"))?
            .check()
            .await
            .map_err(|e| format!("Failed to check for updates: {e}"))?
    } else {
        app.updater()
            .map_err(|e| format!("Failed to get updater: {e}"))?
            .check()
            .await
            .map_err(|e| format!("Failed to check for updates: {e}"))?
    };

    let update = update.ok_or_else(|| "No update available".to_string())?;

    let app_handle = app.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = app_handle.emit(
                    "update-download-progress",
                    DownloadProgress {
                        chunk_length,
                        content_length,
                    },
                );
            },
            || {
                // Download finished, about to install
            },
        )
        .await
        .map_err(|e| format!("Failed to download and install update: {e}"))?;

    let _ = app.emit("update-installing", ());

    Ok(())
}

#[tauri::command]
pub async fn get_app_version(app: AppHandle) -> Result<String, String> {
    Ok(app.package_info().version.to_string())
}
