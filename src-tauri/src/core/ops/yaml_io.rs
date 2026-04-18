use crate::core::ops::model::{Job, Scope};
use crate::core::ops::store;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct JobsYaml {
    pub version: u32,
    pub jobs: Vec<Job>,
}

pub fn export_yaml(scope: Scope, project_hash: Option<&str>) -> Result<String, String> {
    let jobs = store::load_jobs(scope, project_hash).map_err(|e| e.to_string())?;
    let doc = JobsYaml { version: 1, jobs };
    serde_yaml::to_string(&doc).map_err(|e| e.to_string())
}

pub fn import_yaml(scope: Scope, project_hash: Option<&str>, body: &str) -> Result<usize, String> {
    let doc: JobsYaml = serde_yaml::from_str(body).map_err(|e| e.to_string())?;
    let mut existing = store::load_jobs(scope, project_hash).map_err(|e| e.to_string())?;
    for mut job in doc.jobs {
        job.scope = scope;
        job.project_hash = project_hash.map(|s| s.to_string());
        existing.retain(|j| j.id != job.id);
        existing.push(job);
    }
    let n = existing.len();
    store::save_jobs(scope, project_hash, &existing).map_err(|e| e.to_string())?;
    Ok(n)
}
