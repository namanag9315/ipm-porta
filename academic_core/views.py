import datetime
import json
import os
import re
import secrets
from zoneinfo import ZoneInfo

import requests
from django.contrib.auth import authenticate
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db.models import Max, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, parser_classes
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response

from academic_core.models import (
    Announcement,
    Assignment,
    AttendanceRecord,
    ClassSession,
    Course,
    CourseMaterial,
    MessMenu,
    Student,
    StudentCourse,
)
from academic_core.serializers import (
    AnnouncementSerializer,
    AssignmentSerializer,
    AttendanceSerializer,
    ClassSessionSerializer,
    CourseMaterialSerializer,
    CourseSerializer,
    MessMenuSerializer,
    StudentSerializer,
)
from academic_core.tasks import sync_google_sheets_data

LOCAL_TIMEZONE = ZoneInfo('Asia/Kolkata')


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


def _parse_sort_order(value: object, default: int = 0) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(0, parsed)


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


def _enrolled_course_ids(student: Student) -> set[str]:
    attendance_course_ids = set(
        AttendanceRecord.objects.filter(student=student).values_list('course_id', flat=True)
    )
    mapped_course_ids = set(
        StudentCourse.objects.filter(student=student).values_list('course_id', flat=True)
    )
    return attendance_course_ids | mapped_course_ids


@api_view(['GET'])
def get_student_attendance(request, roll_number: str) -> Response:
    records = AttendanceRecord.objects.select_related('course').filter(
        student__roll_number=roll_number
    )
    serializer = AttendanceSerializer(records, many=True)
    return Response(serializer.data, status=status.HTTP_200_OK)


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
                'name': student.name,
                'section': student.section,
                'email': student.email,
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


@api_view(['POST'])
def admin_run_sync(request) -> Response:
    _, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    mode = str(request.data.get('mode', 'async')).strip().lower()
    if mode not in {'async', 'sync'}:
        return Response(
            {'detail': 'Invalid mode. Use "async" or "sync".'},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if mode == 'sync':
        result = sync_google_sheets_data()
        return Response(
            {
                'status': 'completed',
                'mode': 'sync',
                'result': result,
            },
            status=status.HTTP_200_OK,
        )

    try:
        task = sync_google_sheets_data.delay()
        return Response(
            {
                'status': 'queued',
                'mode': 'async',
                'task_id': task.id,
            },
            status=status.HTTP_202_ACCEPTED,
        )
    except Exception as exc:
        result = sync_google_sheets_data()
        return Response(
            {
                'status': 'completed',
                'mode': 'sync_fallback',
                'detail': f'Celery unavailable ({exc}); ran sync inline.',
                'result': result,
            },
            status=status.HTTP_200_OK,
        )


@api_view(['GET'])
def get_student_timetable(request, roll_number: str) -> Response:
    student = get_object_or_404(Student, roll_number=roll_number)
    enrolled_course_ids = _enrolled_course_ids(student)

    sessions = ClassSession.objects.select_related('course')
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


@api_view(['GET'])
def get_mess_menu(request) -> Response:
    date_param = request.query_params.get('date')
    target_date = timezone.now().astimezone(LOCAL_TIMEZONE).date()

    if date_param:
        try:
            target_date = datetime.date.fromisoformat(date_param)
        except ValueError:
            return Response(
                {'detail': 'Invalid date format. Use YYYY-MM-DD.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

    menu_items = MessMenu.objects.filter(date=target_date).order_by('category', 'item_name')
    serializer = MessMenuSerializer(menu_items, many=True)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET'])
def get_dashboard_extras(request) -> Response:
    now = timezone.now()
    today = now.astimezone(LOCAL_TIMEZONE).date()

    birthdays_today = Student.objects.filter(
        date_of_birth__month=today.month,
        date_of_birth__day=today.day,
    ).order_by('name')
    recent_announcements = Announcement.objects.filter(
        Q(starts_at__isnull=True) | Q(starts_at__lte=now),
        Q(expires_at__isnull=True) | Q(expires_at__gte=now),
    ).order_by('-created_at')[:3]
    upcoming_assignments = Assignment.objects.select_related('course').filter(
        due_date__gte=today
    ).order_by('due_date', 'created_at')

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


@api_view(['GET'])
def admin_courses(request) -> Response:
    _, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    courses = Course.objects.order_by('code')
    serializer = CourseSerializer(courses, many=True)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['PATCH'])
def admin_course_detail(request, course_code: str) -> Response:
    _, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    course = get_object_or_404(Course, code=course_code.upper())
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
            course.credits = int(request.data.get('credits'))
        except (TypeError, ValueError):
            return Response(
                {'detail': 'credits must be an integer.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        update_fields.append('credits')

    if update_fields:
        course.save(update_fields=list(set(update_fields)))

    serializer = CourseSerializer(course)
    return Response(serializer.data, status=status.HTTP_200_OK)


@api_view(['GET', 'POST'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def admin_announcements(request) -> Response:
    admin_user, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    if request.method == 'GET':
        announcements = Announcement.objects.order_by('-created_at')
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

    announcement = Announcement.objects.create(
        title=title[:200],
        content=content,
        posted_by=posted_by[:100],
        starts_at=starts_at,
        expires_at=expires_at,
        attachment=request.FILES.get('attachment'),
    )
    serializer = AnnouncementSerializer(announcement, context={'request': request})
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['PATCH', 'DELETE'])
@parser_classes([MultiPartParser, FormParser, JSONParser])
def admin_announcement_detail(request, announcement_id: int) -> Response:
    _, _, error_response = _require_admin(request)
    if error_response:
        return error_response

    announcement = get_object_or_404(Announcement, pk=announcement_id)

    if request.method == 'DELETE':
        announcement.delete()
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

    serializer = AnnouncementSerializer(announcement, context={'request': request})
    return Response(serializer.data, status=status.HTTP_200_OK)


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
