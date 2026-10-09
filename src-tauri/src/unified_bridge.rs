use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::Path,
    process::{Command, Stdio},
    time::Duration,
};

const SWIBO: SocketAddr = SocketAddr::new(std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST), 17991);
const MAX_RESPONSE: u64 = 2 * 1024 * 1024;

fn valid_id(value: &str) -> bool {
    value.len() <= 128
        && value.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
        && value.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
}

fn request_route(kind: &str, target_id: Option<&str>, component: Option<&str>) -> Result<(&'static str, String), String> {
    match kind {
        "status" => Ok(("GET", "/api/status".into())),
        "refresh" => Ok(("POST", "/api/refresh".into())),
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

fn extract_body(reply: &[u8]) -> Result<String, String> {
    let split = reply.windows(4).position(|chunk| chunk == b"\r\n\r\n")
        .ok_or("Invalid daemon response")?;
    let headers = std::str::from_utf8(&reply[..split]).map_err(|_| "Invalid response headers")?;
    let status = headers.lines().next().unwrap_or_default();
    if !status.starts_with("HTTP/1.") { return Err("Invalid HTTP response".into()); }
    let code = status.split_whitespace().nth(1).and_then(|value| value.parse::<u16>().ok())
        .ok_or("Invalid HTTP status")?;
    let body = &reply[split + 4..];
    if code >= 400 { return Err(format!("Swibo HTTP {code}")); }
    String::from_utf8(body.to_vec()).map_err(|_| "Invalid daemon JSON encoding".into())
}

fn swibo_http(method: &str, route: &str, body: Option<&str>) -> Result<String, String> {
    let mut stream = TcpStream::connect_timeout(&SWIBO, Duration::from_secs(2))
        .map_err(|error| format!("Swibo daemon unavailable: {error}"))?;
    stream.set_read_timeout(Some(Duration::from_secs(if method == "GET" { 8 } else { 120 }))).map_err(|error| error.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(2))).map_err(|error| error.to_string())?;
    let payload = body.unwrap_or_default();
    let content_type = if body.is_some() { "Content-Type: application/json\r\n" } else { "" };
    let request = format!("{method} {route} HTTP/1.1\r\nHost: 127.0.0.1:17991\r\nConnection: close\r\n{content_type}Content-Length: {}\r\n\r\n", payload.len());
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
    let output = child.wait_with_output().map_err(|error| error.to_string())?;
    if !output.status.success() || output.stdout.len() > MAX_RESPONSE as usize {
        return Err("Loctl headless runtime failed or returned too much data".into());
    }
    String::from_utf8(output.stdout).map_err(|_| "Invalid Loctl UTF-8 output".into())
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

    #[test]
    fn routes_are_strictly_allowlisted() {
        assert_eq!(request_route("status", None, None).unwrap(), ("GET", "/api/status".into()));
        assert_eq!(request_route("refresh", None, None).unwrap(), ("POST", "/api/refresh".into()));
        assert_eq!(request_route("start", Some("runtime-1"), None).unwrap(), ("POST", "/api/targets/runtime-1/start".into()));
        assert_eq!(request_route("component-restart", Some("runtime-1"), Some("monitor")).unwrap(),
                   ("POST", "/api/targets/runtime-1/components/monitor/restart".into()));
        for input in ["../x", "target/foo", "a?b", "x%20", "", "a\r\nX: true"] {
            assert!(request_route("stop", Some(input), None).is_err());
        }
        assert!(request_route("component-stop", Some("safe"), Some("../bad")).is_err());
        assert!(request_route("shutdown", None, None).is_err());
        assert!(request_route("stop-all", None, None).is_err());
    }

    #[test]
    fn http_reply_parser_rejects_invalid_or_failing_status() {
        assert_eq!(extract_body(b"HTTP/1.1 200 OK\r\nContent-Length: 11\r\n\r\n{\"ok\":true}").unwrap(), "{\"ok\":true}");
        assert!(extract_body(b"HTTP/1.1 403 Forbidden\r\n\r\n{}").is_err());
        assert!(extract_body(b"garbage").is_err());
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
