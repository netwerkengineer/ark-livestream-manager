//! ark-engine-cli: dezelfde offline tests als `ark-player selftest|jumptest`, plus `compare` tegen de Swift-uitvoer.

use ark_engine::mixer::{out_count, Mixer};
use ark_engine::song::load_song;
use ark_engine::{read_wav, render_offline, write_wav};
use std::time::Instant;

fn db(x: f32) -> f32 {
    20.0 * x.max(1e-9).log10()
}
fn peak_db(x: &[f32]) -> String {
    format!("{:.1}", db(x.iter().fold(0.0f32, |a, v| a.max(v.abs()))))
}

fn opt(args: &mut Vec<String>, name: &str) -> Option<String> {
    let i = args.iter().position(|a| a == name)?;
    if i + 1 < args.len() {
        let v = args[i + 1].clone();
        args.drain(i..=i + 1);
        return Some(v);
    }
    None
}
fn flag(args: &mut Vec<String>, name: &str) -> bool {
    match args.iter().position(|a| a == name) {
        Some(i) => {
            args.remove(i);
            true
        }
        None => false,
    }
}

fn selftest(folder: &str, mode: &str, start: f64, secs: f64) -> Result<(), String> {
    let t0 = Instant::now();
    let song = load_song(folder)?;
    let load = t0.elapsed().as_secs_f64();
    let mut m = Mixer::default();
    m.song = song;
    m.out_ch = out_count(mode);
    m.requested = mode.into();
    m.apply_routing();
    m.master = 0.5;
    m.pos = (start * m.sr) as usize;
    m.playing = true;
    let w0 = Instant::now();
    let out = render_offline(&mut m, secs, |_, _| {});
    let wall = w0.elapsed().as_secs_f64();
    let tot: usize = m.song.stems.iter().map(|s| s.frames * s.ch.len() * 4).sum();
    println!("Song: {} | {} stems | {:.1} s | {} MB | laden {:.1} s", m.song.title, m.song.stems.len(), m.song.total() as f64 / 48000.0, tot / 1_000_000, load);
    println!("Secties: {}", m.song.sections.iter().map(|s| format!("{}@{:.1}", s.name, s.start)).collect::<Vec<_>>().join(", "));
    println!(
        "Modus {} -> {} op {} uitgangen | mix {} s in {:.2} s | blok gem. {:.0} us, max {:.0} us (beschikbaar {} us)",
        mode, m.applied, m.out_ch, secs, wall, m.sum_micros / m.blocks.max(1) as f64, m.max_micros, (512.0 / 48000.0 * 1e6) as i64
    );
    for c in 0..m.out_ch {
        println!("  uitgang {}: piek {} dBFS", c + 1, peak_db(&out[c]));
    }
    for s in &m.song.stems {
        println!(
            "  stem {:<14} bus {} {:<20} mute:{} live:{} -> uitgang {}{}{}",
            s.name, s.bus, s.bus_name, if s.mute { "ja" } else { "nee" }, if s.live { "ja" } else { "nee" }, s.out_a + 1,
            s.out_b.map(|b| format!("+{}", b + 1)).unwrap_or_default(), if s.mono { " mono" } else { "" }
        );
    }
    let path = std::env::var("ARK_SELFTEST_WAV").unwrap_or_else(|_| std::env::temp_dir().join("ark-engine-selftest.wav").to_string_lossy().into());
    write_wav(&path, &out, 48000)?;
    println!("Geschreven: {path}");
    Ok(())
}

