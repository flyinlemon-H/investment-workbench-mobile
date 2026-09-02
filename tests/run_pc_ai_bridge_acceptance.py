"""Non-paid Bridge runner with metadata-only logs for browser acceptance."""
import argparse
from pathlib import Path
import sys
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pc-ai-bridge"))
from bridge import BridgeConfig, DeterministicMockProvider, ProviderResult, create_server


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--invalid", action="store_true")
    args = parser.parse_args()

    class AcceptanceProvider(DeterministicMockProvider):
        def complete(self, prompt):
            if args.invalid:
                return ProviderResult(self.name, self.model, '{"bad":true}')
            return super().complete(prompt)

    server = create_server(BridgeConfig(allowed_origins=frozenset({
        "https://flyinlemon-h.github.io", "http://127.0.0.1:8768",
    })), AcceptanceProvider())

    class MetadataHandler(server.RequestHandlerClass):
        def send_response(self, code, message=None):
            print(f"{self.command} {urlsplit(self.path).path} {code} origin={self.headers.get('Origin', '')}", flush=True)
            super().send_response(code, message)

    server.RequestHandlerClass = MetadataHandler
    print(f"Acceptance mock: 127.0.0.1:18765; invalid={args.invalid}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
