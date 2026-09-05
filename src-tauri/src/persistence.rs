use crate::validation::{validate, Invalid};
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
    metadata: LoadMetadata,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadMetadata {
    state: &'static str,
    recovery_reason: Option<String>,
    backup_modified_at: Option<u64>,
}
#[derive(serde::Serialize)]
pub struct LoadResult {
    data: Data,
    metadata: LoadMetadata,
}
fn describe(error: Invalid) -> String {
    match error { Invalid::Future => "UNSUPPORTED_SCHEMA: This portfolio was created by a newer version of Finance Widget. Update the app to open it safely.".into(), Invalid::Corrupt(message) => format!("INTEGRITY_ERROR: {message}") }
}

fn read(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Cannot read saved portfolio: {error}")),
    }
}

fn decode(bytes: &[u8]) -> Result<Data, Invalid> {
    let data: Data = serde_json::from_slice(bytes)
        .map_err(|_| Invalid::Corrupt("Saved portfolio is not valid JSON".into()))?;
    validate(&data)?;
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
        let mut metadata = LoadMetadata {
            state: "portfolioLoaded",
            recovery_reason: None,
            backup_modified_at: None,
        };
        let data = match disk.as_deref() {
            Some(bytes) => match decode(bytes) {
                Ok(data) => data,
                Err(Invalid::Future) => return Err(describe(Invalid::Future)),
                Err(error) => match read(&backup)?.as_deref() {
                    Some(bytes) => {
                        metadata.state = "portfolioRecovered";
                        metadata.recovery_reason = Some(describe(error));
                        decode(bytes).map_err(describe)?
                    }
                    None => return Err(describe(error)),
                },
            },
            None => match read(&backup)?.as_deref() {
                Some(bytes) => {
                    metadata.state = "portfolioRecovered";
                    metadata.recovery_reason = Some("Primary saved copy is missing".into());
                    decode(bytes).map_err(describe)?
                }
                None => {
                    metadata.state = "firstRunEmpty";
                    Data::new()
                }
            },
        };
        if metadata.state == "portfolioRecovered" {
            metadata.backup_modified_at = fs::metadata(&backup)
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|t| t.as_millis() as u64);
        }
        Ok(Self {
            path,
            data,
            disk,
            metadata,
        })
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
        decode(&bytes).map_err(describe)?;
        if let Some(backup) = read(&backup_path(&self.path))? {
            if matches!(decode(&backup), Err(Invalid::Future)) {
                return Err(describe(Invalid::Future));
            }
        }
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
) -> Result<LoadResult, String> {
    let mut active = state.0.lock().map_err(|_| "Portfolio lock unavailable")?;
    *active = None;
    let path = app
        .path()
        .app_data_dir()
        .map_err(|_| "Cannot locate portfolio directory")?
        .join("portfolio.json");
    let session = Session::open(path)?;
    let data = session.data.clone();
    let metadata = session.metadata.clone();
    *active = Some(session);
    Ok(LoadResult { data, metadata })
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
        serde_json::from_value(json!({"portfolio-ledger-v1":{"schemaVersion":2,"assets":[{"id":"synthetic","symbol":"TEST","type":"stock","createdAt":"2020-01-01T00:00:00Z"}],"events":[]}})).unwrap()
    }
    fn trade() -> Value {
        json!({"id":"trade","eventType":"buy","assetId":"synthetic","date":"2020-01-02","sequence":1,"quantity":"2","unitPrice":"5","fees":"0","totalAmount":"10","priceSource":"manual_unit","affectsCashDebt":false,"createdAt":"2020-01-02T00:00:00Z","updatedAt":"2020-01-02T00:00:00Z"})
    }
    fn populated() -> Data {
        let mut d = fixture();
        d.get_mut("portfolio-ledger-v1").unwrap()["events"] = json!([trade()]);
        d
    }
    fn failed_load_preserves(primary: &[u8], backup: Option<&[u8]>, future: bool) {
        let path = path();
        fs::write(&path, primary).unwrap();
        if let Some(b) = backup {
            fs::write(backup_path(&path), b).unwrap();
        }
        let error = Session::open(path.clone())
            .err()
            .expect("Must refuse authoritative load");
        assert_eq!(error.contains("UNSUPPORTED_SCHEMA"), future);
        assert_eq!(fs::read(&path).unwrap(), primary);
        assert_eq!(read(&backup_path(&path)).unwrap().as_deref(), backup);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn incomplete_primary_recovers_without_destroying_backup() {
        for primary in [
            b"{}".as_slice(),
            b"",
            b"{broken",
            b"{\"configuration\":{\"schemaVersion\":10}}",
        ] {
            let path = path();
            let good = serde_json::to_vec(&populated()).unwrap();
            fs::write(&path, primary).unwrap();
            fs::write(backup_path(&path), &good).unwrap();
            let mut recovered = Session::open(path.clone()).unwrap();
            assert_eq!(recovered.metadata.state, "portfolioRecovered");
            assert!(recovered.metadata.recovery_reason.is_some());
            assert_eq!(recovered.data, populated());
            recovered.save(Data::new()).unwrap();
            assert_eq!(fs::read(backup_path(&path)).unwrap(), good);
            assert_eq!(decode(&fs::read(&path).unwrap()).unwrap(), populated());
            fs::remove_dir_all(path.parent().unwrap()).unwrap();
        }
    }
    #[test]
    fn incomplete_primary_without_recovery_is_not_first_run() {
        for primary in [b"{}".as_slice(), b"", b"{broken"] {
            failed_load_preserves(primary, None, false);
        }
    }
    #[test]
    fn future_primary_never_downgrades_to_backup() {
        for key in ["portfolio-ledger-v1", "configuration"] {
            let mut d = populated();
            d.insert(key.into(), json!({"schemaVersion":99}));
            let good = serde_json::to_vec(&populated()).unwrap();
            failed_load_preserves(&serde_json::to_vec(&d).unwrap(), Some(&good), true);
        }
    }
    #[test]
    fn valid_primary_ignores_bad_backup_and_rotates_only_verified_data() {
        let path = path();
        let good = serde_json::to_vec(&populated()).unwrap();
        fs::write(&path, &good).unwrap();
        fs::write(backup_path(&path), b"{}").unwrap();
        let mut session = Session::open(path.clone()).unwrap();
        assert_eq!(session.metadata.state, "portfolioLoaded");
        session.save(Data::new()).unwrap();
        assert_eq!(fs::read(backup_path(&path)).unwrap(), good);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[test]
    fn both_copies_corrupt_preserves_both() {
        failed_load_preserves(b"{broken", Some(b"{}"), false);
    }
    #[test]
    fn malformed_financial_records_block_load_and_save() {
        let mut variants = vec![Value::Null, json!(42), json!({})];
        for (key, value) in [
            ("date", json!("2020-02-31")),
            ("quantity", json!(1)),
            ("quantity", json!("1000001")),
            ("eventType", json!("mystery")),
            ("assetId", json!("missing")),
            ("sequence", json!(0)),
            ("affectsCashDebt", json!("false")),
            ("totalAmount", json!("NaN")),
        ] {
            let mut t = trade();
            t[key] = value;
            variants.push(t);
        }
        let mut sale = trade();
        sale["eventType"] = json!("sell");
        variants.push(sale);
        for value in variants {
            let mut d = populated();
            d.get_mut("portfolio-ledger-v1").unwrap()["events"] = json!([value]);
            let bytes = serde_json::to_vec(&d).unwrap();
            failed_load_preserves(&bytes, None, false);
            let path = path();
            let mut session = Session::open(path.clone()).unwrap();
            session.save(populated()).unwrap();
            let before = fs::read(&path).unwrap();
            let backup = read(&backup_path(&path)).unwrap();
            assert!(session.save(d).is_err());
            assert_eq!(fs::read(&path).unwrap(), before);
            assert_eq!(read(&backup_path(&path)).unwrap(), backup);
            fs::remove_dir_all(path.parent().unwrap()).unwrap();
        }
    }
    #[test]
    fn duplicate_ids_negative_debt_and_bad_assets_fail() {
        for events in [
            json!([trade(), trade()]),
            json!([{"id":"adjust","date":"2020-01-02","sequence":1,"createdAt":"test","updatedAt":"test","eventType":"debt_adjustment","amount":"-1"}]),
        ] {
            let mut d = fixture();
            d.get_mut("portfolio-ledger-v1").unwrap()["events"] = events;
            failed_load_preserves(&serde_json::to_vec(&d).unwrap(), None, false);
        }
        let mut d = fixture();
        d.get_mut("portfolio-ledger-v1").unwrap()["assets"] = json!([null]);
        failed_load_preserves(&serde_json::to_vec(&d).unwrap(), None, false);
    }
    #[test]
    fn malformed_configuration_is_authoritative_but_caches_are_rebuildable() {
        let mut d = populated();
        d.insert("configuration".into(), json!({"schemaVersion":"10"}));
        failed_load_preserves(&serde_json::to_vec(&d).unwrap(), None, false);
        d.remove("configuration");
        d.insert("quote-cache".into(), json!(42));
        d.insert(
            "ledger-price-history-v1".into(),
            json!({"entries":{"bad":{"symbol":42}}}),
        );
        let path = path();
        fs::write(&path, serde_json::to_vec(&d).unwrap()).unwrap();
        let mut s = Session::open(path.clone()).unwrap();
        assert_eq!(s.metadata.state, "portfolioLoaded");
        s.save(Data::new()).unwrap();
        assert_eq!(decode(&fs::read(&path).unwrap()).unwrap(), d);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn locked_primary_or_backup_preserves_files() {
        use std::os::windows::fs::OpenOptionsExt;
        let path = path();
        let mut s = Session::open(path.clone()).unwrap();
        s.save(populated()).unwrap();
        s.save(Data::new()).unwrap();
        let before = fs::read(&path).unwrap();
        let backup = fs::read(backup_path(&path)).unwrap();
        let held = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        assert!(Session::open(path.clone()).is_err());
        assert!(s.save(Data::new()).is_err());
        drop(held);
        let held = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(backup_path(&path))
            .unwrap();
        assert!(s.save(Data::new()).is_err());
        drop(held);
        assert_eq!(fs::read(&path).unwrap(), before);
        assert_eq!(fs::read(backup_path(&path)).unwrap(), backup);
        fs::remove_dir_all(path.parent().unwrap()).unwrap();
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
