#[tauri::command]
fn save_file_to_downloads(suggested_name: String, base64_content: String) -> Result<String, String> {
    use std::io::Write;
    let downloads_dir = dirs::download_dir()
        .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    
    std::fs::create_dir_all(&downloads_dir).map_err(|e| e.to_string())?;
    let file_path = downloads_dir.join(&suggested_name);
    
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_content)
        .map_err(|e| e.to_string())?;

    let mut file = std::fs::File::create(&file_path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn open_file(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", &path])
            .creation_flags(0x08000000)
            .spawn();
    }
    Ok(())
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let downloads_dir = dirs::download_dir()
            .or_else(|| dirs::home_dir().map(|h| h.join("Downloads")))
            .unwrap_or_else(|| std::path::PathBuf::from("."));
        
        let p = if !path.is_empty() && std::path::Path::new(&path).exists() {
            std::path::PathBuf::from(&path)
        } else {
            downloads_dir
        };

        if p.is_file() {
            let _ = std::process::Command::new("explorer")
                .arg("/select,")
                .arg(&p)
                .spawn();
        } else {
            let _ = std::process::Command::new("explorer")
                .arg(&p)
                .spawn();
        }
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::default().build())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_window_state::Builder::default().build())
    .invoke_handler(tauri::generate_handler![save_file_to_downloads, open_file, open_folder])
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
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
