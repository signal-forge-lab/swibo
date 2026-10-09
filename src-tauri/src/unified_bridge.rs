use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    path::Path,
    process::{Command, Stdio},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};
use tauri::Emitter;

const SWIBO: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 17991);
const MAX_RESPONSE: u64 = 2 * 1024 * 1024;
static STREAM_STARTED: AtomicBool = AtomicBool::new(false);

fn sse_status(line: &str) -> Option<serde_json::Value> {
    let payload = line.strip_prefix("data:")?.trim();
    let value: serde_json::Value = serde_json::from_str(payload).ok()?;
    value.get("targets")?.as_array()?;
    Some(value)
}

fn bounded_line<R: BufRead>(reader: &mut R, max_bytes: u64) -> Result<Option<String>, String> {
    let mut line = Vec::new();
    let bytes = reader.take(max_bytes + 1).read_until(b'\n', &mut line)
        .map_err(|error| error.to_string())?;
    if bytes == 0 { return Ok(None); }
    if bytes as u64 > max_bytes { return Err("Swibo event line too large".into()); }
    String::from_utf8(line).map(Some).map_err(|_| "Swibo event is not UTF-8".into())
}

fn relay_swibo_stream(app: &tauri::AppHandle) -> Result<(), String> {
    let mut stream = TcpStream::connect_timeout(&SWIBO, Duration::from_secs(2))
        .map_err(|error| error.to_string())?;
    stream.write_all(b"GET /api/events HTTP/1.1\r\nHost: 127.0.0.1:17991\r\nAccept: text/event-stream\r\nConnection: close\r\n\r\n")
        .map_err(|error| error.to_string())?;
    let mut reader = BufReader::new(stream);
    let status_line = bounded_line(&mut reader, 8192)?.ok_or("Swibo event endpoint closed")?;
    if !status_line.starts_with("HTTP/1.1 200") {
        return Err("Swibo event endpoint unavailable".into());
    }
    loop {
        let line = bounded_line(&mut reader, MAX_RESPONSE)?.ok_or("Swibo event stream ended")?;
        if let Some(snapshot) = sse_status(&line) {
            let _ = app.emit("unified-swibo-status", snapshot);
        }
    }
}

#[tauri::command]
pub(crate) fn unified_swibo_watch(app: tauri::AppHandle) -> Result<(), String> {
    if std::env::var("SWIBO_UNIFIED_PREVIEW").as_deref() != Ok("1") {
        return Err("Unified preview is disabled".into());
    }
    if STREAM_STARTED.swap(true, Ordering::AcqRel) { return Ok(()); }
    thread::spawn(move || loop {
        if relay_swibo_stream(&app).is_err() {
            // Reconnect only when the event stream has actually disconnected.
            thread::sleep(Duration::from_secs(2));
        }
    });
    Ok(())
}

fn valid_id(value: &str) -> bool {
    value.len() <= 128
        && value.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
        && value.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
}

fn request_route(kind: &str, target_id: Option<&str>, component: Option<&str>) -> Result<(&'static str, String), String> {
    match kind {
        "status" => Ok(("GET", "/api/status".into())),
        "refresh" => Ok(("POST", "/api/refresh".into())),
        "start-all" => Ok(("POST", "/api/start-all".into())),
        "stop-all" => Ok(("POST", "/api/stop-all".into())),
        "start" | "stop" | "restart" => {
            let id = target_id.filter(|id| valid_id(id)).ok_or("Invalid target ID")?;
            Ok(("POST", format!("/api/targets/{id}/{kind}")))
        }
        "component-start" | "component-stop" | "component-restart" => {
            let id = target_id.filter(|id| valid_id(id)).ok_or("Invalid target ID")?;
            let key = component.filter(|key| valid_id(key)).ok_or("Invalid component key")?;
            let operation = kind.strip_prefix("component-").ok_or("Unknown request")?;
            Ok(("POST", format!("/api/targets/{id}/components/{key}/{operation}")))
        }
        _ => Err("Unknown request".into()),
    }
}

fn registry_route(kind: &str, target_id: Option<&str>, target: Option<&serde_json::Value>) -> Result<(&'static str, String, Option<String>), String> {
    match kind {
        "add" | "update" => {
            let value = target.and_then(serde_json::Value::as_object).ok_or("Target must be a JSON object")?;
            value.get("id").and_then(serde_json::Value::as_str)
                .filter(|id| valid_id(id)).ok_or("Invalid target ID")?;
            let route = if kind == "add" {
                "/api/targets".to_string()
            } else {
                let existing = target_id.filter(|id| valid_id(id)).ok_or("Invalid original target ID")?;
                format!("/api/targets/{existing}")
            };
            let method = if kind == "add" { "POST" } else { "PUT" };
            Ok((method, route, Some(serde_json::to_string(value).map_err(|error| error.to_string())?)))
        }
        "remove" => {
            if target.is_some() { return Err("Remove must not supply target JSON".into()); }
            let id = target_id.filter(|id| valid_id(id)).ok_or("Invalid target ID")?;
            Ok(("DELETE", format!("/api/targets/{id}"), None))
        }
        _ => Err("Unknown registry operation".into()),
    }
}

