import datetime
import json
import logging
import os
import re
import secrets
import threading
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

import requests
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.db.models import Max, Prefetch, Q, Sum
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime, parse_time
from django.views.decorators.cache import cache_page
from django.views.decorators.vary import vary_on_headers
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from academic_core.models import (
    Announcement,
    Assignment,
    AttendanceRecord,
    AttendanceWaiverRequest,
    Batch,
    BlinkitPool,
    CabPool,
    ClassSession,
    Course,
    CourseMaterial,
    GradeDocument,
    MessMenu,
    Poll,
    PollOption,
    PollVote,
    PeerTransaction,
    SellPost,
    Student,
    StudentCourse,
    TermSettings,
)
from academic_core.bus_schedule import build_bus_schedule_payload
from academic_core.serializers import (
    AnnouncementSerializer,
    AssignmentSerializer,
    AttendanceSerializer,
    AttendanceWaiverRequestSerializer,
    BatchSerializer,
    BlinkitPoolSerializer,
    CabPoolSerializer,
    ClassSessionSerializer,
    CourseMaterialSerializer,
    CourseSerializer,
    GradeDocumentSerializer,
    MessMenuSerializer,
    PollSerializer,
    PeerTransactionSerializer,
    SellPostSerializer,
    StudentSerializer,
    TermSettingsSerializer,
)
from academic_core.tasks import sync_google_sheets_data
from academic_core.utils import format_batch_name, infer_batch_code_from_roll_number

logger = logging.getLogger(__name__)

LOCAL_TIMEZONE = ZoneInfo('Asia/Kolkata')
DEFAULT_BATCH_CODE = str(max(2000, timezone.now().astimezone(LOCAL_TIMEZONE).year - 3))
UPI_ID_PATTERN = re.compile(r'^[a-z0-9.\-_]{2,}@[a-z0-9.\-_]{2,}$')


def _parse_optional_datetime(value: object) -> datetime.datetime | None:
    if value in (None, ''):
        return None
    parsed = parse_datetime(str(value))
    if parsed is None:
        return None
    if timezone.is_naive(parsed):
        return timezone.make_aware(parsed, LOCAL_TIMEZONE)
    return parsed


def _parse_bool(value: object, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {'1', 'true', 'yes', 'on'}:
        return True
    if text in {'0', 'false', 'no', 'off'}:
        return False
    return default


def _normalize_upi_id(value: object) -> tuple[str | None, str | None]:
    text = str(value or '').strip().lower()
    if not text:
        return None, None
    if not UPI_ID_PATTERN.fullmatch(text):
        return None, 'Invalid UPI ID format.'
    return text, None


def _parse_sort_order(value: object, default: int = 0) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(0, parsed)


def _normalize_batch_code(value: object) -> str:
    text = str(value or '').strip().upper()
    if not text:
        return ''
    inferred_year = infer_batch_code_from_roll_number(text)
    if inferred_year:
        return inferred_year
    return text


def _get_or_create_batch(batch_code: str | None = None) -> Batch:
    code = _normalize_batch_code(batch_code) or DEFAULT_BATCH_CODE
    batch, _ = Batch.objects.get_or_create(
        code=code,
        defaults={'name': format_batch_name(code), 'is_active': True},
    )
    return batch


def _preferred_batch_code() -> str:
    return _normalize_batch_code(
        getattr(settings, 'ONLY_BATCH_CODE', '') or getattr(settings, 'DEFAULT_BATCH_CODE', '')
    )


def _allowed_batches():
    qs = Batch.objects.filter(is_active=True)
    only_code = _normalize_batch_code(getattr(settings, 'ONLY_BATCH_CODE', ''))
    if only_code:
        return qs.filter(code=only_code)
    return qs


def _batch_from_request(request, *, required: bool = False) -> tuple[Batch | None, Response | None]:
    batch_code = (
        request.query_params.get('batch_code')
        or request.data.get('batch_code')
        or request.headers.get('X-Batch-Code')
    )
    normalized_code = _normalize_batch_code(batch_code)
    preferred_code = _preferred_batch_code()

    if preferred_code:
        if normalized_code and normalized_code != preferred_code:
            return (
                None,
                Response(
                    {'detail': f'Only batch_code {preferred_code} is allowed.'},
                    status=status.HTTP_400_BAD_REQUEST,
                ),
            )
        if not normalized_code:
            return _get_or_create_batch(preferred_code), None

    if not normalized_code:
        roll_hint = (
            request.headers.get('X-Student-Roll-Number')
            or request.data.get('roll_number')
            or request.query_params.get('roll_number')
        )
        inferred_code = infer_batch_code_from_roll_number(str(roll_hint or ''))
        if inferred_code:
            return _get_or_create_batch(inferred_code), None

        if required:
            return (
                None,
                Response({'detail': 'batch_code is required.'}, status=status.HTTP_400_BAD_REQUEST),
            )
        active_batches = _allowed_batches()
        batch = (
            active_batches.filter(code__regex=r'^20\d{2}$').order_by('code').first()
            or active_batches.order_by('code').first()
            or _get_or_create_batch()
        )
        return batch, None

    batch = Batch.objects.filter(code=normalized_code).first()
    if not batch:
        if (
            (normalized_code.isdigit() and len(normalized_code) == 4)
            or re.fullmatch(r'IPM0?[1-9]', normalized_code)
        ):
            return _get_or_create_batch(normalized_code), None
        return (
            None,
            Response({'detail': f'Unknown batch_code: {normalized_code}'}, status=status.HTTP_400_BAD_REQUEST),
        )
    return batch, None


def _admin_token_from_request(request) -> Token | None:
    auth_header = str(request.headers.get('Authorization', ''))
    prefix, _, token_key = auth_header.partition(' ')
    if prefix.lower() != 'token' or not token_key.strip():
        return None

    token = Token.objects.select_related('user').filter(key=token_key.strip()).first()
    if token is None:
        return None
    if not token.user.is_active or not token.user.is_staff:
        return None
    return token


def _invalidate_cached_dashboard_payloads() -> None:
    try:
        cache.clear()
    except Exception:
        logger.exception('Failed to invalidate dashboard caches after content update.')


def _require_admin(request) -> tuple[object | None, Token | None, Response | None]:
    token = _admin_token_from_request(request)
    if token is None:
        return (
            None,
            None,
            Response(
                {'detail': 'Admin authentication required.'},
                status=status.HTTP_401_UNAUTHORIZED,
            ),
        )
    return token.user, token, None


def _require_ipmo_admin(request) -> tuple[object | None, Token | None, Response | None]:
    admin_user, token, error_response = _require_admin(request)
    if error_response:
        return None, None, error_response

    if not admin_user.is_superuser:
        return (
            None,
            None,
            Response(
                {'detail': 'IPMO permission required.'},
                status=status.HTTP_403_FORBIDDEN,
            ),
        )

    return admin_user, token, None


def _serialize_admin_account(user: User) -> dict[str, object]:
    return {
        'id': user.id,
        'username': user.username,
        'name': user.get_full_name().strip(),
        'is_active': user.is_active,
        'role': 'IPMO' if user.is_superuser else 'CR',
        'last_login': user.last_login,
        'created_at': user.date_joined,
    }


def _extract_json_payload(text: str) -> object | None:
    cleaned = text.strip()
    if not cleaned:
        return None
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    object_match = re.search(r'\{[\s\S]*\}', cleaned)
    if object_match:
        try:
            return json.loads(object_match.group(0))
        except json.JSONDecodeError:
            pass

    array_match = re.search(r'\[[\s\S]*\]', cleaned)
    if array_match:
        try:
            return json.loads(array_match.group(0))
        except json.JSONDecodeError:
            pass

    return None


def _chat_completion(system_prompt: str, user_prompt: str) -> str:
    api_key = os.getenv('OPENAI_API_KEY', '').strip()
    if not api_key:
        return ''

    model = os.getenv('OPENAI_MODEL', 'gpt-4o-mini').strip() or 'gpt-4o-mini'
    response = requests.post(
        'https://api.openai.com/v1/chat/completions',
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
        },
        json={
            'model': model,
            'temperature': 0.4,
            'messages': [
                {'role': 'system', 'content': system_prompt},
                {'role': 'user', 'content': user_prompt},
            ],
        },
        timeout=60,
    )
    response.raise_for_status()
    payload = response.json()
    choices = payload.get('choices') or []
    if not choices:
        return ''

    content = choices[0].get('message', {}).get('content', '')
    if isinstance(content, list):
        text_chunks: list[str] = []
        for item in content:
            if isinstance(item, dict):
                text_chunks.append(str(item.get('text', '')))
            else:
                text_chunks.append(str(item))
        return ''.join(text_chunks).strip()
    return str(content).strip()


def _fallback_announcement(prompt: str) -> dict[str, str]:
    normalized = ' '.join(prompt.split())
    title = normalized[:90] or 'Important Announcement'
    content = (
        f'{normalized}\n\n'
        'Please review the details and complete the required action within the stated timeline.'
    ).strip()
    return {'title': title, 'content': content}


def _generate_announcement_draft(prompt: str) -> dict[str, str]:
    fallback = _fallback_announcement(prompt)
    if not os.getenv('OPENAI_API_KEY'):
        return fallback

    try:
        raw_text = _chat_completion(
            (
                'You are an academic office assistant. Return only strict JSON '
                'with keys "title" and "content". Keep title under 90 chars, '
                'content concise, formal, and student-friendly.'
            ),
            prompt,
        )
    except Exception:
        return fallback

    parsed = _extract_json_payload(raw_text)
    if not isinstance(parsed, dict):
        return fallback

    title = str(parsed.get('title', '')).strip() or fallback['title']
    content = str(parsed.get('content', '')).strip() or fallback['content']
    return {'title': title[:200], 'content': content}


