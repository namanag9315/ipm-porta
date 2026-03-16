import logging
import re
from datetime import date, time
from typing import Any
from zoneinfo import ZoneInfo

import pandas as pd
import requests
from celery import shared_task
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.utils import timezone

from academic_core.models import (
    AttendanceRecord,
    Batch,
    ClassSession,
    Course,
    MessMenu,
    Student,
    StudentCourse,
    TermSettings,
)
from academic_core.utils import extract_sheet_id
from academic_core.utils import format_batch_name, infer_batch_code_from_roll_number

logger = logging.getLogger(__name__)

EXAM_PATTERN = re.compile(r'\b(exam|quiz|end\s*term|mid\s*term)\b', re.IGNORECASE)
BREAK_PATTERN = re.compile(r'break', re.IGNORECASE)
ROLL_NO_PATTERN = re.compile(r'^roll\s*no(?:\.|)?$', re.IGNORECASE)
ROLL_NO_NORMALIZED_PATTERN = re.compile(r'^roll (?:no|number)$', re.IGNORECASE)
SKIP_ATTENDANCE_SHEETS = {'time table', 'consolidated', 'mess', 'bld menu'}
ATTENDANCE_MARKERS = {'P', 'A', 'L'}
SHEET_PARAM_CANDIDATES = ('id', 'spreadsheetId', 'sheetId', 'sheet_id')
LOCAL_TIMEZONE = ZoneInfo('Asia/Kolkata')

TIMETABLE_SHEET_NAME = 'Time table'
MESS_MENU_SHEET_NAME = 'BLD Menu'
BIRTHDAY_SHEET_NAME = 'Birthdays'
COURSE_CREDIT_OVERRIDES: dict[str, int] = {
    'BGS': 4,
    'IBH': 4,
    'WD': 2,
    'POM': 4,
    'SSL': 2,
    'MLTP': 2,
    'LCL': 3,
    'BE': 2,
    'LE': 4,
    'DE': 2,
    'EBS': 2,
    'ME': 2,
    'TP': 2,
    'HVBG': 2,
    'IPRM': 2,
    'SMC': 2,
    'RT': 2,
    'ETC': 2,
    'BPP': 2,
    'APPS': 3,
    'DES': 4,
    'QMP': 2,
}


def _resolve_student_batch(roll_number: str, fallback_batch: Batch | None = None) -> Batch | None:
    if fallback_batch is not None:
        return fallback_batch

    inferred_batch_code = infer_batch_code_from_roll_number(roll_number)
    if inferred_batch_code:
        resolved_batch, _ = Batch.objects.get_or_create(
            code=inferred_batch_code,
            defaults={'name': format_batch_name(inferred_batch_code), 'is_active': True},
        )
        return resolved_batch
    return fallback_batch


def _safe_text(value: Any) -> str:
    if value is None:
        return ''
    if isinstance(value, float) and pd.isna(value):
        return ''
    return str(value).strip()


def _normalize_header(value: Any) -> str:
    text = _safe_text(value).lower()
    text = re.sub(r'[^a-z0-9]+', ' ', text).strip()
    return text


def _make_unique_headers(headers: list[str]) -> list[str]:
    unique_headers: list[str] = []
    seen: dict[str, int] = {}
    for idx, header in enumerate(headers):
        base = header or f'col_{idx}'
        count = seen.get(base, 0)
        seen[base] = count + 1
        unique_headers.append(base if count == 0 else f'{base}_{count}')
    return unique_headers


def _parse_date(value: Any) -> date | None:
    text_value = _safe_text(value)
    if not text_value:
        return None

    if re.match(r'^\d{4}-\d{2}-\d{2}$', text_value):
        try:
            return date.fromisoformat(text_value)
        except ValueError:
            return None

    iso_with_timezone = re.match(r'^\d{4}-\d{2}-\d{2}T', text_value) and (
        text_value.endswith('Z') or '+' in text_value or '-' in text_value[10:]
    )
    if iso_with_timezone:
        parsed = pd.to_datetime(text_value, errors='coerce', utc=True)
        if pd.isna(parsed):
            return None
        return parsed.tz_convert(LOCAL_TIMEZONE).date()

    parsed = pd.to_datetime(text_value, errors='coerce', dayfirst=True)
    if pd.isna(parsed):
        return None
    if getattr(parsed, 'tzinfo', None) is not None:
        parsed = parsed.tz_convert(LOCAL_TIMEZONE)
    return parsed.date()


def _parse_time_part(value: str) -> time | None:
    text = _safe_text(value)
    if not text:
        return None

    normalized = re.sub(r'\s+', ' ', text).strip().lower()
    normalized = normalized.replace('.', ':')
    normalized = normalized.replace('noon', 'pm').replace('midnight', 'am')
    normalized = re.sub(r'(?<=\d)(am|pm)\b', r' \1', normalized)
    if re.fullmatch(r'\d{1,2}\s*(am|pm)', normalized):
        normalized = re.sub(r'(\d{1,2})\s*(am|pm)', r'\1:00 \2', normalized)

    parsed = pd.to_datetime(normalized, format='%I:%M %p', errors='coerce')
    if pd.isna(parsed):
        parsed = pd.to_datetime(normalized, errors='coerce')
    if pd.isna(parsed):
        return None
    return parsed.time().replace(second=0, microsecond=0)


def _parse_time_slot(slot_text: str) -> tuple[time, time] | None:
    text = _safe_text(slot_text)
    if not text:
        return None
    parts = re.split(r'\s*(?:to|-|–|—)\s*', text, maxsplit=1)
    if len(parts) != 2:
        return None
    start = _parse_time_part(parts[0])
    end = _parse_time_part(parts[1])
    if not start or not end:
        return None
    return start, end


