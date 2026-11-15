"""
Auto-fetches Aditya-L1/ASPEX-STEPS Level-2 CDF files from ISRO's PRADAN portal,
closing the gap every other doc in this project flags as "requires a manual,
login-gated download" -- it doesn't, as long as you have your own PRADAN account.

How this works (reverse-engineered from the live portal, see conversation):
  1. PRADAN's login is a standard Keycloak OAuth2/OIDC flow (idp.issdc.gov.in) --
     no CAPTCHA, no OTP. A plain requests.Session() GET of the protected page,
     then POST of username/password to the Keycloak login form's action URL,
     completes the flow and leaves the session authenticated against
     pradan.issdc.gov.in.
  2. Despite the file browser itself being a heavy PrimeFaces/JSF app (ViewState
     tokens, AJAX partial postbacks) that resisted a direct filter-form submission,
     the actual file DOWNLOAD URLs are fully deterministic once you know the
     convention (confirmed by inspecting the default browse listing's rendered
     links), so the JSF filter UI can be skipped entirely:
       /al1/protected/downloadData/aspex/steps/level2/{YYYY}/{MM}/N00_0000/
           AL1_AST91_L2_{DIR}_{YYYYMMDD}_V01.cdf?steps
     where DIR is one of PS/EP/IM/NP (Parker Spiral/Ecliptic Pole/Inner Magnetosphere/
     North Pole -- see aditya_l1/build_aditya_data.py's own docstring).

Credentials: read ONLY from PRADAN_USERNAME / PRADAN_PASSWORD environment
variables -- never hardcode them, never pass as CLI args (shell history/process
list exposure).

Usage:
  PRADAN_USERNAME=... PRADAN_PASSWORD=... python fetch_aditya_pradan.py \\
      --start 2024/05/11 --end 2024/05/16 --out raw/
  optional: --dirs PS,EP   (default: all four, PS,EP,IM,NP)
"""
import argparse
import os
import re
import sys
import datetime as dt
import requests

PROTECTED_URL = "https://pradan.issdc.gov.in/al1/protected/payload.xhtml"
BASE = "https://pradan.issdc.gov.in/al1/protected/downloadData/aspex/steps/level2"
ALL_DIRS = ["PS", "EP", "IM", "NP"]


def login(session, username, password):
    r = session.get(PROTECTED_URL)
    m = re.search(r'<form id="kc-form-login"[^>]*action="([^"]+)"', r.text)
    if not m:
        raise RuntimeError("Could not find the Keycloak login form -- PRADAN's page "
                            "structure may have changed since this script was written.")
    action_url = m.group(1).replace("&amp;", "&")
    r2 = session.post(action_url, data={"username": username, "password": password})
    if not r2.url.startswith("https://pradan.issdc.gov.in"):
        raise RuntimeError("PRADAN login failed -- check PRADAN_USERNAME/PRADAN_PASSWORD.")
    return session


def daterange(start, end):
    d = start
    while d <= end:
        yield d
        d += dt.timedelta(days=1)


def fetch_day(session, date, direction, out_dir, version=1):
    fname = f"AL1_AST91_L2_{direction}_{date:%Y%m%d}_V{version:02d}.cdf"
    out_path = os.path.join(out_dir, fname)
    if os.path.exists(out_path):
        return "cached"

    url = f"{BASE}/{date:%Y}/{date:%m}/N00_0000/{fname}?steps"
    r = session.get(url)
    if r.status_code != 200 or "cdf" not in r.headers.get("Content-Type", "").lower():
        return "missing"

    os.makedirs(out_dir, exist_ok=True)
    with open(out_path, "wb") as f:
        f.write(r.content)
    return "downloaded"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True, help="YYYY/MM/DD")
    ap.add_argument("--end", required=True, help="YYYY/MM/DD")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "raw"))
    ap.add_argument("--dirs", default=",".join(ALL_DIRS))
    args = ap.parse_args()

    username = os.environ.get("PRADAN_USERNAME")
    password = os.environ.get("PRADAN_PASSWORD")
    if not username or not password:
        print("Set PRADAN_USERNAME and PRADAN_PASSWORD environment variables first.")
        sys.exit(1)

    start = dt.datetime.strptime(args.start, "%Y/%m/%d").date()
    end = dt.datetime.strptime(args.end, "%Y/%m/%d").date()
    dirs = args.dirs.split(",")

    session = requests.Session()
    login(session, username, password)
    print("PRADAN login ok")

    counts = {"downloaded": 0, "cached": 0, "missing": 0}
    for date in daterange(start, end):
        for direction in dirs:
            result = fetch_day(session, date, direction, args.out)
            counts[result] += 1
            print(f"{date:%Y-%m-%d} {direction}: {result}")

    print(f"\n{counts['downloaded']} downloaded, {counts['cached']} already present, "
          f"{counts['missing']} missing/unavailable, into {args.out}")


if __name__ == "__main__":
    main()
