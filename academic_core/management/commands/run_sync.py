from django.core.management.base import BaseCommand, CommandError

from academic_core.tasks import sync_google_sheets_data


class Command(BaseCommand):
    help = 'Run Google Sheets ETL sync now (default), or enqueue via Celery with --enqueue.'

    def add_arguments(self, parser) -> None:
        parser.add_argument(
            '--enqueue',
            action='store_true',
            help='Queue the sync task on Celery instead of running synchronously.',
        )
        parser.add_argument(
            '--batch',
            type=str,
            default='',
            help='Optional batch code (for example: 2023). If omitted, all active batches are synced.',
        )

    def handle(self, *args, **options) -> None:
        batch_code = str(options.get('batch', '')).strip().upper() or None
        if options.get('enqueue'):
            try:
                task = sync_google_sheets_data.delay(batch_code=batch_code)
            except Exception as exc:
                raise CommandError(f'Failed to enqueue sync task: {exc}') from exc
            self.stdout.write(
                self.style.SUCCESS(f'Sync task queued successfully. Task ID: {task.id}')
            )
            return

        try:
            result = sync_google_sheets_data(batch_code=batch_code)
        except Exception as exc:
            raise CommandError(f'Failed to run sync: {exc}') from exc

        self.stdout.write(self.style.SUCCESS('Sync completed.'))
        self.stdout.write(str(result))