def _infer_course_from_text(raw_text: str, course_map: dict[str, Course]) -> Course | None:
    upper_text = raw_text.upper()
    if 'TP' in course_map and re.search(r'\bT\s*&\s*P\b', upper_text):
        return course_map['TP']
    for code in sorted(course_map, key=len, reverse=True):
        if re.search(rf'\b{re.escape(code)}\b', upper_text):
            return course_map[code]
    return None


def _find_header_row_index(sheet_rows: list[list[Any]]) -> int | None:
    for index, row in enumerate(sheet_rows):
        for cell in row:
            normalized = _normalize_header(cell)
            if ROLL_NO_PATTERN.match(_safe_text(cell)) or ROLL_NO_NORMALIZED_PATTERN.match(normalized):
                return index
    return None


def _find_column_index(headers: list[str], candidates: set[str]) -> int | None:
    for index, value in enumerate(headers):
        if _normalize_header(value) in candidates:
            return index
    return None


def _looks_like_roll_number(value: str) -> bool:
    roll_number = value.strip().upper()
    if re.fullmatch(r'\d{4}[A-Z]{2,}\d+', roll_number):
        return True
    has_digit = any(character.isdigit() for character in roll_number)
    has_alpha = any(character.isalpha() for character in roll_number)
    return len(roll_number) >= 6 and has_digit and has_alpha


def _infer_course_code_from_sheet_name(sheet_name: str) -> str:
    tokens = re.findall(r'[A-Z0-9]+', sheet_name.upper())
    ignore_tokens = {'A', 'B', 'ATTENDANCE', 'SECTION', 'SHEET', 'STUDENTS'}
    for token in tokens:
        if token in ignore_tokens:
            continue
        if 2 <= len(token) <= 10:
            return token

    words = [word for word in re.findall(r'[A-Z]+', sheet_name.upper()) if word not in ignore_tokens]
    if len(words) >= 2:
        acronym = ''.join(word[0] for word in words if word)
        if 2 <= len(acronym) <= 10:
            return acronym
    return ''


