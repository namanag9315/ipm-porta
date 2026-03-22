import html
import re
import zipfile
from pathlib import Path

import requests
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from academic_core.models import Course, CourseMaterial


ROW_RE = re.compile(r'<tr[^>]*>.*?</tr>', flags=re.IGNORECASE | re.DOTALL)
LINK_RE = re.compile(
    r'<a[^>]*href="(?P<url>[^"]+)"[^>]*>(?P<name>.*?)</a>',
    flags=re.IGNORECASE | re.DOTALL,
)
CELL_RE = re.compile(r'<td[^>]*>(.*?)</td>', flags=re.IGNORECASE | re.DOTALL)
TAG_RE = re.compile(r'<[^>]+>')


def _clean_text(value: str) -> str:
    return re.sub(r'\s+', ' ', html.unescape(TAG_RE.sub('', value or ''))).strip()


def _normalize_code(value: str) -> str:
    code = _clean_text(value).upper()
    code = code.replace('&', '')
    code = re.sub(r'[^A-Z0-9]', '', code)
    if code == 'TP':
        return 'TP'
    return code


def _extract_mapping_from_html(raw_html: str) -> dict[str, dict[str, str]]:
    mapping: dict[str, dict[str, str]] = {}

    for row_html in ROW_RE.findall(raw_html):
        link_match = LINK_RE.search(row_html)
        if not link_match:
            continue

        url = link_match.group('url').strip()
        name = _clean_text(link_match.group('name'))
        if not url:
            continue

        raw_cells = CELL_RE.findall(row_html)
        cell_values = [_clean_text(value) for value in raw_cells]
        cell_values = [value for value in cell_values if value]
        if not cell_values:
            continue

        code = _normalize_code(cell_values[-1])
        if not re.fullmatch(r'[A-Z0-9]{2,10}', code):
            continue

        mapping[code] = {
            'name': name or code,
            'url': url,
        }

    return mapping


