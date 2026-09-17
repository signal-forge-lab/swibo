use std::{env, fs, path::PathBuf};

const ICON_SIZES: &[u16] = &[16, 24, 32, 48, 64, 96, 128, 256];

fn icon_path(manifest: &std::path::Path, size: u16) -> PathBuf {
    manifest.join(format!("../assets/swibo-icons/{size}.png"))
}

fn read_icon_frames(manifest: &std::path::Path) -> Vec<(u16, Vec<u8>)> {
    ICON_SIZES
        .iter()
        .map(|size| {
            let path = icon_path(manifest, *size);
            println!("cargo:rerun-if-changed={}", path.display());
            let bytes = fs::read(&path).unwrap_or_else(|error| {
                panic!("read Swibo {size}px icon {}: {error}", path.display())
            });
            assert!(
                bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
                "Swibo {size}px icon must be PNG"
            );
            (*size, bytes)
        })
        .collect()
}

fn write_context_icon(manifest: &std::path::Path, frames: &[(u16, Vec<u8>)]) {
    let (_, icon_256) = frames
        .iter()
        .find(|(size, _)| *size == 256)
        .expect("256px Swibo icon");
    let icon_dir = manifest.join("icons");
    fs::create_dir_all(&icon_dir).expect("create icon directory");
    fs::write(icon_dir.join("icon.png"), icon_256).expect("write context icon");
}

#[cfg(target_os = "windows")]
fn build_ico(frames: &[(u16, Vec<u8>)]) -> Vec<u8> {
    let count = frames.len() as u16;
    let directory_size = 6 + frames.len() * 16;
    let payload_size: usize = frames.iter().map(|(_, bytes)| bytes.len()).sum();
    let mut ico = Vec::with_capacity(directory_size + payload_size);

    ico.extend_from_slice(&0u16.to_le_bytes());
    ico.extend_from_slice(&1u16.to_le_bytes());
    ico.extend_from_slice(&count.to_le_bytes());

    let mut offset = directory_size as u32;
    for (size, bytes) in frames {
        let dimension = if *size >= 256 { 0 } else { *size as u8 };
        ico.push(dimension);
        ico.push(dimension);
        ico.push(0);
        ico.push(0);
        ico.extend_from_slice(&1u16.to_le_bytes());
        ico.extend_from_slice(&32u16.to_le_bytes());
        ico.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        ico.extend_from_slice(&offset.to_le_bytes());
        offset += bytes.len() as u32;
    }

    for (_, bytes) in frames {
        ico.extend_from_slice(bytes);
    }
    ico
}

#[cfg(target_os = "windows")]
fn write_windows_icon(frames: &[(u16, Vec<u8>)]) -> PathBuf {
    let path = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("swibo.ico");
    fs::write(&path, build_ico(frames)).expect("write generated icon");
    path
}

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let source = manifest.join("../assets/swibo-icon-source.png");
    println!("cargo:rerun-if-changed={}", source.display());

    let frames = read_icon_frames(&manifest);
    write_context_icon(&manifest, &frames);
    #[cfg(target_os = "windows")]
    {
        let windows =
            tauri_build::WindowsAttributes::new().window_icon_path(write_windows_icon(&frames));
        tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
            .expect("failed to run tauri build script");
    }
    #[cfg(not(target_os = "windows"))]
    tauri_build::try_build(tauri_build::Attributes::new())
        .expect("failed to run tauri build script");
}
