#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod unified_bridge;

use std::{
    env, fs,
    io::{Read, Write},
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    webview::{NewWindowResponse, Url, WebviewWindowBuilder},
    Manager, WebviewUrl,
};

const DASHBOARD_URL: &str = "http://127.0.0.1:17991/";
const STOPPED_URL: &str = "http://tauri.localhost/index.html";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn main() {
    let root = locate_project_root().unwrap_or_else(|error| panic!("{error}"));
    let dashboard = Url::parse(DASHBOARD_URL).expect("valid dashboard URL");
    let daemon_ready = ensure_daemon(&root, &dashboard);
    let unified_preview = env::var("SWIBO_UNIFIED_PREVIEW").as_deref() == Ok("1");
    let allowed = dashboard.clone();
    let initial = if unified_preview {
        WebviewUrl::App("unified.html".into())
    } else if daemon_ready {
        WebviewUrl::External(dashboard)
    } else {
        WebviewUrl::App("index.html".into())
    };

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            unified_bridge::unified_swibo_request,
            unified_bridge::unified_swibo_registry,
            unified_bridge::unified_swibo_autostart,
            unified_bridge::unified_swibo_watch,
            unified_bridge::unified_loctl_request,
            swibo_daemon_start,
            swibo_daemon_stop
        ])
        .setup(move |app| {
            app.manage(root.clone());
            #[cfg(target_os = "windows")]
            install_daemon_menu(app, root.clone())?;
            let mut window = WebviewWindowBuilder::new(app, "main", initial.clone())
                .title(if unified_preview { "Swibo + Loctl Preview" } else { "Swibo" })
                .inner_size(1320.0, 820.0)
                .min_inner_size(900.0, 600.0)
                .on_navigation(move |url| {
                    allowed_navigation(url, &allowed)
                        || (unified_preview && allowed_preview_navigation(url))
                })
                .on_new_window(|_, _| NewWindowResponse::Deny);
            if let Some(icon) = app.default_window_icon() {
                window = window.icon(icon.clone())?;
            }
            window.build()?;
            Ok(())
        })
        .on_window_event(move |window, event| {
            // The opt-in shell owns a persistent SSE relay that holds an
            // AppHandle. Closing its only window must still terminate the
            // desktop process; the independently managed daemon keeps running.
            if unified_preview && window.label() == "main"
                && matches!(event, tauri::WindowEvent::Destroyed)
            {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Swibo");
}

fn locate_project_root() -> Result<PathBuf, String> {
    let explicit = env::var_os("MCP_SUPERVISOR_ROOT").map(PathBuf::from);
    let mut candidates = Vec::new();
    if let Some(path) = explicit { candidates.push(path); }
    if let Ok(path) = env::current_dir() { candidates.push(path); }
    if let Ok(exe) = env::current_exe() {
        if let Some(parent) = exe.parent() { candidates.push(parent.to_path_buf()); }
    }
    candidates
        .into_iter()
        .find_map(|candidate| {
            candidate
                .ancestors()
                .take(8)
                .find(|path| is_project_root(path))
                .map(Path::to_path_buf)
        })
        .ok_or_else(|| "Unable to locate Swibo project root. Set MCP_SUPERVISOR_ROOT.".to_string())
}

fn is_project_root(path: &Path) -> bool {
    path.join("src").join("daemon.js").is_file()
        && fs::read_to_string(path.join("package.json"))
            .is_ok_and(|text| text.contains("\"name\": \"mcp-supervisor\""))
}

fn endpoint_reachable(url: &Url) -> bool {
    let (Some(host), Some(port)) = (url.host_str(), url.port_or_known_default()) else {
        return false;
    };
    (host, port)
        .to_socket_addrs()
        .ok()
        .into_iter()
        .flatten()
        .filter(|address| address.ip().is_loopback())
        .any(|address| TcpStream::connect_timeout(&address, Duration::from_millis(200)).is_ok())
}

#[cfg(target_os = "windows")]
fn start_scheduled_daemon() -> Result<(), String> {
    let output = Command::new("schtasks.exe")
        .args(["/Run", "/TN", "SwiboDaemon"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|error| format!("Unable to run the Swibo Windows task: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "SwiboDaemon Windows task could not be started: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

fn start_daemon(root: &Path, url: &Url) -> Result<(), String> {
    if endpoint_reachable(url) { return Ok(()); }
    #[cfg(target_os = "windows")]
    {
        let _ = root;
        start_scheduled_daemon()?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut command = Command::new("node");
        command.arg(root.join("src").join("daemon.js")).current_dir(root)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        command.spawn().map_err(|error| error.to_string())?;
    }
    for _ in 0..60 {
        thread::sleep(Duration::from_millis(250));
        if endpoint_reachable(url) { return Ok(()); }
    }
    Err("Swibo daemon did not become ready after Start.".to_string())
}

fn stop_daemon(url: &Url) -> Result<(), String> {
    if !endpoint_reachable(url) { return Ok(()); }
    let mut stream = TcpStream::connect_timeout(
        &"127.0.0.1:17991".parse().expect("loopback address"),
        Duration::from_secs(2),
    ).map_err(|error| error.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|error| error.to_string())?;
    stream.write_all(b"POST /api/shutdown HTTP/1.1\r\nHost: 127.0.0.1:17991\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
        .map_err(|error| error.to_string())?;
    let mut buf = [0u8; 512];
    let size = stream.read(&mut buf).map_err(|error| error.to_string())?;
    if !String::from_utf8_lossy(&buf[..size]).starts_with("HTTP/1.1 202") {
        return Err("Swibo daemon did not acknowledge shutdown.".to_string());
    }
    for _ in 0..40 {
        if !endpoint_reachable(url) { return Ok(()); }
        thread::sleep(Duration::from_millis(250));
    }
    Err("Swibo daemon did not stop cleanly.".to_string())
}

#[tauri::command]
async fn swibo_daemon_start(root: tauri::State<'_, PathBuf>) -> Result<(), String> {
    let root = root.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let url = Url::parse(DASHBOARD_URL).expect("valid dashboard URL");
        start_daemon(&root, &url)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
async fn swibo_daemon_stop() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let url = Url::parse(DASHBOARD_URL).expect("valid dashboard URL");
        stop_daemon(&url)
    }).await.map_err(|error| error.to_string())?
}

#[cfg(target_os = "windows")]
fn install_daemon_menu(app: &mut tauri::App, root: PathBuf) -> tauri::Result<()> {
    let start = MenuItemBuilder::with_id("daemon-start", "Start daemon").build(app)?;
    let stop = MenuItemBuilder::with_id("daemon-stop", "Stop daemon").build(app)?;
    let section = SubmenuBuilder::new(app, "Daemon")
        .item(&start).item(&stop).build()?;
    let menu = MenuBuilder::new(app).item(&section).build()?;
    app.set_menu(menu)?;
    app.on_menu_event(move |handle, event| {
        let operation = match event.id().as_ref() {
            "daemon-start" => "start",
            "daemon-stop" => "stop",
            _ => return,
        };
        let handle = handle.clone();
        let root = root.clone();
        thread::spawn(move || {
            let url = Url::parse(DASHBOARD_URL).expect("valid dashboard URL");
            let result = if operation == "start" {
                start_daemon(&root, &url)
            } else {
                stop_daemon(&url)
            };
            if let Ok(()) = result {
                if let Some(window) = handle.get_webview_window("main") {
                    let destination = if operation == "start" { DASHBOARD_URL } else { STOPPED_URL };
                    let _ = window.navigate(Url::parse(destination).expect("valid destination"));
                }
            }
        });
    });
    Ok(())
}

fn ensure_daemon(root: &Path, url: &Url) -> bool {
    if endpoint_reachable(url) { return true; }
    #[cfg(target_os = "windows")]
    if start_scheduled_daemon().is_ok() {
        for _ in 0..40 {
            thread::sleep(Duration::from_millis(250));
            if endpoint_reachable(url) { return true; }
        }
        return false;
    }
    let mut command = Command::new("node");
    command
        .arg(root.join("src").join("daemon.js"))
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    if command.spawn().is_err() { return false; }
    for _ in 0..40 {
        thread::sleep(Duration::from_millis(250));
        if endpoint_reachable(url) { return true; }
    }
    false
}

fn allowed_navigation(candidate: &Url, expected: &Url) -> bool {
    let same_dashboard = candidate.scheme() == expected.scheme()
        && candidate.host_str() == expected.host_str()
        && candidate.port_or_known_default() == expected.port_or_known_default()
        && candidate.username().is_empty()
        && candidate.password().is_none();
    let bootstrap = ((candidate.scheme() == "http" && candidate.host_str() == Some("tauri.localhost"))
        || (candidate.scheme() == "tauri" && candidate.host_str() == Some("localhost")))
        && candidate.username().is_empty()
        && candidate.password().is_none()
        && matches!(candidate.path(), "/" | "/index.html");
    same_dashboard || bootstrap
}

fn allowed_preview_navigation(candidate: &Url) -> bool {
    let local = ((candidate.scheme() == "http" && candidate.host_str() == Some("tauri.localhost"))
        || (candidate.scheme() == "tauri" && candidate.host_str() == Some("localhost")))
        && candidate.username().is_empty()
        && candidate.password().is_none();
    local && candidate.path() == "/unified.html"
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::IpAddr;

    #[test]
    fn dashboard_navigation_is_loopback_only() {
        let expected = Url::parse(DASHBOARD_URL).unwrap();
        assert!(allowed_navigation(&Url::parse("http://127.0.0.1:17991/").unwrap(), &expected));
        assert!(allowed_navigation(&Url::parse("http://127.0.0.1:17991/api/status").unwrap(), &expected));
        assert!(!allowed_navigation(&Url::parse("http://127.0.0.1:17992/").unwrap(), &expected));
        assert!(!allowed_navigation(&Url::parse("https://example.com/").unwrap(), &expected));
    }

    #[test]
    fn loopback_url_remains_loopback() {
        let url = Url::parse(DASHBOARD_URL).unwrap();
        assert!(url.host_str().unwrap().parse::<IpAddr>().unwrap().is_loopback());
    }

    #[test]
    fn unified_preview_navigation_is_local_and_path_scoped() {
        assert!(allowed_preview_navigation(&Url::parse("http://tauri.localhost/unified.html").unwrap()));
        assert!(allowed_preview_navigation(&Url::parse("tauri://localhost/unified.html").unwrap()));
        assert!(!allowed_preview_navigation(&Url::parse("https://example.com/unified.html").unwrap()));
        assert!(!allowed_preview_navigation(&Url::parse("http://tauri.localhost/evil.html").unwrap()));
    }

    #[test]
    fn daemon_stopped_page_is_an_allowed_local_bootstrap() {
        let expected = Url::parse(DASHBOARD_URL).unwrap();
        assert!(allowed_navigation(&Url::parse(STOPPED_URL).unwrap(), &expected));
    }
}
