//! Audio-uitvoer via cpal (WASAPI op Windows, ALSA/PipeWire op Linux, CoreAudio op macOS).
//! Het apparaat wordt op 48 kHz gevraagd; de mixer draait in de callback.

use crate::mixer::Mixer;
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::{Arc, Mutex};

pub struct Output {
    pub stream: cpal::Stream,
    pub device_name: String,
    pub channels: usize,
}

pub fn list_devices() -> Vec<(String, usize)> {
    let host = cpal::default_host();
    let mut v = Vec::new();
    for d in host.output_devices().into_iter().flatten() {
        let name = d.name().unwrap_or_else(|_| "?".into());
        let max = d.supported_output_configs().map(|c| c.map(|c| c.channels() as usize).max().unwrap_or(0)).unwrap_or(0);
        v.push((name, max));
    }
    v
}

/// Start het apparaat `name` (of het standaardapparaat) met `want_ch` kanalen (of het maximum tot 8 als None).
pub fn start(mixer: Arc<Mutex<Mixer>>, name: Option<&str>, want_ch: Option<usize>, stats: Arc<crate::stats::Stats>) -> Result<Output, String> {
    let host = cpal::default_host();
    let device = match name {
        Some(n) => host.output_devices().map_err(|e| e.to_string())?.find(|d| d.name().map(|x| x == n).unwrap_or(false)).ok_or(format!("apparaat '{n}' niet gevonden"))?,
        None => host.default_output_device().ok_or("geen standaard uitvoerapparaat")?,
    };
    let device_name = device.name().unwrap_or_default();
    let mut best: Option<cpal::SupportedStreamConfig> = None;
    for c in device.supported_output_configs().map_err(|e| e.to_string())? {
        if c.sample_format() != cpal::SampleFormat::F32 || c.min_sample_rate().0 > 48000 || c.max_sample_rate().0 < 48000 {
            continue;
        }
        let ch = c.channels() as usize;
        let ok = match want_ch {
            Some(w) => ch == w,
            None => true,
        };
        if ok && best.as_ref().map_or(true, |b| ch > b.channels() as usize && ch <= 8) {
            best = Some(c.with_sample_rate(cpal::SampleRate(48000)));
        }
    }
    let cfg = best.ok_or("geen f32-configuratie op 48 kHz met dat aantal kanalen")?;
    let channels = cfg.channels() as usize;
    {
        let mut m = mixer.lock().unwrap();
        m.sr = 48000.0;
        m.out_ch = channels;
        m.apply_routing();
    }
    let m2 = mixer.clone();
    let stats = stats.clone();
    let mut planar: Vec<Vec<f32>> = vec![vec![0.0; 8192]; channels];
    let stream = device
        .build_output_stream(
            &cfg.into(),
            move |data: &mut [f32], _| {
                let total = data.len() / channels;
                let began = stats.begin(total);
                let mut done = 0;
                // de besturing houdt de mixer maar heel kort vast: even wachten is beter dan een stukje stilte
                let mut guard = match m2.try_lock() {
                    Ok(g) => g,
                    Err(_) => {
                        let t = stats.now_us();
                        let mut got = None;
                        while stats.now_us() - t < 2000 {
                            if let Ok(g) = m2.try_lock() {
                                got = Some(g);
                                break;
                            }
                            std::thread::yield_now();
                        }
                        stats.lock_wait_max_us.fetch_max(stats.now_us() - t, std::sync::atomic::Ordering::Relaxed);
                        match got {
                            Some(g) => g,
                            None => {
                                stats.lock_miss.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                data.fill(0.0);
                                return;
                            }
                        }
                    }
                };
                while done < total {
                    let n = (total - done).min(8192);
                    guard.render(n, &mut planar);
                    for i in 0..n {
                        for c in 0..channels {
                            data[(done + i) * channels + c] = planar[c][i];
                        }
                    }
                    done += n;
                }
                drop(guard);
                stats.end(began);
            },
            |e| eprintln!("audio-fout: {e}"),
            None,
        )
        .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(Output { stream, device_name, channels })
}
