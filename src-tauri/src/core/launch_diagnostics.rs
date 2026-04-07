use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;

static APP_DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn init(app_data_dir: PathBuf) {
    if APP_DATA_DIR.set(app_data_dir.clone()).is_ok() {
        log::info!(
            "Launch diagnostics will be written to {}",
            app_data_dir.join("launch-diagnostics.log").display()
        );
    }
}

pub fn append(event: &str, details: &str) {
    let Some(app_data_dir) = APP_DATA_DIR.get() else {
        return;
    };

    if let Err(err) = fs::create_dir_all(app_data_dir) {
        log::warn!(
            "Failed to create launch diagnostics directory {}: {}",
            app_data_dir.display(),
            err
        );
        return;
    }

    let log_path = app_data_dir.join("launch-diagnostics.log");
    let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f %z");
    let sanitized = details.replace('\n', " | ");

    match OpenOptions::new().create(true).append(true).open(&log_path) {
        Ok(mut file) => {
            if let Err(err) = writeln!(file, "[{}] {} {}", timestamp, event, sanitized) {
                log::warn!(
                    "Failed to write launch diagnostic to {}: {}",
                    log_path.display(),
                    err
                );
            }
        }
        Err(err) => {
            log::warn!(
                "Failed to open launch diagnostics file {}: {}",
                log_path.display(),
                err
            );
        }
    }
}
