from django.test import TestCase

from academic_core.models import AttendanceRecord, Batch, StudentCourse
from academic_core.tasks import _attendance_mark_column_indices, _count_attendance_marks, parse_attendance


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
