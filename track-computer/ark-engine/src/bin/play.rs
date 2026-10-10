//! ark-engine-play: speelt een nummer af op een audioapparaat, om het echte geluid te testen.
//! gebruik: ark-engine-play devices
//!          ark-engine-play play <songmap> [--device NAAM] [--channels N] [--mode stereo|2ch|3ch|multi|auto]
//!                          [--start SEC] [--secs SEC] [--jump SECTIE-INDEX[:end|bar|now]] [--jump-at SEC]

use ark_engine::mixer::Mixer;
use ark_engine::{output, song::load_song};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn opt(args: &mut Vec<String>, name: &str) -> Option<String> {
    let i = args.iter().position(|a| a == name)?;
    if i + 1 < args.len() {
        let v = args[i + 1].clone();
        args.drain(i..=i + 1);
        return Some(v);
    }
    None
}

fn main() {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if args.is_empty() {
        eprintln!("gebruik: ark-engine-play devices | play <songmap> ...");
        std::process::exit(2);
    }
    let cmd = args.remove(0);
    if cmd == "devices" {
        for (n, c) in output::list_devices() {
            println!("{n}  (max {c} uitgangen)");
        }
        return;
    }
    let device = opt(&mut args, "--device");
    let channels = opt(&mut args, "--channels").and_then(|s| s.parse().ok());
    let mode = opt(&mut args, "--mode").unwrap_or_else(|| "auto".into());
    let start: f64 = opt(&mut args, "--start").and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let secs: f64 = opt(&mut args, "--secs").and_then(|s| s.parse().ok()).unwrap_or(15.0);
    let jump = opt(&mut args, "--jump");
    let jump_at: f64 = opt(&mut args, "--jump-at").and_then(|s| s.parse().ok()).unwrap_or(5.0);
    let Some(folder) = args.first() else {
        eprintln!("songmap ontbreekt");
        std::process::exit(2);
    };
    let t0 = Instant::now();
    let song = match load_song(folder) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("fout: {e}");
            std::process::exit(1);
        }
    };
    println!("Geladen: {} ({} stems) in {:.1} s", song.title, song.stems.len(), t0.elapsed().as_secs_f64());
    let mut m = Mixer::default();
    m.song = song;
    m.master = 0.5;
    m.requested = mode;
    m.pos = (start * 48000.0) as usize;
    let mixer = Arc::new(Mutex::new(m));
    let out = match output::start(mixer.clone(), device.as_deref(), channels, Arc::new(ark_engine::stats::Stats::new())) {
        Ok(o) => o,
        Err(e) => {
            eprintln!("audio starten mislukt: {e}");
            std::process::exit(1);
        }
    };
    {
        let mut m = mixer.lock().unwrap();
        println!("Audio: {}, {} uitgangen, 48000 Hz, modus {} -> {}", out.device_name, out.channels, m.requested, m.applied);
        m.playing = true;
    }
    let t = Instant::now();
    let mut jumped = jump.is_none();
    while t.elapsed().as_secs_f64() < secs {
        std::thread::sleep(Duration::from_millis(50));
        if !jumped && t.elapsed().as_secs_f64() >= jump_at {
            let j = jump.clone().unwrap();
            let mut p = j.split(':');
            let idx: usize = p.next().and_then(|s| s.parse().ok()).unwrap_or(0);
            let mode = p.next();
            let mut m = mixer.lock().unwrap();
            println!("Sprong gepland op {:.2} s naar sectie {} ({:?})", m.pos_sec(), idx, mode);
            if let Err(e) = m.jump(idx, mode) {
                println!("sprong mislukt: {e}");
            }
            jumped = true;
        }
    }
    let m = mixer.lock().unwrap();
    println!(
        "Klaar: positie {:.2} s, sprongen {}, blokken {}, gem. {:.0} us, max {:.0} us",
        m.pos_sec(), m.jump_count, m.blocks, m.sum_micros / m.blocks.max(1) as f64, m.max_micros
    );
}
