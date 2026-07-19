use tauri::webview::PageLoadEvent;

mod desktop_actions;
mod local_worker;
use desktop_actions::{
  create_desktop_folder,
  create_desktop_shortcut,
  is_autostart_enabled,
  open_desktop_root,
  open_project_root,
  set_autostart_enabled,
};
use local_worker::{local_worker_status, start_local_worker, stop_local_worker};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      create_desktop_folder,
      create_desktop_shortcut,
      open_project_root,
      open_desktop_root,
      is_autostart_enabled,
      set_autostart_enabled,
      start_local_worker,
      stop_local_worker,
      local_worker_status
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    // The main window is configured `visible: false`; it is revealed only
    // once the first page finishes loading, so the frameless transparent
    // frame never paints an uninitialized webview (white flash on Windows,
    // decoration flicker on macOS). Re-fires on dev reloads — show() on a
    // visible window is a no-op.
    .on_page_load(|webview, payload| {
      if matches!(payload.event(), PageLoadEvent::Finished) {
        let window = webview.window();
        let _ = window.show();
        let _ = window.set_focus();
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
