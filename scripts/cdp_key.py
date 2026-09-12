#!/usr/bin/env python3
"""Send a real key press to the Hermes (Dev) renderer via CDP Input.dispatchKeyEvent. Usage: cdp_key.py Tab|Enter|Escape|Backspace [text-to-insert-first]"""
import json, sys, urllib.request, time
from websocket import create_connection

KEYS = {"Tab": (9, "Tab"), "Enter": (13, "Enter"), "Escape": (27, "Escape"), "Backspace": (8, "Backspace")}
key = sys.argv[1]
tabs = json.load(urllib.request.urlopen("http://127.0.0.1:9333/json"))
page = next(t for t in tabs if t["type"] == "page")
ws = create_connection(page["webSocketDebuggerUrl"], timeout=30, suppress_origin=True)
mid = 0
def send(method, params):
    global mid; mid += 1
    ws.send(json.dumps({"id": mid, "method": method, "params": params}))
    while True:
        m = json.loads(ws.recv())
        if m.get("id") == mid: return m
if len(sys.argv) > 2:
    send("Input.insertText", {"text": sys.argv[2]})
code, keyname = KEYS[key]
base = {"key": keyname, "code": keyname, "windowsVirtualKeyCode": code, "nativeVirtualKeyCode": code}
send("Input.dispatchKeyEvent", {"type": "keyDown", **base})
send("Input.dispatchKeyEvent", {"type": "keyUp", **base})
print("sent", key)
ws.close()
