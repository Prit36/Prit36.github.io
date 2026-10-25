"""Rebuild data.js and the profile timeline images from GitHub.

Needs the GitHub CLI (gh), signed in. Run from this folder:

    python update_data.py

Each key in PROJECTS matches a data-project attribute in index.html.
To add a project, add it here and add a row to the list in index.html.
"""

import calendar
import datetime as dt
import json
import subprocess
from collections import Counter
from pathlib import Path

USER = "Prit36"
YEAR = dt.date.today().year
TZ = dt.timezone(dt.timedelta(hours=5, minutes=30))  # IST

# key -> (endpoints, mine_only)
# mine_only filters by GitHub login. Your own repos skip it, because some of
# their commits were made under a git name that is not linked to the account.
PROJECTS = {
    "fuelmate": (["repos/Prit36/fuelmate/commits"], False),
    "markdown-pdf": (["repos/Prit36/markdown-pdf-studio/commits"], False),
    "pm2": (["repos/VishalJTalaviya/pm2-log-analyzer/commits",
             "repos/Prit36/pm2-log-analyzer/commits"], True),
    "pdf-compressor": (["repos/Prit36/pdf-compressor-wasm/commits"], False),
    "pm2-native": (["repos/Prit36/pm2-log-analyzer-rust/commits",
                    "repos/Prit36/pm2-log-analyzer-cpp/commits"], False),
    "jpegview": (["repos/Prit36/jpegview/commits"], True),
    "glyph": (["repos/Prit36/Glyph/commits"], False),
    "sonograph": (["repos/Prit36/Sonograph/commits"], False),
    "bounce": (["repos/Prit36/Bounce/commits"], False),
    "whistle": (["repos/Prit36/whistle-desktop/commits"], False),
    "quarry": (["repos/Prit36/quarry-disk-analyzer/commits"], False),
    "nanoui": (["repos/justrach/nanoui/pulls/22/commits"], True),
}


def fetch(endpoint):
    sep = "&" if "?" in endpoint else "?"
    url = f"{endpoint}{sep}per_page=100"
    if "/pulls/" not in endpoint:
        url += f"&since={YEAR}-01-01T00:00:00Z"
    out = subprocess.run(["gh", "api", "--paginate", "--slurp", url],
                         capture_output=True, text=True, encoding="utf-8", check=True)
    return [c for page in json.loads(out.stdout) for c in page]


def local_time(commit):
    stamp = commit["commit"]["author"]["date"].replace("Z", "+00:00")
    return dt.datetime.fromisoformat(stamp).astimezone(TZ)


# Timeline image for the GitHub profile README, one per GitHub theme.
THEMES = {
    "light": {"ink": "#1f2328", "muted": "#8c959f", "rule": "#d8dee4", "accent": "#2b3fe0"},
    "dark": {"ink": "#e6edf3", "muted": "#6e7681", "rule": "#30363d", "accent": "#8f9cff"},
}
MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def timeline_svg(data, colors):
    start = dt.date.fromisoformat(data["from"])
    end = dt.date.fromisoformat(data["to"])
    today = dt.date.fromisoformat(data["updated"])
    days = [start + dt.timedelta(i) for i in range((end - start).days + 1)]
    totals = Counter()
    for counts in data["projects"].values():
        totals.update(counts)
    peak = max(totals.values())

    width, top, half = 880, 6, 30
    mid = top + half
    slot = width / len(days)
    bar = max(1, round(slot * 0.6))
    mono = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace"
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="100" '
        f'viewBox="0 0 {width} 100" font-family="{mono}" font-size="12">',
    ]
    for i, day in enumerate(days):
        x = i * slot
        if day.day == 1:
            parts.append(f'<rect x="{x:.1f}" y="{top}" width="1" height="{half * 2 + 6}" fill="{colors["rule"]}"/>')
            parts.append(f'<text x="{x + 5:.1f}" y="90" fill="{colors["muted"]}">{MONTHS[day.month - 1]}</text>')
        if day > today:
            continue
        c = totals.get(day.isoformat(), 0)
        h = max(2, c / peak * half * 2) if c else 1.5
        fill = colors["ink"] if c else colors["rule"]
        bx = x + (slot - bar) / 2
        parts.append(f'<rect x="{bx:.1f}" y="{mid - h / 2:.1f}" width="{bar}" height="{h:.1f}" rx="1" fill="{fill}"/>')
    nx = (today - start).days * slot + slot / 2
    parts.append(f'<rect x="{nx:.1f}" y="{top}" width="1" height="{half * 2 + 6}" fill="{colors["accent"]}"/>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def main():
    projects = {}
    times = []
    for key, (endpoints, mine_only) in PROJECTS.items():
        commits = {}
        for endpoint in endpoints:
            for c in fetch(endpoint):
                if mine_only and (c.get("author") or {}).get("login") != USER:
                    continue
                commits[c["sha"]] = local_time(c)
        stamps = [t for t in commits.values() if t.year == YEAR]
        times += stamps
        days = Counter(t.date().isoformat() for t in stamps)
        projects[key] = dict(sorted(days.items()))
        print(f"{key:15} {len(stamps):4} commits")

    today = dt.datetime.now(TZ).date()
    first = min(times).date()
    last_day = calendar.monthrange(today.year, today.month)[1]

    data = {
        "updated": today.isoformat(),
        "from": first.replace(day=1).isoformat(),
        "to": today.replace(day=last_day).isoformat(),
        "first": first.isoformat(),
        "projects": projects,
    }
    body = json.dumps(data, indent=2)
    Path(__file__).with_name("data.js").write_text(
        f"// Generated by update_data.py on {today}. Edit that file, not this one.\n"
        f"window.ACTIVITY = {body};\n",
        encoding="utf-8",
    )
    for theme, colors in THEMES.items():
        Path(__file__).with_name(f"timeline-{theme}.svg").write_text(
            timeline_svg(data, colors), encoding="utf-8")
    print(f"{len(times)} commits, written to data.js and timeline-*.svg")


if __name__ == "__main__":
    main()
