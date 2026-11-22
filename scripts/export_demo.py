import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "apps/api"))
from monolith.seed import make_seed
from monolith.core import analyse
from monolith.mining import mine

data = make_seed()
report = mine(data, analyse(data, 30))
(root / "apps/web/public/demo.json").write_text(
    json.dumps({"data": data, "report": report}, separators=(",", ":"))
)
print(
    {k: report[k] for k in ["events", "cases", "variants", "cycle", "mining", "auto"]}
)
