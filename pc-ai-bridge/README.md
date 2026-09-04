# PC AI Bridge

Status: **CURRENT**

This local-only component carries raw prompts to DeepSeek and returns raw model content. Long-Term Logic parsing, validation, binding, history, and persistence remain in the browser application.

## Normal operation

On the accepted production PC, Windows Task Scheduler starts the hidden Bridge at user logon. The task reads the existing `DEEPSEEK_API_KEY` configuration and starts `pc-ai-bridge\run_bridge.py`; the browser does not receive the key.

Check `http://127.0.0.1:18765/health` when troubleshooting. A healthy response reports the local service and whether AI requests are available. The Bridge permits the production origin `https://flyinlemon-h.github.io` by default and listens only on `127.0.0.1:18765`.

## Recovery / manual start

If the scheduled launcher is unavailable, first confirm `DEEPSEEK_API_KEY` is set as a Windows user environment variable, or copy `.env.example` to ignored `.env`. Then run from the repository root:

```powershell
python pc-ai-bridge\run_bridge.py
```

This command is a recovery and diagnostic path, not the normal per-session startup procedure. The repository currently documents the accepted scheduled task but does not install or modify it automatically.

For deterministic non-paid acceptance testing only, set `PC_AI_BRIDGE_MODE=mock` before starting it. The browser cannot select the provider or model.

The Bridge does not store prompts or responses, does not expose a shell or URL proxy, and never returns the provider key to the browser.
