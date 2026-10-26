//! De mixer: rekent per blok, springt sample-nauwkeurig op de maat, loopt een sectie, speelt de guide-aankondiging.
//! 1-op-1 de Swift `Mixer` (core.swift), zelfde volgorde van berekenen zodat de uitkomst gelijk is.
//! Draait in de audio-callback: geen allocaties in `render` (behalve bij nieuw nummer).

use crate::pads::PadPlayer;
use crate::song::{Song, SR};

pub struct Mixer {
    pub song: Song,
    pub pads: PadPlayer, // pads lopen los van het nummer
    pub pos: usize,
    pub playing: bool,
    pub env: f32,
    pub master: f32,
    pub master_muted: bool,
    pub master_now: f32,
    pub out_ch: usize,
    pub sr: f64,
    pub requested: String,
    pub applied: String,
    pub jump_mode: String,
    pub pend_at: i64,
    pub pend_to: i64,
    pub pend_section: i64,
    pub loop_sec: i64,
    pub loop_start: i64,
    pub loop_end: i64,
    pub fade_in: i64,
    /// uitfaden: de stand loopt in secondes naar stil, daarna stopt het nummer (positie 0)
    /// Eigen click: loopt mee met de maten van het nummer, met te kiezen onderverdeling en accent, op de uitgang van de click-stem
    pub click_div: i64, // 0 = uit; anders klikken per kwartnoot: 1 = kwart, 2 = achtste, 3 = achtste triool, 4 = zestiende
    pub click_accent: bool,
    pub click_db: f32,
    click_age: i64,
    click_freq: f64,
    click_amp: f32,
    pub fading: bool,
    pub fade_left: i64,
    pub fade_total: i64,
    /// Voorteller: een paar maten click voordat het nummer begint (alleen vanaf stilstand); de klikken worden hier gemaakt, op de uitgang van de click-stem
    pub counting: bool,
    pub count_left: i64,
    pub count_total: i64,
    pub count_beat_frames: i64,
    pub count_beats: i64,
    pub count_per_bar: i64,
    pub count_out_a: usize,
    pub count_out_b: Option<usize>,
    pub count_mono: bool,
    pub count_bus: usize,
    pub group_mute: [bool; 10],
    pub group_solo: [bool; 10],
    pub group_gain: [f32; 10],
    pub pend_song: Option<Song>,
    /// nummers die net vervangen zijn: de besturing ruimt ze op (geen vrijgeven van geheugen in de audio-callback)
    pub retired: Vec<Song>,
    pub pend_song_at: i64,
    pub song_fade: i64,
    pub switched: u32,
    pub dip: i64,
    pub g_ws: i64,
    pub g_we: i64,
    pub g_src: i64,
    pub last_jump: (i64, i64),
    pub jump_count: u32,
    pub blocks: u64,
    pub sum_micros: f64,
    pub max_micros: f64,
    env_buf: Vec<f32>,
    env_ref: Vec<f32>,
    env_non: Vec<f32>,
    /// Referentie: A/B tussen de mix van de stems en de originele opname (de click en de guide blijven gewoon klinken)
    pub ref_on: bool,
    pub ref_now: f32,
    pub ref_db: f32,
}

impl Default for Mixer {
    fn default() -> Self {
        Mixer {
            song: Song::default(),
            pads: PadPlayer::default(),
            pos: 0,
            playing: false,
            env: 0.0,
            master: 1.0,
            master_muted: false,
            master_now: 1.0,
            out_ch: 2,
            sr: SR,
            requested: "stereo".into(),
            applied: "stereo".into(),
            jump_mode: "end".into(),
            pend_at: -1,
            pend_to: 0,
            pend_section: -1,
            loop_sec: -1,
            loop_start: 0,
            loop_end: 0,
            fade_in: 0,
            click_div: 0,
            click_accent: true,
            click_db: -6.0,
            click_age: i64::MAX,
            click_freq: 1000.0,
            click_amp: 0.0,
            fading: false,
            fade_left: 0,
            fade_total: 1,
            counting: false,
            count_left: 0,
            count_total: 0,
            count_beat_frames: 1,
            count_beats: 0,
            count_per_bar: 4,
            count_out_a: 0,
            count_out_b: None,
            count_mono: false,
            count_bus: 0,
            group_mute: [false; 10],
            group_solo: [false; 10],
            group_gain: [1.0; 10],
            pend_song: None,
            retired: Vec::with_capacity(8),
            pend_song_at: -1,
            song_fade: 0,
            switched: 0,
            dip: 160,
            g_ws: -1,
            g_we: -1,
            g_src: 0,
            last_jump: (-1, -1),
            jump_count: 0,
            blocks: 0,
            sum_micros: 0.0,
            max_micros: 0.0,
            env_buf: vec![0.0; 16384],
            env_ref: vec![0.0; 16384],
            env_non: vec![0.0; 16384],
            ref_on: false,
            ref_now: 0.0,
            ref_db: 0.0,
        }
    }
}

