//! Omrekenen naar 48 kHz (de speler werkt altijd op 48 kHz). MultiTracks-stems zijn 44,1 kHz.
//! Frequentiedomein-omrekenen met een vast verhouding (44100:48000 = 147:160): schoon en snel genoeg om bij het laden te doen.

use rubato::{FftFixedIn, Resampler};

pub fn to_rate(ch: Vec<Vec<f32>>, rate_in: u32, rate_out: u32) -> Result<Vec<Vec<f32>>, String> {
    if rate_in == rate_out || ch.is_empty() {
        return Ok(ch);
    }
    let n_in = ch[0].len();
    let nch = ch.len();
    let want = ((n_in as f64) * rate_out as f64 / rate_in as f64).round() as usize;
    let mut rs = FftFixedIn::<f32>::new(rate_in as usize, rate_out as usize, 8192, 2, nch).map_err(|e| format!("omrekenen: {e}"))?;
    let delay = rs.output_delay();
    let mut out: Vec<Vec<f32>> = vec![Vec::with_capacity(want + delay + 16384); nch];
    let mut pos = 0usize;
    // hele blokken
    loop {
        let need = rs.input_frames_next();
        if pos + need > n_in {
            break;
        }
        let block: Vec<&[f32]> = ch.iter().map(|c| &c[pos..pos + need]).collect();
        let o = rs.process(&block, None).map_err(|e| format!("omrekenen: {e}"))?;
        for c in 0..nch {
            out[c].extend_from_slice(&o[c]);
        }
        pos += need;
    }
    // de rest en daarna leegmaken tot er genoeg uitvoer is
    let rest: Vec<&[f32]> = ch.iter().map(|c| &c[pos..]).collect();
    let o = rs.process_partial(Some(&rest), None).map_err(|e| format!("omrekenen: {e}"))?;
    for c in 0..nch {
        out[c].extend_from_slice(&o[c]);
    }
    let mut guard = 0;
    while out[0].len() < want + delay && guard < 8 {
        let o = rs.process_partial(None::<&[Vec<f32>]>, None).map_err(|e| format!("omrekenen: {e}"))?;
        for c in 0..nch {
            out[c].extend_from_slice(&o[c]);
        }
        guard += 1;
    }
    for c in out.iter_mut() {
        let start = delay.min(c.len());
        c.drain(..start);
        c.resize(want, 0.0);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sine_keeps_pitch_and_length() {
        let n = 44100 * 2;
        let f = 1000.0f32;
        let x: Vec<f32> = (0..n).map(|i| (2.0 * std::f32::consts::PI * f * i as f32 / 44100.0).sin() * 0.5).collect();
        let y = to_rate(vec![x.clone(), x], 44100, 48000).unwrap();
        assert_eq!(y[0].len(), 96000);
        // dezelfde sinus op 48 kHz, na de aanloop
        let mut max_err = 0.0f32;
        for i in 5000..90000 {
            let e = (2.0 * std::f32::consts::PI * f * i as f32 / 48000.0).sin() * 0.5;
            max_err = max_err.max((y[0][i] - e).abs());
        }
        assert!(max_err < 2e-3, "fout {max_err}");
    }
}
