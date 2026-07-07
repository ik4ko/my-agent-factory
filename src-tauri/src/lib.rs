use tauri::webview::PageLoadEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
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