impl Mixer {
    // --- uitgangsmodus: stereo | 2ch | 3ch | multi | auto
    pub fn apply_routing(&mut self) {
        let how = self.resolve_mode();
        self.applied = how.clone();
        for st in &mut self.song.stems {
            route_stem(st, &how);
        }
    }
    /// Zelfde routering voor een nummer dat nog niet actief is (volgend nummer in de setlist)
    pub fn apply_routing_to(&self, target: &mut Song) {
        let how = self.resolve_mode();
        for st in &mut target.stems {
            route_stem(st, &how);
        }
    }
    fn resolve_mode(&self) -> String {
        let n = self.out_ch;
        let mut how = self.requested.clone();
        if how == "auto" {
            how = if n >= 8 { "multi" } else { "stereo" }.into();
        }
        if how == "3ch" && n < 3 {
            how = if n >= 2 { "2ch" } else { "stereo" }.into();
        }
        if how == "2ch" && n < 2 {
            how = "stereo".into();
        }
        if how == "multi" && n < 8 {
            how = if n >= 3 { "3ch" } else if n >= 2 { "2ch" } else { "stereo" }.into();
        }
        how
    }

    // --- tijd <-> frames
    pub fn frame(&self, sec: f64) -> i64 {
        (sec * self.sr).round() as i64
    }
    pub fn pos_sec(&self) -> f64 {
        self.pos as f64 / self.sr
    }
    pub fn section_index(&self, frame_no: usize) -> Option<usize> {
        let t = frame_no as f64 / self.sr;
        self.song.sections.iter().rposition(|s| s.start <= t + 0.0005)
    }

    // --- sprong naar een sectie
    pub fn jump(&mut self, idx: usize, mode: Option<&str>) -> Result<(), String> {
        if idx >= self.song.sections.len() {
            return Err("sectie niet gevonden".into());
        }
        let mode = mode.unwrap_or(&self.jump_mode).to_string();
        let d = self.frame(self.song.sections[idx].start);
        self.stop_loop();
        if !self.playing || mode == "now" {
            if !self.playing {
                self.pos = d as usize;
                self.pend_at = -1;
                self.pend_section = -1;
                self.clear_guide();
                self.last_jump = (self.pos as i64, d);
                return Ok(());
            }
            self.g_ws = -1;
            self.g_we = -1;
            self.pend_to = d;
            self.pend_section = idx as i64;
            self.pend_at = self.pos as i64 + 256;
            return Ok(());
        }
        let now = self.pos_sec();
        let mut t;
        let tm = &self.song.tempo;
        if mode == "bar" {
            t = tm.next_bar(now);
            if t - now < 0.15 {
                t = tm.next_bar(t + 0.01);
            }
        } else {
            if let Some(cur) = self.section_index(self.pos) {
                t = self.song.sections[cur].end;
            } else {
                t = tm.next_bar(now);
            }
            if t - now < 0.1 {
                t = tm.next_bar(t + 0.01);
            }
        }
        t = t.min(self.song.total() as f64 / self.sr);
        // guide: de originele aankondiging van de doelsectie ervoor in de plaats (twee maten, 8 kwartnoten)
        let mut ws = tm.sec_qn(tm.qn_sec(t) - 8.0);
        if ws < now + 0.3 {
            ws = tm.next_beat(now + 0.3);
        }
        self.g_ws = -1;
        self.g_we = -1;
        if self.song.stems.iter().any(|s| s.is_guide) && ws < t - 0.01 {
            let len = t - ws;
            let beat = tm.sec_qn(tm.qn_sec(t)) - tm.sec_qn(tm.qn_sec(t) - 1.0);
            let src = d - self.frame(len);
            let (w0, w1) = (self.frame(ws), self.frame(t));
            self.g_src = if len >= beat * 0.9 && src >= 0 { src } else { -1 }; // liever even stil dan een halve of verkeerde cue
            self.g_ws = w0;
            self.g_we = w1;
        }
        self.pend_to = d;
        self.pend_section = idx as i64;
        self.pend_at = self.frame(t); // als laatste: de audio-thread kijkt hiernaar
        Ok(())
    }