fn jumptest(folder: &str, from: f64, to: usize, mode: &str, do_loop: bool) -> Result<(), String> {
    let song = load_song(folder)?;
    let mut m = Mixer::default();
    m.song = song;
    m.out_ch = 2;
    m.requested = "stereo".into();
    m.apply_routing();
    m.master = 0.5;
    let guide_only = std::env::var("ARK_GUIDE_CHECK").is_ok();
    for s in &mut m.song.stems {
        s.mute = if guide_only { !s.is_guide } else if s.live { false } else { s.mute };
    }
    m.pos = (from * m.sr) as usize;
    m.playing = true;
    let (mut scheduled, mut expect) = (0.0, 0.0);
    let secs = if do_loop { 30.0 } else { 25.0 };
    let hook_block = (2.0 * 48000.0 / 512.0) as usize;
    let out = render_offline(&mut m, secs, |bi, mm| {
        if bi == hook_block {
            scheduled = mm.pos_sec();
            if do_loop {
                let _ = mm.start_loop();
            } else {
                let _ = mm.jump(to, Some(mode));
            }
            if let Some(c) = mm.section_index(mm.pos) {
                let now = mm.pos_sec();
                expect = match mode {
                    "bar" => mm.song.tempo.next_bar(now),
                    "now" => now,
                    _ => mm.song.sections[c].end,
                };
            }
        }
    });
    let sr = m.sr;
    let sec = |f: i64| format!("{:.3}", f as f64 / sr);
    println!(
        "Gepland op {:.3} s: {}",
        scheduled,
        if do_loop { "loop van de huidige sectie".to_string() } else { format!("sprong naar {} ({:.3} s), moment: {}", m.song.sections[to].name, m.song.sections[to].start, mode) }
    );
    println!(
        "Verwacht sprongmoment: {:.3} s | werkelijk: {} s -> {} s | aantal sprongen: {} | positie na afloop: {:.3} s",
        expect, sec(m.last_jump.0), sec(m.last_jump.1), m.jump_count, m.pos_sec()
    );
    if m.last_jump.0 >= 0 {
        let cut = (m.last_jump.0 - (from * sr) as i64) as usize;
        let x = &out[0];
        let mean = x.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f32>() / (x.len() - 1) as f32;
        let mut max_d = 0.0f32;
        for i in cut.saturating_sub(400).max(1)..(cut + 400).min(x.len()) {
            max_d = max_d.max((x[i] - x[i - 1]).abs());
        }
        println!("Stap rond de sprong: max {:.4} | gemiddeld over het hele stuk {:.4} | piek stuk {} dBFS", max_d, mean, peak_db(x));
    }
    let path = std::env::var("ARK_SELFTEST_WAV").unwrap_or_else(|_| std::env::temp_dir().join("ark-engine-jumptest.wav").to_string_lossy().into());
    write_wav(&path, &out, 48000)?;
    println!("Geschreven: {path}");
    Ok(())
}

/// Vergelijkt twee wav-bestanden: aantal kanalen/samples, grootste verschil, aantal gelijke samples
fn compare(a: &str, b: &str) -> Result<bool, String> {
    let (x, y) = (read_wav(a)?, read_wav(b)?);
    if x.len() != y.len() {
        println!("Kanalen verschillen: {} tegen {}", x.len(), y.len());
        return Ok(false);
    }
    let mut ok = true;
    for c in 0..x.len() {
        let n = x[c].len().min(y[c].len());
        let mut max_err = 0.0f32;
        let mut max_at = 0;
        let mut exact = 0usize;
        let mut sq = 0.0f64;
        let mut refsq = 0.0f64;
        for i in 0..n {
            let d = (x[c][i] - y[c][i]).abs();
            if d == 0.0 {
                exact += 1;
            }
            if d > max_err {
                max_err = d;
                max_at = i;
            }
            sq += (d as f64).powi(2);
            refsq += (y[c][i] as f64).powi(2);
        }
        let rms_db = 10.0 * ((sq / n.max(1) as f64).max(1e-30) / refsq.max(1e-30) * n as f64 / n as f64).log10();
        println!(
            "  uitgang {}: {} samples (lengte {} / {}) | gelijk {:.4}% | max verschil {:.3e} (bij {}) | fout t.o.v. signaal {:.1} dB",
            c + 1, n, x[c].len(), y[c].len(), 100.0 * exact as f64 / n.max(1) as f64, max_err, max_at, rms_db
        );
        if x[c].len() != y[c].len() || max_err > 1e-6 {
            ok = false;
        }
    }
    println!("{}", if ok { "GELIJK (binnen 1e-6)" } else { "VERSCHIL" });
    Ok(ok)
}


