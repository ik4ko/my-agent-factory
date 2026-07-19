use std::{
  path::PathBuf,
  process::{Child, Command, Stdio},
  sync::{Mutex, OnceLock},
};

static LOOP_WORKER: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn worker_slot() -> &'static Mutex<Option<Child>> {
  LOOP_WORKER.get_or_init(|| Mutex::new(None))
}

fn project_root() -> Result<PathBuf, String> {
  let mut dir = std::env::current_dir().map_err(|err| format!("failed to read current directory: {err}"))?;
  loop {
    if dir.join("package.json").exists() {
      return Ok(dir);
    }
    if !dir.pop() {
      break;
    }
  }
  Err("could not locate package.json to launch the local worker".to_string())
}

fn clear_finished(slot: &mut Option<Child>) -> Result<(), String> {
  if let Some(child) = slot.as_mut() {
    if child.try_wait().map_err(|err| format!("worker status check failed: {err}"))?.is_some() {
      *slot = None;
    }
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn start_local_worker() -> Result<u32, String> {
  let mut slot = worker_slot().lock().map_err(|_| "worker lock poisoned".to_string())?;
  clear_finished(&mut slot)?;
  if let Some(child) = slot.as_ref() {
    return Ok(child.id());
  }

  let root = project_root()?;
  // On Windows npm is `npm.cmd`, which CreateProcess (std::process) will not
  // resolve from a bare "npm" — it must be launched through cmd.exe.
  let mut command = if cfg!(target_os = "windows") {
    let mut cmd = Command::new("cmd");
    cmd.args(["/C", "npm", "run", "loop-worker"]);
    cmd
  } else {
    let mut cmd = Command::new("npm");
    cmd.args(["run", "loop-worker"]);
    cmd
  };
  let child = command
    .current_dir(root)
    .stdin(Stdio::null())
    .stdout(Stdio::inherit())
    .stderr(Stdio::inherit())
    .spawn()
    .map_err(|err| format!("failed to start loop worker: {err}"))?;
  let pid = child.id();
  *slot = Some(child);
  Ok(pid)
}

#[tauri::command]
pub(crate) fn stop_local_worker() -> Result<(), String> {
  let mut slot = worker_slot().lock().map_err(|_| "worker lock poisoned".to_string())?;
  clear_finished(&mut slot)?;
  if let Some(mut child) = slot.take() {
    // On Windows the worker runs as cmd.exe → npm → node: kill() only takes
    // down cmd.exe and orphans the node process, so kill the whole tree.
    if cfg!(target_os = "windows") {
      let _ = Command::new("taskkill")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .output();
    }
    let _ = child.kill();
    let _ = child.wait();
  }
  Ok(())
}

#[tauri::command]
pub(crate) fn local_worker_status() -> Result<Option<u32>, String> {
  let mut slot = worker_slot().lock().map_err(|_| "worker lock poisoned".to_string())?;
  clear_finished(&mut slot)?;
  Ok(slot.as_ref().map(|child| child.id()))
}
