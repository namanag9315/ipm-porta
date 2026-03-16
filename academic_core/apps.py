import logging
import os
import sys
import threading
import time

from django.apps import AppConfig
from django.conf import settings

logger = logging.getLogger(__name__)


class AcademicCoreConfig(AppConfig):
    name = 'academic_core'
    _fallback_sync_thread_started = False

    def ready(self):
        if self._fallback_sync_thread_started:
            return
        if not getattr(settings, 'AUTO_SYNC_FALLBACK_ENABLED', False):
            return

        command = os.path.basename(sys.argv[0]) if sys.argv else ''
        subcommand = sys.argv[1] if len(sys.argv) > 1 else ''
        is_runserver = command == 'manage.py' and subcommand == 'runserver'
        is_gunicorn = 'gunicorn' in command
        is_uvicorn = 'uvicorn' in command
        if not (is_runserver or is_gunicorn or is_uvicorn):
            return

        # Django autoreloader starts two processes in DEBUG.
        # Only start the background sync thread in the serving process.
        run_main = os.environ.get('RUN_MAIN')
        uses_reloader = '--noreload' not in sys.argv
        if settings.DEBUG and uses_reloader and run_main != 'true':
            return

        interval_seconds = max(
            60,
            int(getattr(settings, 'AUTO_SYNC_FALLBACK_INTERVAL_SECONDS', 3600)),
        )
        initial_delay_seconds = max(
            5,
            int(getattr(settings, 'AUTO_SYNC_FALLBACK_INITIAL_DELAY_SECONDS', 45)),
        )

        thread = threading.Thread(
            target=self._fallback_sync_loop,
            args=(interval_seconds, initial_delay_seconds),
            daemon=True,
            name='ipm-auto-sync',
        )
        thread.start()
        self._fallback_sync_thread_started = True
        logger.info(
            'Started fallback auto-sync thread (interval=%ss, initial_delay=%ss).',
            interval_seconds,
            initial_delay_seconds,
        )

    @staticmethod
    def _fallback_sync_loop(interval_seconds: int, initial_delay_seconds: int) -> None:
        from academic_core.tasks import sync_google_sheets_data

        time.sleep(initial_delay_seconds)
        while True:
            started_at = time.time()
            try:
                result = sync_google_sheets_data()
                status = result.get('status') if isinstance(result, dict) else 'unknown'
                logger.info('Fallback auto-sync finished. status=%s', status)
            except Exception:
                logger.exception('Fallback auto-sync failed.')

            elapsed = time.time() - started_at
            wait_seconds = max(interval_seconds - elapsed, 30)
            time.sleep(wait_seconds)