/// Vergelijkt een opname van de echte uitvoer (met onbekende beginvertraging) met een referentie-render
fn compare_rec(rec: &str, refw: &str, secs: f64) -> Result<bool, String> {
    let (x, y) = (read_wav(rec)?, read_wav(refw)?);
    if x.len() != y.len() {
        println!("Kanalen verschillen: {} tegen {}", x.len(), y.len());
        return Ok(false);
    }
    let n_all = x[0].len();
    let start = (0..n_all).find(|&i| x.iter().any(|c| c[i].abs() > 1e-4)).ok_or("opname is stil")?;
    let len = ((secs * 48000.0) as usize).min(n_all - start).min(y[0].len());
    let mut ok = true;
    for c in 0..x.len() {
        let pf = y[c][..len].iter().fold(0.0f32, |a, v| a.max(v.abs()));
        let pr = x[c][start..start + len].iter().fold(0.0f32, |a, v| a.max(v.abs()));
        if pf < 1e-6 {
            println!("  uitgang {}: referentie stil, opname piek {:.1e}", c + 1, pr);
            ok &= pr < 1e-4;
            continue;
        }
        // beste verschuiving (in samples) op de eerste 2 seconden
        let w = 96000.min(len - 4000);
        let mut best = (0i64, f64::MIN);
        for lag in -2000i64..2000 {
            let mut dot = 0.0f64;
            for i in 2000..w {
                dot += x[c][(start as i64 + i as i64 + lag) as usize] as f64 * y[c][i] as f64;
            }
            if dot > best.1 {
                best = (lag, dot);
            }
        }
        let mut max_err = 0.0f32;
        for i in 2000..len - 2000 {
            let a = x[c][(start as i64 + i as i64 + best.0) as usize];
            max_err = max_err.max((a - y[c][i]).abs());
        }
        println!("  uitgang {}: piek opname {:.1} dB, referentie {:.1} dB, verschuiving {} samples, max verschil {:.2e}", c + 1, db(pr), db(pf), best.0, max_err);
        ok &= max_err < 1e-4;
    }
    println!("{}", if ok { "OPNAME KLOPT MET DE REFERENTIE" } else { "VERSCHIL" });
    Ok(ok)
}


// ------------------------------------------------------------- cue- en overgangstests (virtuele klok), zoals tests.swift
use ark_engine::player::{folder_of, Player};
use std::sync::{Arc, Mutex};

