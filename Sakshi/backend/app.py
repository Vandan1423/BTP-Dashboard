"""
Local webapp: pick a date/time range + one or more no-phase models, see each model's
MAE on that range, and a forecast plot -- so you can decide which model performs best
for a given period.

Run:
  .venv/bin/python analysis/webapp/app.py
Then open http://127.0.0.1:5050
"""
import datetime as dt
import os
import uuid
from flask import Flask, jsonify, render_template, request

from data_fetch import build_dataset, classify_range, UnsupportedRangeError
from model_eval import evaluate_model, evaluate_series, MODEL_CONFIGS, FAMILIES

app = Flask(__name__)
PLOTS_DIR = os.path.join(os.path.dirname(__file__), "static", "plots")
os.makedirs(PLOTS_DIR, exist_ok=True)


@app.after_request
def add_cors_headers(resp):
    # The dashboard (Vite dev server, a different origin) calls /api/forecast
    # from the browser. This is a local-only tool, so a wide-open CORS policy
    # is fine -- there is nothing here to protect against a random origin.
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


@app.route("/", methods=["GET"])
def index():
    now = dt.datetime.utcnow()
    return render_template("index.html", models=MODEL_CONFIGS, now=now,
                            live_floor=now - dt.timedelta(days=7))


@app.route("/run", methods=["POST"])
def run():
    start_str = request.form["start"]
    end_str = request.form["end"]
    selected = request.form.getlist("models")

    try:
        start = dt.datetime.fromisoformat(start_str)
        end = dt.datetime.fromisoformat(end_str)
    except ValueError:
        return render_template("results.html", error="Could not parse the date/time fields.")

    if end <= start:
        return render_template("results.html", error="End must be after start.")
    if not selected:
        return render_template("results.html", error="Pick at least one model.")

    try:
        classify_range(start, end)
    except UnsupportedRangeError as e:
        return render_template("results.html", error=str(e))

    try:
        df, source_kind = build_dataset(start, end)
    except UnsupportedRangeError as e:
        return render_template("results.html", error=str(e))
    except Exception as e:
        return render_template("results.html", error=f"Data fetch failed: {e}")

    results = []
    for name in selected:
        if MODEL_CONFIGS[name]["use_phase"] and source_kind != "historic":
            results.append({
                "label": MODEL_CONFIGS[name]["label"],
                "error": "needs phase inputs, only computable for historic ranges "
                         "(ending on/before 2020-12-31) -- not for a live range.",
            })
            continue
        plot_name = f"{uuid.uuid4().hex}.png"
        out_png = os.path.join(PLOTS_DIR, plot_name)
        try:
            metrics = evaluate_model(name, df, start, end, out_png)
            metrics["plot_url"] = f"static/plots/{plot_name}"
            metrics["error"] = None
        except Exception as e:
            metrics = {"label": MODEL_CONFIGS[name]["label"], "error": str(e)}
        results.append(metrics)

    # rank successful results by overall MAE, lowest first
    ok = [r for r in results if not r.get("error")]
    ok.sort(key=lambda r: r["mae"])
    best = ok[0]["label"] if ok else None

    return render_template("results.html", results=results, best=best,
                            start=start, end=end, source_kind=source_kind, n_rows=len(df))


@app.route("/api/models", methods=["GET"])
def api_models():
    # Flat list (back-compat for anything reading {id, label}) plus a `families`
    # grouping so the dashboard can build a two-step "family, then phase" picker
    # without hardcoding which ids pair up with which.
    flat = [{"id": k, "label": v["label"], "family": v["family"],
             "use_phase": v["use_phase"]} for k, v in MODEL_CONFIGS.items()]
    families = []
    for fam in FAMILIES:
        variants = {k: v for k, v in MODEL_CONFIGS.items() if v["family"] == fam["id"]}
        if fam["has_phase_variant"]:
            noph = next(k for k, v in variants.items() if not v["use_phase"])
            ph = next(k for k, v in variants.items() if v["use_phase"])
            families.append({**fam, "no_phase_id": noph, "phase_id": ph})
        else:
            (only_id,) = variants.keys()
            families.append({**fam, "model_id": only_id})
    return jsonify({"models": flat, "families": families})


@app.route("/api/forecast", methods=["POST", "OPTIONS"])
def api_forecast():
    if request.method == "OPTIONS":
        return "", 204

    payload = request.get_json(silent=True) or {}
    model_name = payload.get("model")
    start_str = payload.get("start")
    end_str = payload.get("end")

    if model_name not in MODEL_CONFIGS:
        return jsonify({"error": f"Unknown model '{model_name}'."}), 400
    try:
        start = dt.datetime.fromisoformat(start_str)
        end = dt.datetime.fromisoformat(end_str)
    except (TypeError, ValueError):
        return jsonify({"error": "Could not parse start/end (expected ISO 8601)."}), 400
    if end <= start:
        return jsonify({"error": "End must be after start."}), 400

    try:
        classify_range(start, end)
        df, source_kind = build_dataset(start, end)
        # Phase models (m1, m3_ml) need background/rising/falling as an input
        # feature. Those labels are retrospective -- a row is only "rising" because
        # a future peak is already known -- which historic_phases.py can compute
        # honestly for a `historic` range (the whole thing, "future" included, is
        # already fetched), but is fundamentally impossible for `live` data, where
        # the actual future hasn't happened yet. No heuristic substitute is used
        # here on purpose: estimate_phase.py's causal guess was tested earlier and
        # found unreliable (helped one real event, hurt another).
        if MODEL_CONFIGS[model_name]["use_phase"] and source_kind != "historic":
            return jsonify({
                "error": f"{MODEL_CONFIGS[model_name]['label']} needs phase (background/"
                         f"rising/falling) as a model input, which can only be computed "
                         f"honestly for historic data (ending on/before 2020-12-31) -- "
                         f"not for a live range, where the actual future hasn't happened "
                         f"yet. Pick a no-phase model for live ranges, or a historic range "
                         f"for this model."
            }), 400
        result = evaluate_series(model_name, df, start, end)
    except UnsupportedRangeError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

    result["source_kind"] = source_kind
    result["start"] = start.isoformat()
    result["end"] = end.isoformat()
    return jsonify(result)


if __name__ == "__main__":
    app.run(debug=True, port=5050)
