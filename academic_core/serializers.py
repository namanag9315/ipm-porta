import datetime
import re
from collections import Counter

from rest_framework import serializers

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
    TermSettings,
)
from academic_core.utils import format_batch_name, infer_ipm_year_label


class BatchSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()
    ipm_year = serializers.SerializerMethodField()

    def _resolve_admission_year(self, obj):
        from_code = re.search(r'20\d{2}', str(obj.code or ''))
        if from_code:
            return from_code.group(0)

        from_name = re.search(r'20\d{2}', str(obj.name or ''))
        if from_name:
            return from_name.group(0)

        student_rolls = list(obj.students.values_list('roll_number', flat=True)[:400])
        years = [
            match.group(0)
            for roll_number in student_rolls
            for match in [re.match(r'^(20\d{2})', str(roll_number or ''))]
            if match
        ]
        if not years:
            legacy_match = re.fullmatch(r'IPM0?([1-9])', str(obj.code or '').strip(), flags=re.IGNORECASE)
            if legacy_match:
                try:
                    program_year = int(legacy_match.group(1))
                    return str(max(2000, datetime.date.today().year - program_year))
                except (TypeError, ValueError):
                    return ''
            return ''
        return Counter(years).most_common(1)[0][0]

    def get_display_name(self, obj):
        if obj.name and obj.name.strip() and obj.name.strip().upper() != obj.code.strip().upper():
            return obj.name
        inferred_year = self._resolve_admission_year(obj)
        return format_batch_name(inferred_year or obj.code)

    def get_ipm_year(self, obj):
        inferred_year = self._resolve_admission_year(obj)
        return infer_ipm_year_label(inferred_year or obj.code)

    class Meta:
        model = Batch
        fields = ['code', 'name', 'display_name', 'ipm_year', 'is_active']


class CourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = ['code', 'name', 'credits', 'drive_link']


class StudentSerializer(serializers.ModelSerializer):
    batch_code = serializers.SlugRelatedField(
        source='batch',
        slug_field='code',
        queryset=Batch.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Student
        fields = ['roll_number', 'batch_code', 'name', 'section', 'email', 'upi_id', 'date_of_birth', 'is_ipmo']


class AttendanceSerializer(serializers.ModelSerializer):
    course = CourseSerializer(read_only=True)

    class Meta:
        model = AttendanceRecord
        fields = [
            'student',
            'course',
            'total_delivered',
            'total_attended',
            'percentage',
            'last_updated',
        ]


class AttendanceWaiverRequestSerializer(serializers.ModelSerializer):
    course = CourseSerializer(read_only=True)
    file_url = serializers.SerializerMethodField()

    def get_file_url(self, obj):
        if not obj.supporting_file:
            return ''
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.supporting_file.url)
        return obj.supporting_file.url

    class Meta:
        model = AttendanceWaiverRequest
        fields = [
            'id',
            'course',
            'reason',
            'supporting_file',
            'file_url',
            'status',
            'review_notes',
            'submitted_at',
        ]


class CabPoolSerializer(serializers.ModelSerializer):
    creator_name = serializers.CharField(source='creator.name', read_only=True)
    creator_roll_number = serializers.CharField(source='creator.roll_number', read_only=True)

    class Meta:
        model = CabPool
        fields = [
            'id',
            'creator',
            'creator_name',
            'creator_roll_number',
            'destination',
            'departure_date',
            'time_window',
            'available_seats',
            'whatsapp_number',
            'is_active',
            'created_at',
        ]
        read_only_fields = ['creator', 'creator_name', 'creator_roll_number', 'created_at']


class BlinkitPoolSerializer(serializers.ModelSerializer):
    creator_name = serializers.CharField(source='creator.name', read_only=True)
    creator_roll_number = serializers.CharField(source='creator.roll_number', read_only=True)

    class Meta:
        model = BlinkitPool
        fields = [
            'id',
            'creator',
            'creator_name',
            'creator_roll_number',
            'hostel_block',
            'order_type',
            'order_deadline',
            'whatsapp_number',
            'is_active',
            'created_at',
        ]
        read_only_fields = ['creator', 'creator_name', 'creator_roll_number', 'created_at']


class SellPostSerializer(serializers.ModelSerializer):
    creator_name = serializers.CharField(source='creator.name', read_only=True)
    creator_roll_number = serializers.CharField(source='creator.roll_number', read_only=True)

    class Meta:
        model = SellPost
        fields = [
            'id',
            'creator',
            'creator_name',
            'creator_roll_number',
            'title',
            'description',
            'expected_price',
            'whatsapp_number',
            'is_active',
            'created_at',
        ]
        read_only_fields = ['creator', 'creator_name', 'creator_roll_number', 'created_at']


