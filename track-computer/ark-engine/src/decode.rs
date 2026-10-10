//! Stems inlezen (wav, m4a/aac, flac, mp3, ogg) naar Float32, maximaal 2 kanalen (zoals `loadStem` in Swift).

use std::fs::File;
use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

pub struct Decoded {
    pub ch: Vec<Vec<f32>>,
    pub rate: u32,
}

pub fn decode_file(path: &Path, lead_frames: usize) -> Result<Decoded, String> {
    let file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions { enable_gapless: true, ..Default::default() }, &MetadataOptions::default())
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let mut format = probed.format;
    let track = format.default_track().ok_or("geen audiospoor")?.clone();
    let rate = track.codec_params.sample_rate.unwrap_or(48000);
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let mut ch: Vec<Vec<f32>> = Vec::new();
    let mut nch = 0usize;
    let mut buf: Option<SampleBuffer<f32>> = None;
    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(Error::ResetRequired) => break,
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        if packet.track_id() != track.id {
            continue;
        }
        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(Error::DecodeError(_)) => continue,
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        let spec = *decoded.spec();
        let n_in = spec.channels.count();
        if nch == 0 {
            nch = n_in.min(2);
            let cap = track.codec_params.n_frames.unwrap_or(0) as usize + lead_frames + 4096;
            ch = (0..nch).map(|_| { let mut v = Vec::with_capacity(cap); v.resize(lead_frames, 0.0f32); v }).collect();
        }
        if buf.as_ref().map_or(true, |b| b.capacity() < decoded.capacity() * n_in) {
            buf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
        }
        let b = buf.as_mut().unwrap();
        b.copy_interleaved_ref(decoded);
        for frame in b.samples().chunks_exact(n_in) {
            for c in 0..nch {
                ch[c].push(frame[c]);
            }
        }
    }
    if ch.is_empty() {
        return Err(format!("{}: geen audio", path.display()));
    }
    if lead_frames == 0 {
        trim_gapless(path, &mut ch);
    }
    Ok(Decoded { ch, rate })
}

/// Lengte van een bestand in seconden uit de kop (zonder te decoderen)
pub fn duration_secs(path: &Path) -> Option<f64> {
    let file = File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()).ok()?;
    let t = probed.format.default_track()?;
    let rate = t.codec_params.sample_rate? as f64;
    if let Some((_, _, valid)) = smpb(path) {
        return Some(valid as f64 / rate);
    }
    let n = t.codec_params.n_frames?;
    Some(n as f64 / rate)
}

/// Gapless-gegevens van een m4a (tag iTunSMPB): (aanloop, afsluiting, werkelijke lengte in frames).
/// CoreAudio past die toe; de decoder die we gebruiken niet, dus zonder dit begint elke stem ~60 ms te laat.
pub fn smpb(path: &Path) -> Option<(usize, usize, u64)> {
    use std::io::{Read, Seek, SeekFrom};
    let ext = path.extension()?.to_str()?.to_lowercase();
    if ext != "m4a" && ext != "mp4" && ext != "aac" {
        return None;
    }
    let mut f = File::open(path).ok()?;
    let len = f.metadata().ok()?.len();
    let chunk = 1 << 20;
    for (start, n) in [(0u64, chunk.min(len)), (len.saturating_sub(chunk), chunk.min(len))] {
        f.seek(SeekFrom::Start(start)).ok()?;
        let mut buf = vec![0u8; n as usize];
        f.read_exact(&mut buf).ok()?;
        let tag = b"iTunSMPB";
        if let Some(i) = buf.windows(tag.len()).position(|w| w == tag) {
            // na de tag: "data" + 8 bytes kop, dan " 00000000 00000A40 000000F0 0000000000D568D0 ..."
            let rest = &buf[i + tag.len()..(i + tag.len() + 200).min(buf.len())];
            let text: String = rest.iter().map(|&b| if b.is_ascii_hexdigit() || b == b' ' { b as char } else { ' ' }).collect();
            let fields: Vec<&str> = text.split_whitespace().filter(|t| t.len() == 8 || t.len() == 16).collect();
            // het eerste veld van 8 tekens is 00000000, dan aanloop, afsluiting, lengte
            let hex = |t: &str| u64::from_str_radix(t, 16).ok();
            if fields.len() >= 4 {
                let (prime, pad, valid) = (hex(fields[1])?, hex(fields[2])?, hex(fields[3])?);
                if valid > 0 && prime < 100_000 && pad < 100_000 {
                    return Some((prime as usize, pad as usize, valid));
                }
            }
        }
    }
    None
}

fn trim_gapless(path: &Path, ch: &mut Vec<Vec<f32>>) {
    if let Some((prime, _pad, valid)) = smpb(path) {
        let len = ch[0].len();
        if prime < len {
            let end = (prime as u64 + valid).min(len as u64) as usize;
            for c in ch.iter_mut() {
                c.truncate(end);
                c.drain(..prime);
            }
        }
    }
}

/// (seconden, kanalen tot 2, samplefrequentie) uit de kop van een bestand, voor een schatting van het geheugen
pub fn stem_info(path: &Path) -> Option<(f64, usize, u32)> {
    let file = File::open(path).ok()?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe().format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default()).ok()?;
    let t = probed.format.default_track()?;
    let rate = t.codec_params.sample_rate?;
    let ch = t.codec_params.channels.map(|c| c.count()).unwrap_or(2).min(2).max(1);
    let secs = match smpb(path) {
        Some((_, _, valid)) => valid as f64 / rate as f64,
        None => t.codec_params.n_frames? as f64 / rate as f64,
    };
    Some((secs, ch, rate))
}
