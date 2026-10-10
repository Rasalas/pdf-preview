use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Files the OS asked us to open ("Open with", double-click) that the web app has not picked up yet.
#[derive(Default)]
struct OpenedFiles(Mutex<Vec<String>>);

#[tauri::command]
fn take_opened_files(state: tauri::State<OpenedFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(OpenedFiles::default())
        .setup(|app| {
            // Windows and Linux pass files to open as arguments; macOS uses RunEvent::Opened below.
            let paths = std::env::args().skip(1).filter(|a| !a.starts_with('-'));
            app.state::<OpenedFiles>().0.lock().unwrap().extend(paths);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![take_opened_files])
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned());
                _app.state::<OpenedFiles>().0.lock().unwrap().extend(paths);
                let _ = _app.emit("files-opened", ());
            }
        });
}