#[tauri::command]
pub(crate) fn unified_swibo_registry(kind: String, target_id: Option<String>, target: Option<serde_json::Value>) -> Result<String, String> {
    if std::env::var("SWIBO_UNIFIED_PREVIEW").as_deref() != Ok("1") {
        return Err("Unified preview is disabled".into());
    }
    let (method, route, body) = registry_route(&kind, target_id.as_deref(), target.as_ref())?;
    swibo_http(method, &route, body.as_deref())
}

fn extract_body(reply: &[u8]) -> Result<String, String> {
    let split = reply.windows(4).position(|chunk| chunk == b"\r\n\r\n")
        .ok_or("Invalid daemon response")?;
    let headers = std::str::from_utf8(&reply[..split]).map_err(|_| "Invalid response headers")?;
    let status = headers.lines().next().unwrap_or_default();
    if !status.starts_with("HTTP/1.") { return Err("Invalid HTTP response".into()); }
    let code = status.split_whitespace().nth(1).and_then(|value| value.parse::<u16>().ok())
        .ok_or("Invalid HTTP status")?;
    let body = &reply[split + 4..];
    if !(200..300).contains(&code) { return Err(format!("Swibo HTTP {code}")); }
    for header in headers.lines().skip(1) {
        if let Some((name, value)) = header.split_once(':') {
            if name.eq_ignore_ascii_case("transfer-encoding") {
                return Err("Unsupported Swibo response encoding".into());
            }
            if name.eq_ignore_ascii_case("content-length") {
                let expected = value.trim().parse::<usize>().map_err(|_| "Invalid response length")?;
                if expected != body.len() { return Err("Truncated or trailing Swibo response body".into()); }
            }
        }
    }
    String::from_utf8(body.to_vec()).map_err(|_| "Invalid daemon JSON encoding".into())
}

fn swibo_http(method: &str, route: &str, body: Option<&str>) -> Result<String, String> {
    swibo_http_at(SWIBO, method, route, body)
}

