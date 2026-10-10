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
            self.env_buf[i] = g * self.master_now;
        }
        let guide_active = self.g_ws >= 0;
        let solo_active = self.group_solo.iter().any(|&b| b) || self.song.stems.iter().any(|s| s.solo);
        let (g_ws, g_we, g_src) = (self.g_ws, self.g_we, self.g_src);
        let env_buf = &self.env_buf;
        let (group_mute, group_solo, group_gain) = (&self.group_mute, &self.group_solo, &self.group_gain);
        let pos_u = self.pos;
        for s in self.song.stems.iter_mut() {
            let b = s.bus.min(9);
            if s.mute || group_mute[b] || (solo_active && !(s.solo || group_solo[b])) {
                s.peak *= 0.9;
                continue;
            }
            let g = s.gain * group_gain[b] * s.trim;
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
                    let e = g * env_buf[i];
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
                        let v = (lp[i] + rp[i]) * 0.5 * g * env_buf[i];
                        out[a_idx][off + i] += v;
                        pk = pk.max(v.abs());
                    }
                } else {
                    for i in 0..m {
                        let e = g * env_buf[i];
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