    fn click_beat(&self, g: f64) -> (bool, bool) {
        let sigs = &self.song.tempo.sigs;
        let i = sigs.iter().rposition(|s| s.0 <= g + 1e-6).unwrap_or(0);
        let bar = (g - sigs[i].0) / sigs[i].1.max(0.25);
        ((bar - bar.round()).abs() < 1e-6, (g - g.round()).abs() < 1e-6)
    }
    fn click_mix(&mut self, n: usize, off: usize, out: &mut [Vec<f32>]) {
        if self.click_div <= 0 || n == 0 {
            return;
        }
        let n_out = out.len();
        let q0 = self.song.tempo.qn_sec(self.pos as f64 / self.sr);
        let bpm = self.song.tempo.seg.iter().rev().find(|s| s.qn <= q0).unwrap_or(&self.song.tempo.seg[0]).bpm.max(30.0);
        let dq = bpm / 60.0 / self.sr;
        let d = self.click_div as f64;
        let eps = 1e-6;
        let mut triggers: Vec<(usize, bool, bool)> = Vec::new();
        let mut g = ((q0 - eps) * d).ceil() / d;
        while g < q0 + n as f64 * dq - eps && triggers.len() < 16 {
            let j = (((g - q0) / dq).ceil().max(0.0) as usize).min(n - 1);
            let (strong, on_beat) = self.click_beat(g);
            triggers.push((j, strong, on_beat));
            g += 1.0 / d;
        }
        let st = self
            .song
            .stems
            .iter()
            .find(|s| s.name.to_lowercase().starts_with("click") && !s.name.starts_with("Click 1/"))
            .or_else(|| self.song.stems.iter().find(|s| s.monitor && !s.is_guide));
        let (a, b, mono, bus) = match st {
            Some(s) => (s.out_a.min(n_out - 1), s.out_b.filter(|&b| b < n_out), s.mono, s.bus.min(9)),
            None => (0, None, false, 0),
        };
        if self.group_mute[bus] {
            return;
        }
        let gain = 10f32.powf(self.click_db / 20.0);
        let sr = self.sr;
        let limit = (0.08 * sr) as i64;
        let mut t = 0;
        for i in 0..n {
            while t < triggers.len() && triggers[t].0 == i {
                let (_, strong, on_beat) = triggers[t];
                t += 1;
                self.click_age = 0;
                if self.click_accent {
                    self.click_freq = if strong { 1600.0 } else if on_beat { 1000.0 } else { 800.0 };
                    self.click_amp = if strong { 0.9 } else if on_beat { 0.6 } else { 0.35 };
                } else {
                    self.click_freq = 1000.0;
                    self.click_amp = 0.6;
                }
            }
            if self.click_age < limit {
                let tt = self.click_age as f64 / sr;
                let v = ((2.0 * std::f64::consts::PI * self.click_freq * tt).sin() * (-tt / 0.014).exp()) as f32
                    * self.click_amp * gain * (self.click_age as f32 / 24.0).min(1.0) * self.env_buf[i];
                out[a][off + i] += v;
                if !mono {
                    if let Some(b) = b {
                        if b != a {
                            out[b][off + i] += v;
                        }
                    }
                }
                self.click_age += 1;
            }
        }
    }
    pub fn count_beat(&self) -> i64 {
        if self.counting {
            (self.count_total - self.count_left) / self.count_beat_frames.max(1) + 1
        } else {
            0
        }
        .min(self.count_beats)
    }
    pub fn start_count_in(&mut self, bars: i64) {
        let q = self.song.tempo.qn_sec(self.pos as f64 / self.sr);
        let seg = self.song.tempo.seg.iter().rev().find(|s| s.qn <= q).unwrap_or(&self.song.tempo.seg[0]);
        let bpm = seg.bpm.max(30.0);
        let qpb = self.song.tempo.sigs.iter().rev().find(|s| s.0 <= q + 1e-9).unwrap_or(&self.song.tempo.sigs[0]).1;
        self.count_per_bar = (qpb.round() as i64).max(1);
        self.count_beats = bars.max(1) * self.count_per_bar;
        self.count_beat_frames = ((60.0 / bpm * self.sr) as i64).max(1);
        self.count_total = self.count_beats * self.count_beat_frames;
        self.count_left = self.count_total;
        let st = self
            .song
            .stems
            .iter()
            .find(|s| s.name.to_lowercase().starts_with("click") && !s.name.starts_with("Click 1/"))
            .or_else(|| self.song.stems.iter().find(|s| s.monitor && !s.is_guide));
        self.count_out_a = st.map(|s| s.out_a).unwrap_or(0);
        self.count_out_b = st.and_then(|s| s.out_b);
        self.count_mono = st.map(|s| s.mono).unwrap_or(false);
        self.count_bus = st.map(|s| s.bus).unwrap_or(0).min(9);
        self.counting = true;
        self.playing = false;
    }
    /// Maakt de klikken van de voorteller voor dit blok; geeft het aantal frames terug dat daarmee gevuld is (de rest is voor het nummer zelf)
    fn count_render(&mut self, frames: usize, out: &mut [Vec<f32>]) -> usize {
        let n_out = out.len();
        let n = (frames as i64).min(self.count_left).max(0) as usize;
        let a = self.count_out_a.min(n_out - 1);
        let b = match self.count_out_b {
            Some(b) if b < n_out && b != a => Some(b),
            _ => None,
        };
        if !self.group_mute[self.count_bus] {
            let sr = self.sr;
            for j in 0..n {
                let k = self.count_total - self.count_left + j as i64;
                let beat = k / self.count_beat_frames;
                let within = k % self.count_beat_frames;
                if within as f64 > 0.08 * sr {
                    continue;
                }
                let t = within as f64 / sr;
                let f = if beat % self.count_per_bar == 0 { 1600.0 } else { 1000.0 };
                let v = ((2.0 * std::f64::consts::PI * f * t).sin() * (-t / 0.014).exp() * 0.5) as f32 * self.master_now * (within as f32 / 24.0).min(1.0);
                out[a][j] += v;
                if !self.count_mono {
                    if let Some(b) = b {
                        out[b][j] += v;
                    }
                }
            }
        }
        self.count_left -= n as i64;
        if self.count_left <= 0 {
            self.counting = false;
            self.playing = true;
            self.env = 1.0;
        }
        n
    }
    pub fn start_fade_out(&mut self, secs: f64) {
        if !self.playing || self.fading {
            return;
        }
        self.fade_total = ((secs.max(0.2)) * self.sr) as i64;
        self.fade_total = self.fade_total.max(1);
        self.fade_left = self.fade_total;
        self.fading = true;
    }
    pub fn cancel_pending(&mut self) {
        self.pend_at = -1;
        self.pend_section = -1;
        if self.loop_sec < 0 {
            self.clear_guide();
        }
    }
    pub fn clear_guide(&mut self) {
        self.g_ws = -1;
        self.g_we = -1;
    }

