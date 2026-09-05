use std::sync::Mutex;
mod persistence;
use tauri::Manager;
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::{StateFlags, WindowExt};

struct YahooSession {
    client: reqwest::Client,
    crumb: Mutex<Option<String>>,
}

#[tauri::command]
async fn fetch_yahoo_session_quotes(
    symbols: Vec<String>,
    session: tauri::State<'_, YahooSession>,
) -> Result<String, String> {
    if symbols.is_empty() {
        return Ok(r#"{"quoteResponse":{"result":[],"error":null}}"#.into());
    }
    let fields = "currency,regularMarketTime,regularMarketPrice,preMarketTime,preMarketPrice,postMarketTime,postMarketPrice,overnightMarketTime,overnightMarketPrice";
    let joined_symbols = symbols.join(",");
    for attempt in 0..2 {
        let existing_crumb = session.crumb.lock().map_err(|_| "Yahoo session lock failed")?.clone();
        let crumb = match existing_crumb {
            Some(value) => value,
            None => {
                let _ = session.client.get("https://fc.yahoo.com").send().await
                    .map_err(|error| format!("Yahoo cookie request failed: {error}"))?;
                let response = session.client.get("https://query1.finance.yahoo.com/v1/test/getcrumb").send().await
                    .map_err(|error| format!("Yahoo token request failed: {error}"))?;
                if !response.status().is_success() {
                    return Err(format!("Yahoo token HTTP {}", response.status()));
                }
                let value = response.text().await
                    .map_err(|error| format!("Yahoo token response failed: {error}"))?
                    .trim().to_string();
                if value.is_empty() {
                    return Err("Yahoo token unavailable".into());
                }
                *session.crumb.lock().map_err(|_| "Yahoo session lock failed")? = Some(value.clone());
                value
            }
        };
        let response = session.client
            .get("https://query1.finance.yahoo.com/v7/finance/quote")
            .query(&[
                ("fields", fields),
                ("formatted", "false"),
                ("symbols", joined_symbols.as_str()),
                ("enablePrivateCompany", "true"),
                ("overnightPrice", "true"),
                ("lang", "en-US"),
                ("region", "US"),
                ("crumb", &crumb),
            ])
            .send().await
            .map_err(|error| format!("Yahoo overnight request failed: {error}"))?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED && attempt == 0 {
            *session.crumb.lock().map_err(|_| "Yahoo session lock failed")? = None;
            continue;
        }
        if !response.status().is_success() {
            return Err(format!("Yahoo overnight HTTP {}", response.status()));
        }
        return response.text().await
            .map_err(|error| format!("Yahoo overnight response failed: {error}"));
    }
    Err("Yahoo overnight authorization failed".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let yahoo_client = reqwest::Client::builder()
        .cookie_store(true)
        .user_agent("Mozilla/5.0 Finance Widget")
        .build()
        .expect("failed to create Yahoo HTTP client");
    tauri::Builder::default()
        .manage(YahooSession { client: yahoo_client, crumb: Mutex::new(None) })
        .manage(persistence::Persistence::default())
        .invoke_handler(tauri::generate_handler![fetch_yahoo_session_quotes, persistence::load_portfolio, persistence::save_portfolio])
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(StateFlags::POSITION | StateFlags::SIZE)
                .build(),
        )
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.restore_state(StateFlags::POSITION | StateFlags::SIZE);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running portfolio widget");
}
