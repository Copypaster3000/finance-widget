//! Validate authoritative records before a file can be used or rotated into recovery.
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

#[derive(Debug)]
pub enum Invalid {
    Corrupt(String),
    Future,
}
fn bad(message: &str) -> Invalid {
    Invalid::Corrupt(message.into())
}
fn object(value: &Value) -> Result<&Map<String, Value>, Invalid> {
    value
        .as_object()
        .ok_or_else(|| bad("Invalid financial record"))
}
fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str, Invalid> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| bad("Missing or invalid financial field"))
}
pub fn date(s: &str) -> bool {
    if s.len() != 10 || s.as_bytes()[4] != b'-' || s.as_bytes()[7] != b'-' {
        return false;
    }
    let parts: Vec<_> = s.split('-').map(str::parse::<u32>).collect();
    let (Ok(y), Ok(m), Ok(d)) = (&parts[0], &parts[1], &parts[2]) else {
        return false;
    };
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if leap {
                29
            } else {
                28
            }
        }
        _ => 0,
    };
    *y >= 1900 && *y <= 9999 && *d >= 1 && *d <= days
}
fn decimal(v: &Value, digits: u32, signed: bool) -> Result<i128, Invalid> {
    let s = v
        .as_str()
        .ok_or_else(|| bad("Financial decimals must be text"))?;
    if s.len() > 40 {
        return Err(bad("Financial value exceeds supported range"));
    }
    let negative = s.starts_with('-');
    if negative && !signed {
        return Err(bad("Negative financial value"));
    }
    let s = if negative { &s[1..] } else { s };
    let parts: Vec<_> = s.split('.').collect();
    if parts.len() > 2
        || parts
            .iter()
            .any(|p| p.is_empty() || !p.bytes().all(|c| c.is_ascii_digit()))
        || parts.get(1).is_some_and(|p| p.len() > digits as usize)
    {
        return Err(bad("Invalid decimal precision or syntax"));
    }
    let whole = parts[0]
        .parse::<i128>()
        .map_err(|_| bad("Financial value exceeds supported range"))?;
    let limit = if digits == 2 {
        1_000_000_000_000
    } else {
        1_000_000
    };
    if whole > limit {
        return Err(bad("Financial value exceeds supported range"));
    }
    let scale = 10i128.pow(digits);
    let fraction = parts
        .get(1)
        .map(|p| p.parse::<i128>().unwrap() * 10i128.pow(digits - p.len() as u32))
        .unwrap_or(0);
    let n = whole * scale + fraction;
    if n > limit * scale {
        return Err(bad("Financial value exceeds supported range"));
    }
    Ok(if negative { -n } else { n })
}
fn schema(v: &Value, max: u64) -> Result<u64, Invalid> {
    let n = v
        .get("schemaVersion")
        .and_then(Value::as_u64)
        .ok_or_else(|| bad("Invalid schema version"))?;
    if n > max {
        Err(Invalid::Future)
    } else if n == 0 {
        Err(bad("Invalid schema version"))
    } else {
        Ok(n)
    }
}