    pub fn start_loop(&mut self) -> Result<(), String> {
        let Some(cur) = self.section_index(self.pos) else { return Err("geen sectie op de huidige positie".into()) };
        let sec = self.song.sections[cur].clone();
        self.cancel_pending();
        let tm = &self.song.tempo;
        let start = self.frame(sec.start);
        let end = self.frame(sec.end);
        let ws = tm.sec_qn(tm.qn_sec(sec.end) - 8.0);
        let (mut gs, mut ge, mut src) = (-1, -1, -1);
        if self.song.stems.iter().any(|s| s.is_guide) && ws < sec.end - 0.01 {
            let len = sec.end - ws;
            let beat = tm.sec_qn(tm.qn_sec(sec.end)) - tm.sec_qn(tm.qn_sec(sec.end) - 1.0);
            gs = self.frame(ws);
            ge = end;
            src = if len >= beat * 0.9 && start - self.frame(len) >= 0 { start - self.frame(len) } else { -1 };
        }
        self.g_src = src;
        self.g_ws = gs;
        self.g_we = ge;
        self.loop_start = start;
        self.loop_end = end;
        self.loop_sec = cur as i64;
        Ok(())
    }
    pub fn stop_loop(&mut self) {
        if self.loop_sec >= 0 {
            self.loop_sec = -1;
            self.clear_guide();
        }
    }