def _reorder_materials_with_ai(materials: list[CourseMaterial]) -> list[int]:
    if not materials:
        return []

    material_payload = [
        {
            'id': material.id,
            'title': material.title,
            'description': material.description,
            'has_link': bool(material.drive_link),
            'has_file': bool(material.file),
        }
        for material in materials
    ]

    if not os.getenv('OPENAI_API_KEY'):
        return [item['id'] for item in sorted(material_payload, key=lambda entry: entry['title'].lower())]

    try:
        raw_text = _chat_completion(
            (
                'Reorder course materials for a student portal. Return only strict JSON as '
                '{"ordered_ids":[...]} from foundational to advanced flow.'
            ),
            json.dumps(material_payload),
        )
    except Exception:
        return [material.id for material in materials]

    parsed = _extract_json_payload(raw_text)
    if not isinstance(parsed, dict):
        return [material.id for material in materials]

    proposed_ids = parsed.get('ordered_ids')
    if not isinstance(proposed_ids, list):
        return [material.id for material in materials]

    valid_ids = {material.id for material in materials}
    cleaned_ids = [int(item) for item in proposed_ids if isinstance(item, (int, str)) and str(item).isdigit()]
    ordered_unique: list[int] = []
    for item in cleaned_ids:
        if item in valid_ids and item not in ordered_unique:
            ordered_unique.append(item)

    for material in materials:
        if material.id not in ordered_unique:
            ordered_unique.append(material.id)
    return ordered_unique


def _normalize_gemini_model_name(model_name: str) -> str:
    normalized = str(model_name or '').strip()
    if not normalized:
        return ''
    if normalized.startswith('models/'):
        return normalized.split('/', 1)[1].strip()
    return normalized


def _list_gemini_generate_content_models(genai_module) -> list[str]:
    names: list[str] = []
    try:
        for model in genai_module.list_models():
            methods = getattr(model, 'supported_generation_methods', None) or []
            normalized_methods = {str(method).replace('_', '').lower() for method in methods}
            if 'generatecontent' in normalized_methods:
                name = str(getattr(model, 'name', '')).strip()
                if name:
                    names.append(name)
    except Exception as exc:
        logger.warning('Unable to list Gemini models for this API key: %s', exc)
    return names


def _pick_gemini_model_name(preferred_model: str, available_model_names: list[str]) -> str:
    preferred = _normalize_gemini_model_name(preferred_model)
    model_map: dict[str, str] = {}
    for model_name in available_model_names:
        short_name = _normalize_gemini_model_name(model_name)
        if short_name and short_name not in model_map:
            model_map[short_name] = model_name

    for candidate in [
        preferred,
        'gemini-1.5-flash',
        'gemini-1.5-flash-latest',
        'gemini-2.0-flash',
        'gemini-2.5-flash',
        'gemini-1.5-pro',
    ]:
        if candidate and candidate in model_map:
            return model_map[candidate]

    flash_match = next((name for short_name, name in model_map.items() if 'flash' in short_name), '')
    if flash_match:
        return flash_match

    if model_map:
        return next(iter(model_map.values()))

    return preferred_model or 'gemini-1.5-flash'


def _is_gemini_quota_error(error_text: str) -> bool:
    normalized = str(error_text or '').lower()
    if not normalized:
        return False
    return (
        'quota exceeded' in normalized
        or 'resource_exhausted' in normalized
        or 'rate limit' in normalized
        or ('429' in normalized and 'gemini' in normalized)
    )


def _generate_gemini_draft(prompt: str) -> str:
    api_key = (
        os.getenv('GEMINI_API_KEY', '').strip()
        or os.getenv('GOOGLE_API_KEY', '').strip()
        or os.getenv('GEMENI_API_KEY', '').strip()
    )
    if not api_key:
        raise ValueError('GEMINI_API_KEY is not configured.')

    try:
        import google.generativeai as genai
    except Exception as exc:
        raise RuntimeError('google-generativeai is not installed.') from exc

    configured_model = os.getenv('GEMINI_MODEL', 'gemini-1.5-flash').strip() or 'gemini-1.5-flash'
    genai.configure(api_key=api_key)
    available_models = _list_gemini_generate_content_models(genai)
    model_name = _pick_gemini_model_name(configured_model, available_models)
    prompt_text = (
        'Write a professionally formatted, polite, and clear announcement draft for students. '
        'Do not add markdown headings. Keep it concise but complete.\n\n'
        f'Request:\n{prompt.strip()}'
    )

    try:
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(prompt_text)
    except Exception as exc:
        error_text = str(exc).lower()
        model_not_found = 'not found' in error_text or 'not supported for generatecontent' in error_text
        if not model_not_found:
            raise

        fallback_model = _pick_gemini_model_name('gemini-1.5-flash', available_models)
        if _normalize_gemini_model_name(fallback_model) == _normalize_gemini_model_name(model_name):
            raise

        logger.warning(
            'Configured Gemini model "%s" failed; retrying with "%s".',
            model_name,
            fallback_model,
        )
        model = genai.GenerativeModel(fallback_model)
        response = model.generate_content(prompt_text)

    text = str(getattr(response, 'text', '') or '').strip()
    if text:
        return text
    raise RuntimeError('Gemini returned an empty draft.')


def _generate_gemini_announcement_payload(prompt: str) -> dict[str, str]:
    api_key = (
        os.getenv('GEMINI_API_KEY', '').strip()
        or os.getenv('GOOGLE_API_KEY', '').strip()
        or os.getenv('GEMENI_API_KEY', '').strip()
    )
    if not api_key:
        raise ValueError('GEMINI_API_KEY is not configured.')

    try:
        import google.generativeai as genai
    except Exception as exc:
        raise RuntimeError('google-generativeai is not installed.') from exc

    configured_model = os.getenv('GEMINI_MODEL', 'gemini-1.5-flash').strip() or 'gemini-1.5-flash'
    genai.configure(api_key=api_key)
    available_models = _list_gemini_generate_content_models(genai)
    model_name = _pick_gemini_model_name(configured_model, available_models)
    prompt_text = (
        'You are drafting a student-portal announcement.\n'
        'Return ONLY strict JSON with keys: "title" and "content".\n'
        '- title: concise and actionable, max 120 chars.\n'
        '- content: polished, clear, and ready to publish.\n'
        '- do not include markdown.\n\n'
        f'Request:\n{prompt.strip()}'
    )

    try:
        model = genai.GenerativeModel(model_name)
        response = model.generate_content(prompt_text)
    except Exception as exc:
        error_text = str(exc).lower()
        model_not_found = 'not found' in error_text or 'not supported for generatecontent' in error_text
        if not model_not_found:
            raise

        fallback_model = _pick_gemini_model_name('gemini-1.5-flash', available_models)
        if _normalize_gemini_model_name(fallback_model) == _normalize_gemini_model_name(model_name):
            raise
        model = genai.GenerativeModel(fallback_model)
        response = model.generate_content(prompt_text)

    text = str(getattr(response, 'text', '') or '').strip()
    parsed = _extract_json_payload(text)
    if not isinstance(parsed, dict):
        raise RuntimeError('Gemini did not return valid JSON title/content.')

    title = str(parsed.get('title', '')).strip()
    content = str(parsed.get('content', '')).strip()
    if not title or not content:
        raise RuntimeError('Gemini response missing title/content.')
    return {
        'title': title[:200],
        'content': content,
    }


def _parse_iso_date(value: object) -> datetime.date | None:
    text = str(value or '').strip()
    if not text:
        return None
    try:
        return datetime.date.fromisoformat(text)
    except ValueError:
        return None


def _resolve_assignment_deadline(request) -> tuple[datetime.date | None, datetime.time | None, Response | None]:
    due_at_raw = str(request.data.get('due_at', '')).strip()
    if due_at_raw:
        due_at = _parse_optional_datetime(due_at_raw)
        if due_at is None:
            return (
                None,
                None,
                Response(
                    {'detail': 'Invalid due_at format. Use ISO datetime.'},
                    status=status.HTTP_400_BAD_REQUEST,
                ),
            )
        localized_due = due_at.astimezone(LOCAL_TIMEZONE)
        due_time = localized_due.time().replace(second=0, microsecond=0)
        return localized_due.date(), due_time, None

    due_date = _parse_iso_date(request.data.get('due_date'))
    if due_date is None:
        return (
            None,
            None,
            Response(
                {'detail': 'due_date is required and must be YYYY-MM-DD.'},
                status=status.HTTP_400_BAD_REQUEST,
            ),
        )

    due_time_raw = str(request.data.get('due_time', '')).strip()
    if not due_time_raw:
        return due_date, None, None

    due_time = parse_time(due_time_raw)
    if due_time is None:
        return (
            None,
            None,
            Response(
                {'detail': 'Invalid due_time format. Use HH:MM.'},
                status=status.HTTP_400_BAD_REQUEST,
            ),
        )
    due_time = due_time.replace(second=0, microsecond=0)
    return due_date, due_time, None


def _resolve_announcement_target(request) -> tuple[str, Course | None, Response | None]:
    target_type = str(request.data.get('target_type', 'ALL')).strip().upper() or 'ALL'
    valid_types = {'ALL', 'SECTION_A', 'SECTION_B', 'COURSE'}
    if target_type not in valid_types:
        return (
            '',
            None,
            Response(
                {'detail': f'Invalid target_type. Choose one of: {", ".join(sorted(valid_types))}.'},
                status=status.HTTP_400_BAD_REQUEST,
            ),
        )

    target_course = None
    if target_type == 'COURSE':
        target_course_code = str(request.data.get('target_course_code', '')).strip().upper()
        if not target_course_code:
            return (
                '',
                None,
                Response(
                    {'detail': 'target_course_code is required when target_type is COURSE.'},
                    status=status.HTTP_400_BAD_REQUEST,
                ),
            )
        target_course = Course.objects.filter(code=target_course_code).first()
        if target_course is None:
            return (
                '',
                None,
                Response(
                    {'detail': f'Unknown target_course_code: {target_course_code}.'},
                    status=status.HTTP_400_BAD_REQUEST,
                ),
            )

    return target_type, target_course, None


def _poll_visible_for_student(poll: Poll, student: Student, enrolled_course_ids: set[str]) -> bool:
    if poll.target_type == 'ALL':
        return True
    if poll.target_type == 'SECTION_A':
        return student.section == 'A'
    if poll.target_type == 'SECTION_B':
        return student.section == 'B'
    if poll.target_type == 'COURSE':
        return bool(poll.target_course_id and poll.target_course_id in enrolled_course_ids)
    return False


