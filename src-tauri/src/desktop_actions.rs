use std::{
  env,
  fs,
  path::{Path, PathBuf},
  process::Command,
};

#[tauri::command]
pub(crate) fn create_desktop_folder(folder_name: String) -> Result<String, String> {
  let name = sanitize_folder_name(&folder_name)?;
  let desktop_dir = desktop_directory()?;
  let target = desktop_dir.join(&name);

  if target.exists() {
    return Ok(target.display().to_string());
  }

  fs::create_dir_all(&target)
    .map_err(|err| format!("failed to create desktop folder '{name}': {err}"))?;

  Ok(target.display().to_string())
}

#[tauri::command]
pub(crate) fn create_desktop_shortcut() -> Result<String, String> {
  let desktop_dir = desktop_directory()?;
  let shortcut = desktop_dir.join("My Agent Factory Launcher.lnk");
  write_windows_shortcut(&shortcut, "My Agent Factory Launcher", "desktop shortcut")?;
  Ok(shortcut.display().to_string())
}

#[tauri::command]
pub(crate) fn open_project_root() -> Result<String, String> {
  let root = workspace_directory()?;
  open_in_file_explorer(&root)?;
  Ok(root.display().to_string())
}

#[tauri::command]
pub(crate) fn open_desktop_root() -> Result<String, String> {
  let desktop_dir = desktop_directory()?;
  open_in_file_explorer(&desktop_dir)?;
  Ok(desktop_dir.display().to_string())
}

#[tauri::command]
pub(crate) fn is_autostart_enabled() -> Result<bool, String> {
  if !cfg!(target_os = "windows") {
    return Ok(false);
  }

  Ok(startup_shortcut_path()?.exists())
}

#[tauri::command]
pub(crate) fn set_autostart_enabled(enabled: bool) -> Result<bool, String> {
  if !cfg!(target_os = "windows") {
    return Err("autostart is currently implemented for Windows desktop builds only".to_string());
  }

  let shortcut = startup_shortcut_path()?;

  if enabled {
    create_autostart_shortcut(&shortcut)?;
  } else if shortcut.exists() {
    fs::remove_file(&shortcut)
      .map_err(|err| format!("failed to remove autostart shortcut '{}': {err}", shortcut.display()))?;
  }

  Ok(enabled)
}

fn desktop_directory() -> Result<PathBuf, String> {
  dirs::desktop_dir()
    .or_else(|| dirs::home_dir().map(|home| home.join("Desktop")))
    .ok_or_else(|| "could not locate the Desktop folder for this user".to_string())
}

fn workspace_directory() -> Result<PathBuf, String> {
  env::current_dir()
    .map_err(|err| format!("failed to resolve the current workspace directory: {err}"))
}

fn startup_shortcut_path() -> Result<PathBuf, String> {
  let appdata = env::var_os("APPDATA")
    .ok_or_else(|| "APPDATA is not set; cannot locate the Windows startup folder".to_string())?;
  let startup_dir = PathBuf::from(appdata)
    .join("Microsoft")
    .join("Windows")
    .join("Start Menu")
    .join("Programs")
    .join("Startup");
  fs::create_dir_all(&startup_dir).map_err(|err| {
    format!(
      "failed to create or access the Windows startup folder '{}': {err}",
      startup_dir.display()
    )
  })?;
  Ok(startup_dir.join("My Agent Factory.lnk"))
}

fn open_in_file_explorer(path: &Path) -> Result<(), String> {
  let mut command = if cfg!(target_os = "windows") {
    let mut cmd = Command::new("explorer.exe");
    cmd.arg(path);
    cmd
  } else if cfg!(target_os = "macos") {
    let mut cmd = Command::new("open");
    cmd.arg(path);
    cmd
  } else {
    let mut cmd = Command::new("xdg-open");
    cmd.arg(path);
    cmd
  };

  command
    .spawn()
    .map_err(|err| format!("failed to open '{}' in the file explorer: {err}", path.display()))?;
  Ok(())
}

fn create_autostart_shortcut(shortcut_path: &Path) -> Result<(), String> {
  write_windows_shortcut(shortcut_path, "My Agent Factory", "autostart shortcut")
}

fn write_windows_shortcut(shortcut_path: &Path, description: &str, label: &str) -> Result<(), String> {
  let executable = env::current_exe()
    .map_err(|err| format!("failed to resolve the current executable path: {err}"))?;
  let working_dir = executable
    .parent()
    .ok_or_else(|| format!("failed to resolve the executable directory for the {label}"))?;

  let shortcut = ps_quote(shortcut_path);
  let target = ps_quote(&executable);
  let working = ps_quote(working_dir);
  let icon = executable.to_string_lossy().replace('\'', "''");
  let description = ps_quote_text(description);
  let script = format!(
    r#"$ErrorActionPreference = 'Stop'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut({shortcut})
$shortcut.TargetPath = {target}
$shortcut.WorkingDirectory = {working}
$shortcut.Description = {description}
$shortcut.IconLocation = '{icon},0'
$shortcut.Save()
"#
  );

  let output = Command::new("powershell.exe")
    .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-Command", &script])
    .output()
    .map_err(|err| format!("failed to invoke PowerShell to create the {label}: {err}"))?;

  if output.status.success() {
    Ok(())
  } else {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if stderr.is_empty() {
      format!("PowerShell failed to create the {label} for '{}'", shortcut_path.display())
    } else {
      format!("PowerShell failed to create the {label} for '{}': {stderr}", shortcut_path.display())
    })
  }
}

fn ps_quote(value: &Path) -> String {
  let text = value.to_string_lossy().replace('\'', "''");
  format!("'{}'", text)
}

fn ps_quote_text(value: &str) -> String {
  let text = value.replace('\'', "''");
  format!("'{}'", text)
}

fn sanitize_folder_name(input: &str) -> Result<String, String> {
  let trimmed = input.trim();
  if trimmed.is_empty() {
    return Err("folder name cannot be empty".to_string());
  }
  if trimmed == "." || trimmed == ".." {
    return Err("folder name cannot be '.' or '..'".to_string());
  }
  if trimmed.contains(['/', '\\', '\0']) {
    return Err("folder name cannot contain path separators".to_string());
  }

  let cleaned: String = trimmed
    .chars()
    .map(|ch| {
      if ch.is_ascii_alphanumeric() || matches!(ch, ' ' | '-' | '_' | '.' | '(' | ')') {
        ch
      } else {
        '_'
      }
    })
    .collect::<String>()
    .trim()
    .trim_matches('.')
    .to_string();

  if cleaned.is_empty() {
    return Err("folder name became empty after sanitization".to_string());
  }

  Ok(cleaned)
}
