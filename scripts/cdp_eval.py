#!/usr/bin/env python3
"""Evaluate JS in the running Hermes (Dev) renderer over CDP. Usage: cdp_eval.py '<js expression>' [--await]"""
import json, sys, urllib.request
from websocket import create_connection  # websocket-client

expr = sys.argv[1]
awaitp = "--await" in sys.argv
tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9333/json"))
page = next(t for t in tabs if t["type"] == "page")
ws = create_connection(page["webSocketDebuggerUrl"], timeout=30, suppress_origin=True)
ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": expr, "awaitPromise": awaitp, "returnByValue": True}}))
while True:
    msg = json.loads(ws.recv())
    if msg.get("id") == 1:
        r = msg.get("result", {})
        if "exceptionDetails" in r:
            print("EXC:", json.dumps(r["exceptionDetails"].get("exception", {}).get("description", r["exceptionDetails"]))[:1500])
        else:
            v = r.get("result", {}).get("value")
            print(json.dumps(v, indent=1, ensure_ascii=False)[:6000] if not isinstance(v, str) else v[:6000])
        break
ws.close()
