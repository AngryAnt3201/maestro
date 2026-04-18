//! End-to-end: scheduler + fake driver + store. No Tauri AppHandle.

use maestro_lib::core::ops::drivers::{fake::FakeDriver, Driver, DispatchEvent};
use maestro_lib::core::ops::model::*;
use maestro_lib::core::ops::scheduler::Scheduler;
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

fn sample_maestro_job() -> Job {
    Job {
        id: "j1".into(),
        name: "demo".into(),
        enabled: true,
        scope: Scope::Global,
        project_hash: None,
        tags: vec![],
        driver: JobDriver::Maestro,
        schedule: None,
        maestro: Some(MaestroJobPayload {
            command: "echo".into(),
            args: vec!["integration".into()],
            cwd: None,
            env: HashMap::new(),
            timeout_sec: Some(5),
        }),
        claude_trigger: None,
        tool_id: None,
        notify_on_failure: false,
        last_dispatch: None,
        created_at: 0,
        updated_at: 0,
    }
}

#[tokio::test]
async fn scheduler_runs_job_via_fake_driver_and_emits_finished() {
    let fake = Arc::new(FakeDriver::new());
    let runs = fake.runs.clone();
    let (tx, mut rx) = mpsc::unbounded_channel::<DispatchEvent>();
    let sched = Arc::new(Scheduler::new(fake as Arc<dyn Driver>, tx, 2));

    sched.dispatch_now(&sample_maestro_job(), TriggeredBy::Manual).await;
    let evt = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await.unwrap();
    match evt {
        Some(DispatchEvent::Output { chunk, .. }) => assert!(chunk.contains("hello")),
        other => panic!("expected Output, got {other:?}"),
    }
    let evt2 = tokio::time::timeout(Duration::from_secs(2), rx.recv()).await.unwrap();
    match evt2 {
        Some(DispatchEvent::Finished { status, .. }) => assert_eq!(status, DispatchStatus::Succeeded),
        other => panic!("expected Finished, got {other:?}"),
    }
    assert_eq!(runs.load(Ordering::SeqCst), 1);
}
