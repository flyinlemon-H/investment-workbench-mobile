from __future__ import annotations

from bridge import BridgeConfig, create_server, load_local_env, provider_from_env


def main() -> None:
    load_local_env()
    config = BridgeConfig.from_env()
    provider = provider_from_env()
    server = create_server(config, provider)
    capability = "available" if provider.available else "provider key unavailable"
    print(f"PC AI Bridge listening on http://{config.host}:{config.port} ({capability})")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