fn swibo_http_at(address: SocketAddr, method: &str, route: &str, body: Option<&str>) -> Result<String, String> {
    let mut stream = TcpStream::connect_timeout(&address, Duration::from_secs(2))
        .map_err(|error| format!("Swibo daemon unavailable: {error}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(if method == "GET" { 8 } else { 120 }))).map_err(|error| error.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(2))).map_err(|error| error.to_string())?;
    let payload = body.unwrap_or_default();
    let content_type = if body.is_some() { "Content-Type: application/json\r\n" } else { "" };
    let request = format!("{method} {route} HTTP/1.1\r\nHost: {address}\r\nConnection: close\r\n{content_type}Content-Length: {}\r\n\r\n", payload.len());
    stream.write_all(request.as_bytes()).map_err(|error| error.to_string())?;
    if !payload.is_empty() {
        stream.write_all(payload.as_bytes()).map_err(|error| error.to_string())?;
    }
    let mut response = Vec::new();
    stream.take(MAX_RESPONSE + 1).read_to_end(&mut response)
        .map_err(|error| format!("Unable to read Swibo response: {error}"))?;
    if response.len() as u64 > MAX_RESPONSE { return Err("Swibo response too large".into()); }
    extract_body(&response)
}

fn autostart_body(snapshot: &str, target_id: &str, enabled: bool) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(snapshot).map_err(|error| error.to_string())?;
    let targets = value.get("registry").and_then(|registry| registry.get("targets"))
        .and_then(serde_json::Value::as_array).ok_or("Swibo registry is missing")?;
    let mut target = targets.iter().find(|target| target.get("id").and_then(serde_json::Value::as_str) == Some(target_id))
        .cloned().ok_or("Unknown Swibo target")?;
    target["startupPolicy"] = serde_json::Value::String(if enabled { "auto" } else { "manual" }.into());
    serde_json::to_string(&target).map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn unified_swibo_autostart(target_id: String, enabled: bool) -> Result<String, String> {
    if std::env::var("SWIBO_UNIFIED_PREVIEW").as_deref() != Ok("1") {
        return Err("Unified preview is disabled".into());
    }
    if !valid_id(&target_id) { return Err("Invalid target ID".into()); }
    let snapshot = swibo_http("GET", "/api/status", None)?;
    let body = autostart_body(&snapshot, &target_id, enabled)?;
    swibo_http("PUT", &format!("/api/targets/{target_id}"), Some(&body))
}

fn loctl_request(kind: &str, module_id: Option<&str>, operation: Option<&str>) -> Result<serde_json::Value, String> {
    match kind {
        "registry" => Ok(serde_json::json!({"kind":"registry"})),
        "module_status" | "module_icon" => {
            let id = module_id.filter(|id| valid_id(id)).ok_or("Invalid module ID")?;
            Ok(serde_json::json!({"kind":kind,"module_id":id}))
        }
        "module_action" => {
            let id = module_id.filter(|id| valid_id(id)).ok_or("Invalid module ID")?;
            let action = operation.filter(|action| matches!(*action,"open"|"status"|"start"|"stop"|"restart"|"diagnose"|"settings"))
                .ok_or("Invalid module action")?;
            Ok(serde_json::json!({"kind":kind,"module_id":id,"operation":action}))
        }
        _ => Err("Unknown Loctl request".into()),
    }
}

#[tauri::command]
pub(crate) fn unified_loctl_request(kind: String, module_id: Option<String>, operation: Option<String>) -> Result<String, String> {
    if std::env::var("SWIBO_UNIFIED_PREVIEW").as_deref() != Ok("1") {
        return Err("Unified preview is disabled".into());
    }
    let payload = loctl_request(&kind, module_id.as_deref(), operation.as_deref())?;
    let exe = std::env::var("SWIBO_UNIFIED_LOCTL_EXE").map_err(|_| "SWIBO_UNIFIED_LOCTL_EXE is not configured")?;
    let path = Path::new(&exe);
    if !path.is_file() || !path.file_name().is_some_and(|name| name == if cfg!(windows) { "loctl.exe" } else { "loctl" }) {
        return Err("Invalid Loctl executable path".into());
    }
    let mut child = Command::new(path).arg("--headless-rpc")
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|error| format!("Unable to start Loctl headless runtime: {error}"))?;
    let data = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
    child.stdin.take().ok_or("Missing Loctl input pipe")?
        .write_all(&data).map_err(|error| error.to_string())?;
    let stdout = child.stdout.take().ok_or("Missing Loctl output pipe")?;
    let reader = thread::spawn(move || {
        let mut output = Vec::new();
        let result = stdout.take(MAX_RESPONSE + 1).read_to_end(&mut output);
        result.map(|_| output)
    });
    // Loctl adapters can declare a timeout of up to ten minutes. Bound the
    // surrounding headless process as well, even if it stops responding.
    let max_seconds = if matches!(kind.as_str(), "registry" | "module_icon") { 15 } else { 660 };
    let deadline = Instant::now() + Duration::from_secs(max_seconds);
    let status = loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(status) => break status,
            None if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Loctl headless runtime timed out".into());
            }
            None => thread::sleep(Duration::from_millis(50)),
        }
    };
    let output = reader.join().map_err(|_| "Loctl output reader failed")?
        .map_err(|error| error.to_string())?;
    if !status.success() || output.len() as u64 > MAX_RESPONSE {
        return Err("Loctl headless runtime failed or returned too much data".into());
    }
    String::from_utf8(output).map_err(|_| "Invalid Loctl UTF-8 output".into())
}

