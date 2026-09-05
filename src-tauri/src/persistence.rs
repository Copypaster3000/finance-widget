use serde_json::{Map, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

type Data = Map<String, Value>;

#[derive(Default)]
pub struct Persistence(pub Mutex<Option<Session>>);

pub struct Session {
    path: PathBuf,
    data: Data,
    disk: Option<Vec<u8>>,
}

fn read(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Cannot read saved portfolio: {error}")),
    }
}

fn decode(bytes: &[u8]) -> Result<Data, String> {
    let data: Data = serde_json::from_slice(bytes)
        .map_err(|_| "Saved portfolio is not valid JSON".to_string())?;
    if let Some(ledger) = data.get("portfolio-ledger-v1") {
        let schema = ledger.get("schemaVersion").and_then(Value::as_u64);
        if !matches!(schema, Some(1 | 2))
            || !ledger.get("assets").is_some_and(Value::is_array)
            || !ledger.get("events").is_some_and(Value::is_array)
        {
            return Err("Saved portfolio ledger cannot be read safely".into());
        }
    }
    Ok(data)
}

fn backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("Invalid portfolio directory")?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("Cannot create portfolio directory: {error}"))?;
    let temp = path.with_extension(format!("tmp-{}", std::process::id()));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp)
            .map_err(|error| format!("Cannot prepare portfolio save: {error}"))?;
        file.write_all(bytes)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("Cannot finish portfolio save: {error}"))?;
        drop(file);
        fs::rename(&temp, path).map_err(|error| format!("Cannot replace portfolio file: {error}"))
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

impl Session {
    fn open(path: PathBuf) -> Result<Self, String> {
        let disk = read(&path)?;
        let backup = backup_path(&path);
        let data = match disk.as_deref() {
            Some(bytes) => match decode(bytes) {
                Ok(data) => data,
                Err(error) => match read(&backup)?.as_deref() {
                    Some(bytes) => decode(bytes).map_err(|_| error)?,
                    None => return Err(error),
                },
            },
            None => match read(&backup)?.as_deref() {
                Some(bytes) => decode(bytes)?,
                None => Data::new(),
            },
        };
        Ok(Self { path, data, disk })
    }

    fn save(&mut self, updates: Data) -> Result<(), String> {
        fs::create_dir_all(self.path.parent().ok_or("Invalid portfolio directory")?)
            .map_err(|error| format!("Cannot create portfolio directory: {error}"))?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(self.path.with_extension("json.lock"))
            .map_err(|error| format!("Cannot lock portfolio: {error}"))?;
        lock.try_lock()
            .map_err(|_| "Another window is saving the portfolio. Try again.")?;
        // Another running copy must never silently overwrite this session's data.
        if read(&self.path)? != self.disk {
            return Err(
                "Portfolio changed in another window. Close and reopen before saving.".into(),
            );
        }
        let mut next = self.data.clone();
        next.extend(updates);
        let bytes =
            serde_json::to_vec_pretty(&next).map_err(|_| "Cannot encode portfolio".to_string())?;
        decode(&bytes)?;
        if let Some(previous) = &self.disk {
            if decode(previous).is_ok() {
                atomic_write(&backup_path(&self.path), previous)?;
            }
        }
        atomic_write(&self.path, &bytes)?;
        self.disk = Some(bytes);
        self.data = next;
        Ok(())
    }
}

#[tauri::command]
pub fn load_portfolio(
    app: tauri::AppHandle,
    state: tauri::State<'_, Persistence>,
) -> Result<Data, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| "Cannot locate portfolio directory")?
        .join("portfolio.json");
    let session = Session::open(path)?;
    let data = session.data.clone();
    *state.0.lock().map_err(|_| "Portfolio lock unavailable")? = Some(session);
    Ok(data)
}

#[tauri::command]
pub fn save_portfolio(updates: Data, state: tauri::State<'_, Persistence>) -> Result<(), String> {
    state
        .0
        .lock()
        .map_err(|_| "Portfolio lock unavailable")?
        .as_mut()
        .ok_or("Load the saved portfolio before saving")?
        .save(updates)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    fn path() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "finance-persistence-test-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir.join("portfolio.json")
    }
    fn fixture() -> Data {
        serde_json::from_value(json!({"portfolio-ledger-v1":{"schemaVersion":2,"assets":[{"id":"synthetic","symbol":"TEST","type":"stock"}],"events":[]}})).unwrap()
    }
    #[test]
    fn saved_data_survives_reopening_and_keeps_other_keys() {
        let path = path();
        Session::open(path.clone())
            .unwrap()
            .save(fixture())
            .unwrap();
        let mut reopened = Session::open(path.clone()).unwrap();
        assert_eq!(reopened.data, fixture());
        reopened
            .save(serde_json::from_value(json!({"quote-cache":[]})).unwrap())
            .unwrap();
        assert_eq!(
            Session::open(path.clone()).unwrap().data["portfolio-ledger-v1"],
            fixture()["portfolio-ledger-v1"]
        );
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn unreadable_or_malformed_file_never_becomes_empty() {
        let path = path();
        fs::write(&path, b"{broken").unwrap();
        assert!(Session::open(path.clone()).is_err());
        assert_eq!(fs::read(&path).unwrap(), b"{broken");
        fs::remove_file(&path).unwrap();
        fs::create_dir(&path).unwrap();
        assert!(Session::open(path.clone()).is_err());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn interrupted_write_recovers_valid_backup() {
        let path = path();
        let mut session = Session::open(path.clone()).unwrap();
        session.save(fixture()).unwrap();
        session
            .save(serde_json::from_value(json!({"quote-cache":[]})).unwrap())
            .unwrap();
        fs::write(&path, b"{truncated").unwrap();
        let mut recovered = Session::open(path.clone()).unwrap();
        assert_eq!(recovered.data, fixture());
        recovered.save(Data::new()).unwrap();
        assert_eq!(
            decode(&fs::read(backup_path(&path)).unwrap()).unwrap(),
            fixture()
        );
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn second_window_cannot_overwrite_newer_data() {
        let path = path();
        let mut first = Session::open(path.clone()).unwrap();
        let mut second = Session::open(path.clone()).unwrap();
        first.save(fixture()).unwrap();
        assert!(second.save(Data::new()).is_err());
        assert_eq!(Session::open(path.clone()).unwrap().data, fixture());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn malformed_ledger_is_rejected_before_write() {
        let path = path();
        let mut session = Session::open(path.clone()).unwrap();
        session.save(fixture()).unwrap();
        assert!(session
            .save(
                serde_json::from_value(json!({"portfolio-ledger-v1":{"schemaVersion":2}})).unwrap()
            )
            .is_err());
        assert_eq!(Session::open(path.clone()).unwrap().data, fixture());
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn process_persistence_child() {
        let Ok(path) = std::env::var("FINANCE_TEST_STORE") else {
            return;
        };
        let mut session = Session::open(PathBuf::from(path)).unwrap();
        if std::env::var("FINANCE_TEST_ACTION").unwrap() == "save" {
            session.save(fixture()).unwrap();
        } else {
            assert_eq!(session.data, fixture());
        }
    }
    #[test]
    fn saved_data_survives_separate_processes() {
        let path = path();
        for action in ["save", "read", "read"] {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "persistence::tests::process_persistence_child"])
                .env("FINANCE_TEST_STORE", &path)
                .env("FINANCE_TEST_ACTION", action)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stdout)
            );
        }
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
}