def _announcement_visible_for_student(
    announcement: Announcement,
    student: Student | None,
    enrolled_course_ids: set[str],
) -> bool:
    target_type = str(getattr(announcement, 'target_type', '') or 'ALL').upper()
    if target_type == 'ALL':
        return True
    if student is None:
        return False
    if target_type == 'SECTION_A':
        return student.section == 'A'
    if target_type == 'SECTION_B':
        return student.section == 'B'
    if target_type == 'COURSE':
        return bool(announcement.target_course_id and announcement.target_course_id in enrolled_course_ids)
    return False


def _serialize_poll_for_student(poll: Poll, student: Student) -> dict[str, object]:
    # Use prefetched vote/option data when available to avoid per-poll DB queries.
    votes = list(poll.votes.all())
    student_vote = next((vote for vote in votes if vote.student_id == student.roll_number), None)

    vote_counts: dict[int, int] = {}
    for vote in votes:
        vote_counts[vote.option_id] = vote_counts.get(vote.option_id, 0) + 1
    total_votes = sum(vote_counts.values())

    options_payload: list[dict[str, object]] = []
    for option in sorted(poll.options.all(), key=lambda item: item.id):
        count = vote_counts.get(option.id, 0)
        percentage = round((count / total_votes) * 100, 1) if total_votes else 0.0
        options_payload.append(
            {
                'id': option.id,
                'text': option.text,
                'vote_count': count if student_vote else None,
                'percentage': percentage if student_vote else None,
            }
        )

    return {
        'id': poll.id,
        'title': poll.title,
        'description': poll.description,
        'target_type': poll.target_type,
        'target_course': (
            {
                'code': poll.target_course.code,
                'name': poll.target_course.name,
            }
            if poll.target_course
            else None
        ),
        'created_by': poll.created_by,
        'created_at': poll.created_at,
        'expires_at': poll.expires_at,
        'has_voted': bool(student_vote),
        'student_vote_option_id': student_vote.option_id if student_vote else None,
        'total_votes': total_votes if student_vote else None,
        'options': options_payload,
    }


def _serialize_poll_for_admin(poll: Poll) -> dict[str, object]:
    votes = list(poll.votes.all())
    vote_counts: dict[int, int] = {}
    voters_by_option: dict[int, list[dict[str, object]]] = {}

    for vote in votes:
        vote_counts[vote.option_id] = vote_counts.get(vote.option_id, 0) + 1
        voters_by_option.setdefault(vote.option_id, []).append(
            {
                'roll_number': vote.student_id,
                'name': vote.student.name,
                'section': vote.student.section,
                'voted_at': vote.created_at,
            }
        )

    options_payload: list[dict[str, object]] = []
    for option in sorted(poll.options.all(), key=lambda item: item.id):
        voters = voters_by_option.get(option.id, [])
        options_payload.append(
            {
                'id': option.id,
                'text': option.text,
                'vote_count': vote_counts.get(option.id, 0),
                'voters': voters,
            }
        )

    return {
        'id': poll.id,
        'title': poll.title,
        'description': poll.description,
        'target_type': poll.target_type,
        'target_course': (
            {
                'code': poll.target_course.code,
                'name': poll.target_course.name,
            }
            if poll.target_course
            else None
        ),
        'created_by': poll.created_by,
        'created_at': poll.created_at,
        'expires_at': poll.expires_at,
        'options': options_payload,
        'total_votes': len(votes),
    }


def _enrolled_course_ids(student: Student) -> set[str]:
    # Combine both sources in a single query using union to reduce DB round-trips.
    attendance_qs = AttendanceRecord.objects.filter(student=student).values_list('course_id', flat=True)
    mapping_qs = StudentCourse.objects.filter(student=student).values_list('course_id', flat=True)
    return set(attendance_qs.union(mapping_qs))


def _student_is_mapped_to_course(student: Student, course: Course) -> bool:
    return AttendanceRecord.objects.filter(student=student, course=course).exists() or StudentCourse.objects.filter(
        student=student,
        course=course,
    ).exists()


def _student_from_request(request) -> tuple[Student | None, Response | None]:
    roll_number = str(
        request.headers.get('X-Student-Roll-Number')
        or request.data.get('roll_number')
        or request.query_params.get('roll_number')
        or ''
    ).strip().upper()

    if not roll_number:
        return (
            None,
            Response(
                {'detail': 'Student roll number is required in X-Student-Roll-Number header.'},
                status=status.HTTP_400_BAD_REQUEST,
            ),
        )

    student = Student.objects.filter(roll_number__iexact=roll_number).first()
    if student is None:
        return (
            None,
            Response(
                {'detail': 'Student not found for the provided roll number.'},
                status=status.HTTP_404_NOT_FOUND,
            ),
        )

    return student, None


def _ensure_post_owner(student: Student, creator: Student) -> Response | None:
    if student.roll_number != creator.roll_number:
        return Response(
            {'detail': 'Only the post creator can modify this post.'},
            status=status.HTTP_403_FORBIDDEN,
        )
    return None