class ClassSessionSerializer(serializers.ModelSerializer):
    course = CourseSerializer(read_only=True)

    class Meta:
        model = ClassSession
        fields = [
            'id',
            'date',
            'start_time',
            'end_time',
            'room',
            'course',
            'raw_text',
            'is_exam',
        ]


class MessMenuSerializer(serializers.ModelSerializer):
    class Meta:
        model = MessMenu
        fields = ['id', 'date', 'category', 'item_name']


class AnnouncementSerializer(serializers.ModelSerializer):
    attachment_url = serializers.SerializerMethodField()

    def get_attachment_url(self, obj):
        if not obj.attachment:
            return ''
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.attachment.url)
        return obj.attachment.url

    class Meta:
        model = Announcement
        fields = [
            'id',
            'title',
            'content',
            'posted_by',
            'starts_at',
            'expires_at',
            'attachment',
            'attachment_url',
            'created_at',
        ]


class AssignmentSerializer(serializers.ModelSerializer):
    course = CourseSerializer(read_only=True)
    due_at = serializers.SerializerMethodField()

    def get_due_at(self, obj):
        due_time = obj.due_time or datetime.time(23, 59)
        due_datetime = datetime.datetime.combine(obj.due_date, due_time)
        return due_datetime.isoformat()

    class Meta:
        model = Assignment
        fields = ['id', 'course', 'title', 'description', 'due_date', 'due_time', 'due_at', 'created_at']


class PollOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PollOption
        fields = ['id', 'text']


class PollSerializer(serializers.ModelSerializer):
    target_course = CourseSerializer(read_only=True)
    options = PollOptionSerializer(many=True, read_only=True)

    class Meta:
        model = Poll
        fields = [
            'id',
            'title',
            'description',
            'target_type',
            'target_course',
            'created_by',
            'created_at',
            'expires_at',
            'options',
        ]


class PollVoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = PollVote
        fields = ['id', 'poll', 'option', 'student', 'created_at']


class PeerTransactionSerializer(serializers.ModelSerializer):
    creditor_name = serializers.CharField(source='creditor.name', read_only=True)
    debtor_name = serializers.CharField(source='debtor.name', read_only=True)
    creditor_upi_id = serializers.CharField(source='creditor.upi_id', read_only=True)

    class Meta:
        model = PeerTransaction
        fields = [
            'id',
            'creditor',
            'debtor',
            'creditor_name',
            'debtor_name',
            'creditor_upi_id',
            'amount',
            'description',
            'is_settled',
            'created_at',
        ]
        read_only_fields = [
            'id',
            'creditor',
            'debtor',
            'creditor_name',
            'debtor_name',
            'creditor_upi_id',
            'is_settled',
            'created_at',
        ]


class CourseMaterialSerializer(serializers.ModelSerializer):
    course = CourseSerializer(read_only=True)
    file_url = serializers.SerializerMethodField()

    def get_file_url(self, obj):
        if not obj.file:
            return ''
        request = self.context.get('request')
        if request:
            return request.build_absolute_uri(obj.file.url)
        return obj.file.url

    class Meta:
        model = CourseMaterial
        fields = [
            'id',
            'course',
            'title',
            'description',
            'drive_link',
            'file',
            'file_url',
            'sort_order',
            'is_published',
            'created_by',
            'created_at',
            'updated_at',
        ]


class TermSettingsSerializer(serializers.ModelSerializer):
    batch_code = serializers.SlugRelatedField(
        source='batch',
        slug_field='code',
        queryset=Batch.objects.all(),
        required=False,
        allow_null=True,
    )
    timetable_sheet_url = serializers.CharField(required=False, allow_blank=True)
    attendance_sheet_url = serializers.CharField(required=False, allow_blank=True)
    mess_menu_sheet_url = serializers.CharField(required=False, allow_blank=True)
    birthday_sheet_url = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = TermSettings
        fields = [
            'batch_code',
            'current_term_name',
            'timetable_sheet_url',
            'attendance_sheet_url',
            'mess_menu_sheet_url',
            'birthday_sheet_url',
            'updated_at',
        ]
        read_only_fields = ['updated_at']


class GradeDocumentSerializer(serializers.ModelSerializer):
    batch_code = serializers.SlugRelatedField(
        source='batch',
        slug_field='code',
        queryset=Batch.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = GradeDocument
        fields = ['id', 'batch_code', 'term_name', 'document', 'uploaded_at']
        read_only_fields = ['uploaded_at']