#[tauri::command]
pub(crate) fn unified_swibo_request(
    kind: String,
    target_id: Option<String>,
    component: Option<String>,
) -> Result<String, String> {
    // The bridge is entirely disabled for ordinary Swibo launches.
    if std::env::var("SWIBO_UNIFIED_PREVIEW").as_deref() != Ok("1") {
        return Err("Unified preview is disabled".into());
    }
    let (method, route) = request_route(&kind, target_id.as_deref(), component.as_deref())?;
    swibo_http(method, &route, None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io;
    use std::net::TcpListener;

    #[test]
    fn routes_are_strictly_allowlisted() {
        assert_eq!(request_route("status", None, None).unwrap(), ("GET", "/api/status".into()));
        assert_eq!(request_route("refresh", None, None).unwrap(), ("POST", "/api/refresh".into()));
        assert_eq!(request_route("start-all", None, None).unwrap(), ("POST", "/api/start-all".into()));
        assert_eq!(request_route("stop-all", None, None).unwrap(), ("POST", "/api/stop-all".into()));
        assert_eq!(request_route("start", Some("runtime-1"), None).unwrap(), ("POST", "/api/targets/runtime-1/start".into()));
        assert_eq!(request_route("component-restart", Some("runtime-1"), Some("monitor")).unwrap(),
                   ("POST", "/api/targets/runtime-1/components/monitor/restart".into()));
        for input in ["../x", "target/foo", "a?b", "x%20", "", "a\r\nX: true"] {
            assert!(request_route("stop", Some(input), None).is_err());
        }
        assert!(request_route("component-stop", Some("safe"), Some("../bad")).is_err());
        assert!(request_route("shutdown", None, None).is_err());
    }

    #[test]
    fn registry_mutations_are_bound_to_valid_ids_and_daemon_routes() {
        let target = serde_json::json!({"id":"safe-1","name":"Safe","startupPolicy":"manual"});
        assert_eq!(registry_route("add", None, Some(&target)).unwrap().0, "POST");
        assert_eq!(registry_route("update", Some("old-id"), Some(&target)).unwrap().1, "/api/targets/old-id");
        assert_eq!(registry_route("remove", Some("safe-1"), None).unwrap().0, "DELETE");
        assert!(registry_route("add", None, Some(&serde_json::json!({"id":"../bad"}))).is_err());
        assert!(registry_route("update", Some("../bad"), Some(&target)).is_err());
        assert!(registry_route("remove", Some("safe"), Some(&target)).is_err());
        assert!(registry_route("bulk-delete", None, None).is_err());
    }

    #[test]
    fn sse_relay_only_accepts_valid_status_snapshots() {
        assert_eq!(sse_status("data: {\"targets\":[{\"id\":\"x\"}]}\n").unwrap()["targets"][0]["id"], "x");
        assert!(sse_status("event: status").is_none());
        assert!(sse_status("data: {\"error\":\"no\"}").is_none());
        assert!(sse_status("data: invalid").is_none());
    }

    #[test]
    fn http_reply_parser_rejects_invalid_or_failing_status() {
        assert_eq!(extract_body(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n{\"ok\":true}").unwrap(), "{\"ok\":true}");
        assert!(extract_body(b"HTTP/1.1 403 Forbidden\r\n\r\n{}").is_err());
        assert!(extract_body(b"HTTP/1.1 302 Found\r\n\r\n{}").is_err());
        assert!(extract_body(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n{}").is_err());
        assert!(extract_body(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n").is_err());
        assert!(extract_body(b"garbage").is_err());
    }

    #[test]
    fn event_lines_are_bounded_before_allocating_unlimited_input() {
        let mut valid = io::Cursor::new(b"data: {\"targets\":[]}\n".to_vec());
        assert!(bounded_line(&mut valid, 128).unwrap().is_some());
        let mut huge = io::Cursor::new(vec![b'x'; 200]);
        assert!(bounded_line(&mut huge, 64).is_err());
        let mut eof = io::Cursor::new(Vec::new());
        assert!(bounded_line(&mut eof, 64).unwrap().is_none());
    }

    #[test]
    fn daemon_bridge_routes_mutation_through_loopback_without_touching_live_registry() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut reader = BufReader::new(&mut stream);
            let mut headers = String::new();
            loop {
                let mut line = String::new();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" { break; }
                headers.push_str(&line);
            }
            assert!(headers.starts_with("PUT /api/targets/old-id HTTP/1.1\r\n"));
            assert!(headers.contains("Content-Type: application/json\r\n"));
            let size = headers.lines().find_map(|line| line.strip_prefix("Content-Length: "))
                .unwrap().trim().parse::<usize>().unwrap();
            let mut body = vec![0; size];
            reader.read_exact(&mut body).unwrap();
            let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(value["id"], "new-id");
            drop(reader);
            let response = b"{\"ok\":true}";
            stream.write_all(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\n\r\n", response.len()).as_bytes()).unwrap();
            stream.write_all(response).unwrap();
        });
        let target = serde_json::json!({"id":"new-id","name":"fixture"});
        let (method, path, body) = registry_route("update", Some("old-id"), Some(&target)).unwrap();
        assert_eq!(swibo_http_at(address, method, &path, body.as_deref()).unwrap(), "{\"ok\":true}");
        server.join().unwrap();
    }

    #[test]
    fn loctl_bridge_rejects_unsafe_requests() {
        assert_eq!(loctl_request("registry", None, None).unwrap()["kind"], "registry");
        assert_eq!(loctl_request("module_status", Some("swibo"), None).unwrap()["module_id"], "swibo");
        assert!(loctl_request("module_status", Some("../outside"), None).is_err());
        assert!(loctl_request("module_action", Some("swibo"), Some("unknown")).is_err());
        assert!(loctl_request("shell", None, None).is_err());
    }

    #[test]
    fn autostart_updates_only_the_selected_registered_target() {
        let source = r#"{"registry":{"targets":[{"id":"first","startupPolicy":"manual","enabled":true},{"id":"second","startupPolicy":"auto","enabled":false}]}}"#;
        let target: serde_json::Value = serde_json::from_str(&autostart_body(source, "first", true).unwrap()).unwrap();
        assert_eq!(target["id"], "first");
        assert_eq!(target["startupPolicy"], "auto");
        assert_eq!(target["enabled"], true);
        assert!(autostart_body(source, "missing", false).is_err());
    }
}