@api_view(['GET', 'POST'])
def get_or_create_cab_pools(request) -> Response:
    if request.method == 'GET':
        today = timezone.now().astimezone(LOCAL_TIMEZONE).date()
        pools = (
            CabPool.objects.select_related('creator')
            .filter(is_active=True, departure_date__gte=today)
            .order_by('-created_at')
        )
        serializer = CabPoolSerializer(pools, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    student, error_response = _student_from_request(request)
    if error_response:
        return error_response

    serializer = CabPoolSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    available_seats = int(serializer.validated_data.get('available_seats') or 0)
    if available_seats <= 0:
        return Response(
            {'available_seats': ['Available seats must be greater than zero.']},
            status=status.HTTP_400_BAD_REQUEST,
        )

    pool = serializer.save(creator=student, is_active=True)
    response_serializer = CabPoolSerializer(pool)
    return Response(response_serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
def update_or_delete_cab_pool(request, pool_id: int) -> Response:
    student, error_response = _student_from_request(request)
    if error_response:
        return error_response

    pool = get_object_or_404(CabPool, id=pool_id)
    permission_error = _ensure_post_owner(student, pool.creator)
    if permission_error:
        return permission_error

    if request.method == 'DELETE':
        pool.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    action = str(request.data.get('action', '')).strip().lower()
    if action == 'fulfill' or request.data.get('is_active') is False:
        pool.is_active = False
        pool.save(update_fields=['is_active'])
    serializer = CabPoolSerializer(pool)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET', 'POST'])
def get_or_create_blinkit_pools(request) -> Response:
    if request.method == 'GET':
        pools = (
            BlinkitPool.objects.select_related('creator')
            .filter(is_active=True)
            .order_by('-created_at')
        )
        serializer = BlinkitPoolSerializer(pools, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    student, error_response = _student_from_request(request)
    if error_response:
        return error_response

    serializer = BlinkitPoolSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    pool = serializer.save(creator=student, is_active=True)
    response_serializer = BlinkitPoolSerializer(pool)
    return Response(response_serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
def update_or_delete_blinkit_pool(request, pool_id: int) -> Response:
    student, error_response = _student_from_request(request)
    if error_response:
        return error_response

    pool = get_object_or_404(BlinkitPool, id=pool_id)
    permission_error = _ensure_post_owner(student, pool.creator)
    if permission_error:
        return permission_error

    if request.method == 'DELETE':
        pool.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    action = str(request.data.get('action', '')).strip().lower()
    if action == 'fulfill' or request.data.get('is_active') is False:
        pool.is_active = False
        pool.save(update_fields=['is_active'])
    serializer = BlinkitPoolSerializer(pool)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET', 'POST'])
def get_or_create_sell_posts(request) -> Response:
    if request.method == 'GET':
        posts = (
            SellPost.objects.select_related('creator')
            .filter(is_active=True)
            .order_by('-created_at')
        )
        serializer = SellPostSerializer(posts, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    student, error_response = _student_from_request(request)
    if error_response:
        return error_response

    serializer = SellPostSerializer(data=request.data)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    post = serializer.save(creator=student, is_active=True)
    response_serializer = SellPostSerializer(post)
    return Response(response_serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
def update_or_delete_sell_post(request, post_id: int) -> Response:
    student, error_response = _student_from_request(request)
    if error_response:
        return error_response

    post = get_object_or_404(SellPost, id=post_id)
    permission_error = _ensure_post_owner(student, post.creator)
    if permission_error:
        return permission_error

    if request.method == 'DELETE':
        post.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    action = str(request.data.get('action', '')).strip().lower()
    if action == 'fulfill' or request.data.get('is_active') is False:
        post.is_active = False
        post.save(update_fields=['is_active'])
    serializer = SellPostSerializer(post)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['POST'])
def finance_split(request) -> Response:
    creditor, error_response = _student_from_request(request)
    if error_response:
        return error_response

    debtor_roll_number = str(
        request.data.get('debtor_roll_number') or request.data.get('debtor') or ''
    ).strip().upper()
    description = str(request.data.get('description', '')).strip()
    raw_amount = request.data.get('amount')

    if not debtor_roll_number:
        return Response(
            {'detail': 'debtor_roll_number is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not description:
        return Response(
            {'detail': 'description is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if len(description) < 3:
        return Response(
            {'detail': 'description must be at least 3 characters.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if raw_amount in (None, ''):
        return Response(
            {'detail': 'amount is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if debtor_roll_number == creditor.roll_number:
        return Response(
            {'detail': 'You cannot create a self-transaction.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    debtor = Student.objects.filter(roll_number=debtor_roll_number).first()
    if debtor is None:
        return Response(
            {'detail': 'Debtor student not found.'},
            status=status.HTTP_404_NOT_FOUND,
        )
    if creditor.batch_id and debtor.batch_id and creditor.batch_id != debtor.batch_id:
        return Response(
            {'detail': 'You can only split expenses with students in your batch.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    normalized_upi_id, upi_error = _normalize_upi_id(creditor.upi_id)
    if upi_error:
        return Response(
            {'detail': 'Please update a valid UPI ID in your profile before creating split requests.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if not normalized_upi_id:
        return Response(
            {'detail': 'Please add your UPI ID in profile before creating split requests.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        amount = Decimal(str(raw_amount))
    except (InvalidOperation, TypeError, ValueError):
        return Response(
            {'detail': 'Invalid amount.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if amount <= 0:
        return Response(
            {'detail': 'Amount must be greater than zero.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    transaction_obj = PeerTransaction.objects.create(
        creditor=creditor,
        debtor=debtor,
        amount=amount,
        description=description[:255],
    )
    serializer = PeerTransactionSerializer(
        transaction_obj,
        context={'request': request, 'current_student': creditor},
    )
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
def finance_students(request) -> Response:
    student, error_response = _student_from_request(request)
    if error_response:
        return error_response

    query = str(request.query_params.get('q', '')).strip()
    students = Student.objects.exclude(roll_number=student.roll_number)
    if student.batch_id:
        students = students.filter(batch_id=student.batch_id)
    if query:
        students = students.filter(
            Q(roll_number__icontains=query) | Q(name__icontains=query)
        )

    students = students.order_by('roll_number')[:80]
    payload = [
        {
            'roll_number': item.roll_number,
            'name': item.name,
            'section': item.section,
        }
        for item in students
    ]
    return Response(payload, status=status.HTTP_200_OK)


@api_view(['GET'])
def finance_dues(request) -> Response:
    student, error_response = _student_from_request(request)
    if error_response:
        return error_response

    dues = (
        PeerTransaction.objects.select_related('creditor', 'debtor')
        .filter(debtor=student, is_settled=False)
        .order_by('-created_at')
    )
    serializer = PeerTransactionSerializer(
        dues,
        many=True,
        context={'request': request, 'current_student': student},
    )
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['PATCH'])
def finance_settle(request, transaction_id: int) -> Response:
    student, error_response = _student_from_request(request)
    if error_response:
        return error_response

    transaction_obj = get_object_or_404(
        PeerTransaction.objects.select_related('creditor', 'debtor'),
        pk=transaction_id,
    )
    if transaction_obj.creditor_id != student.roll_number and transaction_obj.debtor_id != student.roll_number:
        return Response(
            {'detail': 'You are not allowed to update this transaction.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    action = str(request.data.get('action', '')).strip().lower()
    if not action:
        action = 'mark_paid' if transaction_obj.debtor_id == student.roll_number else 'confirm_received'

    if action in {'mark_paid', 'debtor_confirm', 'paid'}:
        if transaction_obj.debtor_id != student.roll_number:
            return Response(
                {'detail': 'Only the debtor can mark payment as done.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        transaction_obj.debtor_confirmed = True
    elif action in {'confirm_received', 'creditor_confirm', 'received'}:
        if transaction_obj.creditor_id != student.roll_number:
            return Response(
                {'detail': 'Only the creditor can confirm receipt.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        if not transaction_obj.debtor_confirmed:
            return Response(
                {'detail': 'Debtor must mark payment first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        transaction_obj.creditor_confirmed = True
    else:
        return Response(
            {'detail': 'Invalid action. Use mark_paid or confirm_received.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if transaction_obj.debtor_confirmed and transaction_obj.creditor_confirmed:
        transaction_obj.is_settled = True
        if transaction_obj.settled_at is None:
            transaction_obj.settled_at = timezone.now()

    update_fields = ['debtor_confirmed', 'creditor_confirmed', 'is_settled', 'settled_at']
    transaction_obj.save(update_fields=update_fields)

    serializer = PeerTransactionSerializer(
        transaction_obj,
        context={'request': request, 'current_student': student},
    )
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET'])
def finance_records(request) -> Response:
    student, error_response = _student_from_request(request)
    if error_response:
        return error_response

    all_records = (
        PeerTransaction.objects.select_related('creditor', 'debtor')
        .filter(Q(creditor=student) | Q(debtor=student))
        .order_by('-created_at')
    )
    you_owe_qs = all_records.filter(debtor=student, is_settled=False)
    owed_to_you_qs = all_records.filter(creditor=student, is_settled=False)

    total_you_owe = you_owe_qs.aggregate(total=Sum('amount')).get('total') or Decimal('0.00')
    total_owed_to_you = owed_to_you_qs.aggregate(total=Sum('amount')).get('total') or Decimal('0.00')

    context = {'request': request, 'current_student': student}
    payload = {
        'summary': {
            'total_you_owe': str(total_you_owe),
            'total_owed_to_you': str(total_owed_to_you),
            'pending_debtor_validation': you_owe_qs.filter(debtor_confirmed=False).count(),
            'pending_creditor_validation': owed_to_you_qs.filter(
                debtor_confirmed=True,
                creditor_confirmed=False,
            ).count(),
            'total_records': all_records.count(),
        },
        'you_owe': PeerTransactionSerializer(you_owe_qs, many=True, context=context).data,
        'owed_to_you': PeerTransactionSerializer(owed_to_you_qs, many=True, context=context).data,
        'history': PeerTransactionSerializer(all_records[:120], many=True, context=context).data,
    }
    return Response(payload, status=status.HTTP_200_OK)


@api_view(['GET'])
def finance_notifications(request) -> Response:
    student, error_response = _student_from_request(request)
    if error_response:
        return error_response

    count = PeerTransaction.objects.filter(is_settled=False).filter(
        Q(debtor=student, debtor_confirmed=False)
        | Q(creditor=student, debtor_confirmed=True, creditor_confirmed=False)
    ).count()
    return Response({'count': count}, status=status.HTTP_200_OK)


@cache_page(60 * 15)
@api_view(['GET'])
def get_student_attendance(request, roll_number: str) -> Response:
    student = get_object_or_404(Student, roll_number=roll_number)
    records = AttendanceRecord.objects.select_related('course').filter(
        student=student,
    )
    if student.batch_id:
        records = records.filter(batch_id=student.batch_id)
    serializer = AttendanceSerializer(records, many=True)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET', 'POST'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def get_or_create_attendance_waivers(request, roll_number: str) -> Response:
    student = get_object_or_404(Student, roll_number=roll_number)

    if request.method == 'GET':
        waivers = AttendanceWaiverRequest.objects.select_related('course').filter(student=student).order_by(
            '-submitted_at'
        )
        serializer = AttendanceWaiverRequestSerializer(
            waivers,
            many=True,
            context={'request': request},
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    course_code = str(request.data.get('course_code', '')).strip().upper()
    if not course_code:
        return Response(
            {'detail': 'course_code is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    course = get_object_or_404(Course, code=course_code)
    if not _student_is_mapped_to_course(student, course):
        return Response(
            {'detail': 'This course is not mapped to the selected student.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    supporting_file = request.FILES.get('supporting_file')
    if supporting_file is None:
        return Response(
            {'detail': 'supporting_file is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    waiver = AttendanceWaiverRequest.objects.create(
        student=student,
        course=course,
        reason=str(request.data.get('reason', '')).strip(),
        supporting_file=supporting_file,
    )
    serializer = AttendanceWaiverRequestSerializer(waiver, context={'request': request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
def get_bus_schedule(request) -> Response:
    try:
        payload = build_bus_schedule_payload()
    except Exception as exc:
        return Response(
            {'detail': f'Unable to load bus schedule right now: {exc}'},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )

    return Response(payload, status=status.HTTP_200_OK)


@api_view(['POST'])
def login_student(request) -> Response:
    roll_number = str(request.data.get('roll_number', '')).strip().upper()
    password = str(request.data.get('password', ''))

    if not roll_number or not password:
        return Response(
            {'detail': 'roll_number and password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    student = Student.objects.filter(roll_number=roll_number).first()
    if student is None:
        return Response({'detail': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

    if not student.batch_id:
        inferred_batch_code = infer_batch_code_from_roll_number(student.roll_number)
        if inferred_batch_code:
            student.batch = _get_or_create_batch(inferred_batch_code)
            student.save(update_fields=['batch'])

    if not student.password:
        student.set_password(f'IIM@{student.roll_number}')
        student.save(update_fields=['password'])

    if not student.check_password(password):
        return Response({'detail': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

    return Response(
        {
            'access': secrets.token_urlsafe(32),
            'refresh': secrets.token_urlsafe(48),
            'user': {
                'roll_number': student.roll_number,
                'batch_code': student.batch_id or '',
                'name': student.name,
                'section': student.section,
                'email': student.email,
                'is_ipmo': student.is_ipmo,
            },
        },
        status=status.HTTP_200_OK,
    )


@api_view(['POST'])
def login_admin(request) -> Response:
    username = str(request.data.get('username', '')).strip()
    password = str(request.data.get('password', ''))

    if not username or not password:
        return Response(
            {'detail': 'username and password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    user = authenticate(request=request, username=username, password=password)
    if user is None:
        fallback_user = User.objects.filter(username__iexact=username).first()
        if fallback_user and fallback_user.check_password(password):
            user = fallback_user
    if user is None or not user.is_active or not user.is_staff:
        return Response({'detail': 'Invalid admin credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

    token, _ = Token.objects.get_or_create(user=user)
    display_name = user.get_full_name().strip() or user.username
    role = 'IPMO' if user.is_superuser else 'CR'

    return Response(
        {
            'access': token.key,
            'user': {
                'username': user.username,
                'name': display_name,
                'role': role,
            },
        },
        status=status.HTTP_200_OK,
    )


@api_view(['POST'])
def logout_admin(request) -> Response:
    _, token, error_response = _require_admin(request)
    if error_response:
        return error_response
    token.delete()
    return Response({'detail': 'Logged out successfully.'}, status=status.HTTP_200_OK)


def _run_sync_background(batch_code: str | None) -> str:
    def _target() -> None:
        try:
            sync_google_sheets_data(batch_code=batch_code or None)
        except Exception:
            logger.exception('Background sync failed.')

    thread = threading.Thread(
        target=_target,
        daemon=True,
        name=f'ipm-sync-{batch_code or "all"}',
    )
    thread.start()
    return thread.name


@api_view(['POST'])
def admin_run_sync(request) -> Response:
    _, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    mode = str(request.data.get('mode', 'async')).strip().lower()
    batch_code = _normalize_batch_code(request.data.get('batch_code'))
    if mode not in {'async', 'sync'}:
        return Response(
            {'detail': 'Invalid mode. Use "async" or "sync".'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if mode == 'sync':
        thread_name = _run_sync_background(batch_code)
        return Response(
            {
                'status': 'queued',
                'mode': 'sync_background',
                'detail': 'Sync started in background.',
                'thread': thread_name,
            },
            status=status.HTTP_202_ACCEPTED,
        )

    try:
        task = sync_google_sheets_data.delay(batch_code=batch_code or None)
        return Response(
            {
                'status': 'queued',
                'mode': 'async',
                'task_id': task.id,
            },
            status=status.HTTP_202_ACCEPTED,
        )
    except Exception as exc:
        thread_name = _run_sync_background(batch_code)
        return Response(
            {
                'status': 'queued',
                'mode': 'async_background',
                'detail': f'Celery unavailable ({exc}); sync started in background.',
                'thread': thread_name,
            },
            status=status.HTTP_202_ACCEPTED,
        )


@cache_page(60 * 15)
@api_view(['GET'])
def get_student_timetable(request, roll_number: str) -> Response:
    student = get_object_or_404(Student, roll_number=roll_number)
    enrolled_course_ids = _enrolled_course_ids(student)

    sessions = ClassSession.objects.select_related('course')
    if student.batch_id:
        sessions = sessions.filter(batch_id=student.batch_id)
    if student.section == 'A':
        sessions = sessions.exclude(target_section='B')
    elif student.section == 'B':
        sessions = sessions.exclude(target_section='A')

    sessions = sessions.filter(
        Q(course_id__in=enrolled_course_ids)
        | Q(course__isnull=True)
        | Q(is_exam=True)
    ).order_by('date', 'start_time')

    serializer = ClassSessionSerializer(sessions, many=True)
    return Response(serializer.data, status=status.HTTP_200_OK)


@cache_page(60 * 15)
@vary_on_headers('X-Batch-Code')
@api_view(['GET'])
def get_mess_menu(request) -> Response:
    date_param = request.query_params.get('date')
    template_fallback = _parse_bool(request.query_params.get('template_fallback'), default=False)
    batch, batch_error = _batch_from_request(request)
    if batch_error:
        return batch_error
    target_date = timezone.now().astimezone(LOCAL_TIMEZONE).date()

    if date_param:
        try:
            target_date = datetime.date.fromisoformat(date_param)
        except ValueError:
            return Response(
                {'detail': 'Invalid date format. Use YYYY-MM-DD.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    menu_scope = MessMenu.objects.filter(batch=batch)
    menu_items = menu_scope.filter(date=target_date).order_by('category', 'item_name')
    if menu_items.exists():
        serializer = MessMenuSerializer(menu_items, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    if not template_fallback:
        return Response([], status=status.HTTP_200_OK)

    fallback_item = (
        menu_scope.filter(date__lte=target_date)
        .order_by('-date')
        .first()
        or menu_scope.order_by('-date').first()
    )
    if fallback_item is None:
        return Response([], status=status.HTTP_200_OK)

    template_items = menu_scope.filter(date=fallback_item.date).order_by('category', 'item_name')
    payload = [
        {
            'id': item.id,
            'date': target_date.isoformat(),
            'category': item.category,
            'item_name': item.item_name,
            'source_date': fallback_item.date.isoformat(),
        }
        for item in template_items
    ]
    return Response(payload, status=status.HTTP_200_OK)


@cache_page(60 * 2)
@vary_on_headers('X-Batch-Code', 'X-Student-Roll-Number')
@api_view(['GET'])
def get_dashboard_extras(request) -> Response:
    batch, batch_error = _batch_from_request(request)
    if batch_error:
        return batch_error

    student_roll = str(
        request.headers.get('X-Student-Roll-Number')
        or request.query_params.get('roll_number')
        or request.data.get('roll_number')
        or ''
    ).strip().upper()
    student = Student.objects.filter(roll_number__iexact=student_roll).first() if student_roll else None
    enrolled_course_ids = _enrolled_course_ids(student) if student else set()

    now = timezone.now()
    today = now.astimezone(LOCAL_TIMEZONE).date()

    birthdays_today = Student.objects.filter(
        batch=batch,
        date_of_birth__month=today.month,
        date_of_birth__day=today.day,
    ).order_by('name')
    recent_announcements = Announcement.objects.filter(
        Q(starts_at__isnull=True) | Q(starts_at__lte=now),
        Q(expires_at__isnull=True) | Q(expires_at__gte=now),
        Q(batch=batch) | Q(batch__isnull=True),
    ).select_related('target_course')
    announcement_visibility = Q(target_type='ALL')
    if student is not None:
        if student.section == 'A':
            announcement_visibility |= Q(target_type='SECTION_A')
        elif student.section == 'B':
            announcement_visibility |= Q(target_type='SECTION_B')
        if enrolled_course_ids:
            announcement_visibility |= Q(target_type='COURSE', target_course_id__in=enrolled_course_ids)
    recent_announcements = recent_announcements.filter(announcement_visibility).order_by('-created_at')[:3]
    current_time = now.astimezone(LOCAL_TIMEZONE).time().replace(second=0, microsecond=0)
    upcoming_assignments = Assignment.objects.select_related('course').filter(
        Q(batch=batch) | Q(batch__isnull=True),
    ).filter(
        Q(due_date__gt=today)
        | Q(due_date=today, due_time__isnull=True)
        | Q(due_date=today, due_time__gte=current_time)
    ).order_by('due_date', 'due_time', 'created_at')

    birthdays_payload = [
        {
            'roll_number': student.roll_number,
            'name': student.name,
            'section': student.section,
        }
        for student in birthdays_today
    ]

    return Response(
        {
            'birthdays_today': birthdays_payload,
            'recent_announcements': AnnouncementSerializer(
                recent_announcements,
                many=True,
                context={'request': request},
            ).data,
            'upcoming_assignments': AssignmentSerializer(upcoming_assignments, many=True).data,
        },
        status=status.HTTP_200_OK,
    )


@api_view(['GET'])
def get_student_readings(request, roll_number: str) -> Response:
    student = get_object_or_404(Student, roll_number=roll_number)
    enrolled_ids = sorted(_enrolled_course_ids(student))
    if not enrolled_ids:
        return Response([], status=status.HTTP_200_OK)

    courses = Course.objects.filter(code__in=enrolled_ids).order_by('code')
    material_qs = CourseMaterial.objects.select_related('course').filter(
        course_id__in=enrolled_ids,
        is_published=True,
    ).order_by('course_id', 'sort_order', 'id')

    materials_by_course: dict[str, list[CourseMaterial]] = {}
    for material in material_qs:
        materials_by_course.setdefault(material.course_id, []).append(material)

    payload = []
    for course in courses:
        payload.append(
            {
                **CourseSerializer(course).data,
                'materials': CourseMaterialSerializer(
                    materials_by_course.get(course.code, []),
                    many=True,
                    context={'request': request},
                ).data,
            }
        )

    return Response(payload, status=status.HTTP_200_OK)


@api_view(['GET', 'PATCH', 'PUT'])
def get_or_update_student_profile(request, roll_number: str) -> Response:
    student = get_object_or_404(Student, roll_number=roll_number)

    if request.method == 'GET':
        serializer = StudentSerializer(student)
        return Response(serializer.data, status=status.HTTP_200_OK)

    name = request.data.get('name', student.name)
    email = request.data.get('email', student.email)
    upi_id_value = request.data.get('upi_id', student.upi_id)
    date_of_birth_value = request.data.get('date_of_birth', student.date_of_birth)

    update_fields: list[str] = []

    if name is not None:
        normalized_name = str(name).strip()
        if not normalized_name:
            return Response(
                {'detail': 'Name cannot be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if student.name != normalized_name[:100]:
            student.name = normalized_name[:100]
            update_fields.append('name')

    if email is not None:
        normalized_email = str(email).strip().lower()
        if not normalized_email:
            return Response(
                {'detail': 'Email cannot be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            validate_email(normalized_email)
        except ValidationError:
            return Response(
                {'detail': 'Enter a valid email address.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        email_taken = Student.objects.exclude(pk=student.pk).filter(email=normalized_email).exists()
        if email_taken:
            return Response(
                {'detail': 'This email is already in use by another student.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if student.email != normalized_email:
            student.email = normalized_email
            update_fields.append('email')

    if 'date_of_birth' in request.data:
        parsed_dob = None
        if date_of_birth_value not in (None, ''):
            try:
                parsed_dob = datetime.date.fromisoformat(str(date_of_birth_value))
            except ValueError:
                return Response(
                    {'detail': 'Invalid date_of_birth format. Use YYYY-MM-DD.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        if student.date_of_birth != parsed_dob:
            student.date_of_birth = parsed_dob
            update_fields.append('date_of_birth')

    if 'upi_id' in request.data:
        normalized_upi_id, upi_error = _normalize_upi_id(upi_id_value)
        if upi_error:
            return Response(
                {'detail': upi_error},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if student.upi_id != normalized_upi_id:
            student.upi_id = normalized_upi_id
            update_fields.append('upi_id')

    if update_fields:
        student.save(update_fields=update_fields)

    serializer = StudentSerializer(student)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['POST'])
def change_student_password(request, roll_number: str) -> Response:
    student = get_object_or_404(Student, roll_number=roll_number)

    current_password = str(request.data.get('current_password', ''))
    new_password = str(request.data.get('new_password', ''))
    confirm_password = str(request.data.get('confirm_password', ''))

    if not current_password or not new_password:
        return Response(
            {'detail': 'current_password and new_password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not student.password:
        student.set_password(f'IIM@{student.roll_number}')
        student.save(update_fields=['password'])

    if not student.check_password(current_password):
        return Response(
            {'detail': 'Current password is incorrect.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(new_password) < 8:
        return Response(
            {'detail': 'New password must be at least 8 characters long.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if new_password == current_password:
        return Response(
            {'detail': 'New password must be different from current password.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if confirm_password and confirm_password != new_password:
        return Response(
            {'detail': 'confirm_password does not match new_password.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    student.set_password(new_password)
    student.save(update_fields=['password'])

    return Response(
        {'detail': 'Password changed successfully.'},
        status=status.HTTP_200_OK,
    )


@api_view(['GET', 'PUT'])
def admin_settings(request) -> Response:
    if request.method == 'GET':
        _, _, error_response = _require_admin(request)
    else:
        _, _, error_response = _require_ipmo_admin(request)
    if error_response:
        return error_response

    batch, batch_error = _batch_from_request(request, required=False)
    if batch_error:
        return batch_error

    settings_obj, _ = TermSettings.objects.get_or_create(
        batch=batch,
        defaults={
            'current_term_name': 'Term-IX',
            'timetable_sheet_url': '',
            'attendance_sheet_url': '',
            'mess_menu_sheet_url': '',
            'birthday_sheet_url': '',
        },
    )

    if request.method == 'GET':
        serializer = TermSettingsSerializer(settings_obj)
        payload = dict(serializer.data)
        payload['selected_batch_code'] = batch.code
        payload['batches'] = BatchSerializer(
            _allowed_batches().order_by('code'),
            many=True,
        ).data
        return Response(payload, status=status.HTTP_200_OK)

    serializer = TermSettingsSerializer(settings_obj, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()
    payload = dict(serializer.data)
    payload['selected_batch_code'] = batch.code
    payload['batches'] = BatchSerializer(
        _allowed_batches().order_by('code'),
        many=True,
    ).data
    return Response(payload, status=status.HTTP_200_OK)


@api_view(['GET', 'POST'])
def admin_students(request) -> Response:
    _, _, error_response = _require_ipmo_admin(request)
    if error_response:
        return error_response

    if request.method == 'GET':
        requested_batch_code = _normalize_batch_code(request.query_params.get('batch_code'))
        preferred_code = _preferred_batch_code()
        if preferred_code:
            requested_batch_code = requested_batch_code or preferred_code

        students = Student.objects.select_related('batch').order_by('roll_number')
        if requested_batch_code:
            students = students.filter(batch_id=requested_batch_code)

        serializer = StudentSerializer(students, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    batch, batch_error = _batch_from_request(request, required=False)
    if batch_error:
        return batch_error

    payload = dict(request.data)
    payload['batch_code'] = payload.get('batch_code') or batch.code
    serializer = StudentSerializer(data=payload)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    student = serializer.save()
    initial_password = str(request.data.get('password', '')).strip()
    if not initial_password:
        initial_password = f'IIM@{student.roll_number}'
    student.set_password(initial_password)
    student.save(update_fields=['password'])

    response_serializer = StudentSerializer(student)
    return Response(response_serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
def admin_student_detail(request, roll_number: str) -> Response:
    _, _, error_response = _require_ipmo_admin(request)
    if error_response:
        return error_response

    student_qs = Student.objects.filter(roll_number=roll_number.upper())
    batch_code = _normalize_batch_code(request.query_params.get('batch_code'))
    if batch_code:
        student_qs = student_qs.filter(batch_id=batch_code)
    student = get_object_or_404(student_qs)

    if request.method == 'GET':
        serializer = StudentSerializer(student)
        return Response(serializer.data, status=status.HTTP_200_OK)

    if request.method == 'DELETE':
        student.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    serializer = StudentSerializer(student, data=request.data, partial=True)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    serializer.save()

    new_password = str(request.data.get('password', '')).strip()
    if new_password:
        student.set_password(new_password)
        student.save(update_fields=['password'])

    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET', 'POST'])
def admin_courses(request) -> Response:
    if request.method == 'GET':
        _, _, error_response = _require_admin(request)
    else:
        _, _, error_response = _require_ipmo_admin(request)
    if error_response:
        return error_response

    requested_batch_code = _normalize_batch_code(request.query_params.get('batch_code'))
    preferred_code = _preferred_batch_code()
    if preferred_code:
        requested_batch_code = requested_batch_code or preferred_code

    if request.method == 'GET':
        course_qs = Course.objects.all()
        if requested_batch_code:
            filtered_qs = course_qs.filter(
                Q(studentcourse__batch_id=requested_batch_code)
                | Q(attendancerecord__batch_id=requested_batch_code)
                | Q(classsession__batch_id=requested_batch_code)
            ).distinct()
            if filtered_qs.exists():
                course_qs = filtered_qs

        courses = course_qs.order_by('code')
        serializer = CourseSerializer(courses, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    code = str(request.data.get('code', '')).strip().upper()
    name = str(request.data.get('name', '')).strip()
    if not code or not name:
        return Response(
            {'detail': 'code and name are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        credits = int(request.data.get('credits', 0))
    except (TypeError, ValueError):
        return Response(
            {'detail': 'credits must be an integer.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if credits < 0:
        return Response(
            {'detail': 'credits must be a non-negative integer.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if Course.objects.filter(code=code).exists():
        return Response(
            {'detail': 'A course with this code already exists.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    course = Course.objects.create(
        code=code,
        name=name[:150],
        credits=credits,
        drive_link=str(request.data.get('drive_link', '')).strip() or None,
    )
    serializer = CourseSerializer(course)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'PUT', 'PATCH', 'DELETE'])
def admin_course_detail(request, course_code: str) -> Response:
    _, _, error_response = _require_ipmo_admin(request)
    if error_response:
        return error_response

    course = get_object_or_404(Course, code=course_code.upper())

    if request.method == 'GET':
        serializer = CourseSerializer(course)
        return Response(serializer.data, status=status.HTTP_200_OK)

    if request.method == 'DELETE':
        course.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    update_fields: list[str] = []

    if 'name' in request.data:
        name = str(request.data.get('name', '')).strip()
        if not name:
            return Response(
                {'detail': 'name cannot be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        course.name = name[:150]
        update_fields.append('name')

    if 'drive_link' in request.data:
        course.drive_link = str(request.data.get('drive_link', '')).strip() or None
        update_fields.append('drive_link')

    if 'credits' in request.data:
        try:
            credits = int(request.data.get('credits'))
        except (TypeError, ValueError):
            return Response(
                {'detail': 'credits must be an integer.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if credits < 0:
            return Response(
                {'detail': 'credits must be a non-negative integer.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        course.credits = credits
        update_fields.append('credits')

    if update_fields:
        course.save(update_fields=list(set(update_fields)))

    serializer = CourseSerializer(course)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['POST'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def admin_upload_grades(request) -> Response:
    _, _, error_response = _require_ipmo_admin(request)
    if error_response:
        return error_response

    batch, batch_error = _batch_from_request(request, required=False)
    if batch_error:
        return batch_error

    payload = request.data.copy()
    if not payload.get('batch_code'):
        payload['batch_code'] = batch.code

    serializer = GradeDocumentSerializer(data=payload)
    if not serializer.is_valid():
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
    document = serializer.save()
    response_serializer = GradeDocumentSerializer(document)
    return Response(response_serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET', 'POST'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def admin_announcements(request) -> Response:
    admin_user, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    batch, batch_error = _batch_from_request(request, required=False)
    if batch_error:
        return batch_error

    if request.method == 'GET':
        announcements = (
            Announcement.objects.select_related('target_course')
            .filter(batch=batch)
            .order_by('-created_at')
        )
        serializer = AnnouncementSerializer(
            announcements,
            many=True,
            context={'request': request},
        )
        return Response(serializer.data, status=status.HTTP_200_OK)

    title = str(request.data.get('title', '')).strip()
    content = str(request.data.get('content', '')).strip()
    if not title or not content:
        return Response(
            {'detail': 'title and content are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    starts_at = _parse_optional_datetime(request.data.get('starts_at'))
    expires_at = _parse_optional_datetime(request.data.get('expires_at'))
    if request.data.get('starts_at') and not starts_at:
        return Response(
            {'detail': 'Invalid starts_at format. Use ISO datetime.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if request.data.get('expires_at') and not expires_at:
        return Response(
            {'detail': 'Invalid expires_at format. Use ISO datetime.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if starts_at and expires_at and expires_at < starts_at:
        return Response(
            {'detail': 'expires_at must be after starts_at.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    posted_by = str(request.data.get('posted_by', '')).strip()
    if not posted_by:
        posted_by = admin_user.get_full_name().strip() or admin_user.username

    target_type, target_course, target_error = _resolve_announcement_target(request)
    if target_error:
        return target_error

    announcement = Announcement.objects.create(
        batch=batch,
        title=title[:200],
        content=content,
        target_type=target_type,
        target_course=target_course,
        posted_by=posted_by[:100],
        starts_at=starts_at,
        expires_at=expires_at,
        attachment=request.FILES.get('attachment'),
    )
    _invalidate_cached_dashboard_payloads()
    serializer = AnnouncementSerializer(announcement, context={'request': request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def admin_announcement_detail(request, announcement_id: int) -> Response:
    _, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    batch, batch_error = _batch_from_request(request, required=False)
    if batch_error:
        return batch_error

    announcement = get_object_or_404(Announcement, pk=announcement_id, batch=batch)

    if request.method == 'DELETE':
        announcement.delete()
        _invalidate_cached_dashboard_payloads()
        return Response(status=status.HTTP_204_NO_CONTENT)

    update_fields: list[str] = []

    if 'title' in request.data:
        title = str(request.data.get('title', '')).strip()
        if not title:
            return Response(
                {'detail': 'title cannot be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        announcement.title = title[:200]
        update_fields.append('title')

    if 'content' in request.data:
        content = str(request.data.get('content', '')).strip()
        if not content:
            return Response(
                {'detail': 'content cannot be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        announcement.content = content
        update_fields.append('content')

    if 'posted_by' in request.data:
        posted_by = str(request.data.get('posted_by', '')).strip()
        if posted_by:
            announcement.posted_by = posted_by[:100]
            update_fields.append('posted_by')

    if 'target_type' in request.data or 'target_course_code' in request.data:
        target_type, target_course, target_error = _resolve_announcement_target(request)
        if target_error:
            return target_error
        announcement.target_type = target_type
        announcement.target_course = target_course
        update_fields.extend(['target_type', 'target_course'])

    if 'starts_at' in request.data:
        starts_at = _parse_optional_datetime(request.data.get('starts_at'))
        if request.data.get('starts_at') and not starts_at:
            return Response(
                {'detail': 'Invalid starts_at format. Use ISO datetime.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        announcement.starts_at = starts_at
        update_fields.append('starts_at')

    if 'expires_at' in request.data:
        expires_at = _parse_optional_datetime(request.data.get('expires_at'))
        if request.data.get('expires_at') and not expires_at:
            return Response(
                {'detail': 'Invalid expires_at format. Use ISO datetime.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        announcement.expires_at = expires_at
        update_fields.append('expires_at')

    if announcement.starts_at and announcement.expires_at and announcement.expires_at < announcement.starts_at:
        return Response(
            {'detail': 'expires_at must be after starts_at.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if _parse_bool(request.data.get('clear_attachment'), default=False):
        if announcement.attachment:
            announcement.attachment.delete(save=False)
        announcement.attachment = None
        update_fields.append('attachment')

    new_attachment = request.FILES.get('attachment')
    if new_attachment is not None:
        if announcement.attachment:
            announcement.attachment.delete(save=False)
        announcement.attachment = new_attachment
        update_fields.append('attachment')

    if update_fields:
        announcement.save(update_fields=list(set(update_fields)))
        _invalidate_cached_dashboard_payloads()

    serializer = AnnouncementSerializer(announcement, context={'request': request})
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET', 'POST'])
def admin_assignments(request) -> Response:
    _, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    batch, batch_error = _batch_from_request(request, required=False)
    if batch_error:
        return batch_error

    if request.method == 'GET':
        assignments = (
            Assignment.objects.select_related('course')
            .filter(batch=batch)
            .order_by('due_date', 'due_time', 'created_at')
        )
        serializer = AssignmentSerializer(assignments, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    course_code = str(request.data.get('course_code', '')).strip().upper()
    title = str(request.data.get('title', '')).strip()
    if not course_code or not title:
        return Response(
            {'detail': 'course_code and title are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    course = get_object_or_404(Course, code=course_code)
    due_date, due_time, due_error = _resolve_assignment_deadline(request)
    if due_error:
        return due_error

    assignment = Assignment.objects.create(
        batch=batch,
        course=course,
        title=title[:200],
        description=str(request.data.get('description', '')).strip(),
        group_members=str(request.data.get('group_members', '')).strip(),
        due_date=due_date,
        due_time=due_time,
    )
    _invalidate_cached_dashboard_payloads()
    serializer = AssignmentSerializer(assignment)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
def admin_assignment_detail(request, assignment_id: int) -> Response:
    _, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    batch, batch_error = _batch_from_request(request, required=False)
    if batch_error:
        return batch_error

    assignment = get_object_or_404(Assignment, pk=assignment_id, batch=batch)
    if request.method == 'DELETE':
        assignment.delete()
        _invalidate_cached_dashboard_payloads()
        return Response(status=status.HTTP_204_NO_CONTENT)

    update_fields: list[str] = []
    if 'title' in request.data:
        title = str(request.data.get('title', '')).strip()
        if not title:
            return Response(
                {'detail': 'title cannot be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        assignment.title = title[:200]
        update_fields.append('title')

    if 'description' in request.data:
        assignment.description = str(request.data.get('description', '')).strip()
        update_fields.append('description')

    if 'group_members' in request.data:
        assignment.group_members = str(request.data.get('group_members', '')).strip()
        update_fields.append('group_members')

    if 'course_code' in request.data:
        course_code = str(request.data.get('course_code', '')).strip().upper()
        if not course_code:
            return Response(
                {'detail': 'course_code cannot be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        assignment.course = get_object_or_404(Course, code=course_code)
        update_fields.append('course')

    if 'due_at' in request.data or 'due_date' in request.data or 'due_time' in request.data:
        due_date, due_time, due_error = _resolve_assignment_deadline(request)
        if due_error:
            return due_error
        assignment.due_date = due_date
        assignment.due_time = due_time
        update_fields.extend(['due_date', 'due_time'])

    if update_fields:
        assignment.save(update_fields=list(set(update_fields)))
        _invalidate_cached_dashboard_payloads()

    serializer = AssignmentSerializer(assignment)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET', 'POST'])
def admin_polls(request) -> Response:
    admin_user, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    batch, batch_error = _batch_from_request(request, required=False)
    if batch_error:
        return batch_error

    if request.method == 'GET':
        polls = (
            Poll.objects.select_related('target_course')
            .prefetch_related(
                'options',
                Prefetch(
                    'votes',
                    queryset=PollVote.objects.select_related('student').order_by('created_at', 'id'),
                ),
            )
            .filter(batch=batch)
            .order_by('-created_at')
        )
        payload = [_serialize_poll_for_admin(poll) for poll in polls]
        return Response(payload, status=status.HTTP_200_OK)

    title = str(request.data.get('title', '')).strip()
    if not title:
        return Response(
            {'detail': 'title is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    target_type = str(request.data.get('target_type', 'ALL')).strip().upper() or 'ALL'
    valid_types = {choice for choice, _ in Poll.TARGET_TYPE_CHOICES}
    if target_type not in valid_types:
        return Response(
            {'detail': f'Invalid target_type. Choose one of: {", ".join(sorted(valid_types))}.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    target_course = None
    target_course_code = str(request.data.get('target_course_code', '')).strip().upper()
    if target_type == 'COURSE':
        if not target_course_code:
            return Response(
                {'detail': 'target_course_code is required when target_type is COURSE.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        target_course = get_object_or_404(Course, code=target_course_code)

    raw_options = request.data.get('options', [])
    if isinstance(raw_options, str):
        try:
            parsed_options = json.loads(raw_options)
        except json.JSONDecodeError:
            parsed_options = [line.strip() for line in raw_options.split('\n') if line.strip()]
    else:
        parsed_options = raw_options

    if not isinstance(parsed_options, list):
        return Response(
            {'detail': 'options must be a list of option texts.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    cleaned_options = [str(option).strip() for option in parsed_options if str(option).strip()]
    if len(cleaned_options) < 2:
        return Response(
            {'detail': 'At least two poll options are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    cleaned_options = cleaned_options[:8]

    expires_at = _parse_optional_datetime(request.data.get('expires_at'))
    if request.data.get('expires_at') and not expires_at:
        return Response(
            {'detail': 'Invalid expires_at format. Use ISO datetime.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if expires_at and expires_at <= timezone.now():
        return Response(
            {'detail': 'expires_at must be in the future.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    creator_name = admin_user.get_full_name().strip() or admin_user.username
    with transaction.atomic():
        poll = Poll.objects.create(
            batch=batch,
            title=title[:220],
            description=str(request.data.get('description', '')).strip(),
            target_type=target_type,
            target_course=target_course,
            created_by=creator_name[:100],
            expires_at=expires_at,
        )
        PollOption.objects.bulk_create(
            [PollOption(poll=poll, text=option[:220]) for option in cleaned_options]
        )
    _invalidate_cached_dashboard_payloads()

    created_poll = Poll.objects.select_related('target_course').prefetch_related(
        'options',
        Prefetch(
            'votes',
            queryset=PollVote.objects.select_related('student').order_by('created_at', 'id'),
        ),
    ).get(pk=poll.id)
    return Response(_serialize_poll_for_admin(created_poll), status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
def admin_poll_detail(request, poll_id: int) -> Response:
    _, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    batch, batch_error = _batch_from_request(request, required=False)
    if batch_error:
        return batch_error

    poll = get_object_or_404(Poll, pk=poll_id, batch=batch)
    if request.method == 'DELETE':
        poll.delete()
        _invalidate_cached_dashboard_payloads()
        return Response(status=status.HTTP_204_NO_CONTENT)

    update_fields: list[str] = []
    if 'title' in request.data:
        title = str(request.data.get('title', '')).strip()
        if not title:
            return Response(
                {'detail': 'title cannot be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        poll.title = title[:220]
        update_fields.append('title')

    if 'description' in request.data:
        poll.description = str(request.data.get('description', '')).strip()
        update_fields.append('description')

    if 'expires_at' in request.data:
        expires_at = _parse_optional_datetime(request.data.get('expires_at'))
        if request.data.get('expires_at') and not expires_at:
            return Response(
                {'detail': 'Invalid expires_at format. Use ISO datetime.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        poll.expires_at = expires_at
        update_fields.append('expires_at')

    if update_fields:
        poll.save(update_fields=list(set(update_fields)))
        _invalidate_cached_dashboard_payloads()

    refreshed_poll = Poll.objects.select_related('target_course').prefetch_related(
        'options',
        Prefetch(
            'votes',
            queryset=PollVote.objects.select_related('student').order_by('created_at', 'id'),
        ),
    ).get(pk=poll.id)
    return Response(_serialize_poll_for_admin(refreshed_poll), status=status.HTTP_200_OK)


@api_view(['GET', 'POST'])
def admin_access_accounts(request) -> Response:
    _, _, error_response = _require_ipmo_admin(request)
    if error_response:
        return error_response

    if request.method == 'GET':
        users = User.objects.filter(is_staff=True).order_by('-is_superuser', 'username')
        payload = [_serialize_admin_account(user) for user in users]
        return Response(payload, status=status.HTTP_200_OK)

    username = str(request.data.get('username', '')).strip()
    password = str(request.data.get('password', '')).strip()
    role = str(request.data.get('role', 'CR')).strip().upper() or 'CR'
    full_name = str(request.data.get('name', '')).strip()
    is_active = _parse_bool(request.data.get('is_active', True), default=True)

    if not username or not password:
        return Response(
            {'detail': 'username and password are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if role not in {'CR', 'IPMO'}:
        return Response(
            {'detail': 'role must be either CR or IPMO.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if User.objects.filter(username__iexact=username).exists():
        return Response(
            {'detail': 'An admin account with this username already exists.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    first_name = ''
    last_name = ''
    if full_name:
        parts = full_name.split()
        first_name = parts[0][:150]
        last_name = ' '.join(parts[1:])[:150] if len(parts) > 1 else ''

    user = User.objects.create(
        username=username[:150],
        first_name=first_name,
        last_name=last_name,
        is_staff=True,
        is_superuser=(role == 'IPMO'),
        is_active=is_active,
    )
    user.set_password(password)
    user.save(update_fields=['password'])

    return Response(_serialize_admin_account(user), status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
def admin_access_account_detail(request, account_id: int) -> Response:
    admin_user, _, error_response = _require_ipmo_admin(request)
    if error_response:
        return error_response

    account = get_object_or_404(User, pk=account_id, is_staff=True)

    if request.method == 'DELETE':
        if account.id == admin_user.id:
            return Response(
                {'detail': 'You cannot delete your own admin account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        account.is_active = False
        account.save(update_fields=['is_active'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    update_fields: list[str] = []

    if 'username' in request.data:
        username = str(request.data.get('username', '')).strip()
        if not username:
            return Response(
                {'detail': 'username cannot be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        exists = User.objects.exclude(pk=account.pk).filter(username__iexact=username).exists()
        if exists:
            return Response(
                {'detail': 'Another admin account already uses this username.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        account.username = username[:150]
        update_fields.append('username')

    if 'name' in request.data:
        full_name = str(request.data.get('name', '')).strip()
        if full_name:
            parts = full_name.split()
            account.first_name = parts[0][:150]
            account.last_name = ' '.join(parts[1:])[:150] if len(parts) > 1 else ''
        else:
            account.first_name = ''
            account.last_name = ''
        update_fields.extend(['first_name', 'last_name'])

    if 'role' in request.data:
        role = str(request.data.get('role', '')).strip().upper()
        if role not in {'CR', 'IPMO'}:
            return Response(
                {'detail': 'role must be either CR or IPMO.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        account.is_superuser = role == 'IPMO'
        update_fields.append('is_superuser')

    if 'is_active' in request.data:
        next_active = _parse_bool(request.data.get('is_active'), default=account.is_active)
        if account.id == admin_user.id and not next_active:
            return Response(
                {'detail': 'You cannot deactivate your own account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        account.is_active = next_active
        update_fields.append('is_active')

    if 'password' in request.data:
        password = str(request.data.get('password', '')).strip()
        if not password:
            return Response(
                {'detail': 'password cannot be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        account.set_password(password)
        update_fields.append('password')

    if update_fields:
        account.save(update_fields=list(set(update_fields)))

    refreshed = User.objects.get(pk=account.pk)
    return Response(_serialize_admin_account(refreshed), status=status.HTTP_200_OK)


@api_view(['GET'])
def get_active_polls(request) -> Response:
    student, error_response = _student_from_request(request)
    if error_response:
        return error_response

    now = timezone.now()
    polls = (
        Poll.objects.select_related('target_course', 'batch')
        .prefetch_related('options', 'votes')
        .filter(
            Q(batch=student.batch) | Q(batch__isnull=True),
            Q(expires_at__isnull=True) | Q(expires_at__gte=now),
        )
        .order_by('-created_at')
    )

    enrolled_course_ids = _enrolled_course_ids(student)
    visible_polls = [
        _serialize_poll_for_student(poll, student)
        for poll in polls
        if _poll_visible_for_student(poll, student, enrolled_course_ids)
    ]
    return Response(visible_polls, status=status.HTTP_200_OK)


@api_view(['POST'])
def cast_poll_vote(request, poll_id: int) -> Response:
    student, error_response = _student_from_request(request)
    if error_response:
        return error_response

    poll = get_object_or_404(
        Poll.objects.select_related('target_course').prefetch_related('options', 'votes'),
        pk=poll_id,
    )
    now = timezone.now()
    if poll.expires_at and poll.expires_at < now:
        return Response(
            {'detail': 'This poll has expired.'},
            status=status.HTTP_400_BAD_REQUEST,
        )
    if poll.batch_id and student.batch_id and poll.batch_id != student.batch_id:
        return Response(
            {'detail': 'This poll is not targeted to your batch.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    enrolled_course_ids = _enrolled_course_ids(student)
    if not _poll_visible_for_student(poll, student, enrolled_course_ids):
        return Response(
            {'detail': 'This poll is not targeted to your profile.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    try:
        option_id = int(request.data.get('option_id'))
    except (TypeError, ValueError):
        return Response(
            {'detail': 'option_id is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    option = poll.options.filter(pk=option_id).first()
    if option is None:
        return Response(
            {'detail': 'Invalid option_id for this poll.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        PollVote.objects.create(poll=poll, option=option, student=student)
    except IntegrityError:
        return Response(
            {'detail': 'You have already voted on this poll.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    refreshed = Poll.objects.select_related('target_course').prefetch_related('options', 'votes').get(pk=poll.id)
    return Response(_serialize_poll_for_student(refreshed, student), status=status.HTTP_200_OK)


@api_view(['POST'])
def cr_generate_draft(request) -> Response:
    _, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    prompt = str(request.data.get('prompt', '')).strip()
    target = str(request.data.get('target', 'announcement')).strip().lower() or 'announcement'
    if not prompt:
        return Response(
            {'detail': 'prompt is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    try:
        if target == 'assignment':
            draft = _generate_gemini_draft(prompt)
            return Response({'draft': draft, 'source': 'gemini', 'target': 'assignment'}, status=status.HTTP_200_OK)

        payload = _generate_gemini_announcement_payload(prompt)
        return Response(
            {
                'title': payload['title'],
                'content': payload['content'],
                'draft': payload['content'],
                'source': 'gemini',
                'target': 'announcement',
            },
            status=status.HTTP_200_OK,
        )
    except Exception as exc:
        logger.warning('Gemini draft generation failed: %s', exc)
        fallback = _generate_announcement_draft(prompt)
        fallback_title = str(fallback.get('title', '')).strip()
        fallback_content = str(fallback.get('content', '')).strip()
        if not fallback_content:
            return Response(
                {'detail': f'Unable to generate draft right now: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        reason = 'Gemini unavailable. Returned fallback draft.'
        if _is_gemini_quota_error(str(exc)):
            reason = 'Gemini quota exceeded. Returned fallback draft.'
        return Response(
            {
                'title': fallback_title,
                'content': fallback_content,
                'draft': fallback_content,
                'source': 'fallback',
                'target': target,
                'detail': reason,
            },
            status=status.HTTP_200_OK,
        )


@api_view(['GET', 'POST'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def admin_course_materials(request) -> Response:
    admin_user, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    if request.method == 'GET':
        course_code = str(request.query_params.get('course', '')).strip().upper()
        materials = CourseMaterial.objects.select_related('course')
        if course_code:
            materials = materials.filter(course_id=course_code)
        materials = materials.order_by('course__code', 'sort_order', 'id')
        serializer = CourseMaterialSerializer(materials, many=True, context={'request': request})
        return Response(serializer.data, status=status.HTTP_200_OK)

    course_code = str(request.data.get('course_code', '')).strip().upper()
    title = str(request.data.get('title', '')).strip()
    if not course_code or not title:
        return Response(
            {'detail': 'course_code and title are required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    course = get_object_or_404(Course, code=course_code)
    next_order = (
        CourseMaterial.objects.filter(course=course).aggregate(max_order=Max('sort_order')).get('max_order')
        or 0
    ) + 1

    material = CourseMaterial.objects.create(
        course=course,
        title=title[:220],
        description=str(request.data.get('description', '')).strip(),
        drive_link=str(request.data.get('drive_link', '')).strip() or None,
        file=request.FILES.get('file'),
        sort_order=_parse_sort_order(request.data.get('sort_order'), default=next_order),
        is_published=_parse_bool(request.data.get('is_published', True), default=True),
        created_by=(
            str(request.data.get('created_by', '')).strip()
            or admin_user.get_full_name().strip()
            or admin_user.username
        )[:100],
    )
    serializer = CourseMaterialSerializer(material, context={'request': request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def admin_course_material_detail(request, material_id: int) -> Response:
    _, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    material = get_object_or_404(CourseMaterial, pk=material_id)
    if request.method == 'DELETE':
        if material.file:
            material.file.delete(save=False)
        material.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    update_fields: list[str] = []

    if 'course_code' in request.data:
        course_code = str(request.data.get('course_code', '')).strip().upper()
        if not course_code:
            return Response(
                {'detail': 'course_code cannot be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        material.course = get_object_or_404(Course, code=course_code)
        update_fields.append('course')

    if 'title' in request.data:
        title = str(request.data.get('title', '')).strip()
        if not title:
            return Response(
                {'detail': 'title cannot be empty.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        material.title = title[:220]
        update_fields.append('title')

    if 'description' in request.data:
        material.description = str(request.data.get('description', '')).strip()
        update_fields.append('description')

    if 'drive_link' in request.data:
        material.drive_link = str(request.data.get('drive_link', '')).strip() or None
        update_fields.append('drive_link')

    if 'sort_order' in request.data:
        material.sort_order = _parse_sort_order(request.data.get('sort_order'), default=material.sort_order)
        update_fields.append('sort_order')

    if 'is_published' in request.data:
        material.is_published = _parse_bool(
            request.data.get('is_published'),
            default=material.is_published,
        )
        update_fields.append('is_published')

    if _parse_bool(request.data.get('clear_file'), default=False):
        if material.file:
            material.file.delete(save=False)
        material.file = None
        update_fields.append('file')

    new_file = request.FILES.get('file')
    if new_file is not None:
        if material.file:
            material.file.delete(save=False)
        material.file = new_file
        update_fields.append('file')

    if update_fields:
        material.save(update_fields=list(set(update_fields + ['updated_at'])))

    serializer = CourseMaterialSerializer(material, context={'request': request})
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['POST'])
def admin_ai_generate_announcement(request) -> Response:
    _, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    prompt = str(request.data.get('prompt', '')).strip()
    if not prompt:
        return Response(
            {'detail': 'prompt is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    draft = _generate_announcement_draft(prompt)
    return Response(draft, status=status.HTTP_200_OK)


@api_view(['POST'])
def admin_ai_arrange_materials(request) -> Response:
    _, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    course_code = str(request.data.get('course_code', '')).strip().upper()
    if not course_code:
        return Response(
            {'detail': 'course_code is required.'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    materials = list(
        CourseMaterial.objects.filter(course_id=course_code).order_by('sort_order', 'id')
    )
    if not materials:
        return Response([], status=status.HTTP_200_OK)

    ordered_ids = _reorder_materials_with_ai(materials)
    order_map = {material_id: index for index, material_id in enumerate(ordered_ids, start=1)}
    for material in materials:
        material.sort_order = order_map.get(material.id, material.sort_order)

    CourseMaterial.objects.bulk_update(materials, ['sort_order', 'updated_at'])
    refreshed = CourseMaterial.objects.select_related('course').filter(course_id=course_code).order_by(
        'sort_order',
        'id',
    )
    serializer = CourseMaterialSerializer(refreshed, many=True, context={'request': request})
    return Response(serializer.data, status=status.HTTP_200_OK)
