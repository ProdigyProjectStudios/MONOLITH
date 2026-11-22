"""Exercise status transitions with a loopback telemetry service and webhook receiver."""
import importlib.util
import json
import tempfile
import threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib import request

spec=importlib.util.spec_from_file_location("health_watch",Path(__file__).resolve().parents[1]/"deploy/health_watch.py")
watch=importlib.util.module_from_spec(spec);spec.loader.exec_module(watch)
class Service(BaseHTTPRequestHandler):
    ready=True
    delivered=[]
    def do_GET(self):
        if self.path.endswith("/ready"):
            data={"status":"ready" if Service.ready else "unavailable"}
        else:
            assert self.headers["Authorization"]=="Bearer local-only"
            data={"worker":{"status":"online"},"queue":{"pending":0},"http_process":{"process_started_at_unix":10,"requests":40,"server_errors":0}}
        self.send_response(200);self.end_headers();self.wfile.write(json.dumps(data).encode())
    def do_POST(self):
        assert self.headers.get("Authorization") is None
        Service.delivered.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
        self.send_response(204);self.end_headers()
    def log_message(self,*args):pass
server=ThreadingHTTPServer(("127.0.0.1",0),Service)
thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
origin=f"http://127.0.0.1:{server.server_port}"
try:
    with tempfile.TemporaryDirectory() as d:
        state=Path(d)/"status.json"
        for ready,code in [(True,0),(False,2),(False,2),(True,0)]:
            Service.ready=ready
            assert watch.cycle(origin,"local-only",origin+"/alerts",state)==code
        assert [e["status"] for e in Service.delivered]==["alert","healthy"]
        print("Loopback webhook passed: incident, duplicate suppression, recovery and credential isolation.")
finally:
    server.shutdown();thread.join();server.server_close()