class Command(BaseCommand):
    help = 'Import course drive links from a zipped Google Sheet HTML export.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--zip',
            dest='zip_path',
            required=True,
            help='Absolute path to the exported zip file (example: Untitled spreadsheet.zip).',
        )
        parser.add_argument(
            '--html-name',
            dest='html_name',
            default='Sheet1.html',
            help='HTML file inside the zip (default: Sheet1.html).',
        )
        parser.add_argument(
            '--material-title',
            dest='material_title',
            default='Master Drive Folder',
            help='Title to use for generated CourseMaterial records.',
        )
        parser.add_argument(
            '--skip-materials',
            action='store_true',
            help='Only update Course.drive_link; do not create/update CourseMaterial entries.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Parse and print stats without writing to DB.',
        )
        parser.add_argument(
            '--parse-only',
            action='store_true',
            help='Only parse the zip and print discovered links (no DB read/write).',
        )
        parser.add_argument(
            '--api-base-url',
            dest='api_base_url',
            default='',
            help='Optional: sync via deployed API instead of direct DB (example: https://ipm-portal-api.onrender.com).',
        )
        parser.add_argument(
            '--admin-username',
            dest='admin_username',
            default='',
            help='Admin username for API mode.',
        )
        parser.add_argument(
            '--admin-password',
            dest='admin_password',
            default='',
            help='Admin password for API mode.',
        )
        parser.add_argument(
            '--admin-token',
            dest='admin_token',
            default='',
            help='Existing admin token for API mode (skips /admin/login).',
        )
        parser.add_argument(
            '--api-timeout',
            dest='api_timeout',
            type=int,
            default=30,
            help='HTTP timeout in seconds for API mode (default: 30).',
        )

    def handle(self, *args, **options):
        zip_path = Path(options['zip_path']).expanduser().resolve()
        html_name = options['html_name']
        material_title = options['material_title'].strip() or 'Master Drive Folder'
        skip_materials = bool(options['skip_materials'])
        dry_run = bool(options['dry_run'])
        parse_only = bool(options['parse_only'])
        api_base_url = str(options.get('api_base_url') or '').strip().rstrip('/')
        admin_username = str(options.get('admin_username') or '').strip()
        admin_password = str(options.get('admin_password') or '')
        admin_token = str(options.get('admin_token') or '').strip()
        api_timeout = int(options.get('api_timeout') or 30)

        if not zip_path.exists():
            raise CommandError(f'Zip file not found: {zip_path}')

        try:
            with zipfile.ZipFile(zip_path) as archive:
                raw_html = archive.read(html_name).decode('utf-8', errors='ignore')
        except KeyError as exc:
            raise CommandError(f'File "{html_name}" not found in zip: {zip_path}') from exc
        except zipfile.BadZipFile as exc:
            raise CommandError(f'Invalid zip file: {zip_path}') from exc

        mapping = _extract_mapping_from_html(raw_html)
        if not mapping:
            raise CommandError('No course links found in the provided HTML.')

        if parse_only:
            self.stdout.write(self.style.SUCCESS('Drive-link parsing succeeded.'))
            self.stdout.write(f'Zip: {zip_path}')
            self.stdout.write(f'Links parsed: {len(mapping)}')
            sample_codes = ', '.join(sorted(mapping.keys())[:10])
            if sample_codes:
                self.stdout.write(f'Sample codes: {sample_codes}')
            return

        if api_base_url:
            if not admin_token and (not admin_username or not admin_password):
                raise CommandError(
                    'Provide either --admin-token OR both --admin-username and --admin-password with --api-base-url.'
                )

            def api_request(method: str, path: str, *, token: str | None = None, json_payload=None):
                headers = {'Accept': 'application/json'}
                if token:
                    headers['Authorization'] = f'Token {token}'
                response = requests.request(
                    method=method.upper(),
                    url=f'{api_base_url}{path}',
                    json=json_payload,
                    headers=headers,
                    timeout=api_timeout,
                )
                if response.status_code >= 400:
                    raise CommandError(
                        f'API {method.upper()} {path} failed ({response.status_code}): {response.text[:400]}'
                    )
                if not response.content:
                    return {}
                try:
                    return response.json()
                except ValueError:
                    return {}

            token = admin_token
            if not token:
                login_payload = {'username': admin_username, 'password': admin_password}
                login_data = api_request('POST', '/api/v1/admin/login/', json_payload=login_payload)
                token = str(login_data.get('access') or '').strip()
                if not token:
                    raise CommandError('Login succeeded but no access token was returned.')

            course_rows = api_request('GET', '/api/v1/admin/courses/', token=token)
            if not isinstance(course_rows, list):
                raise CommandError('Unexpected /admin/courses response format.')
            courses_by_code = {
                str(row.get('code') or '').upper(): row
                for row in course_rows
                if str(row.get('code') or '').strip()
            }

            missing_codes = sorted(code for code in mapping if code not in courses_by_code)
            matched_codes = sorted(code for code in mapping if code in courses_by_code)

            updated_course_count = 0
            for code in matched_codes:
                current_link = str(courses_by_code[code].get('drive_link') or '').strip()
                new_link = mapping[code]['url']
                if current_link == new_link:
                    continue
                updated_course_count += 1
                if not dry_run:
                    api_request(
                        'PATCH',
                        f'/api/v1/admin/courses/{code}/',
                        token=token,
                        json_payload={'drive_link': new_link},
                    )

            created_materials = 0
            updated_materials = 0
            if not skip_materials and matched_codes:
                material_rows = api_request('GET', '/api/v1/admin/course-materials/', token=token)
                if not isinstance(material_rows, list):
                    raise CommandError('Unexpected /admin/course-materials response format.')

                existing_material_by_course: dict[str, dict] = {}
                for material in material_rows:
                    if str(material.get('title') or '').strip() != material_title:
                        continue
                    course_code = str((material.get('course') or {}).get('code') or '').upper().strip()
                    if course_code and course_code not in existing_material_by_course:
                        existing_material_by_course[course_code] = material

                for code in matched_codes:
                    url = mapping[code]['url']
                    course_name = mapping[code]['name']
                    existing = existing_material_by_course.get(code)
                    if existing is None:
                        created_materials += 1
                        if not dry_run:
                            api_request(
                                'POST',
                                '/api/v1/admin/course-materials/',
                                token=token,
                                json_payload={
                                    'course_code': code,
                                    'title': material_title,
                                    'description': f'Primary drive link for {course_name}',
                                    'drive_link': url,
                                    'sort_order': 0,
                                    'is_published': True,
                                    'created_by': 'system-import',
                                },
                            )
                        continue

                    material_id = existing.get('id')
                    current_link = str(existing.get('drive_link') or '').strip()
                    current_published = bool(existing.get('is_published'))
                    current_sort = int(existing.get('sort_order') or 0)
                    needs_update = (
                        current_link != url
                        or not current_published
                        or current_sort != 0
                    )
                    if not needs_update:
                        continue

                    updated_materials += 1
                    if not dry_run:
                        api_request(
                            'PATCH',
                            f'/api/v1/admin/course-materials/{material_id}/',
                            token=token,
                            json_payload={
                                'drive_link': url,
                                'is_published': True,
                                'sort_order': 0,
                            },
                        )

            self.stdout.write(self.style.SUCCESS('Drive-link API sync completed.'))
            self.stdout.write(f'API base URL: {api_base_url}')
            self.stdout.write(f'Links parsed: {len(mapping)}')
            self.stdout.write(f'Matched courses in API: {len(matched_codes)}')
            self.stdout.write(f'Missing course codes in API: {len(missing_codes)}')
            if missing_codes:
                self.stdout.write(f'  Missing: {", ".join(missing_codes)}')
            self.stdout.write(f'Course.drive_link updates: {updated_course_count}')
            if skip_materials:
                self.stdout.write('CourseMaterial updates: skipped')
            else:
                self.stdout.write(f'CourseMaterial created: {created_materials}')
                self.stdout.write(f'CourseMaterial updated: {updated_materials}')
            if dry_run:
                self.stdout.write(self.style.WARNING('Dry-run mode: no API writes were sent.'))
            return

        courses_by_code = {course.code.upper(): course for course in Course.objects.all()}
        missing_codes = sorted(code for code in mapping if code not in courses_by_code)
        matched_codes = sorted(code for code in mapping if code in courses_by_code)

        updated_courses: list[Course] = []
        for code in matched_codes:
            course = courses_by_code[code]
            new_link = mapping[code]['url']
            if course.drive_link != new_link:
                course.drive_link = new_link
                updated_courses.append(course)

        created_materials = 0
        updated_materials = 0

        if not dry_run:
            with transaction.atomic():
                if updated_courses:
                    Course.objects.bulk_update(updated_courses, ['drive_link'], batch_size=200)

                if not skip_materials and matched_codes:
                    target_course_ids = [courses_by_code[code].code for code in matched_codes]
                    existing_materials = {
                        material.course_id: material
                        for material in CourseMaterial.objects.filter(
                            course_id__in=target_course_ids,
                            title=material_title,
                        )
                    }

                    to_create: list[CourseMaterial] = []
                    to_update: list[CourseMaterial] = []
                    for code in matched_codes:
                        course = courses_by_code[code]
                        url = mapping[code]['url']
                        course_name = mapping[code]['name']
                        material = existing_materials.get(course.code)
                        if material is None:
                            to_create.append(
                                CourseMaterial(
                                    course=course,
                                    title=material_title,
                                    description=f'Primary drive link for {course_name}',
                                    drive_link=url,
                                    sort_order=0,
                                    is_published=True,
                                    created_by='system-import',
                                )
                            )
                            continue

                        changed = False
                        if material.drive_link != url:
                            material.drive_link = url
                            changed = True
                        if not material.is_published:
                            material.is_published = True
                            changed = True
                        if material.sort_order != 0:
                            material.sort_order = 0
                            changed = True
                        if changed:
                            to_update.append(material)

                    if to_create:
                        CourseMaterial.objects.bulk_create(to_create, batch_size=200)
                        created_materials = len(to_create)
                    if to_update:
                        CourseMaterial.objects.bulk_update(
                            to_update,
                            ['drive_link', 'is_published', 'sort_order', 'updated_at'],
                            batch_size=200,
                        )
                        updated_materials = len(to_update)

        self.stdout.write(self.style.SUCCESS('Drive-link import parsed successfully.'))
        self.stdout.write(f'Zip: {zip_path}')
        self.stdout.write(f'Links parsed: {len(mapping)}')
        self.stdout.write(f'Matched courses in DB: {len(matched_codes)}')
        self.stdout.write(f'Missing course codes in DB: {len(missing_codes)}')
        if missing_codes:
            self.stdout.write(f'  Missing: {", ".join(missing_codes)}')

        self.stdout.write(f'Course.drive_link updates: {len(updated_courses)}')
        if skip_materials:
            self.stdout.write('CourseMaterial updates: skipped')
        else:
            self.stdout.write(f'CourseMaterial created: {created_materials}')
            self.stdout.write(f'CourseMaterial updated: {updated_materials}')

        if dry_run:
            self.stdout.write(self.style.WARNING('Dry-run mode: no DB changes were written.'))