def _normalize_course_name_from_sheet_name(sheet_name: str) -> str:
    cleaned = _safe_text(sheet_name)
    cleaned = re.sub(r'\bsection\s*[AB]\b', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s+\b[AB]\b\s*$', '', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    return cleaned or _safe_text(sheet_name)


def _infer_section_from_sheet_name(sheet_name: str) -> str:
    match = re.search(r'\b([AB])\b', sheet_name.upper())
    if match:
        return match.group(1)
    return ''


def _normalize_section(value: Any, fallback: str = 'A') -> str:
    normalized = _safe_text(value).upper()
    if not normalized:
        return fallback
    if normalized in {'A', 'B'}:
        return normalized
    if normalized.startswith('A'):
        return 'A'
    if normalized.startswith('B'):
        return 'B'
    has_a = bool(re.search(r'\bA\b', normalized))
    has_b = bool(re.search(r'\bB\b', normalized))
    if has_a and not has_b:
        return 'A'
    if has_b and not has_a:
        return 'B'
    return fallback


def _placeholder_email(roll_number: str) -> str:
    local_part = re.sub(r'[^a-z0-9]+', '', roll_number.lower())
    local_part = local_part or 'student'
    return f'{local_part}@ipm.local'


def _valid_or_placeholder_email(value: Any, roll_number: str) -> str:
    email = _safe_text(value).lower()
    if email:
        try:
            validate_email(email)
            return email
        except ValidationError:
            pass
    return _placeholder_email(roll_number)


def _find_consolidated_sheet(
    json_payload: dict[str, list[list[Any]]],
) -> tuple[str | None, list[list[Any]] | None]:
    for sheet_name, sheet_data in json_payload.items():
        normalized_name = sheet_name.strip().lower()
        if normalized_name == 'consolidated attendance sheet':
            return sheet_name, sheet_data

    for sheet_name, sheet_data in json_payload.items():
        normalized_name = sheet_name.strip().lower()
        if 'consolidated' in normalized_name and 'attendance' in normalized_name:
            return sheet_name, sheet_data

    return None, None


def _is_non_data_row(roll_number: str) -> bool:
    return _normalize_header(roll_number) in {'total', 'average', 'avg', 'summary'}


def _count_attendance_marks(values: list[Any]) -> tuple[int, int, int]:
    p_count = 0
    a_count = 0
    l_count = 0

    for value in values:
        marker = _safe_text(value).upper()
        if marker not in ATTENDANCE_MARKERS:
            continue
        if marker == 'P':
            p_count += 1
        elif marker == 'A':
            a_count += 1
        elif marker == 'L':
            l_count += 1

    return p_count, a_count, l_count


def _infer_credits_from_total_delivered(total_delivered: int) -> int:
    delivered = int(total_delivered or 0)
    if delivered <= 0:
        return 0
    if delivered <= 10:
        return 2
    if delivered <= 15:
        return 3
    return 4


def _has_attendance_markers(
    sheet_data: list[list[Any]],
    header_index: int,
    roll_column: int,
) -> bool:
    for row in sheet_data[header_index + 1 : header_index + 80]:
        if not isinstance(row, (list, tuple)):
            continue
        roll_number = _safe_text(_cell_value(row, roll_column))
        if not roll_number or _is_non_data_row(roll_number):
            continue
        attendance_slice = list(row[roll_column + 1 :]) if len(row) > roll_column + 1 else []
        present_count, absent_count, late_count = _count_attendance_marks(attendance_slice)
        if present_count + absent_count + late_count > 0:
            return True
    return False


def _cell_value(row: list[Any] | tuple[Any, ...], index: int | None) -> Any:
    if index is None or index < 0 or index >= len(row):
        return ''
    return row[index]


def _preprocess_timetable_rows(raw_rows: list[Any]) -> list[dict[str, Any]]:
    if not raw_rows:
        return []

    header_row_index: int | None = None
    header_row: list[Any] = []
    for idx, row in enumerate(raw_rows):
        if not isinstance(row, (list, tuple)):
            continue
        normalized_cells = [_safe_text(cell).lower() for cell in row]
        has_date = any(cell == 'date' for cell in normalized_cells)
        has_room = any(cell == 'room' for cell in normalized_cells)
        has_times = any('am' in cell or 'pm' in cell or 'noon' in cell for cell in normalized_cells)
        if has_date and has_room and has_times:
            header_row_index = idx
            header_row = list(row)
            break

    if header_row_index is None:
        logger.warning('Timetable preprocessing skipped: header row not found.')
        return []

    date_col: int | None = None
    room_col: int | None = None
    slot_columns: dict[int, str] = {}

    for col_idx, cell in enumerate(header_row):
        text = _safe_text(cell).replace('\n', ' ').strip()
        normalized = text.lower()
        if not text:
            continue
        if normalized == 'date':
            date_col = col_idx
        elif normalized == 'room':
            room_col = col_idx
        elif normalized == 'break':
            continue
        elif 'am' in normalized or 'pm' in normalized or 'noon' in normalized:
            slot_columns[col_idx] = text

    if date_col is None or room_col is None or not slot_columns:
        logger.warning('Timetable preprocessing skipped: required columns not found.')
        return []

    output: list[dict[str, Any]] = []
    current_date: Any = None
    for row in raw_rows[header_row_index + 1 :]:
        if not isinstance(row, (list, tuple)):
            continue

        date_value = _safe_text(_cell_value(row, date_col))
        if date_value:
            current_date = date_value

        room_value = _safe_text(_cell_value(row, room_col))
        if not room_value or current_date is None:
            continue

        for col_idx, slot_text in slot_columns.items():
            cell_text = _safe_text(_cell_value(row, col_idx))
            if not cell_text:
                continue
            output.append(
                {
                    'date': current_date,
                    'room': room_value,
                    'timeSlot': slot_text,
                    'raw_text': cell_text,
                }
            )

    return output


def parse_timetable(sheet_data: list[dict[str, Any]], *, batch: Batch | None = None) -> dict[str, int]:
    stats = {'created': 0, 'deleted': 0, 'skipped': 0, 'errors': 0}
    if not isinstance(sheet_data, list):
        return stats

    sessions_to_create: list[ClassSession] = []

    exam_name_map = {
        'principles of management': 'PoM',
        'web development': 'WD',
        'business, government and society': 'BGS',
        'development economics': 'DE',
        'business history': 'IBH',
        'intellectual property rights': 'IPRM',
        'business strategy': 'EBS',
        'emerging technologies': 'ETC',
        'labor economics': 'LE',
        'behavioral economics': 'BE',
        'technology and politics': 'TP',
    }

    course_by_code = {course.code.upper(): course for course in Course.objects.all()}

    for item in sheet_data:
        try:
            if not isinstance(item, dict):
                stats['skipped'] += 1
                continue

            raw_text = _safe_text(item.get('raw_text'))
            if not raw_text or BREAK_PATTERN.search(raw_text):
                stats['skipped'] += 1
                continue

            parsed_date = _parse_date(item.get('date'))
            if not parsed_date:
                stats['skipped'] += 1
                continue

            room = _safe_text(item.get('room')) or 'Unknown'
            time_slot = _safe_text(item.get('timeSlot') or item.get('time_slot'))
            parsed_slot = _parse_time_slot(time_slot)
            start_time = parsed_slot[0] if parsed_slot else None
            end_time = parsed_slot[1] if parsed_slot else None

            upper_clean_text = re.sub(r'\bA\s*GAME\b', '', raw_text.upper())

            target_section = 'All'
            if re.search(r'\bB\b', upper_clean_text) or 'SEC B' in upper_clean_text:
                target_section = 'B'
            elif re.search(r'\bA\b', upper_clean_text) or 'SEC A' in upper_clean_text:
                target_section = 'A'

            is_exam = bool(EXAM_PATTERN.search(raw_text))

            matched_course = _infer_course_from_text(raw_text, course_by_code)
            if not matched_course:
                lower_text = raw_text.lower()
                for full_name, code in exam_name_map.items():
                    if full_name in lower_text:
                        matched_course = course_by_code.get(code.upper())
                        break

            sessions_to_create.append(
                ClassSession(
                    batch=batch,
                    date=parsed_date,
                    start_time=start_time,
                    end_time=end_time,
                    room=room[:20],
                    raw_text=raw_text[:255],
                    target_section=target_section,
                    is_exam=is_exam,
                    course=matched_course,
                )
            )
        except Exception:
            stats['errors'] += 1
            logger.exception('Error while parsing timetable row.')

    with transaction.atomic():
        session_qs = ClassSession.objects.filter(batch=batch) if batch else ClassSession.objects.all()
        deleted_count, _ = session_qs.delete()
        if sessions_to_create:
            ClassSession.objects.bulk_create(sessions_to_create, batch_size=500)

    stats['deleted'] = deleted_count
    stats['created'] = len(sessions_to_create)
    return stats


def parse_consolidated_attendance_sheet(
    json_payload: dict[str, list[list[Any]]],
    *,
    batch: Batch | None = None,
) -> dict[str, int]:
    stats = {
        'sheet_found': 0,
        'users_created': 0,
        'users_updated': 0,
        'skipped': 0,
        'errors': 0,
    }
    if not isinstance(json_payload, dict):
        return stats

    _, sheet_data = _find_consolidated_sheet(json_payload)
    if not isinstance(sheet_data, list):
        return stats
    stats['sheet_found'] = 1

    header_index = _find_header_row_index(sheet_data)
    if header_index is None:
        logger.warning('Consolidated parsing skipped: could not find Roll No header row.')
        return stats

    headers = [_safe_text(value) for value in sheet_data[header_index]]
    roll_column = _find_column_index(headers, {'roll no', 'roll no.', 'roll number'})
    name_column = _find_column_index(headers, {'student name', 'name'})
    email_column = _find_column_index(
        headers,
        {'email id', 'email', 'emailid', 'email address'},
    )
    section_column = _find_column_index(headers, {'section', 'sec'})

    if roll_column is None:
        logger.warning('Consolidated parsing skipped: Roll No column not found.')
        return stats

    for row in sheet_data[header_index + 1 :]:
        try:
            if not isinstance(row, (list, tuple)):
                continue

            roll_number = _safe_text(_cell_value(row, roll_column))
            if (
                not roll_number
                or _is_non_data_row(roll_number)
                or not _looks_like_roll_number(roll_number)
            ):
                stats['skipped'] += 1
                continue

            student_name = _safe_text(_cell_value(row, name_column)) or roll_number
            email = _valid_or_placeholder_email(_cell_value(row, email_column), roll_number)
            section = _normalize_section(_cell_value(row, section_column), fallback='A')
            student_batch = _resolve_student_batch(roll_number, fallback_batch=batch)

            defaults = {
                'batch': student_batch,
                'name': student_name[:100],
                'section': section,
                'email': email,
            }

            try:
                student, created = Student.objects.get_or_create(
                    roll_number=roll_number,
                    defaults=defaults,
                )
            except IntegrityError:
                defaults['email'] = _placeholder_email(roll_number)
                student, created = Student.objects.get_or_create(
                    roll_number=roll_number,
                    defaults=defaults,
                )

            if created:
                student.set_password(f'IIM@{roll_number}')
                student.save(update_fields=['password'])
                stats['users_created'] += 1
                continue

            update_fields: list[str] = []
            if student.name != student_name[:100]:
                student.name = student_name[:100]
                update_fields.append('name')
            if student_batch and student.batch_id != student_batch.code:
                student.batch = student_batch
                update_fields.append('batch')
            if section and student.section != section:
                student.section = section
                update_fields.append('section')
            if email and student.email != email:
                email_taken = Student.objects.exclude(pk=student.pk).filter(email=email).exists()
                if not email_taken:
                    student.email = email
                    update_fields.append('email')

            if update_fields:
                student.save(update_fields=update_fields)
                stats['users_updated'] += 1
        except Exception:
            stats['errors'] += 1
            logger.exception('Error while parsing consolidated attendance row.')

    return stats


def parse_attendance(
    json_payload: dict[str, list[list[Any]]],
    *,
    batch: Batch | None = None,
) -> dict[str, int]:
    stats = {
        'sheets_processed': 0,
        'students_created': 0,
        'records_upserted': 0,
        'student_course_mappings_created': 0,
        'stale_records_removed': 0,
        'errors': 0,
    }
    if not isinstance(json_payload, dict):
        return stats
    valid_course_codes: set[str] = set()

    for sheet_name, sheet_data in json_payload.items():
        normalized_name = sheet_name.strip().lower()
        if (
            normalized_name in SKIP_ATTENDANCE_SHEETS
            or 'consolidated' in normalized_name
            or 'mess' in normalized_name
            or 'feedback' in normalized_name
            or 'participant' in normalized_name
            or 'section a' in normalized_name
            or 'section b' in normalized_name
            or 'group email' in normalized_name
            or 'book' in normalized_name
            or 'contact' in normalized_name
        ):
            continue

        if not isinstance(sheet_data, list):
            continue

        header_index = _find_header_row_index(sheet_data)
        if header_index is None:
            continue

        headers = [_safe_text(value) for value in sheet_data[header_index]]
        roll_column = _find_column_index(headers, {'roll no', 'roll no.', 'roll number'})
        name_column = _find_column_index(headers, {'student name', 'name'})
        if roll_column is None:
            continue
        course_code = _infer_course_code_from_sheet_name(sheet_name)
        if not course_code:
            continue
        normalized_course_name = _normalize_course_name_from_sheet_name(sheet_name)
        normalized_course_code = course_code.upper()
        configured_credits = COURSE_CREDIT_OVERRIDES.get(normalized_course_code, 0)

        course, _ = Course.objects.get_or_create(
            code=course_code,
            defaults={
                'name': normalized_course_name[:150],
                'credits': configured_credits,
            },
        )
        course_update_fields: list[str] = []
        if normalized_course_name and course.name != normalized_course_name[:150]:
            course.name = normalized_course_name[:150]
            course_update_fields.append('name')
        if configured_credits > 0 and course.credits != configured_credits:
            course.credits = configured_credits
            course_update_fields.append('credits')
        if course_update_fields:
            course.save(update_fields=course_update_fields)
        valid_course_codes.add(course.code)
        section = _infer_section_from_sheet_name(sheet_name)
        max_delivered_for_course = 0

        for row in sheet_data[header_index + 1 :]:
            try:
                if not isinstance(row, (list, tuple)):
                    continue

                roll_number = _safe_text(_cell_value(row, roll_column))
                if (
                    not roll_number
                    or _is_non_data_row(roll_number)
                    or not _looks_like_roll_number(roll_number)
                ):
                    continue

                student_name = _safe_text(_cell_value(row, name_column)) or roll_number

                attendance_slice = list(row[roll_column + 1 :]) if len(row) > roll_column + 1 else []
                present_count, absent_count, late_count = _count_attendance_marks(attendance_slice)
                total_delivered = present_count + absent_count + late_count
                total_attended = present_count
                percentage = (total_attended / total_delivered * 100.0) if total_delivered else 0.0
                max_delivered_for_course = max(max_delivered_for_course, total_delivered)
                student_batch = _resolve_student_batch(roll_number, fallback_batch=batch)

                student, created = Student.objects.get_or_create(
                    roll_number=roll_number,
                    defaults={
                        'batch': student_batch,
                        'name': student_name[:100],
                        'section': section or 'A',
                        'email': _placeholder_email(roll_number),
                    },
                )
                if created:
                    stats['students_created'] += 1
                else:
                    update_fields: list[str] = []
                    if student_name and student.name != student_name[:100]:
                        student.name = student_name[:100]
                        update_fields.append('name')
                    if student_batch and student.batch_id != student_batch.code:
                        student.batch = student_batch
                        update_fields.append('batch')
                    if section and student.section != section:
                        student.section = section
                        update_fields.append('section')
                    if not student.email:
                        student.email = _placeholder_email(roll_number)
                        update_fields.append('email')
                    if update_fields:
                        student.save(update_fields=update_fields)

                mapping, mapping_created = StudentCourse.objects.get_or_create(
                    student=student,
                    course=course,
                    defaults={'batch': student_batch or batch},
                )
                if mapping_created:
                    stats['student_course_mappings_created'] += 1
                elif (student_batch or batch) and mapping.batch_id != (student_batch or batch).code:
                    mapping.batch = student_batch or batch
                    mapping.save(update_fields=['batch'])

                AttendanceRecord.objects.update_or_create(
                    student=student,
                    course=course,
                    defaults={
                        'batch': batch,
                        'total_delivered': total_delivered,
                        'total_attended': total_attended,
                        'percentage': round(percentage, 2),
                    },
                )
                stats['records_upserted'] += 1
            except Exception:
                stats['errors'] += 1
                logger.exception(
                    'Error while parsing attendance row for sheet "%s".',
                    sheet_name,
                )

        inferred_credits = _infer_credits_from_total_delivered(max_delivered_for_course)
        should_update_credits = (
            configured_credits <= 0
            and
            inferred_credits > 0
            and (course.credits <= 0 or inferred_credits > course.credits)
        )
        if should_update_credits:
            course.credits = inferred_credits
            course.save(update_fields=['credits'])

        stats['sheets_processed'] += 1

    if valid_course_codes:
        attendance_scope = AttendanceRecord.objects.filter(batch=batch) if batch else AttendanceRecord.objects.all()
        mapping_scope = StudentCourse.objects.filter(batch=batch) if batch else StudentCourse.objects.all()
        with transaction.atomic():
            stale_attendance_deleted, _ = attendance_scope.exclude(
                course_id__in=valid_course_codes
            ).delete()
            stale_mappings_deleted, _ = mapping_scope.exclude(
                course_id__in=valid_course_codes
            ).delete()
        stats['stale_records_removed'] = stale_attendance_deleted + stale_mappings_deleted

    return stats


def parse_mess_menu(sheet_data: list[list[Any]], *, batch: Batch | None = None) -> dict[str, int]:
    stats = {'created': 0, 'deleted': 0, 'errors': 0}
    if not isinstance(sheet_data, list) or len(sheet_data) <= 5:
        return stats

    rows = [list(row) if isinstance(row, (list, tuple)) else [] for row in sheet_data]
    if not rows:
        return stats

    date_row_index: int | None = None
    date_col_index: int | None = None
    day_row_index: int | None = None

    for row_index, row in enumerate(rows):
        for col_index, cell in enumerate(row):
            if _normalize_header(cell) == 'date':
                date_row_index = row_index
                date_col_index = col_index
                break
        if date_row_index is not None:
            break

    if date_row_index is None or date_col_index is None:
        logger.warning('BLD Menu parsing skipped: DATE row not found.')
        return stats

    for row_index in range(date_row_index + 1, len(rows)):
        probe = _safe_text(_cell_value(rows[row_index], date_col_index)).upper()
        if probe == 'DAY':
            day_row_index = row_index
            break

    if day_row_index is None:
        logger.warning('BLD Menu parsing skipped: DAY row not found.')
        return stats

    date_row = rows[date_row_index]
    parsed_dates = [_parse_date(value) for value in date_row[date_col_index + 1 :]]
    parsed_dates = [parsed_date for parsed_date in parsed_dates if parsed_date is not None]
    if not parsed_dates:
        logger.warning('BLD Menu parsing skipped: could not parse any menu dates.')
        return stats

    menu_rows: list[MessMenu] = []
    current_meal_section = ''
    meal_headers = {'BREAKFAST', 'LUNCH', 'DINNER', 'SNACKS', 'HIGH TEA', 'HI TEA'}

    for row_index in range(day_row_index + 1, len(rows)):
        row = rows[row_index]
        category = _safe_text(_cell_value(row, date_col_index))
        if not category:
            continue

        normalized_category = category.upper()
        if normalized_category in meal_headers:
            current_meal_section = normalized_category.title()
            continue

        effective_category = (
            f'{current_meal_section} - {category}' if current_meal_section else category
        )

        for column_index, menu_date in enumerate(parsed_dates):
            try:
                cell_index = date_col_index + 1 + column_index
                item_name = _safe_text(_cell_value(row, cell_index))
                if not menu_date or not item_name:
                    continue
                if item_name.lower() in {'nan', 'none'}:
                    continue

                menu_rows.append(
                    MessMenu(
                        batch=batch,
                        date=menu_date,
                        category=effective_category[:50],
                        item_name=item_name[:100],
                    )
                )
            except Exception:
                stats['errors'] += 1
                logger.exception('Error while parsing BLD Menu cell.')

    with transaction.atomic():
        menu_scope = MessMenu.objects.filter(batch=batch) if batch else MessMenu.objects.all()
        deleted_count, _ = menu_scope.filter(date__gte=timezone.localdate()).delete()
        if menu_rows:
            MessMenu.objects.bulk_create(menu_rows, batch_size=500)

    stats['deleted'] = deleted_count
    stats['created'] = len(menu_rows)
    return stats


def _normalize_row_item(item: dict[str, Any]) -> dict[str, Any]:
    normalized: dict[str, Any] = {}
    for key, value in item.items():
        normalized[_normalize_header(key)] = value
    return normalized


def _pick_first_value(item: dict[str, Any], candidates: tuple[str, ...]) -> Any:
    for key in candidates:
        if key in item:
            return item[key]
    return ''


def _parse_birthday_date(value: Any) -> date | None:
    return _parse_date(value)


def _normalize_student_name(value: Any) -> str:
    return re.sub(r'\s+', ' ', _safe_text(value).strip().lower())


def _birthday_sheet_to_rows(sheet_data: list[Any]) -> list[dict[str, Any]]:
    if not sheet_data:
        return []

    first_item = sheet_data[0]
    if isinstance(first_item, dict):
        return [row for row in sheet_data if isinstance(row, dict)]

    if not isinstance(first_item, (list, tuple)):
        return []

    header_index = _find_header_row_index(sheet_data)
    if header_index is None:
        header_index = 0

    header_row = sheet_data[header_index]
    if not isinstance(header_row, (list, tuple)):
        return []

    headers = _make_unique_headers([_normalize_header(value) for value in header_row])
    parsed_rows: list[dict[str, Any]] = []
    for row in sheet_data[header_index + 1 :]:
        if not isinstance(row, (list, tuple)):
            continue
        parsed_rows.append({header: _cell_value(row, idx) for idx, header in enumerate(headers)})
    return parsed_rows


def parse_birthdays(sheet_data: list[Any], *, batch: Batch | None = None) -> dict[str, int]:
    stats = {'updated': 0, 'skipped': 0, 'errors': 0}
    if not isinstance(sheet_data, list):
        return stats

    rows = _birthday_sheet_to_rows(sheet_data)
    if not rows:
        return stats

    student_scope = Student.objects.filter(batch=batch) if batch else Student.objects.all()
    students_by_roll = {
        student.roll_number.upper(): student
        for student in student_scope.only('roll_number', 'name', 'date_of_birth')
    }
    students_by_name: dict[str, list[Student]] = {}
    for student in students_by_roll.values():
        normalized_name = _normalize_student_name(student.name)
        if not normalized_name:
            continue
        students_by_name.setdefault(normalized_name, []).append(student)

    students_to_update: list[Student] = []
    already_marked: set[str] = set()

    roll_keys = (
        'roll no',
        'roll no.',
        'roll number',
        'roll no no',
        'roll_no',
        'roll_number',
        'rollnumber',
    )
    name_keys = ('name', 'student name', 'student')
    dob_keys = (
        'date format',
        'date of birth',
        'dob',
        'birth date',
        'birthday',
        'date_of_birth',
        'birthdate',
        'date',
    )

    for row in rows:
        try:
            normalized_row = _normalize_row_item(row)
            roll_number = _safe_text(_pick_first_value(normalized_row, roll_keys)).upper()
            student = None
            if roll_number and _looks_like_roll_number(roll_number):
                student = students_by_roll.get(roll_number)
            elif not roll_number:
                normalized_name = _normalize_student_name(_pick_first_value(normalized_row, name_keys))
                name_matches = students_by_name.get(normalized_name, [])
                if len(name_matches) == 1:
                    student = name_matches[0]

            if not student:
                stats['skipped'] += 1
                continue

            parsed_dob = _parse_birthday_date(_pick_first_value(normalized_row, dob_keys))
            if not parsed_dob:
                stats['skipped'] += 1
                continue

            student_key = student.roll_number.upper()
            if student.date_of_birth == parsed_dob or student_key in already_marked:
                continue

            student.date_of_birth = parsed_dob
            students_to_update.append(student)
            already_marked.add(student_key)
        except Exception:
            stats['errors'] += 1
            logger.exception('Error while parsing birthday row.')

    if students_to_update:
        Student.objects.bulk_update(students_to_update, ['date_of_birth'], batch_size=500)

    stats['updated'] = len(students_to_update)
    return stats


def _birthday_sheet_score(sheet_data: Any) -> tuple[int, int]:
    rows = _birthday_sheet_to_rows(sheet_data if isinstance(sheet_data, list) else [])
    if not rows:
        return (0, 0)

    first_row = _normalize_row_item(rows[0])
    keys = set(first_row.keys())

    score = 0
    if 'date format' in keys:
        score += 5
    if 'days to go' in keys:
        score += 4
    if keys & {'date of birth', 'dob', 'birthdate', 'birthday'}:
        score += 4
    if 'name' in keys and 'date' in keys:
        score += 2
    if keys & {'roll no', 'roll number', 'roll_no'}:
        score += 1

    # Exclude feedback/survey-like tabs that also contain name/date.
    if keys & {
        'meal breakfast lunch dinner snacks',
        'any specific item',
        'explain in detail',
        'messcom comments',
        'feedback',
    }:
        score -= 6

    return (score, len(rows))


def _find_birthday_sheet_data(payload: dict[str, list[Any]]) -> list[Any]:
    explicit_keys = (
        'Birthdays',
        'Birthday',
        'birthdays',
        'DOB',
        BIRTHDAY_SHEET_NAME,
        'Sheet1',
    )
    for key in explicit_keys:
        data = payload.get(key)
        if isinstance(data, list) and data and _birthday_sheet_score(data)[0] > 0:
            return data

    for sheet_name, sheet_data in payload.items():
        normalized_name = _normalize_header(sheet_name)
        if 'birth' in normalized_name or 'dob' in normalized_name:
            if isinstance(sheet_data, list):
                return sheet_data

    scored_candidates: list[tuple[tuple[int, int], list[Any]]] = []
    for sheet_data in payload.values():
        if not isinstance(sheet_data, list):
            continue
        score = _birthday_sheet_score(sheet_data)
        if score[0] > 0:
            scored_candidates.append((score, sheet_data))

    if scored_candidates:
        scored_candidates.sort(key=lambda item: item[0], reverse=True)
        return scored_candidates[0][1]

    return []


def _extract_sheet_mapping(
    raw_payload: Any,
    fallback_sheet_name: str | None = None,
) -> dict[str, list[list[Any]]]:
    if isinstance(raw_payload, dict):
        for wrapper_key in ('data', 'sheets', 'payload'):
            wrapped_value = raw_payload.get(wrapper_key)
            if isinstance(wrapped_value, dict):
                mapping = {
                    str(key): value
                    for key, value in wrapped_value.items()
                    if isinstance(value, list)
                }
                if mapping:
                    return mapping
            if isinstance(wrapped_value, list) and fallback_sheet_name:
                return {fallback_sheet_name: wrapped_value}

        mapping = {
            str(key): value
            for key, value in raw_payload.items()
            if isinstance(value, list)
        }
        if mapping:
            return mapping
        return {}

    if isinstance(raw_payload, list) and fallback_sheet_name:
        return {fallback_sheet_name: raw_payload}

    return {}


def _fetch_payload_from_url(
    url: str,
    *,
    params: dict[str, str] | None = None,
    fallback_sheet_name: str | None = None,
) -> dict[str, list[list[Any]]]:
    response = requests.get(url, params=params, timeout=60)
    response.raise_for_status()
    raw_payload = response.json()
    if isinstance(raw_payload, dict):
        error_value = raw_payload.get('error')
        if isinstance(error_value, str) and error_value.strip():
            raise ValueError(error_value.strip())
    return _extract_sheet_mapping(raw_payload, fallback_sheet_name=fallback_sheet_name)


def _fetch_payload_by_sheet_ids(
    term_settings: TermSettings | None,
) -> dict[str, list[list[Any]]]:
    base_url = settings.GAS_BRIDGE_BASE_URL or settings.GAS_BRIDGE_URL
    if not base_url:
        return {}

    timetable_sheet_id = extract_sheet_id(term_settings.timetable_sheet_url) if term_settings else ''
    if not timetable_sheet_id:
        timetable_sheet_id = extract_sheet_id(settings.TIMETABLE_SHEET_ID)

    attendance_sheet_id = extract_sheet_id(term_settings.attendance_sheet_url) if term_settings else ''
    if not attendance_sheet_id:
        attendance_sheet_id = extract_sheet_id(settings.ATTENDANCE_SHEET_ID)

    mess_menu_sheet_id = extract_sheet_id(term_settings.mess_menu_sheet_url) if term_settings else ''
    if not mess_menu_sheet_id:
        mess_menu_sheet_id = extract_sheet_id(settings.MESS_MENU_SHEET_ID)

    birthday_sheet_id = extract_sheet_id(term_settings.birthday_sheet_url) if term_settings else ''
    if not birthday_sheet_id:
        birthday_sheet_id = extract_sheet_id(settings.BIRTHDAY_SHEET_ID)

    sources = [
        (timetable_sheet_id, TIMETABLE_SHEET_NAME),
        (attendance_sheet_id, None),
        (mess_menu_sheet_id, MESS_MENU_SHEET_NAME),
        (birthday_sheet_id, BIRTHDAY_SHEET_NAME),
    ]
    if not any(spreadsheet_id for spreadsheet_id, _ in sources):
        raise ValueError('No sheet IDs configured for this batch.')

    merged_payload: dict[str, list[list[Any]]] = {}
    source_errors: list[str] = []

    for spreadsheet_id, fallback_sheet_name in sources:
        if not spreadsheet_id:
            continue

        fetched_for_source: dict[str, list[list[Any]]] = {}
        attempt_errors: list[str] = []

        for param_name in SHEET_PARAM_CANDIDATES:
            try:
                candidate_payload = _fetch_payload_from_url(
                    base_url,
                    params={param_name: spreadsheet_id},
                    fallback_sheet_name=fallback_sheet_name,
                )
                if candidate_payload:
                    fetched_for_source = candidate_payload
                    break
                attempt_errors.append(f'{param_name}: empty payload')
            except Exception as exc:
                attempt_errors.append(f'{param_name}: {exc}')

        if fetched_for_source:
            merged_payload.update(fetched_for_source)
        else:
            source_errors.append(
                f'Failed to fetch spreadsheet "{spreadsheet_id}": '
                + '; '.join(attempt_errors)
            )

    if merged_payload:
        return merged_payload

    if source_errors:
        raise ValueError(' | '.join(source_errors))

    return {}


def _fetch_google_payload(term_settings: TermSettings | None = None) -> dict[str, list[list[Any]]]:
    if term_settings is not None:
        return _fetch_payload_by_sheet_ids(term_settings)

    errors: list[str] = []

    if settings.GAS_BRIDGE_URL:
        try:
            payload = _fetch_payload_from_url(settings.GAS_BRIDGE_URL)
            if payload:
                return payload
            errors.append('direct_url: empty payload')
        except Exception as exc:
            errors.append(f'direct_url: {exc}')

    settings_obj = term_settings or TermSettings.objects.order_by('-updated_at').first()
    has_sheet_ids = bool(extract_sheet_id(settings_obj.timetable_sheet_url) if settings_obj else '')
    has_sheet_ids = has_sheet_ids or bool(
        extract_sheet_id(settings_obj.attendance_sheet_url) if settings_obj else ''
    )
    has_sheet_ids = has_sheet_ids or bool(
        extract_sheet_id(settings_obj.mess_menu_sheet_url) if settings_obj else ''
    )
    has_sheet_ids = has_sheet_ids or bool(
        extract_sheet_id(settings_obj.birthday_sheet_url) if settings_obj else ''
    )
    has_sheet_ids = has_sheet_ids or bool(
        extract_sheet_id(settings.TIMETABLE_SHEET_ID)
        or extract_sheet_id(settings.ATTENDANCE_SHEET_ID)
        or extract_sheet_id(settings.MESS_MENU_SHEET_ID)
        or extract_sheet_id(settings.BIRTHDAY_SHEET_ID)
    )
    if (settings.GAS_BRIDGE_BASE_URL or settings.GAS_BRIDGE_URL) and has_sheet_ids:
        try:
            payload = _fetch_payload_by_sheet_ids(settings_obj)
            if payload:
                return payload
            errors.append('sheet_id_fetch: empty payload')
        except Exception as exc:
            errors.append(f'sheet_id_fetch: {exc}')

    if errors:
        raise ValueError('; '.join(errors))

    raise ValueError('GAS bridge configuration is missing.')


def _initial_sync_stats() -> dict[str, Any]:
    return {
        'status': 'failed',
        'consolidated': {'sheet_found': 0, 'users_created': 0, 'users_updated': 0, 'skipped': 0, 'errors': 0},
        'timetable': {'created': 0, 'deleted': 0, 'skipped': 0, 'errors': 0},
        'attendance': {
            'sheets_processed': 0,
            'students_created': 0,
            'records_upserted': 0,
            'student_course_mappings_created': 0,
            'stale_records_removed': 0,
            'errors': 0,
        },
        'mess_menu': {'created': 0, 'deleted': 0, 'errors': 0},
        'birthdays': {'updated': 0, 'skipped': 0, 'errors': 0},
        'errors': [],
    }


def _merge_stat_bucket(aggregate: dict[str, Any], section: str, stats: dict[str, Any]) -> None:
    bucket = aggregate.get(section)
    if not isinstance(bucket, dict):
        aggregate[section] = dict(stats)
        return

    for key, value in stats.items():
        if isinstance(value, (int, float)):
            bucket[key] = bucket.get(key, 0) + value
        else:
            bucket[key] = value


@shared_task(name='academic_core.sync_google_sheets_data')
def sync_google_sheets_data(batch_code: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = _initial_sync_stats()
    result['batches'] = {}

    term_settings_qs = TermSettings.objects.select_related('batch').order_by('batch__code')
    if batch_code:
        term_settings_qs = term_settings_qs.filter(batch__code=batch_code)
    else:
        term_settings_qs = term_settings_qs.filter(batch__is_active=True)
    term_settings_list = list(term_settings_qs)

    if not term_settings_list:
        try:
            payload = _fetch_google_payload()
        except Exception as exc:
            logger.exception('Failed to fetch data from GAS bridge.')
            result['errors'].append(f'fetch_failed: {exc}')
            return result
        term_settings_list = []
        fallback_batch = Batch.objects.filter(is_active=True).order_by('code').first()
        result['batches']['default'] = _sync_payload_for_batch(payload, fallback_batch)
        for section in ('consolidated', 'timetable', 'attendance', 'mess_menu', 'birthdays'):
            _merge_stat_bucket(result, section, result['batches']['default'].get(section, {}))
        result['errors'].extend(result['batches']['default'].get('errors', []))
        result['status'] = 'completed_with_errors' if result['errors'] else 'completed'
        return result

    for settings_obj in term_settings_list:
        batch = settings_obj.batch
        batch_key = batch.code if batch else 'default'
        try:
            payload = _fetch_google_payload(settings_obj)
        except Exception as exc:
            logger.exception('Failed to fetch data from GAS bridge for batch %s.', batch_key)
            batch_result = _initial_sync_stats()
            batch_result['errors'].append(f'fetch_failed: {exc}')
            result['batches'][batch_key] = batch_result
            result['errors'].append(f'[{batch_key}] fetch_failed: {exc}')
            continue

        batch_result = _sync_payload_for_batch(payload, batch)
        result['batches'][batch_key] = batch_result
        for section in ('consolidated', 'timetable', 'attendance', 'mess_menu', 'birthdays'):
            _merge_stat_bucket(result, section, batch_result.get(section, {}))
        result['errors'].extend([f'[{batch_key}] {error}' for error in batch_result.get('errors', [])])

    result['status'] = 'completed_with_errors' if result['errors'] else 'completed'
    return result


def _sync_payload_for_batch(payload: dict[str, list[list[Any]]], batch: Batch | None) -> dict[str, Any]:
    batch_result: dict[str, Any] = _initial_sync_stats()

    try:
        batch_result['consolidated'] = parse_consolidated_attendance_sheet(payload, batch=batch)
    except Exception as exc:
        logger.exception('parse_consolidated_attendance_sheet failed.')
        batch_result['errors'].append(f'parse_consolidated_failed: {exc}')

    try:
        timetable_raw = (
            payload.get('Time table')
            or payload.get('Timetable')
            or payload.get('time table')
            or []
        )
        first_item = timetable_raw[0] if timetable_raw else None
        if isinstance(first_item, (list, tuple)):
            timetable_payload = _preprocess_timetable_rows(timetable_raw)
        else:
            timetable_payload = timetable_raw
        batch_result['timetable'] = parse_timetable(timetable_payload, batch=batch)
    except Exception as exc:
        logger.exception('parse_timetable failed.')
        batch_result['errors'].append(f'parse_timetable_failed: {exc}')

    try:
        batch_result['attendance'] = parse_attendance(payload, batch=batch)
    except Exception as exc:
        logger.exception('parse_attendance failed.')
        batch_result['errors'].append(f'parse_attendance_failed: {exc}')

    try:
        mess_menu_payload = (
            payload.get('BLD Menu')
            or payload.get('Mess Menu')
            or payload.get('BLD menu')
            or []
        )
        batch_result['mess_menu'] = parse_mess_menu(mess_menu_payload, batch=batch)
    except Exception as exc:
        logger.exception('parse_mess_menu failed.')
        batch_result['errors'].append(f'parse_mess_menu_failed: {exc}')

    try:
        birthday_payload = _find_birthday_sheet_data(payload)
        batch_result['birthdays'] = parse_birthdays(birthday_payload, batch=batch)
    except Exception as exc:
        logger.exception('parse_birthdays failed.')
        batch_result['errors'].append(f'parse_birthdays_failed: {exc}')

    batch_result['status'] = 'completed_with_errors' if batch_result['errors'] else 'completed'
    return batch_result