pub fn validate(data: &Map<String, Value>) -> Result<(), Invalid> {
    let today = chrono::Local::now().format("%Y-%m-%d").to_string();
    // Compatibility checks precede corruption checks: never downgrade a future file.
    if let Some(c) = data.get("configuration") {
        if c.get("schemaVersion")
            .and_then(Value::as_u64)
            .is_some_and(|n| n > 10)
        {
            return Err(Invalid::Future);
        }
    }
    if let Some(l) = data.get("portfolio-ledger-v1") {
        if l.get("schemaVersion")
            .and_then(Value::as_u64)
            .is_some_and(|n| n > 2)
        {
            return Err(Invalid::Future);
        }
    }
    if let Some(c) = data.get("configuration") {
        object(c)?;
        let config_version = schema(c, 10)?;
        if config_version == 10
            && (c.get("historyStartDate").is_none() || c.get("historyStartMode").is_none())
        {
            return Err(bad("Accounting configuration is incomplete"));
        }
        if let Some(d) = c.get("historyStartDate") {
            if !d.as_str().is_some_and(|s| date(s) && s <= today.as_str()) {
                return Err(bad("Invalid history start date"));
            }
        }
        if let Some(mode) = c.get("historyStartMode") {
            if !matches!(mode.as_str(), Some("auto" | "manual")) {
                return Err(bad("Invalid history start mode"));
            }
        }
        if c.get("appearance").is_some_and(|a| !a.is_object()) {
            return Err(bad("Invalid configuration"));
        }
        for key in ["launchAtStartup", "showInTaskbar"] {
            if c.get(key).is_some_and(|v| !v.is_boolean()) {
                return Err(bad("Invalid configuration flag"));
            }
        }
        if c.get("stockSession")
            .is_some_and(|v| !matches!(v.as_str(), Some("regular" | "extended")))
        {
            return Err(bad("Invalid stock session"));
        }
    }
    let Some(ledger) = data.get("portfolio-ledger-v1") else {
        // Recognized legacy holdings are migratable, unlike an existing empty object.
        let c = data
            .get("configuration")
            .ok_or_else(|| bad("Saved portfolio structure is missing"))?;
        let holdings = c
            .get("holdings")
            .and_then(Value::as_array)
            .ok_or_else(|| bad("Saved ledger is missing"))?;
        let mut ids = HashSet::new();
        for h in holdings {
            object(h)?;
            let id = text(h, "id")?;
            text(h, "symbol")?;
            if !ids.insert(id)
                || !matches!(
                    h.get("type").and_then(Value::as_str),
                    Some("stock" | "crypto")
                )
            {
                return Err(bad("Invalid legacy holding"));
            }
            let q = h
                .get("quantity")
                .and_then(Value::as_f64)
                .ok_or_else(|| bad("Invalid legacy quantity"))?;
            if !q.is_finite() || q <= 0.0 || q > 1_000_000.0 {
                return Err(bad("Invalid legacy quantity"));
            }
        }
        return Ok(());
    };
    object(ledger)?;
    let version = schema(ledger, 2)?;
    let assets = ledger
        .get("assets")
        .and_then(Value::as_array)
        .ok_or_else(|| bad("Invalid assets container"))?;
    let events = ledger
        .get("events")
        .and_then(Value::as_array)
        .ok_or_else(|| bad("Invalid events container"))?;
    let mut quantities = HashMap::new();
    for a in assets {
        object(a)?;
        let id = text(a, "id")?;
        text(a, "symbol")?;
        text(a, "createdAt")?;
        if quantities.insert(id, 0i128).is_some()
            || !matches!(
                a.get("type").and_then(Value::as_str),
                Some("stock" | "crypto")
            )
        {
            return Err(bad("Invalid or duplicate asset"));
        }
    }
    let mut ids = HashSet::new();
    let mut ordered = Vec::new();
    for e in events {
        object(e)?;
        let id = text(e, "id")?;
        if !ids.insert(id) {
            return Err(bad("Duplicate transaction ID"));
        }
        let d = text(e, "date")?;
        if !date(d) || d > today.as_str() {
            return Err(bad("Invalid transaction calendar date"));
        }
        let seq = e
            .get("sequence")
            .and_then(Value::as_u64)
            .filter(|n| *n > 0 && *n <= 9_007_199_254_740_991)
            .ok_or_else(|| bad("Invalid transaction sequence"))?;
        let created = text(e, "createdAt")?;
        text(e, "updatedAt")?;
        ordered.push((d, seq, created, id, e));
    }
    ordered.sort_by(|a, b| (&a.0, a.1, &a.2, &a.3).cmp(&(&b.0, b.1, &b.2, &b.3)));
    let (mut cash, mut debt) = (0i128, 0i128);
    for (_, _, _, _, e) in ordered {
        let kind = text(e, "eventType")?;
        if matches!(kind, "buy" | "sell" | "opening_position") {
            let q = decimal(&e["quantity"], 8, false)?;
            if q <= 0 {
                return Err(bad("Invalid transaction quantity"));
            }
            let owned = quantities
                .get_mut(text(e, "assetId")?)
                .ok_or_else(|| bad("Unknown transaction asset"))?;
            if kind == "opening_position" {
                if version != 1 {
                    return Err(bad("Unexpected legacy opening position"));
                }
                if !matches!(text(e, "priceSource")?, "manual_total" | "legacy_unknown")
                    || !e.get("needsReconciliation").is_some_and(Value::is_boolean)
                {
                    return Err(bad("Invalid legacy opening-position metadata"));
                }
                if let Some(t) = e.get("totalAmount") {
                    let total = decimal(t, 2, false)?;
                    let derived_price = (total * 1_000_000_000_000i128 + q / 2) / q;
                    if total <= 0 || derived_price == 0 || derived_price > 1_000_000_000_000 {
                        return Err(bad("Legacy cost basis is outside supported range"));
                    }
                }
                *owned += q;
            } else {
                let funding = match e.get("affectsCashDebt") {
                    Some(Value::Bool(b)) => *b,
                    None if version == 1 => true,
                    _ => return Err(bad("Invalid trade funding flag")),
                };
                let source = text(e, "priceSource")?;
                if !matches!(
                    source,
                    "manual_unit"
                        | "manual_total"
                        | "current_quote"
                        | "historical_close"
                        | "previous_trading_close"
                        | "stale_quote_confirmed"
                        | "legacy_unknown"
                ) {
                    return Err(bad("Invalid trade price source"));
                }
                let fees = decimal(&e["fees"], 2, false)?;
                let unknown = kind == "buy"
                    && !funding
                    && source == "legacy_unknown"
                    && e.get("totalAmount").is_none()
                    && e.get("unitPrice").is_none();
                if unknown {
                    if fees != 0 {
                        return Err(bad("Unknown-basis trade has fees"));
                    }
                    *owned += q;
                } else {
                    let amount = decimal(&e["totalAmount"], 2, false)?;
                    let price = decimal(&e["unitPrice"], 6, false)?;
                    if kind == "buy" && (amount == 0 || price == 0) {
                        return Err(bad("Invalid purchase value"));
                    }
                    if kind == "sell" {
                        if q > *owned {
                            return Err(bad("Sale exceeds historical position"));
                        }
                        *owned -= q;
                        if funding {
                            let payment = debt.min(amount);
                            debt -= payment;
                            cash += amount - payment;
                        }
                    } else {
                        *owned += q;
                        if funding {
                            let used = cash.min(amount);
                            cash -= used;
                            debt += amount - used;
                        }
                    }
                }
            }
            if *owned > 100_000_000_000_000 {
                return Err(bad("Position exceeds supported quantity"));
            }
        } else {
            let adjustment = matches!(kind, "cash_adjustment" | "debt_adjustment");
            let a = decimal(&e["amount"], 2, adjustment)?;
            if a == 0 {
                return Err(bad("Account event has no effect"));
            }
            match kind {
                "cash_opening" => cash = a,
                "debt_opening" => debt = a,
                "cash_deposit" => {
                    let paid = debt.min(a);
                    debt -= paid;
                    cash += a - paid;
                }
                "cash_withdrawal" => {
                    let used = cash.min(a);
                    cash -= used;
                    debt += a - used;
                }
                "cash_adjustment" => cash += a,
                "debt_adjustment" => debt += a,
                "debt_payment" => {
                    match text(e, "source")? {
                        "cash" => cash -= a,
                        "external" => (),
                        _ => return Err(bad("Invalid debt payment source")),
                    };
                    debt -= a;
                }
                _ => return Err(bad("Unsupported transaction type")),
            }
        }
        if cash < 0 || debt < 0 {
            return Err(bad("Negative Cash or Debt after replay"));
        }
        if cash > 100_000_000_000_000 || debt > 100_000_000_000_000 {
            return Err(bad("Account exceeds supported range"));
        }
    }
    Ok(())
}
