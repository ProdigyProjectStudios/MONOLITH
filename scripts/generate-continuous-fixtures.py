"""Rebuild the two opt-in synthetic Northstar CSV downloads. Never edits the seed."""

import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "apps/api"))
from monolith.continuous_fixture import WAVES, fixture_csv

for wave, (_, filename) in WAVES.items():
    target = root / "apps/web/public" / filename
    target.write_bytes(fixture_csv(wave).encode("utf-8"))
    print(f"{wave}: {target}")