struct Sim {
    p: Arc<Player>,
    now: f64,
    calls: Arc<Mutex<Vec<(f64, String, String)>>>,
    clock: Arc<Mutex<f64>>,
}
impl Sim {
    fn new() -> Sim {
        let mixer = Arc::new(Mutex::new(Mixer::default()));
        {
            let mut m = mixer.lock().unwrap();
            m.sr = 48000.0;
            m.out_ch = 2;
            m.requested = "stereo".into();
            m.master = 0.5;
        }
        let p = Player::new(mixer);
        let calls = Arc::new(Mutex::new(Vec::new()));
        let clock = Arc::new(Mutex::new(0.0));
        let (c2, k2) = (calls.clone(), clock.clone());
        p.lock().on_freeshow = Some(Arc::new(move |a, d| c2.lock().unwrap().push((*k2.lock().unwrap(), a.to_string(), d.to_string()))));
        Sim { p, now: 0.0, calls, clock }
    }
    fn run(&mut self, secs: f64) {
        let block = 512usize;
        let total = (secs * 48000.0) as usize;
        let mut buf = vec![vec![0.0f32; block]; 2];
        let (mut done, mut bi) = (0usize, 0usize);
        while done < total {
            let n = block.min(total - done);
            self.p.mx().render(n, &mut buf);
            done += n;
            bi += 1;
            self.now += n as f64 / 48000.0;
            *self.clock.lock().unwrap() = self.now;
            if bi % 4 == 0 {
                self.p.tick();
            }
        }
    }
    fn activate(&mut self, path: &str) -> Result<(), String> {
        self.p.select_song(path, None)?;
        let f = folder_of(path);
        for _ in 0..400 {
            if self.p.lock().active_folder == f {
                return Ok(());
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        Err("laden duurde te lang".into())
    }
    fn calls(&self) -> Vec<(f64, String, String)> {
        self.calls.lock().unwrap().clone()
    }
    fn clear(&self) {
        self.calls.lock().unwrap().clear();
    }
}

fn sample_cues(song: &ark_engine::song::Song) -> String {
    let mut n = 3;
    let mut parts = vec!["show:abc123@lay1".to_string()];
    for s in &song.sections {
        let nm = s.name.to_lowercase();
        if ["count off", "intro", "instrumental", "outro", "interlude", "ending"].iter().any(|p| nm.starts_with(p)) {
            parts.push(format!("{}:{}", s.id, if nm.starts_with("count") { 1 } else { 2 }));
        } else {
            parts.push(format!("{}:{}", s.id, (0..4).map(|k| format!("{}@{}", n + k, 20 + k * 5)).collect::<Vec<_>>().join(",")));
            n += 4;
        }
    }
    parts.join(";")
}

fn rpp_in(folder: &str) -> String {
    let mut v: Vec<String> = std::fs::read_dir(folder).unwrap().filter_map(|e| e.ok()).map(|e| e.file_name().to_string_lossy().to_string()).filter(|n| n.ends_with(".RPP")).collect();
    v.sort();
    format!("{}/{}", folder, v.first().cloned().unwrap_or_default())
}

fn cuetest(folder: &str) -> Result<(), String> {
    let mut sim = Sim::new();
    sim.p.lock().cfg.lead_beats = 2.0;
    let rpp = rpp_in(folder);
    sim.activate(&rpp)?;
    let sections = sim.p.mx().song.sections.clone();
    let cues = sample_cues(&sim.p.mx().song);
    sim.p.save_cues(&rpp, &cues)?;
    {
        let st = sim.p.lock();
        println!(
            "Cues geladen: {} | show {} layout {} | {} secties | tijdlijn {} dia's",
            st.table.is_some(), st.table.as_ref().and_then(|t| t.show_id.clone()).unwrap_or("-".into()),
            st.table.as_ref().and_then(|t| t.layout_id.clone()).unwrap_or("-".into()), st.table.as_ref().map(|t| t.regions.len()).unwrap_or(0), st.timeline.len()
        );
    }
    println!("Bij het kiezen van het nummer: {:?}", sim.calls().iter().map(|c| format!("{} {}", c.1, c.2)).collect::<Vec<_>>());
    // 1. afspelen vanaf het begin
    sim.clear();
    sim.now = 0.0;
    {
        let mut m = sim.p.mx();
        m.pos = 0;
        m.playing = true;
    }
    sim.run(150.0);
    let calls = sim.calls();
    println!("\n-- Afspelen 0-150 s: {} berichten naar FreeShow", calls.len());
    let mut bad = 0;
    for c in calls.iter().filter(|c| c.1 == "index_select_slide") {
        let idx: i64 = c.2.rsplit("\"index\":").next().unwrap().trim_end_matches('}').parse().unwrap();
        let exp = sim.p.lock().timeline.iter().find(|x| x.n == idx).map(|x| x.t).unwrap_or(-1.0);
        let ok = (c.0 - exp).abs() < 0.12;
        if !ok {
            bad += 1;
        }
        if (c.0 - exp).abs() >= 0.12 || idx <= 12 {
            println!("   t={:7.2}  dia {:2}  (tijdlijn {:7.2})  {}", c.0, idx, exp, if ok { "ok" } else { "AFWIJKING" });
        }
    }
    println!("   dia's te vroeg/laat (> 0,12 s t.o.v. de tijdlijn): {bad}");
    // 2. sprong op de volgende maat
    sim.clear();
    {
        let mut m = sim.p.mx();
        m.pos = 30 * 48000;
        m.playing = true;
    }
    sim.p.lock().sent = None;
    sim.run(1.0);
    let target = sections.iter().position(|s| s.name == "Bridge").ok_or("geen Bridge")?;
    let (t_sched, pos_sched) = (sim.now, sim.p.mx().pos_sec());
    let _ = sim.p.jump(target, Some("bar"));
    let at_song = sim.p.mx().pend_at as f64 / 48000.0;
    let at = t_sched + (at_song - pos_sched);
    sim.run(10.0);
    let first = {
        let st = sim.p.lock();
        let m = sim.p.mx();
        sim.p.first_slide_of(&st, &m, target).unwrap_or(-1)
    };
    let hit = sim.calls().into_iter().find(|c| c.2.contains(&format!("\"index\":{first}")));
    let lead = {
        let st = sim.p.lock();
        let m = sim.p.mx();
        Player::lead_seconds(&m, st.cfg.lead_beats, at_song)
    };
    println!(
        "\n-- Sprong naar {} op de maat (liedtijd {:.2} s, na {:.2} s): eerste dia {} verstuurd {} s voor het sprongmoment (verwacht ongeveer {:.2} s)",
        sections[target].name, at_song, at - t_sched, first, hit.map(|h| format!("{:.2}", at - h.0)).unwrap_or("NIET".into()), lead
    );
    // 3. loop
    sim.clear();
    {
        let mut m = sim.p.mx();
        m.pos = 87 * 48000;
        m.playing = true;
    }
    sim.p.lock().sent = None;
    sim.run(1.0);
    let _ = sim.p.mx().start_loop();
    sim.run(20.0);
    let (loop_name, jumps) = {
        let m = sim.p.mx();
        (m.song.sections[m.loop_sec as usize].name.clone(), m.jump_count)
    };
    println!(
        "-- Loop van {}: {} sprongen; dia's verstuurd: {:?}",
        loop_name, jumps,
        sim.calls().iter().filter(|c| c.1 == "index_select_slide").map(|c| format!("{}s:{}", ((c.0 * 10.0) as i64) / 10, c.2.rsplit("\"index\":").next().unwrap().trim_end_matches('}'))).collect::<Vec<_>>()
    );
    sim.p.mx().stop_loop();
    // 4. timing opnemen
    sim.clear();
    {
        let mut m = sim.p.mx();
        m.pos = 55 * 48000;
        m.playing = true;
    }
    sim.p.lock().sent = None;
    sim.p.record("start")?;
    sim.run(3.0);
    let before: Vec<f64> = sim.p.lock().timeline.iter().map(|x| x.t).collect();
    sim.p.tap(None)?;
    sim.run(2.0);
    sim.p.tap(None)?;
    sim.run(1.0);
    sim.p.record("save")?;
    let after: Vec<f64> = sim.p.lock().timeline.iter().map(|x| x.t).collect();
    println!("-- Timing opnemen: taps {} | tijdlijn gewijzigd: {}", sim.p.lock().last_taps["sections"], before != after);
    Ok(())
}

fn transtest(a: &str, b: &str) -> Result<(), String> {
    let mut sim = Sim::new();
    let (pa, pb) = (rpp_in(a), rpp_in(b));
    sim.activate(&pa)?;
    sim.p.set_setlist(vec![pa.clone(), pb.clone()]);
    for _ in 0..400 {
        if sim.p.lock().cache.len() >= 1 {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    let name = |p: &str| p.trim_end_matches('/').rsplit('/').next().unwrap_or("").to_string();
    {
        let st = sim.p.lock();
        println!("Setlist geladen: {} nummers in het geheugen | volgende: {}", st.cache.len() + 1, Player::next_song(&st).map(|n| name(&n)).unwrap_or("-".into()));
    }
    {
        let mut m = sim.p.mx();
        m.pos = 30 * 48000;
        m.playing = true;
    }
    sim.run(1.0);
    let t0 = sim.p.mx().pos_sec();
    sim.p.select_song(&pb, Some("bar"))?;
    {
        let m = sim.p.mx();
        let at = m.pend_song_at as f64 / 48000.0;
        println!(
            "\nOvergang op de volgende maat gepland vanaf {:.3} s: wisselmoment {:.3} s, fade {:.3} s | in state: pending_song {}",
            t0, at, m.song_fade as f64 / 48000.0, sim.p.lock().switch_target.is_some()
        );
    }
    sim.run(3.0);
    {
        let m = sim.p.mx();
        println!("Na afloop: nummer gewisseld {} keer | actief: {} | positie {:.2} s | pending leeg: {}", m.switched, name(&sim.p.lock().active_path), m.pos_sec(), m.pend_song_at < 0);
    }
    sim.p.set_setlist(vec![pb.clone(), pa.clone()]);
    std::thread::sleep(std::time::Duration::from_millis(2000));
    {
        let mut m = sim.p.mx();
        m.pos = m.song.total() - 2 * 48000;
        m.playing = true;
    }
    sim.run(4.0);
    {
        let m = sim.p.mx();
        println!("Einde van het nummer: gestopt {} | actief nu: {} | positie {:.2} s", !m.playing, name(&sim.p.lock().active_path), m.pos_sec());
    }
    Ok(())
}

fn padtest(wav: &str) -> Result<(), String> {
    let dir = std::env::temp_dir().join("ark-padtest-rs");
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(dir.join("Set/Laag")).map_err(|e| e.to_string())?;
    for k in ["C", "D"] {
        std::fs::copy(wav, dir.join(format!("Set/Laag/{k}.wav"))).map_err(|e| e.to_string())?;
    }
    let mut m = Mixer::default();
    m.pads.set_root(&dir.to_string_lossy());
    println!("sets: {:?}", m.pads.meta().library);
    let mut fails = 0;
    let mut check = |ok: bool, what: String| {
        println!("{} {}", if ok { "ok   " } else { "FOUT " }, what);
        if !ok {
            fails += 1;
        }
    };
    let frames = 4800usize;
    fn run(m: &mut Mixer, blocks: usize, n_out: usize, frames: usize) -> Vec<f32> {
        let mut peak = vec![0.0f32; n_out];
        let mut bufs = vec![vec![0.0f32; frames]; n_out];
        for _ in 0..blocks {
            m.render(frames, &mut bufs);
            for c in 0..n_out {
                for i in 0..frames {
                    peak[c] = peak[c].max(bufs[c][i].abs());
                }
            }
        }
        peak
    }
    let wait = |m: &Mixer| {
        while m.pads.meta().loading {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    };
    for (mode, out_ch, expect) in [("stereo", 2usize, vec![0usize, 1]), ("2ch", 2, vec![1]), ("3ch", 3, vec![1, 2]), ("multi", 8, vec![7])] {
        m.out_ch = out_ch;
        m.requested = mode.into();
        m.apply_routing();
        m.pads.play("Set", "Laag", "C", 0.2, 48000.0);
        wait(&m);
        let err = m.pads.meta().error;
        check(err.is_empty(), format!("{mode}: laden zonder fout ({err})"));
        let peak = run(&mut m, 12, out_ch, frames);
        for c in 0..out_ch {
            let plays = expect.contains(&c);
            check(if plays { peak[c] > 0.05 } else { peak[c] < 0.0001 }, format!("{mode}: uitgang {} {} (piek {})", c + 1, if plays { "speelt" } else { "stil" }, peak[c]));
        }
        m.pads.stop(0.1, 48000.0);
        run(&mut m, 6, out_ch, frames);
        let after = run(&mut m, 2, out_ch, frames);
        check(after.iter().all(|&p| p < 0.0001), format!("{mode}: na stop stil"));
    }
    // crossfade: tijdens het wisselen horen we nooit twee volle pads
    m.out_ch = 2;
    m.requested = "stereo".into();
    m.apply_routing();
    m.pads.play("Set", "Laag", "C", 0.1, 48000.0);
    wait(&m);
    run(&mut m, 6, 2, frames);
    m.pads.play("Set", "Laag", "D", 0.5, 48000.0);
    wait(&m);
    run(&mut m, 8, 2, frames);
    let meta = m.pads.meta();
    check(m.pads.voice_count() == 1 && meta.key == "D", format!("crossfade klaar: één pad over ({} stemmen, toon {})", m.pads.voice_count(), meta.key));
    m.pads.play("Set", "Laag", "X", 1.0, 48000.0);
    check(!m.pads.meta().error.is_empty(), "onbekende toon geeft een melding".into());
    println!("{}", if fails == 0 { "PADTEST GESLAAGD".to_string() } else { format!("PADTEST: {fails} fouten") });
    if fails == 0 { Ok(()) } else { Err("padtest mislukt".into()) }
}

fn ca_test(dir: &str) -> Result<(), String> {

            // ca-test <map>: maakt een CA en twee certificaten (een lokaal en een voor een openbare naam), om met openssl te controleren
            use base64::Engine;
            let dir = std::path::PathBuf::from(dir);
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let ca = ark_engine::lanca::Ca::new(Some(dir.clone()));
            ca.ensure("Testcomputer")?;
            let pem = |der: &[u8]| format!("-----BEGIN CERTIFICATE-----\n{}\n-----END CERTIFICATE-----\n", base64::engine::general_purpose::STANDARD.encode(der).as_bytes().chunks(64).map(|c| String::from_utf8_lossy(c).to_string()).collect::<Vec<_>>().join("\n"));
            let (good, _) = ca.leaf(&["pc.local".to_string()], &["192.168.1.5".to_string()], "Testcomputer")?;
            std::fs::write(dir.join("good.pem"), pem(&good)).map_err(|e| e.to_string())?;
            let (bad, _) = ca.leaf(&["www.example.com".to_string()], &["8.8.8.8".to_string()], "Testcomputer")?;
            std::fs::write(dir.join("bad.pem"), pem(&bad)).map_err(|e| e.to_string())?;
            println!("vingerafdruk: {}", ca.fingerprint());
    Ok(())
}

fn vault_test() -> Result<(), String> {
    use ark_engine::{lanca::Ca, vault};
    std::env::set_var("ARK_VAULT_SERVICE", format!("nl.arkchurch.tracks-desktop.test-{}", std::process::id())); // eigen proefnaam: de echte items blijven ongemoeid
    let mut fails = 0;
    let mut check = |ok: bool, what: &str| {
        println!("{} {}", if ok { "ok   " } else { "FOUT " }, what);
        if !ok {
            fails += 1;
        }
    };
    let have = vault::available();
    println!("sleutelbos beschikbaar: {have}");
    if have {
        check(vault::set("proef", "geheim-1"), "waarde bewaren");
        check(vault::get("proef").as_deref() == Some("geheim-1"), "waarde teruglezen");
        check(vault::set("proef", "geheim-2") && vault::get("proef").as_deref() == Some("geheim-2"), "waarde vervangen");
        vault::delete("proef");
        check(vault::get("proef").is_none(), "waarde verwijderen");
    }
    // certificaatsleutel: een oud bestand met sleutel wordt overgezet (met sleutelbos) of blijft staan (zonder)
    let dir = std::env::temp_dir().join(format!("ark-vault-test-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let ca = Ca::new(Some(dir.clone()));
    ca.ensure("Proef")?;
    let key_file = dir.join("ca.key.pem");
    if have {
        check(!key_file.exists(), "CA: privésleutel staat niet in een bestand");
        check(vault::get("lan-ca-key").map(|k| k.contains("PRIVATE KEY")).unwrap_or(false), "CA: privésleutel staat in de sleutelbos");
    } else {
        check(key_file.exists(), "CA: zonder sleutelbos blijft de sleutel in het bestand");
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&key_file).map(|m| m.permissions().mode() & 0o777).unwrap_or(0);
            check(mode == 0o600, &format!("CA: rechten van het sleutelbestand zijn 600 (nu {mode:o})"));
        }
    }
    check(ca.leaf(&["pc.local".to_string()], &["192.168.1.5".to_string()], "Proef").is_ok(), "CA: certificaat maken met de bewaarde sleutel");
    // oud bestand met sleutel: overzetten
    if have {
        let key = vault::get("lan-ca-key").unwrap_or_default();
        vault::delete("lan-ca-key");
        std::fs::write(&key_file, &key).map_err(|e| e.to_string())?;
        let ca2 = Ca::new(Some(dir.clone()));
        check(ca2.leaf(&["pc.local".to_string()], &[], "Proef").is_ok(), "CA: oud sleutelbestand blijft bruikbaar");
        check(!key_file.exists() && vault::get("lan-ca-key").is_some(), "CA: sleutel uit het oude bestand is naar de sleutelbos verhuisd en het bestand is gewist");
    }
    ca.reset();
    check(!ca.exists() && vault::get("lan-ca-key").is_none() && !key_file.exists(), "CA: opnieuw maken wist alles");
    let _ = std::fs::remove_dir_all(&dir);
    println!("{}", if fails == 0 { "SLEUTELBOSTEST GESLAAGD".to_string() } else { format!("SLEUTELBOSTEST: {fails} fouten") });
    if fails == 0 { Ok(()) } else { Err("sleutelbostest mislukt".into()) }
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("gebruik: ark-engine-cli selftest|jumptest|compare ...");
        std::process::exit(2);
    }
    let cmd = args.remove(0);
    let result = match cmd.as_str() {
        "selftest" => {
            let mode = opt(&mut args, "--mode").unwrap_or_else(|| if flag(&mut args, "--multi") { "multi".into() } else { "stereo".into() });
            if args.is_empty() {
                eprintln!("gebruik: selftest <songmap> [start] [duur] [--mode stereo|2ch|3ch|multi]");
                std::process::exit(2);
            }
            let start = args.get(1).and_then(|s| s.parse().ok()).unwrap_or(30.0);
            let secs = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(20.0);
            selftest(&args[0], &mode, start, secs)
        }
        "jumptest" => {
            let l = flag(&mut args, "--loop");
            if args.len() < 3 {
                eprintln!("gebruik: jumptest <songmap> <vanaf-sec> <sectie-id> [end|bar|now] [--loop]");
                std::process::exit(2);
            }
            let from: f64 = args[1].parse().unwrap_or(0.0);
            let to: usize = args[2].parse().unwrap_or(1);
            let mode = args.get(3).cloned().unwrap_or_else(|| "end".into());
            // Swift gebruikt de sectie-index direct (`song.sections[to]`)
            jumptest(&args[0], from, to, &mode, l)
        }
        "compare" => {
            if args.len() < 2 {
                eprintln!("gebruik: compare <a.wav> <b.wav>");
                std::process::exit(2);
            }
            match compare(&args[0], &args[1]) {
                Ok(true) => Ok(()),
                Ok(false) => std::process::exit(1),
                Err(e) => Err(e),
            }
        }
        "compare-rec" => {
            if args.len() < 2 {
                eprintln!("gebruik: compare-rec <opname.wav> <referentie.wav> [secs]");
                std::process::exit(2);
            }
            match compare_rec(&args[0], &args[1], args.get(2).and_then(|s| s.parse().ok()).unwrap_or(8.0)) {
                Ok(true) => Ok(()),
                Ok(false) => std::process::exit(1),
                Err(e) => Err(e),
            }
        }
        "decode" => {
            // decode <bestand> <uit.wav>: het bestand zoals de speler het in het geheugen zet
            if args.len() < 2 {
                eprintln!("gebruik: decode <bestand> <uit.wav>");
                std::process::exit(2);
            }
            (|| {
                let d = ark_engine::decode::decode_file(std::path::Path::new(&args[0]), 0)?;
                println!("{} kanalen, {} frames, {} Hz", d.ch.len(), d.ch[0].len(), d.rate);
                let ch = if args.get(2).map(|s| s.as_str()) == Some("--48k") { ark_engine::resample::to_rate(d.ch, d.rate, 48000)? } else { d.ch };
                println!("uitvoer: {} frames", ch[0].len());
                write_wav(&args[1], &ch, if args.get(2).map(|s| s.as_str()) == Some("--48k") { 48000 } else { d.rate })
            })()
        }
        "import" => {
            // import <zip> <songsmap>: zet een zip als nummer in een map (zoals de pagina "importeren" doet)
            if args.len() < 2 {
                eprintln!("gebruik: import <zip> <songsmap>");
                std::process::exit(2);
            }
            let mixer = Arc::new(Mutex::new(Mixer::default()));
            let p = Player::new(mixer);
            p.set_songs_root(&args[1]);
            let f = ark_engine::fetch::Fetcher::new(p.clone(), Arc::new(|| (String::new(), String::new())), Arc::new(|_| String::new()));
            f.import_zip(&args[0]);
            let t0 = Instant::now();
            loop {
                std::thread::sleep(std::time::Duration::from_millis(300));
                let st = f.status();
                let j = &st["jobs"][0];
                let state = j["state"].as_str().unwrap_or("");
                if state == "klaar" || state == "fout" {
                    println!("IMPORT {} in {:.1} s: {}", state, t0.elapsed().as_secs_f64(), j);
                    if state == "fout" {
                        std::process::exit(1);
                    }
                    break;
                }
                if t0.elapsed().as_secs() > 600 {
                    eprintln!("time-out");
                    std::process::exit(1);
                }
            }
            Ok(())
        }
        "mirror" => {
            // mirror <server> <sleutel>: de kopie voor gebruik zonder server ophalen (map: ARK_MIRROR_DIR)
            if args.len() < 2 {
                eprintln!("gebruik: mirror <server> <sleutel>");
                std::process::exit(2);
            }
            ark_engine::offline::sync(&args[0], &args[1])
        }
        "ca-test" => ca_test(&args[0]),
        "lan-test" => {
            // lan-test <poort> [--tls]: lokale bediening aan, koppelen vanzelf toestaan, alles in het geheugen (raakt niets echts aan); stopt na 15 minuten
            let tls = flag(&mut args, "--tls");
            let port: u16 = args.first().and_then(|p| p.parse().ok()).unwrap_or(8796);
            let mixer = Arc::new(Mutex::new(Mixer::default()));
            let p = Player::new(mixer);
            p.start_ticker();
            let lan = ark_engine::lan::Lan::new(p, Arc::new(ark_engine::lan::Kv::new(None)), Arc::new(|_, _| true), true);
            lan.start(port, tls, "Testcomputer");
            std::thread::sleep(std::time::Duration::from_secs(900));
            Ok(())
        }
        "vault-test" => vault_test(),
        "padtest" => padtest(args.first().map(|s| s.as_str()).unwrap_or("")),
        "cuetest" => cuetest(args.first().map(|s| s.as_str()).unwrap_or("")),
        "transtest" => transtest(args.first().map(|s| s.as_str()).unwrap_or(""), args.get(1).map(|s| s.as_str()).unwrap_or("")),
        _ => Err("onbekende opdracht".into()),
    };
    if let Err(e) = result {
        eprintln!("fout: {e}");
        std::process::exit(1);
    }
}