    // --- audio
    /// Vult `out[c][0..frames]` (alle kanalen even lang); schrijft over de oude inhoud heen.
    pub fn render(&mut self, frames: usize, out: &mut [Vec<f32>]) {
        let t0 = std::time::Instant::now();
        for c in out.iter_mut() {
            c[..frames].fill(0.0);
        }
        let mut total = self.song.total() as i64;
        let mut off = 0usize;
        if self.counting {
            off = self.count_render(frames, out);
        }
        while off < frames {
            if !(self.playing || self.env > 0.0001) || total == 0 {
                for st in &mut self.song.stems {
                    st.peak *= 0.9;
                }
                break;
            }
            let pos = self.pos as i64;
            let mut seg = (frames - off) as i64;
            let mut event = 0;
            if self.pend_at >= 0 {
                if self.pend_at <= pos {
                    seg = 0;
                    event = 1;
                } else if self.pend_at - pos < seg {
                    seg = self.pend_at - pos;
                    event = 1;
                }
            }
            if event != 1 && self.pend_song_at >= 0 {
                if self.pend_song_at <= pos {
                    seg = 0;
                    event = 5;
                } else if self.pend_song_at - pos < seg {
                    seg = self.pend_song_at - pos;
                    event = 5;
                }
            }
            if event == 0 && self.loop_sec >= 0 {
                if self.loop_end <= pos {
                    seg = 0;
                    event = 2;
                } else if self.loop_end - pos < seg {
                    seg = self.loop_end - pos;
                    event = 2;
                }
            }
            if event == 0 && total - pos <= seg {
                seg = (total - pos).max(0);
                event = 3;
            }
            if seg > 0 {
                self.mix(seg as usize, off, out);
                self.pos += seg as usize;
                off += seg as usize;
            }
            if self.fading && self.fade_left == 0 {
                // uitgefaded: stoppen
                self.fading = false;
                self.playing = false;
                self.env = 0.0;
                self.pos = 0;
                self.stop_loop();
                self.cancel_pending();
                break;
            }
            match event {
                1 => {
                    self.jump_count += 1;
                    self.last_jump = (self.pos as i64, self.pend_to);
                    self.pos = self.pend_to as usize;
                    self.pend_at = -1;
                    self.pend_section = -1;
                    self.fade_in = self.dip;
                    self.clear_guide();
                }
                2 => {
                    self.jump_count += 1;
                    self.last_jump = (self.pos as i64, self.loop_start);
                    self.pos = self.loop_start as usize;
                    self.fade_in = self.dip;
                }
                5 => {
                    self.switched += 1;
                    if let Some(n) = self.pend_song.take() {
                        let old = std::mem::replace(&mut self.song, n);
                        if self.retired.len() < 8 {
                            self.retired.push(old);
                        } else {
                            std::mem::forget(old);
                        }
                        total = self.song.total() as i64;
                    }
                    self.pend_song_at = -1;
                    self.pend_at = -1;
                    self.pend_section = -1;
                    self.loop_sec = -1;
                    self.clear_guide();
                    self.last_jump = (self.pos as i64, 0);
                    self.pos = 0;
                    self.fade_in = self.dip;
                }
                3 => {
                    self.playing = false;
                    self.pos = total as usize;
                    for st in &mut self.song.stems {
                        st.peak *= 0.9;
                    }
                    break;
                }
                _ => {}
            }
            if seg == 0 && event == 0 {
                break;
            }
        }
        self.pads.mix(frames, out, &self.applied);
        let us = t0.elapsed().as_secs_f64() * 1e6;
        self.blocks += 1;
        self.sum_micros += us;
        self.max_micros = self.max_micros.max(us);
    }

