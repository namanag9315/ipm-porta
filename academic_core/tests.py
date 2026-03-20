from django.test import TestCase

from academic_core.models import AttendanceRecord, Batch, MessMenu, StudentCourse
from academic_core.tasks import (
    _attendance_mark_column_indices,
    _count_attendance_marks,
    parse_attendance,
    parse_mess_menu,
)
from academic_core.views import _is_gemini_quota_error, _pick_gemini_model_name


class AttendanceParsingTests(TestCase):
    def test_skips_summary_columns_p_a_l_and_percentage(self):
        headers = [
            'S.No.',
            'Student Name',
            'Roll No.',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            'P',
            'A',
            'L',
            'Attendance %',
        ]
        roll_column = 2
        indices = _attendance_mark_column_indices(headers, roll_column)
        # Only the blank attendance date columns should be parsed.
        self.assertEqual(indices, list(range(3, 13)))

    def test_count_marks_does_not_treat_summary_numbers_as_marks(self):
        row_slice = ['P', 'P', 'P', 'P', 'P', 'A', 'P', None, None, None, 6, 1, 0, 0.8571428571]
        present_count, absent_count, late_count = _count_attendance_marks(row_slice)
        self.assertEqual(present_count, 6)
        self.assertEqual(absent_count, 1)
        self.assertEqual(late_count, 0)

    def test_parse_attendance_bulk_upsert_updates_existing_record(self):
        batch, _ = Batch.objects.get_or_create(
            code='IPM01',
            defaults={'name': 'IPM01', 'is_active': True},
        )
        payload = {
            'POM B': [
                ['Roll No.', 'Student Name', 'D1', 'D2', 'D3', 'P', 'A', 'L', 'Attendance %'],
                ['2023IPM079', 'Naman', 'P', 'P', 'A', 2, 1, 0, 66.67],
            ]
        }

        first_result = parse_attendance(payload, batch=batch)
        self.assertEqual(first_result['records_upserted'], 1)
        self.assertEqual(AttendanceRecord.objects.count(), 1)
        self.assertEqual(StudentCourse.objects.count(), 1)

        updated_payload = {
            'POM B': [
                ['Roll No.', 'Student Name', 'D1', 'D2', 'D3', 'P', 'A', 'L', 'Attendance %'],
                ['2023IPM079', 'Naman', 'P', 'A', 'A', 1, 2, 0, 33.33],
            ]
        }
        second_result = parse_attendance(updated_payload, batch=batch)
        self.assertEqual(second_result['records_upserted'], 1)
        self.assertEqual(AttendanceRecord.objects.count(), 1)
        self.assertEqual(StudentCourse.objects.count(), 1)

        record = AttendanceRecord.objects.select_related('course', 'student').get()
        self.assertEqual(record.student_id, '2023IPM079')
        self.assertEqual(record.course_id, 'POM')
        self.assertEqual(record.total_delivered, 3)
        self.assertEqual(record.total_attended, 1)
        self.assertEqual(record.percentage, 33.33)


class GeminiModelSelectionTests(TestCase):
    def test_pick_model_keeps_available_preferred_model(self):
        picked = _pick_gemini_model_name(
            'gemini-2.0-flash',
            ['models/gemini-2.0-flash', 'models/gemini-2.0-pro'],
        )
        self.assertEqual(picked, 'models/gemini-2.0-flash')

    def test_pick_model_falls_back_to_available_flash_model(self):
        picked = _pick_gemini_model_name(
            'gemini-1.5-flash',
            ['models/gemini-2.0-pro', 'models/gemini-2.0-flash'],
        )
        self.assertEqual(picked, 'models/gemini-2.0-flash')

    def test_detects_quota_error_message(self):
        error_text = '429 Quota exceeded for metric generate_content_free_tier_requests'
        self.assertTrue(_is_gemini_quota_error(error_text))

    def test_non_quota_message_returns_false(self):
        self.assertFalse(_is_gemini_quota_error('Gemini returned an empty draft.'))


class MessMenuParsingTests(TestCase):
    def test_parse_mess_menu_reads_multiple_week_blocks(self):
        batch, _ = Batch.objects.get_or_create(code='IPM01', defaults={'name': 'IPM01', 'is_active': True})
        sheet_data = [
            ['DATE', '2026-03-09', '2026-03-10'],
            ['DAY', 'Mon', 'Tue'],
            ['BREAKFAST'],
            ['HOT PREPARATION', 'Poha', 'Upma'],
            ['LUNCH'],
            ['DAL PREPARATION', 'Dal fry', 'Mix dal'],
            ['DATE', '2026-03-16', '2026-03-17'],
            ['DAY', 'Mon', 'Tue'],
            ['BREAKFAST'],
            ['HOT PREPARATION', 'Masala dosa', 'Idli sambar'],
            ['DINNER'],
            ['GRAVY VEG', 'Paneer masala', 'Kadhi'],
        ]

        result = parse_mess_menu(sheet_data, batch=batch)
        self.assertGreater(result['created'], 0)

        created_dates = set(MessMenu.objects.filter(batch=batch).values_list('date', flat=True))
        self.assertIn('2026-03-09', {str(value) for value in created_dates})
        self.assertIn('2026-03-17', {str(value) for value in created_dates})

    def test_parse_mess_menu_keeps_date_alignment_when_a_column_date_is_invalid(self):
        batch, _ = Batch.objects.get_or_create(code='IPM02', defaults={'name': 'IPM02', 'is_active': True})
        sheet_data = [
            ['DATE', '2026-03-23', 'not-a-date', '2026-03-25'],
            ['DAY', 'Mon', 'Tue', 'Wed'],
            ['BREAKFAST'],
            ['HOT PREPARATION', 'Poha', 'Skip me', 'Paratha'],
            ['LUNCH'],
            ['DAL PREPARATION', 'Dal', 'Skip me', 'Kadhi'],
        ]

        parse_mess_menu(sheet_data, batch=batch)
        items = list(MessMenu.objects.filter(batch=batch).order_by('date', 'item_name'))
        self.assertEqual(len(items), 4)

        breakfast_items = [item for item in items if item.category.endswith('HOT PREPARATION')]
        self.assertEqual(len(breakfast_items), 2)
        self.assertEqual(str(breakfast_items[0].date), '2026-03-23')
        self.assertEqual(breakfast_items[0].item_name, 'Poha')
        self.assertEqual(str(breakfast_items[1].date), '2026-03-25')
        self.assertEqual(breakfast_items[1].item_name, 'Paratha')

    def test_parse_mess_menu_uses_latest_date_header_row_before_day_row(self):
        batch, _ = Batch.objects.get_or_create(code='IPM03', defaults={'name': 'IPM03', 'is_active': True})
        sheet_data = [
            ['', 'DATE', '2026-03-01', '2026-03-02'],
            ['', '', '2026-03-15', '2026-03-16'],
            ['', 'DAY', 'Mon', 'Tue'],
            ['', 'BREAKFAST', '', ''],
            ['', 'HOT PREPARATION', 'Poha', 'Upma'],
            ['', 'LUNCH', '', ''],
        ]

        parse_mess_menu(sheet_data, batch=batch)
        created_dates = sorted(
            {str(value) for value in MessMenu.objects.filter(batch=batch).values_list('date', flat=True)}
        )
        self.assertEqual(created_dates, ['2026-03-15', '2026-03-16'])
