//! Scheduler: watches all enabled jobs with a cron schedule and a Maestro
//! driver, wakes on soonest next-fire, spawns dispatches under a
//! concurrency cap, and forwards DispatchEvents out for broadcasting.

use crate::core::ops::drivers::{DispatchContext, DispatchEvent, DispatchTx, Driver};
use crate::core::ops::model::{Job, JobDriver, TriggeredBy};
use chrono::{DateTime, Utc};
use cron::Schedule;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{mpsc, Mutex, Semaphore};

pub const DEFAULT_CONCURRENCY_CAP: usize = 4;

pub struct Scheduler {
    concurrency: Arc<Semaphore>,
    jobs: Arc<Mutex<HashMap<String, Job>>>,
    driver: Arc<dyn Driver>,
    events_tx: DispatchTx,
    pending_rx: Mutex<Option<mpsc::UnboundedReceiver<Tick>>>,
    pending_tx: mpsc::UnboundedSender<Tick>,
}

#[derive(Debug)]
enum Tick {
    Rescan,
}

impl Scheduler {
    pub fn new(driver: Arc<dyn Driver>, events_tx: DispatchTx, cap: usize) -> Self {
        let (ptx, prx) = mpsc::unbounded_channel();
        Self {
            concurrency: Arc::new(Semaphore::new(cap)),
            jobs: Arc::new(Mutex::new(HashMap::new())),
            driver,
            events_tx,
            pending_rx: Mutex::new(Some(prx)),
            pending_tx: ptx,
        }
    }

    pub async fn set_jobs(&self, jobs: Vec<Job>) {
        let mut m = self.jobs.lock().await;
        m.clear();
        for j in jobs {
            m.insert(j.id.clone(), j);
        }
        let _ = self.pending_tx.send(Tick::Rescan);
    }

    pub async fn upsert_job(&self, job: Job) {
        self.jobs.lock().await.insert(job.id.clone(), job);
        let _ = self.pending_tx.send(Tick::Rescan);
    }

    pub async fn remove_job(&self, id: &str) {
        self.jobs.lock().await.remove(id);
        let _ = self.pending_tx.send(Tick::Rescan);
    }

    pub fn spawn(self: Arc<Self>) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            self.run().await;
        })
    }

    async fn run(self: Arc<Self>) {
        let mut rx = match self.pending_rx.lock().await.take() {
            Some(rx) => rx,
            None => return,
        };
        loop {
            let next = self.next_fire(Utc::now()).await;
            let wait_for = match next {
                Some((_, when)) => {
                    let now = Utc::now();
                    if when > now { (when - now).to_std().unwrap_or(Duration::from_millis(100)) }
                    else { Duration::from_millis(0) }
                }
                None => Duration::from_secs(3600),
            };
            tokio::select! {
                _ = tokio::time::sleep(wait_for) => {
                    let now = Utc::now();
                    let to_fire = self.jobs_ready(now).await;
                    for job in to_fire {
                        self.spawn_dispatch(job, TriggeredBy::Schedule).await;
                    }
                }
                evt = rx.recv() => {
                    match evt {
                        Some(Tick::Rescan) | None => continue,
                    }
                }
            }
        }
    }

    async fn next_fire(&self, now: DateTime<Utc>) -> Option<(String, DateTime<Utc>)> {
        let m = self.jobs.lock().await;
        let mut earliest: Option<(String, DateTime<Utc>)> = None;
        for job in m.values() {
            if !job.enabled { continue; }
            if job.driver != JobDriver::Maestro { continue; }
            let Some(expr) = &job.schedule else { continue; };
            let Ok(sched) = Schedule::from_str(expr) else { continue; };
            if let Some(next) = sched.after(&now).next() {
                match &earliest {
                    Some((_, e)) if *e <= next => {}
                    _ => earliest = Some((job.id.clone(), next)),
                }
            }
        }
        earliest
    }

    async fn jobs_ready(&self, now: DateTime<Utc>) -> Vec<Job> {
        let m = self.jobs.lock().await;
        let mut out = Vec::new();
        for job in m.values() {
            if !job.enabled { continue; }
            if job.driver != JobDriver::Maestro { continue; }
            let Some(expr) = &job.schedule else { continue; };
            let Ok(sched) = Schedule::from_str(expr) else { continue; };
            let previous = sched.after(&(now - chrono::Duration::seconds(60))).next();
            if let Some(t) = previous {
                if t <= now { out.push(job.clone()); }
            }
        }
        out
    }

    pub async fn dispatch_now(&self, job: &Job, triggered_by: TriggeredBy) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        self.spawn_dispatch_with_id(job.clone(), triggered_by, id.clone()).await;
        id
    }

    async fn spawn_dispatch(&self, job: Job, triggered_by: TriggeredBy) {
        let id = uuid::Uuid::new_v4().to_string();
        self.spawn_dispatch_with_id(job, triggered_by, id).await;
    }

    async fn spawn_dispatch_with_id(&self, job: Job, triggered_by: TriggeredBy, id: String) {
        let permit = match self.concurrency.clone().acquire_owned().await {
            Ok(p) => p,
            Err(_) => return,
        };
        let driver = self.driver.clone();
        let tx = self.events_tx.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let _ = driver.run_now(&job, DispatchContext { dispatch_id: id, triggered_by }, tx).await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ops::drivers::fake::FakeDriver;
    use crate::core::ops::model::*;
    use std::collections::HashMap;
    use std::sync::atomic::Ordering;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn dispatch_now_runs_once_through_driver() {
        let fake = Arc::new(FakeDriver::new());
        let runs_counter = fake.runs.clone();
        let (tx, _rx) = mpsc::unbounded_channel();
        let sched = Arc::new(Scheduler::new(fake as Arc<dyn Driver>, tx, 4));

        let job = Job {
            id: "j1".into(),
            name: "fake".into(),
            enabled: true,
            scope: Scope::Global,
            project_hash: None,
            tags: vec![],
            driver: JobDriver::Maestro,
            schedule: None,
            maestro: Some(MaestroJobPayload {
                command: "echo".into(),
                args: vec!["hi".into()],
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
        };
        sched.dispatch_now(&job, TriggeredBy::Manual).await;
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(runs_counter.load(Ordering::SeqCst), 1);
    }
}