    fn mix(&mut self, n: usize, off: usize, out: &mut [Vec<f32>]) {
        let n_out = out.len();
        let step = (1.0 / (0.005 * self.sr)) as f32;
        let target: f32 = if self.playing { 1.0 } else { 0.0 };
        let fdip = self.dip as f32;
        let master_target: f32 = if self.master_muted { 0.0 } else { self.master };
        let mk = (1.0 / (0.01 * self.sr)) as f32; // ~10 ms: geen klik bij dempen of verschuiven
        let pos = self.pos as i64;
        for i in 0..n {
            self.master_now += (master_target - self.master_now) * mk;
            if self.env < target {
                self.env = target.min(self.env + step);
            } else if self.env > target {
                self.env = target.max(self.env - step);
            }
            let mut g = self.env;
            let ap = pos + i as i64;
            if self.pend_at >= 0 {
                g *= ((self.pend_at - ap) as f32 / fdip).max(0.0).min(1.0);
            }
            if self.loop_sec >= 0 {
                g *= ((self.loop_end - ap) as f32 / fdip).max(0.0).min(1.0);
            }
            if self.pend_song_at >= 0 && self.song_fade > 0 {
                g *= ((self.pend_song_at - ap) as f32 / self.song_fade as f32).max(0.0).min(1.0);
            }
            if self.fade_in > 0 {
                g *= (self.dip - self.fade_in) as f32 / fdip;
                self.fade_in -= 1;
            }
            if self.fading {
                let r = self.fade_left as f32 / self.fade_total as f32;
                g *= r * r;
                if self.fade_left > 0 {
                    self.fade_left -= 1;
                }
            }
            self.env_buf[i] = g * self.master_now;
        }
        self.click_mix(n, off, out);
        let ref_target: f32 = if self.ref_on && self.song.reference.is_some() { 1.0 } else { 0.0 };
        let ref_active = self.ref_now > 0.0 || ref_target > 0.0;
        if ref_active {
            let rk = (1.0 / (0.02 * self.sr)) as f32;
            for i in 0..n {
                self.ref_now += (ref_target - self.ref_now) * rk;
                if (ref_target - self.ref_now).abs() < 1e-4 {
                    self.ref_now = ref_target;
                }
                self.env_ref[i] = self.env_buf[i] * self.ref_now;
                self.env_non[i] = self.env_buf[i] * (1.0 - self.ref_now);
            }
        }
        let guide_active = self.g_ws >= 0;
        let solo_active = self.group_solo.iter().any(|&b| b) || self.song.stems.iter().any(|s| s.solo);
        let (g_ws, g_we, g_src) = (self.g_ws, self.g_we, self.g_src);
        let env_buf = &self.env_buf;
        let e_non = if ref_active { &self.env_non } else { &self.env_buf };
        let (group_mute, group_solo, group_gain) = (&self.group_mute, &self.group_solo, &self.group_gain);
        let pos_u = self.pos;
        for s in self.song.stems.iter_mut() {
            let b = s.bus.min(9);
            if s.mute || group_mute[b] || (solo_active && !(s.solo || group_solo[b])) {
                s.peak *= 0.9;
                continue;
            }
            let g = s.gain * group_gain[b] * s.trim;
            let eb = if s.monitor { env_buf } else { e_non };
            let mut pk: f32 = 0.0;
            let a_idx = s.out_a.min(n_out - 1);
            let b_idx = match s.out_b {
                Some(o) if o < n_out => o,
                _ => a_idx,
            };
            let l = &s.ch[0];
            let r = if s.ch.len() > 1 { &s.ch[1] } else { &s.ch[0] };
            if s.is_guide && guide_active {
                for i in 0..n {
                    let ap = pos + i as i64;
                    let mut idx = ap;
                    if ap >= g_ws && ap < g_we {
                        idx = if g_src >= 0 { g_src + (ap - g_ws) } else { -1 };
                    }
                    if idx < 0 || idx as usize >= s.frames {
                        continue;
                    }
                    let idx = idx as usize;
                    let e = g * eb[i];
                    if s.mono {
                        let v = (l[idx] + r[idx]) * 0.5 * e;
                        out[a_idx][off + i] += v;
                        pk = pk.max(v.abs());
                    } else {
                        let a = l[idx] * e;
                        let b2 = r[idx] * e;
                        out[a_idx][off + i] += a;
                        out[b_idx][off + i] += b2;
                        pk = pk.max(a.abs().max(b2.abs()));
                    }
                }
            } else {
                let m = n.min(s.frames.saturating_sub(pos_u));
                if m == 0 {
                    s.peak *= 0.9;
                    continue;
                }
                let lp = &l[pos_u..pos_u + m];
                let rp = &r[pos_u..pos_u + m];
                if s.mono {
                    for i in 0..m {
                        let v = (lp[i] + rp[i]) * 0.5 * g * eb[i];
                        out[a_idx][off + i] += v;
                        pk = pk.max(v.abs());
                    }
                } else {
                    for i in 0..m {
                        let e = g * eb[i];
                        let a = lp[i] * e;
                        let b2 = rp[i] * e;
                        out[a_idx][off + i] += a;
                        out[b_idx][off + i] += b2;
                        pk = pk.max(a.abs().max(b2.abs()));
                    }
                }
            }
            s.peak = pk.max(s.peak * 0.9);
        }
        if self.ref_now > 0.0 {
            self.reference_mix(n, off, out);
        }
    }

