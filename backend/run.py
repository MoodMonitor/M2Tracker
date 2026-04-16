import os
import sys
from typing import Any, Dict

from backend.config import settings


def _setup_environment_before_start():
    prom_dir = settings.prometheus_multiproc_dir
    if prom_dir:
        os.environ['PROMETHEUS_MULTIPROC_DIR'] = prom_dir
        os.makedirs(prom_dir, exist_ok=True)


def main() -> None:
    """Main function to configure and run the application server."""
    _setup_environment_before_start()

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))

    if settings.web_workers is not None:
        workers = settings.web_workers
    else:
        # Default to 1 worker in debug mode
        workers = 1

    # Gunicorn is not supported on Windows, so we fall back to Uvicorn.
    if sys.platform == "win32":
        print("Running on Windows, falling back to Uvicorn.")
        import uvicorn
        uvicorn.run(
            "backend.main:app",
            host=host,
            port=port,
            reload=settings.debug,
            workers=1,
            log_level=settings.log_level.lower(),
            proxy_headers=True,
            forwarded_allow_ips='127.0.0.1',
        )
    else:
        # Use Gunicorn on non-Windows systems (Linux, macOS)
        from gunicorn.app.base import BaseApplication

        class StandaloneApplication(BaseApplication):
            def __init__(self, app_uri: str, options: Dict[str, Any] | None = None):
                self.options = options or {}
                self.application_uri = app_uri
                super().__init__()

            def load_config(self):
                config = {
                    key: value
                    for key, value in self.options.items()
                    if key in self.cfg.settings and value is not None
                }
                for key, value in config.items():
                    self.cfg.set(key.lower(), value)

            def load(self) -> Any:
                from gunicorn import util
                return util.import_app(self.application_uri)

        options = {
            "bind": f"{host}:{port}",
            "workers": workers,
            "worker_class": "uvicorn.workers.UvicornWorker",
            "loglevel": settings.log_level.lower(),
            "proxy_headers": True,
            "forwarded_allow_ips": "127.0.0.1",
            "reload": settings.debug,
        }

        # Pass command line arguments to Gunicorn
        sys.argv = ["gunicorn"] + sys.argv[1:]

        # Run the Gunicorn application
        StandaloneApplication("backend.main:app", options).run()


if __name__ == "__main__":
    main()
