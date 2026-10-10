use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Files the OS asked us to open ("Open with", double-click) that the web app has not picked up yet.
#[derive(Default)]
struct OpenedFiles(Mutex<Vec<String>>);

#[tauri::command]
fn take_opened_files(state: tauri::State<OpenedFiles>) -> Vec<String> {
    std::mem::take(&mut *state.0.lock().unwrap())
}

/// Turns command-line arguments into absolute paths of existing files.
/// Linux file managers may pass `file://` URIs, and paths can be relative to the caller's directory.
fn file_args(args: impl IntoIterator<Item = String>, cwd: &Path) -> Vec<String> {
    args.into_iter()
        .filter(|a| !a.starts_with('-'))
        .filter_map(|a| {
            let path = if a.starts_with("file://") {
                tauri::Url::parse(&a).ok()?.to_file_path().ok()?
            } else {
                PathBuf::from(a)
            };
            let path = if path.is_absolute() { path } else { cwd.join(path) };
            path.is_file().then(|| path.to_string_lossy().into_owned())
        })
        .collect()
}

fn hand_over(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }
    app.state::<OpenedFiles>().0.lock().unwrap().extend(paths);
    let _ = app.emit("files-opened", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        // Must come first: a second launch ("Open with" on Windows/Linux, several selected files)
        // forwards its files to the running window instead of opening another one.
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            hand_over(app, file_args(args.into_iter().skip(1), Path::new(&cwd)));
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(OpenedFiles::default())
        .setup(|app| {
            // Windows and Linux pass files to open as arguments; macOS uses RunEvent::Opened below.
            let cwd = std::env::current_dir().unwrap_or_default();
            hand_over(app.handle(), file_args(std::env::args().skip(1), &cwd));
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
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                hand_over(_app, paths);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::file_args;
    use std::fs;

    #[test]
    fn resolves_relative_paths_and_file_uris_and_skips_the_rest() {
        let dir = std::env::temp_dir().join("pdf-preview-args-test");
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("a.pdf"), b"%PDF").unwrap();
        fs::write(dir.join("sub/b c.pdf"), b"%PDF").unwrap();
        let uri = tauri::Url::from_file_path(dir.join("sub/b c.pdf")).unwrap().to_string();

        let found = file_args(
            ["a.pdf".into(), uri, "--flag".into(), "missing.pdf".into(), "sub".into()],
            &dir,
        );

        assert_eq!(
            found,
            vec![
                dir.join("a.pdf").to_string_lossy().into_owned(),
                dir.join("sub/b c.pdf").to_string_lossy().into_owned(),
            ]
        );
    }
}