    fn reference_route(&self) -> (usize, Option<usize>, bool) {
        match self.applied.as_str() {
            "multi" => (6, Some(7), false),
            "2ch" => (1, None, true),
            "3ch" => (1, Some(2), false),
            _ => (0, Some(1), false),
        }
    }
    fn reference_mix(&mut self, n: usize, off: usize, out: &mut [Vec<f32>]) {
        let n_out = out.len();
        let (a, b, mono) = self.reference_route();
        let a = a.min(n_out - 1);
        let b = b.filter(|&b| b < n_out && b != a);
        let g = 10f32.powf(self.ref_db / 20.0);
        let pos = self.pos as i64;
        let offset = self.song.ref_offset;
        let Some(r) = self.song.reference.as_ref() else { return };
        let l = &r.ch[0];
        let rr = if r.ch.len() > 1 { &r.ch[1] } else { &r.ch[0] };
        for i in 0..n {
            let idx = pos + i as i64 + offset;
            if idx < 0 || idx as usize >= r.frames {
                continue;
            }
            let idx = idx as usize;
            let e = g * self.env_ref[i];
            if mono {
                out[a][off + i] += (l[idx] + rr[idx]) * 0.5 * e;
            } else {
                out[a][off + i] += l[idx] * e;
                if let Some(b) = b {
                    out[b][off + i] += rr[idx] * e;
                }
            }
        }
    }
}

fn route_stem(st: &mut crate::song::Stem, how: &str) {
    st.trim = 1.0;
    match how {
        "multi" => {
            st.out_a = st.bus - 1;
            st.out_b = None;
            st.mono = true;
        }
        "2ch" => {
            st.mono = true;
            st.out_b = None;
            st.out_a = if st.monitor { 0 } else { 1 };
            if st.monitor {
                st.trim = 0.7079;
            }
        }
        "3ch" => {
            if st.monitor {
                st.mono = true;
                st.out_a = 0;
                st.out_b = None;
                st.trim = 0.7079;
            } else {
                st.mono = false;
                st.out_a = 1;
                st.out_b = Some(2);
            }
        }
        _ => {
            st.mono = false;
            st.out_a = 0;
            st.out_b = Some(1);
        }
    }
}

pub fn out_count(mode: &str) -> usize {
    match mode {
        "multi" | "auto" => 8,
        "3ch" => 3,
        _ => 2,
    }
}

#[cfg(test)]
mod count_tests {
    use super::*;
    use crate::song::Stem;

    #[test]
    fn count_in_then_song() {
        let n = 10 * 48000;
        let mut song = Song::default();
        song.stems.push(Stem::new("Keys", vec![vec![0.0; n], vec![0.0; n]]));
        song.stems.push(Stem::new("Click", vec![vec![0.0; n]]));
        let mut m = Mixer::default();
        m.sr = 48000.0;
        m.song = song;
        m.out_ch = 2;
        m.apply_routing();
        m.start_count_in(1); // 120 bpm, 4/4: 4 tellen van 0,5 s
        assert_eq!(m.count_beats, 4);
        let mut out = vec![vec![0.0f32; 480]; 2];
        let mut peak = 0.0f32;
        let mut seen = std::collections::BTreeSet::new();
        for _ in 0..100 {
            m.render(480, &mut out);
            if m.counting {
                seen.insert(m.count_beat());
            }
            peak = peak.max(out[0].iter().fold(0.0, |a, v| a.max(v.abs())));
        }
        // 100 x 10 ms = 1 s: nog in de voorteller (2 s), er is geklikt, het nummer is niet begonnen
        assert!(m.counting && !m.playing && m.pos == 0);
        assert!(peak > 0.3);
        assert!(seen.contains(&1) && seen.contains(&2));
        for _ in 0..120 {
            m.render(480, &mut out);
        }
        assert!(!m.counting && m.playing);
        assert!(m.pos > 0);
    }
}

