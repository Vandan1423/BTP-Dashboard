"""
Reconstructs background/rising/falling phase labels for ARBITRARY historic data,
using the full fetched window (not a real-time guess) -- unlike estimate_phase.py's
causal heuristic, this doesn't need to predict the future because for historic data
the "future" relative to any point in the requested range is already sitting in the
data we fetched for the whole range. Only usable for `source_kind == "historic"`;
live data has no such luxury (see data_fetch.py's UnsupportedRangeError / app.py's
own check before calling this).

Mirrors Data/data_preprocess.py's find_indices() + add_phases(), which built the
ORIGINAL training labels from Data/p10f10event.dat, whose own header defines the
event boundaries this reconstructs:
    F(>10MeV)>10 pfu Event list
    Index (1=onset 2=threshold, 3=maximum 4=end (threshold/5))
and the paper's Table 1 note: "The onset time is defined to be the time when the
flux rises three times the error bar above the pre-event background. The end time
is set when the flux drops below 2 pfu [ = threshold/5 ]."

We don't have true instrument error bars in the fetched data, so "three times the
error bar above background" is approximated as background_mean + 3 * background_std
over a trailing pre-event window -- the standard proxy for that kind of statistical
threshold. Validated against the real training labels in validate_against_training()
below; see analysis/validate_historic_phases.py for the actual accuracy numbers.
"""
import numpy as np
import pandas as pd

LN10 = float(np.log(10))
END_THRESH = float(np.log(10 / 5))     # matches p10f10event.dat's "end = threshold/5"
BACKGROUND_WINDOW = 24                  # 2 hours of 5-min steps, for background mean/std
SIGMA_MULT = 3                          # "three times the error bar above background"


def add_historic_phases(df, proton_col="proton"):
    """
    df: DataFrame with a proton column (ln flux). Adds background/rising/falling
    (one-hot int columns, matching Data/data.csv's own schema) and returns a copy.
    Uses the WHOLE column, both directions -- only valid for already-fetched,
    fully-known historic data, never for a live/streaming point.
    """
    proton = df[proton_col].to_numpy()
    n = len(proton)
    phase = np.zeros(n, dtype=int)  # 0=background, 1=rising, 2=falling

    i = 0
    while i < n:
        if proton[i] < LN10:
            i += 1
            continue

        # --- threshold crossing at i: this is a candidate event ---
        bg_start = max(0, i - BACKGROUND_WINDOW)
        bg_window = proton[bg_start:i]
        if len(bg_window) >= 4:
            bg_mean, bg_std = float(bg_window.mean()), float(bg_window.std())
        else:
            bg_mean, bg_std = 0.0, 0.0
        onset_level = bg_mean + SIGMA_MULT * bg_std

        # scan backward from the threshold crossing for the onset: the earliest
        # contiguous point already above the pre-event background + 3 sigma level.
        onset_idx = i
        j = i - 1
        while j >= bg_start and proton[j] > onset_level:
            onset_idx = j
            j -= 1

        # scan forward for the peak (running max) and the end (decay to threshold/5).
        peak_idx = i
        peak_val = proton[i]
        k = i
        while k < n:
            if proton[k] > peak_val:
                peak_val = proton[k]
                peak_idx = k
            if proton[k] <= END_THRESH and k > peak_idx:
                break
            k += 1
        end_idx = min(k, n - 1)

        phase[onset_idx:peak_idx] = 1       # rising: [onset, peak)
        phase[peak_idx:end_idx + 1] = 2     # falling: [peak, end]

        i = end_idx + 1  # resume scanning after this event; everything before was background

    out = df.copy()
    out["background"] = (phase == 0).astype(int)
    out["rising"] = (phase == 1).astype(int)
    out["falling"] = (phase == 2).astype(int)
    return out
