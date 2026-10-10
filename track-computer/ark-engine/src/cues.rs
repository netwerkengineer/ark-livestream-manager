//! FreeShow-cues: de cuetabel van een nummer (<project>.RPP.cues) en de tijdlijn die eruit volgt (cues.swift).

use crate::song::Song;
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct CueSlide {
    pub n: i64,
    pub w: i64,
    pub q: Option<f64>,
    pub text: String,
}

#[derive(Clone, Debug)]
pub struct SlideTime {
    pub t: f64,
    pub n: i64,
}

#[derive(Default, Clone)]
pub struct CueTable {
    pub show_id: Option<String>,
    pub layout_id: Option<String>,
    pub regions: HashMap<i64, Vec<CueSlide>>,
}

fn decode_text(s: &str) -> String {
    let plus = s.replace('+', " ");
    let b = plus.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&plus[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8(out).unwrap_or(plus)
}

/// "n@w@q#tekst" (alle delen na n optioneel)
fn parse_token(t: &str) -> Option<CueSlide> {
    let c: Vec<char> = t.chars().collect();
    let mut i = 0;
    let digits = |i: &mut usize| {
        let s = *i;
        while *i < c.len() && c[*i].is_ascii_digit() {
            *i += 1;
        }
        c[s..*i].iter().collect::<String>()
    };
    let n = digits(&mut i);
    if n.is_empty() {
        return None;
    }
    if i < c.len() && c[i] == '@' {
        i += 1;
    }
    let w = digits(&mut i);
    if i < c.len() && c[i] == '@' {
        i += 1;
    }
    let s = i;
    while i < c.len() && (c[i].is_ascii_digit() || c[i] == '.') {
        i += 1;
    }
    let q: String = c[s..i].iter().collect();
    if i < c.len() && c[i] == '#' {
        i += 1;
    }
    let text: String = c[i..].iter().collect();
    Some(CueSlide { n: n.parse().unwrap_or(0), w: w.parse::<i64>().unwrap_or(1).max(1), q: q.parse().ok(), text: decode_text(&text) })
}

impl CueTable {
    pub fn read(path: &str) -> Option<CueTable> {
        let content = std::fs::read_to_string(path).ok()?;
        let mut lines = content.split('\n');
        let first = lines.next()?;
        if !matches!(first, "ark-cues 1" | "ark-cues 2" | "ark-cues 3" | "ark-cues 4") {
            return None;
        }
        let mut table = CueTable::default();
        for line in lines {
            let parts: Vec<&str> = line.split(|c| c == ' ' || c == '\t').filter(|s| !s.is_empty()).collect();
            let Some(head) = parts.first() else { continue };
            if *head == "show" && parts.len() >= 2 {
                table.show_id = Some(parts[1].to_string());
                table.layout_id = parts.get(2).map(|s| s.to_string());
                continue;
            }
            let Ok(id) = head.parse::<i64>() else { continue };
            table.regions.insert(id, parts[1..].iter().filter_map(|t| parse_token(t)).collect());
        }
        Some(table)
    }
}

/// Tijdlijn (tijd, dia) van een nummer (generateCueItems in de bridge)
pub fn build_timeline(song: &Song, table: &CueTable, lead: f64) -> Vec<SlideTime> {
    let tm = &song.tempo;
    let mut out = Vec::new();
    for sec in &song.sections {
        let Some(list) = table.regions.get(&sec.id) else { continue };
        if list.is_empty() {
            continue;
        }
        let qs = tm.qn_sec(sec.start);
        let len = tm.qn_sec(sec.end) - qs;
        let total: f64 = list.iter().map(|s| s.w as f64).sum();
        let mut use_recorded = true;
        let mut last = 0.0;
        for k in 1..list.len() {
            if let Some(q) = list[k].q {
                if q <= last || q >= len - 0.25 {
                    use_recorded = false;
                }
                last = q;
            }
        }
        let mut acc = 0.0;
        let mut prev: Option<f64> = None;
        for (k, s) in list.iter().enumerate() {
            let mut qn = if k == 0 {
                qs - lead
            } else if let (Some(q), true) = (s.q, use_recorded) {
                qs + q
            } else {
                qs + (acc / total * len + 0.5).floor() - lead
            };
            if let Some(p) = prev {
                if qn < p + 0.25 {
                    qn = (p + 0.5).min(qs + len - 0.25); // altijd in volgorde
                }
            }
            prev = Some(qn);
            acc += s.w as f64;
            out.push(SlideTime { t: tm.sec_qn(qn.max(0.0)), n: s.n });
        }
    }
    out.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap());
    out
}

#[derive(Default, Clone)]
pub struct Recording {
    pub region: Option<usize>,
    pub idx: usize,
    pub taps: HashMap<usize, HashMap<usize, f64>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn token() {
        let t = parse_token("3@12@1.5#Hallo+wereld%21").unwrap();
        assert_eq!((t.n, t.w, t.q, t.text.as_str()), (3, 12, Some(1.5), "Hallo wereld!"));
        let t = parse_token("7").unwrap();
        assert_eq!((t.n, t.w, t.q), (7, 1, None));
        let t = parse_token("2@5#a").unwrap();
        assert_eq!((t.n, t.w, t.q, t.text.as_str()), (2, 5, None, "a"));
    }
}