#[cfg(test)]
mod click_tests {
    use super::*;
    use crate::song::Stem;

    #[test]
    fn click_follows_the_bars() {
        let n = 20 * 48000;
        let mut song = Song::default();
        song.stems.push(Stem::new("Keys", vec![vec![0.0; n], vec![0.0; n]]));
        song.stems.push(Stem::new("Click", vec![vec![0.0; n]]));
        let mut m = Mixer::default();
        m.sr = 48000.0;
        m.song = song;
        m.out_ch = 2;
        m.apply_routing();
        m.click_db = 0.0;
        m.playing = true;
        m.env = 1.0;
        let mut counts = Vec::new();
        for div in [1, 2, 3, 4] {
            m.click_div = div;
            m.pos = 0;
            let mut out = vec![vec![0.0f32; 480]; 2];
            let (mut onsets, mut quiet, mut hi) = (0, 0, false);
            for _ in 0..400 {
                // 4 s in blokken van 10 ms
                m.render(480, &mut out);
                for x in out[0].iter() {
                    if x.abs() > 0.02 {
                        if !hi && quiet > 480 {
                            onsets += 1;
                        }
                        hi = true;
                        quiet = 0;
                    } else {
                        quiet += 1;
                        if quiet > 1440 {
                            hi = false;
                        }
                    }
                }
            }
            counts.push(onsets);
        }
        // 120 bpm = 2 per s: 4 s geeft 8, 16, 24 (triool: 6 per kwart-paar) en 32 klikken (+/- 1 aan de rand)
        for (got, want) in counts.iter().zip([8, 16, 24, 32]) {
            assert!((got - want as i32).abs() <= 1, "{:?}", counts);
        }
        m.click_div = 0;
        m.pos = 0;
        let mut out = vec![vec![0.0f32; 480]; 2];
        m.render(480, &mut out);
        m.render(480, &mut out);
        assert!(out[0].iter().all(|v| v.abs() < 1e-6));
    }
}

#[cfg(test)]
mod reference_tests {
    use super::*;
    use crate::song::Stem;

    #[test]
    fn reference_replaces_the_stems_but_not_the_click() {
        let n = 10 * 48000;
        let mut song = Song::default();
        song.stems.push(Stem::new("Keys", vec![vec![0.2; n], vec![0.2; n]]));
        song.stems.push(Stem::new("Click", vec![vec![0.05; n]]));
        // referentie: 0,4 vanaf 1 s in het bestand
        let r: Vec<f32> = (0..n).map(|i| if i < 48000 { 0.0 } else { 0.4 }).collect();
        song.reference = Some(Stem::new("Reference", vec![r.clone(), r]));
        let mut m = Mixer::default();
        m.sr = 48000.0;
        m.song = song;
        m.out_ch = 2;
        m.apply_routing();
        m.playing = true;
        m.env = 1.0;
        let mut out = vec![vec![0.0f32; 480]; 2];
        let last = |m: &mut Mixer, out: &mut Vec<Vec<f32>>, blocks: usize| {
            for _ in 0..blocks {
                m.render(480, out);
            }
            out[0][479]
        };
        let with_stems = last(&mut m, &mut out, 10);
        assert!(with_stems > 0.19 && with_stems < 0.4, "{with_stems}");
        m.ref_on = true;
        let with_ref = last(&mut m, &mut out, 10); // 100 ms later: de wissel (20 ms) is klaar, pos < 1 s dus de referentie is nog stil
        assert!(with_ref < 0.1, "{with_ref}"); // alleen de click (0,05) blijft
        m.song.ref_offset = 48000 * 2; // de referentie ligt 2 s verder: nu klinkt hij meteen
        let shifted = last(&mut m, &mut out, 2);
        assert!(shifted > 0.38 && shifted < 0.5, "{shifted}");
        m.ref_on = false;
        let back = last(&mut m, &mut out, 10);
        assert!(back > 0.19 && back < 0.4, "{back}");
    }
}
