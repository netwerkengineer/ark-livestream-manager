//! Tempokaart: maten, kwartnoten en seconden (1-op-1 de Swift `TempoMap`).

#[derive(Clone, Debug)]
pub struct Seg {
    pub qn: f64,
    pub sec: f64,
    pub bpm: f64,
}

#[derive(Clone, Debug)]
pub struct TempoMap {
    pub seg: Vec<Seg>,
    pub qn_per_bar: f64,
    /// maatsoort per stuk: (kwartnoot, kwartnoten per maat)
    pub sigs: Vec<(f64, f64)>,
}

impl Default for TempoMap {
    fn default() -> Self {
        TempoMap { seg: vec![Seg { qn: 0.0, sec: 0.0, bpm: 120.0 }], qn_per_bar: 4.0, sigs: vec![(0.0, 4.0)] }
    }
}

impl TempoMap {
    /// Uit ark-player.json: tempo en maatsoort in kwartnoten
    pub fn from_qn(mut tempo: Vec<(f64, f64)>, sigs: Vec<(f64, f64, f64)>) -> Self {
        let mut m = TempoMap::default();
        tempo.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let mut out: Vec<Seg> = Vec::new();
        for (qn, bpm) in tempo {
            match out.last() {
                Some(l) => {
                    let sec = l.sec + (qn - l.qn) * 60.0 / l.bpm;
                    out.push(Seg { qn, sec, bpm })
                }
                None => out.push(Seg { qn: 0.0, sec: 0.0, bpm }),
            }
        }
        if !out.is_empty() {
            m.seg = out;
        }
        let mut s = sigs;
        s.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let list: Vec<(f64, f64)> = s.iter().map(|&(qn, n, d)| (qn, n * 4.0 / d)).collect();
        if !list.is_empty() {
            m.qn_per_bar = list[0].1;
            m.sigs = list;
        }
        m
    }

    /// Uit song.json: tempo per maat (1-based) en een vaste maatsoort
    pub fn from_bars(mut tempo: Vec<(f64, f64)>, qn_per_bar: f64) -> Self {
        let mut m = TempoMap::default();
        m.qn_per_bar = qn_per_bar;
        m.sigs = vec![(0.0, qn_per_bar)];
        tempo.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap());
        let mut out: Vec<Seg> = Vec::new();
        for (bar, bpm) in tempo {
            let qn = (bar - 1.0) * qn_per_bar;
            match out.last() {
                Some(l) => {
                    let sec = l.sec + (qn - l.qn) * 60.0 / l.bpm;
                    out.push(Seg { qn, sec, bpm })
                }
                None => out.push(Seg { qn: 0.0, sec: 0.0, bpm }),
            }
        }
        if !out.is_empty() {
            m.seg = out;
        }
        m
    }

    pub fn sec_qn(&self, qn: f64) -> f64 {
        let s = self.seg.iter().rev().find(|s| s.qn <= qn).unwrap_or(&self.seg[0]);
        s.sec + (qn - s.qn) * 60.0 / s.bpm
    }
    pub fn qn_sec(&self, sec: f64) -> f64 {
        let s = self.seg.iter().rev().find(|s| s.sec <= sec).unwrap_or(&self.seg[0]);
        s.qn + (sec - s.sec) * s.bpm / 60.0
    }
    pub fn sec_bar(&self, bar: f64) -> f64 {
        self.sec_qn((bar - 1.0) * self.qn_per_bar)
    }
    /// begin van de eerstvolgende maat na (of op) tijdstip t
    pub fn next_bar(&self, t: f64) -> f64 {
        let q = self.qn_sec(t);
        let i = self.sigs.iter().rposition(|s| s.0 <= q + 1e-9).unwrap_or(0);
        let n = ((q - self.sigs[i].0) / self.sigs[i].1).ceil();
        let mut cand = self.sigs[i].0 + n * self.sigs[i].1;
        if i + 1 < self.sigs.len() && self.sigs[i + 1].0 < cand - 1e-9 {
            cand = self.sigs[i + 1].0; // een maatwissel begint op een maatgrens
        }
        self.sec_qn(cand)
    }
    pub fn next_beat(&self, t: f64) -> f64 {
        self.sec_qn(self.qn_sec(t).ceil())
    }
    /// "maat.tel.honderdsten", bijvoorbeeld 12.3.50
    pub fn bar_beat(&self, q: f64) -> String {
        let q = q.max(0.0);
        let mut bars = 0.0;
        let mut i = 0;
        while i + 1 < self.sigs.len() && self.sigs[i + 1].0 <= q + 1e-9 {
            bars += (self.sigs[i + 1].0 - self.sigs[i].0) / self.sigs[i].1;
            i += 1;
        }
        let into = q - self.sigs[i].0;
        let bar = bars + (into / self.sigs[i].1).floor() + 1.0;
        let in_bar = into % self.sigs[i].1;
        let beat = in_bar.floor() + 1.0;
        let frac = ((in_bar - in_bar.floor()) * 100.0).floor() as i64;
        format!("{}.{}.{:02}", bar as i64, beat as i64, frac)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn constant_tempo() {
        let m = TempoMap::from_qn(vec![(0.0, 120.0)], vec![(0.0, 4.0, 4.0)]);
        assert!((m.sec_qn(8.0) - 4.0).abs() < 1e-12);
        assert!((m.next_bar(0.1) - 2.0).abs() < 1e-9);
        assert_eq!(m.bar_beat(6.5), "2.3.50");
    }
    #[test]
    fn tempo_change() {
        let m = TempoMap::from_qn(vec![(0.0, 120.0), (4.0, 60.0)], vec![(0.0, 4.0, 4.0)]);
        assert!((m.sec_qn(6.0) - 4.0).abs() < 1e-12);
        assert!((m.qn_sec(4.0) - 6.0).abs() < 1e-12);
    }
}
