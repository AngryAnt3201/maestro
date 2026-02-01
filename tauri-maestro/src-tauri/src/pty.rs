use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use tauri::{AppHandle, Emitter};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub async fn spawn(&self, session_id: &str, app: AppHandle) -> anyhow::Result<()> {
        let pty_system = native_pty_system();

        let pair = pty_system.openpty(PtySize {
            rows: 24,
            cols: 80,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        // Get default shell
        let shell = Self::get_shell();
        let mut cmd = CommandBuilder::new(&shell);
        cmd.env("TERM", "xterm-256color");

        // Set working directory to home
        if let Some(home) = dirs::home_dir() {
            cmd.cwd(home);
        }

        let _child = pair.slave.spawn_command(cmd)?;

        let mut reader = pair.master.try_clone_reader()?;
        let writer = pair.master.take_writer()?;

        // Store session
        {
            let mut sessions = self.sessions.lock();
            sessions.insert(
                session_id.to_string(),
                PtySession {
                    master: pair.master,
                    writer,
                },
            );
        }

        // Spawn reader task
        let event_name = format!("pty-output-{}", session_id);
        let session_id_owned = session_id.to_string();

        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit(&event_name, data);
                    }
                    Err(_) => break,
                }
            }
            println!("PTY reader exited for session {}", session_id_owned);
        });

        Ok(())
    }

    pub async fn write(&self, session_id: &str, data: &[u8]) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock();
        if let Some(session) = sessions.get_mut(session_id) {
            session.writer.write_all(data)?;
            session.writer.flush()?;
        }
        Ok(())
    }

    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> anyhow::Result<()> {
        let sessions = self.sessions.lock();
        if let Some(session) = sessions.get(session_id) {
            session.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })?;
        }
        Ok(())
    }

    pub async fn kill(&self, session_id: &str) -> anyhow::Result<()> {
        let mut sessions = self.sessions.lock();
        sessions.remove(session_id);
        Ok(())
    }

    fn get_shell() -> String {
        #[cfg(windows)]
        {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
        }
        #[cfg(not(windows))]
        {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string())
        }
    }
}
