"""
Shared helper for running an m3_ml-style model (phase_selection_model.keras +
background/rising/falling_model.keras in a run directory) on arbitrary window arrays,
mirroring the routing logic in ElectronInput/m3_ml.py's predict_intensity().
"""
import os
import numpy as np
from keras.models import load_model


def load_m3ml_models(run_dir):
    return (
        load_model(os.path.join(run_dir, "phase_selection_model.keras")),
        load_model(os.path.join(run_dir, "background_model.keras")),
        load_model(os.path.join(run_dir, "rising_model.keras")),
        load_model(os.path.join(run_dir, "falling_model.keras")),
    )


def predict_m3ml(models, x, verbose=0):
    """x: array of shape (n, steps, features). Returns (predictions, predicted_phase_idx)."""
    phase_sel, bg, rising, falling = models
    phases = phase_sel.predict(x, verbose=verbose).argmax(axis=1)   # 0=background,1=rising,2=falling
    preds = np.zeros(len(x))
    for cls, m in ((0, bg), (2, falling), (1, rising)):
        idx = np.where(phases == cls)[0]
        if len(idx):
            preds[idx] = m.predict(x[idx], verbose=verbose).flatten()
    return preds, phases
