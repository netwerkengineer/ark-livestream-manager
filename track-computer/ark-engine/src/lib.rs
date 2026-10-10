//! ark-engine: de speler van Ark Tracks, platformonafhankelijk.
//!
//! Dit is de Rust-versie van `track-computer/ark-player` (Swift). Dezelfde onderdelen, dezelfde uitkomsten:
//! de mixer rekent per blok van 48 kHz-samples, springt sample-nauwkeurig op de maat met een korte fade, en
//! speelt de guide-aankondiging van de doelsectie. Het audioapparaat zit er niet in (dat is `cpal`, in de schil);
//! hier wordt alleen gerekend, zodat de uitkomst offline met de Swift-speler vergeleken kan worden.

pub mod clickbank;
pub mod cues;
pub mod fetch;
pub mod importer;
pub mod decode;
pub mod offline;
pub mod pads;
pub mod player;
pub mod resample;
pub mod server;
pub mod lan;
pub mod lanca;
pub mod mixer;
pub mod song;
pub mod stats;
pub mod tempo;
#[cfg(feature = "audio")]
pub mod output;

/// Offline renderen zoals de Swift-tests: blokken van 512, uitvoer per kanaal
pub fn render_offline(m: &mut mixer::Mixer, secs: f64, mut on_block: impl FnMut(usize, &mut mixer::Mixer)) -> Vec<Vec<f32>> {
    let block = 512usize;
    let n_out = m.out_ch;
    let total = (secs * m.sr) as usize;
    let mut out = vec![vec![0.0f32; total]; n_out];
    let mut buf = vec![vec![0.0f32; block]; n_out];
    let (mut done, mut bi) = (0usize, 0usize);
    while done < total {
        let n = block.min(total - done);
        on_block(bi, m);
        m.render(n, &mut buf);
        for c in 0..n_out {
            out[c][done..done + n].copy_from_slice(&buf[c][..n]);
        }
        done += n;
        bi += 1;
    }
    out
}

pub fn write_wav(path: &str, channels: &[Vec<f32>], sr: u32) -> Result<(), String> {
    let spec = hound::WavSpec { channels: channels.len() as u16, sample_rate: sr, bits_per_sample: 32, sample_format: hound::SampleFormat::Float };
    let mut w = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
    for i in 0..channels[0].len() {
        for c in channels {
            w.write_sample(c[i]).map_err(|e| e.to_string())?;
        }
    }
    w.finalize().map_err(|e| e.to_string())
}

pub fn read_wav(path: &str) -> Result<Vec<Vec<f32>>, String> {
    let mut r = hound::WavReader::open(path).map_err(|e| format!("{path}: {e}"))?;
    let spec = r.spec();
    let n = spec.channels as usize;
    let mut out = vec![Vec::new(); n];
    match spec.sample_format {
        hound::SampleFormat::Float => {
            for (i, s) in r.samples::<f32>().enumerate() {
                out[i % n].push(s.map_err(|e| e.to_string())?);
            }
        }
        hound::SampleFormat::Int => {
            let sc = 1.0 / (1u64 << (spec.bits_per_sample - 1)) as f32;
            for (i, s) in r.samples::<i32>().enumerate() {
                out[i % n].push(s.map_err(|e| e.to_string())? as f32 * sc);
            }
        }
    }
    Ok(out)
}
