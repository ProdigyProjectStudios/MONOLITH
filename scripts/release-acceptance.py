#!/usr/bin/env python3
"""Run portable and Docker-backed application gates. Deployment drills have their own isolated-stack runner."""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
from datetime import UTC,datetime
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BROWSER=("studio-browser","studio-focus","studio-instruments","connected-records","observatory","continuous-intelligence","api-connected-stack","workspace-accessibility","living-field")
UNIT=("field-projection","runtime","graph-history","observatory-metrics","studio-receipts","guided-demo","live-archive-reader")
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",required=True,type=Path)
    parser.add_argument("--existing-build",action="store_true",help="Verify an already-built candidate")
    parser.add_argument("--require-production",action="store_true")
    args=parser.parse_args()
    steps=[("Backend and controlled providers",[str(ROOT/"apps/api/.venv/bin/python"),"-m","pytest","-q","apps/api/tests","--basetemp",str(Path(tempfile.mkdtemp())/"pytest")])]
    if not args.existing_build:
        steps.append(("Production export",["npm","run","build"]))
    steps.append(("TypeScript",["npm","run","typecheck"]))
    steps.extend((test,["node","scripts/test-"+test+".mjs"]) for test in (*UNIT,*BROWSER))
    env={k:v for k,v in os.environ.items() if not k.startswith(("OPENAI_","HUBSPOT_","TENANT_")) and k not in ("DATABASE_URL","REDIS_URL","MONOLITH_ENV","NEXT_PUBLIC_API_URL")}
    env["MONOLITH_MODEL_CALLS_ENABLED"]="0"
    report={"executed_at":datetime.now(UTC).isoformat(),"candidate":subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip(),"working_tree_changed":bool(subprocess.check_output(["git","status","--porcelain"],cwd=ROOT)),"gates":[]}
    def save():
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps(report,indent=2)+"\n")
    for name,cmd in steps:
        start=time.monotonic()
        try:
            test=subprocess.run(cmd,cwd=ROOT,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=300)
            result="PASSED" if test.returncode==0 else "FAILED"
            lines=[s for s in test.stdout.splitlines() if s.strip()]
            note=next((s.strip() for s in reversed(lines) if "passed" in s.lower() or "verified" in s.lower()),lines[-1] if lines else "Command completed.")
            if test.returncode: print(test.stdout[-4000:],file=sys.stderr)
        except subprocess.TimeoutExpired:
            result,note="FAILED","Exceeded the 300-second test deadline."
        report["gates"].append({"gate":name,"status":result,"seconds":round(time.monotonic()-start,2),"evidence":note[:400]})
        print(name,result,flush=True);save()
    for name,reason in [("Public HTTPS production backend","Persistent host and DNS deferred by the owner."),("Live HubSpot OAuth/synchronisation","Sandbox consent deferred by the owner."),("Official OpenAI six-agent run","Paid calls disabled by the owner.")]:
        report["gates"].append({"gate":name,"status":"BLOCKED","evidence":reason})
    save()
    return int(any(g["status"]=="FAILED" or args.require_production and g["status"]=="BLOCKED" for g in report["gates"]))
if __name__=="__main__":
    sys.exit(main())
