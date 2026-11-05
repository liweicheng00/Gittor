// Hides the console window on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use gittor_service::Service;
use serde_json::Value;
use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

/// Runs a command of the service by name, as the dev server does. The command runs off the UI thread,
/// because git can take a while on a large repository. `body` holds the arguments, and "root" names the
/// repository of the command. A failure is `{ error, kind }`.
#[tauri::command(async)]
fn call(state: State<'_, Service>, cmd: String, body: Value) -> Result<Value, Value> {
    let out = state.dispatch(&cmd, &body.to_string()).map_err(|e| gittor_service::errors::error_json(&e))?;
    serde_json::from_str(&out).map_err(|e| gittor_service::errors::error_json(&e.to_string()))
}

/// The repository path given on the command line, if any.
#[tauri::command]
fn initial_path() -> Option<String> {
    std::env::args().nth(1).filter(|a| !a.starts_with('-'))
}

/// Zooms the page of the window, as the zoom of a browser: 1.0 is 100%. The text and the layout scale
/// together, so the editors keep their mouse positions.
#[tauri::command]
fn set_zoom(webview: tauri::Webview, level: f64) -> Result<(), String> {
    webview.set_zoom(level.clamp(0.5, 3.0)).map_err(|e| e.to_string())
}

/// The app checks for updates only when the build has the public key of the updater. A release build
/// on GitHub gets it from `tauri.release.conf.json`; a local build has none.
struct Updates(bool);

/// True when this build can check for updates and install them.
#[tauri::command]
fn updates_enabled(updates: State<'_, Updates>) -> bool {
    updates.0
}

/// Opens a repository in a new window at a place on the screen, for a tab that the user drags out of
/// the tab bar. The window gets the path from an initialization script, and it does not keep the tabs
/// of the session. The command is async: a window made on the main thread of a
/// synchronous command can deadlock on Windows.
#[tauri::command(async)]
fn open_window(app: tauri::AppHandle, path: String, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);
    let label = format!("repo-{}", NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let name = std::path::Path::new(&path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone());
    let data = serde_json::json!({ "repo": path });
    let builder = tauri::WebviewWindowBuilder::new(&app, label, tauri::WebviewUrl::default())
        .title(format!("{name} – Gittor"))
        .position(x, y)
        .inner_size(width.max(600.0), height.max(400.0))
        .min_inner_size(600.0, 400.0)
        .disable_drag_drop_handler()
        .initialization_script(format!("window.__GITTOR_WINDOW__ = {data};"));
    // The same title bar as the main window (tauri.conf.json): the tabs go next to the window buttons.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(14.0, 22.0));
    builder.build().map_err(|e| e.to_string())?;
    Ok(())
}

/// Brings a window to the front: a repository shows in one window only.
#[tauri::command]
fn focus_window(app: tauri::AppHandle, label: String) -> Result<(), String> {
    let w = app.get_webview_window(&label).ok_or_else(|| format!("no window {label}"))?;
    let _ = w.unminimize();
    w.set_focus().map_err(|e| e.to_string())
}

/// WebKitGTK draws with OpenGL. Without a GPU render node, Mesa runs OpenGL on the CPU (llvmpipe), and the
/// GL buffers live in normal memory: about 280 MB more on git/git, and more CPU time. The software path of
/// WebKit is cheaper then. A user setting of the variable wins.
#[cfg(target_os = "linux")]
fn use_software_rendering_without_gpu() {
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
        return;
    }
    let has_gpu = std::fs::read_dir("/dev/dri")
        .map(|d| d.flatten().any(|e| e.file_name().to_string_lossy().starts_with("renderD")))
        .unwrap_or(false);
    if !has_gpu {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
}

/// The id of the menu item that closes the window.
const CLOSE_WINDOW: &str = "close-window";

/// The menu of macOS: the default menu of Tauri, but Close Window has Cmd+Shift+W. Cmd+W goes to the
/// page, where it closes the project tab.
fn app_menu<R: Runtime>(h: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let info = h.package_info();
    let about = AboutMetadata { name: Some(info.name.clone()), version: Some(info.version.to_string()), ..Default::default() };
    let close = || MenuItem::with_id(h, CLOSE_WINDOW, "Close Window", true, Some("CmdOrCtrl+Shift+W"));
    Menu::with_items(
        h,
        &[
            &Submenu::with_items(
                h,
                info.name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(h, None, Some(about))?,
                    &PredefinedMenuItem::separator(h)?,
                    &PredefinedMenuItem::services(h, None)?,
                    &PredefinedMenuItem::separator(h)?,
                    &PredefinedMenuItem::hide(h, None)?,
                    &PredefinedMenuItem::hide_others(h, None)?,
                    &PredefinedMenuItem::separator(h)?,
                    &PredefinedMenuItem::quit(h, None)?,
                ],
            )?,
            &Submenu::with_items(h, "File", true, &[&close()?])?,
            &Submenu::with_items(
                h,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(h, None)?,
                    &PredefinedMenuItem::redo(h, None)?,
                    &PredefinedMenuItem::separator(h)?,
                    &PredefinedMenuItem::cut(h, None)?,
                    &PredefinedMenuItem::copy(h, None)?,
                    &PredefinedMenuItem::paste(h, None)?,
                    &PredefinedMenuItem::select_all(h, None)?,
                ],
            )?,
            &Submenu::with_items(h, "View", true, &[&PredefinedMenuItem::fullscreen(h, None)?])?,
            &Submenu::with_items(
                h,
                "Window",
                true,
                &[&PredefinedMenuItem::minimize(h, None)?, &PredefinedMenuItem::maximize(h, None)?, &PredefinedMenuItem::separator(h)?, &close()?],
            )?,
        ],
    )
}

fn main() {
    gittor_service::askpass::run_helper_if_requested();
    #[cfg(target_os = "linux")]
    use_software_rendering_without_gpu();
    let builder = tauri::Builder::default();
    #[cfg(target_os = "macos")]
    let builder = builder.menu(app_menu);
    #[cfg(not(target_os = "macos"))]
    let _ = app_menu::<tauri::Wry>;
    builder
        .on_menu_event(|app, event| {
            if event.id() == CLOSE_WINDOW {
                if let Some(w) = app.webview_windows().into_values().find(|w| w.is_focused().unwrap_or(false)) {
                    let _ = w.close();
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(Service::with_askpass(&std::env::current_exe().expect("current executable")))
        .setup(|app| {
            let pubkey = app.config().plugins.0.get("updater").and_then(|u| u.get("pubkey")).and_then(|k| k.as_str()).unwrap_or("");
            let updates = !pubkey.trim().is_empty();
            if updates {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            }
            app.manage(Updates(updates));
            // The backend events go to the window as "backend-event".
            let events = app.state::<Service>().subscribe();
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                for e in events {
                    let _ = handle.emit("backend-event", e);
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![initial_path, call, set_zoom, open_window, focus_window, updates_enabled])
        .run(tauri::generate_context!())
        .expect("error while running Gittor");
}
