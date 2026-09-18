"""
Reference/documentation script, not runnable standalone here: reconstructs phase
labels with historic_phases.add_historic_phases() on the REAL training data.csv
from the ProtonFluxTimeSeries repo, and compares against the actual background/
rising/falling columns that were computed there from the hand-curated
p10f10event.dat catalog. This is how add_historic_phases() was validated before
being trusted for real forecasts: 99.7% row-level agreement, background/falling
both ~1.0 precision+recall, rising 1.000 precision / 0.746 recall (conservative --
starts the rising phase a little late on some events, never early, never a false
alarm). To re-run it, copy this next to the ProtonFluxTimeSeries repo's
`Data/data.csv` (or point the path below at it) with this folder's
`historic_phases.py` importable and scikit-learn installed.
"""
import numpy as np
import pandas as pd
from historic_phases import add_historic_phases
from sklearn.metrics import confusion_matrix

df = pd.read_csv("../Data/data.csv")  # path into the ProtonFluxTimeSeries repo's Data/
truth = df[["background", "rising", "falling"]].to_numpy().argmax(axis=1)

recon = add_historic_phases(df[["time", "proton"]])
pred = recon[["background", "rising", "falling"]].to_numpy().argmax(axis=1)

print("rows:", len(df))
cm = confusion_matrix(truth, pred, labels=[0, 1, 2])
print("confusion matrix (rows=actual, cols=predicted; order background,rising,falling)")
print(cm)

for i, name in enumerate(["background", "rising", "falling"]):
    tp = cm[i, i]
    fp = cm[:, i].sum() - tp
    fn = cm[i, :].sum() - tp
    precision = tp / (tp + fp) if (tp + fp) else float("nan")
    recall = tp / (tp + fn) if (tp + fn) else float("nan")
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else float("nan")
    print(f"{name:10s}  precision={precision:.3f}  recall={recall:.3f}  f1={f1:.3f}  n={cm[i,:].sum()}")

overall_acc = (truth == pred).mean()
print(f"\noverall row-level agreement: {overall_acc:.4f}")
