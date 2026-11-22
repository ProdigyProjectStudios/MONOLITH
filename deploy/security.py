#!/usr/bin/env python3
"""Audit locked dependencies and deployed images. Requires npm, uv and Trivy 0.76.2."""

import argparse
from datetime import UTC, datetime
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def run(command, **kwargs):
    return subprocess.run(command, cwd=ROOT, check=True, **kwargs)


def scan(args):
    dst = args.out.resolve()
    dst.mkdir(parents=True, exist_ok=True)
    with (dst / "npm.json").open("w") as report:
        npm_rc = subprocess.run(
            ["npm", "audit", "--audit-level=high", "--json"], cwd=ROOT, stdout=report
        ).returncode
    npm = json.loads((dst / "npm.json").read_text())["metadata"]
    with tempfile.TemporaryDirectory() as tmp:
        requirements = Path(tmp) / "runtime.txt"
        run(
            [
                "uv",
                "export",
                "--project",
                "apps/api",
                "--frozen",
                "--no-dev",
                "--no-hashes",
                "--no-annotate",
                "--format",
                "requirements-txt",
                "--output-file",
                str(requirements),
            ],
            stdout=subprocess.DEVNULL,
        )
        pip_rc = subprocess.run(
            [
                "uv",
                "tool",
                "run",
                "--from",
                "pip-audit==2.10.1",
                "pip-audit",
                "--disable-pip",
                "--no-deps",
                "--format",
                "json",
                "--output",
                str(dst / "python.json"),
                "-r",
                str(requirements),
            ],
            cwd=ROOT,
        ).returncode
    deps = json.loads((dst / "python.json").read_text())["dependencies"]
    checks = {
        "npm": {
            "packages": npm["dependencies"]["total"],
            "advisories": npm["vulnerabilities"],
        },
        "python": {
            "packages": len(deps),
            "advisories": sum(len(p.get("vulns", [])) for p in deps),
            "skipped": sum("skip_reason" in p for p in deps),
        },
    }
    version = subprocess.check_output([args.trivy, "--version"], text=True)
    if "Version: 0.76.2\n" not in version:
        raise SystemExit("Use the pinned Trivy 0.76.2 distribution")
    for role, image in (
        ("app", args.app),
        ("gateway", args.gateway),
        ("db", args.database),
        ("redis", args.redis),
    ):
        report = dst / (role + ".json")
        run(
            [
                args.trivy,
                "image",
                "--image-src",
                "docker",
                "--parallel",
                "1",
                "--cache-backend",
                "memory",
                "--scanners",
                "vuln",
                "--severity",
                "HIGH,CRITICAL",
                "--no-progress",
                "--format",
                "json",
                "--output",
                str(report),
                image,
            ]
        )
        data = json.loads(report.read_text())
        vulns = [v for r in data["Results"] for v in r.get("Vulnerabilities", [])]
        fixed = [
            {
                "id": v["VulnerabilityID"],
                "package": v["PkgName"],
                "fixed": v["FixedVersion"],
            }
            for v in vulns
            if v.get("FixedVersion")
        ]
        checks[role] = {
            "image_id": data["Metadata"]["ImageID"],
            "high_or_critical": len(vulns),
            "fixable": fixed,
        }
    passed = not (
        npm_rc
        or pip_rc
        or checks["python"]["skipped"]
        or any(v.get("fixable") for v in checks.values())
    )
    result = {
        "status": "passed" if passed else "blocked",
        "utc": datetime.now(UTC).isoformat(),
        "gate": "npm high/critical; any Python advisory or skipped dependency; fixable image HIGH/CRITICAL",
        "trivy": "0.76.2",
        "checks": checks,
    }
    (dst / "summary.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__)
    for name in ("app", "gateway", "database", "redis"):
        p.add_argument("--" + name, required=True)
    p.add_argument("--trivy", default="trivy")
    p.add_argument("--out", type=Path, required=True)
    raise SystemExit(scan(p.parse_args()))
