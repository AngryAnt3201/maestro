mod pty;

use pty::PtyManager;
use std::sync::Arc;

#[tauri::command]
async fn spawn_pty(
    session_id: String,
    state: tauri::State<'_, Arc<PtyManager>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    state.spawn(&session_id, app).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_pty(
    session_id: String,
    data: String,
    state: tauri::State<'_, Arc<PtyManager>>,
) -> Result<(), String> {
    state.write(&session_id, data.as_bytes()).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn resize_pty(
    session_id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, Arc<PtyManager>>,
) -> Result<(), String> {
    state.resize(&session_id, cols, rows).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn kill_pty(
    session_id: String,
    state: tauri::State<'_, Arc<PtyManager>>,
) -> Result<(), String> {
    state.kill(&session_id).await.map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let pty_manager = Arc::new(PtyManager::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(pty_manager)
        .invoke_handler(tauri::generate_handler![
            spawn_pty,
            write_pty,
            resize_pty,
            kill_pty,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
