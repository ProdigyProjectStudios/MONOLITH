#!/usr/bin/env python3
"""Test a loopback HTTPS gateway against an existing staging Compose network and Caddy's private CA."""
import argparse
import http.client
import json
import ssl
import subprocess
import tempfile
import time
from pathlib import Path
from uuid import uuid4

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--network",required=True)
    ap.add_argument("--gateway-image",required=True)
    ap.add_argument("--output",type=Path,required=True)
    args=ap.parse_args()
    container="monolith-tls-qa-"+uuid4().hex[:10]
    with tempfile.TemporaryDirectory() as tmp:
        try:
            subprocess.run(["docker","run","-d","--name",container,"--network",args.network,
                            "-e","MONOLITH_API_HOST=localhost","-e","NO_PROXY=api,localhost,127.0.0.1","-p","127.0.0.1::443",args.gateway_image],check=True,stdout=subprocess.DEVNULL)
            port=int(subprocess.check_output(["docker","port",container,"443/tcp"],text=True).strip().rsplit(":",1)[1])
            pem=Path(tmp)/"issuer.crt"
            for _ in range(50):
                cp=subprocess.run(["docker","cp",container+":/data/caddy/pki/authorities/local/root.crt",str(pem)],capture_output=True)
                if cp.returncode==0:break
                time.sleep(.3)
            context=ssl.create_default_context(cafile=str(pem))
            for attempt in range(20):
                conn=http.client.HTTPSConnection("localhost",port,context=context,timeout=4)
                try:
                    conn.connect()
                    break
                except ssl.SSLCertVerificationError:
                    raise
                except (ConnectionError, ssl.SSLError, TimeoutError):
                    conn.close()
                    if attempt==19:
                        raise
                    time.sleep(.4)
            protocol=conn.sock.version()
            cert=conn.sock.getpeercert()
            conn.request("GET","/api/health/ready");response=conn.getresponse()
            assert response.status==200 and json.loads(response.read())=={"status":"ready"}
            conn.request("GET","/");page=conn.getresponse()
            assert page.status==200 and b'data-runtime="production"' in page.read()
            conn.close()
            result={"status":"PASSED","protocol":protocol,"certificate_name":cert["subjectAltName"],"public_dns":False,
                    "verification":"Verified Caddy-issued certificate and localhost hostname against the local root, then requested backend readiness and the production entry document."}
            args.output.write_text(json.dumps(result,indent=2)+"\n")
            print(result["verification"])
        finally:
            subprocess.run(["docker","rm","-fv",container],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
if __name__=="__main__":main()
