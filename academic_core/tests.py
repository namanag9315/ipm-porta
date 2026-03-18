from django.test import TestCase

from academic_core.tasks import _attendance_mark_column_indices, _count_attendance_marks


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
