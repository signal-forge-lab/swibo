#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod unified_bridge;

use std::{
    env, fs,
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::{
    webview::{NewWindowResponse, Url, WebviewWindowBuilder},
    WebviewUrl,
};

const DASHBOARD_URL: &str = "http://127.0.0.1:17991/";
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
            unified_bridge::unified_loctl_request
        ])
        .setup(move |app| {
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

fn ensure_daemon(root: &Path, url: &Url) -> bool {
    if endpoint_reachable(url) { return true; }
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
}
