# PC AI Bridge

This local-only component carries raw prompts to DeepSeek and returns raw model content. Long-Term Logic parsing, validation, binding, history, and persistence remain in the browser application.

## Local setup

1. Prefer setting `DEEPSEEK_API_KEY` as a Windows user environment variable. Alternatively copy `.env.example` to `.env` and fill the key; `.env` is ignored by Git.
2. Run from the repository root:

   ```powershell
   python pc-ai-bridge\run_bridge.py
   ```

3. The Bridge listens only on `127.0.0.1:18765` and permits the production origin `https://flyinlemon-h.github.io` by default.

For deterministic non-paid acceptance testing only, set `PC_AI_BRIDGE_MODE=mock` before starting it. The browser cannot select the provider or model.

The Bridge does not store prompts or responses, does not expose a shell or URL proxy, and never returns the provider key to the browser.
