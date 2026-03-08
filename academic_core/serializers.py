from rest_framework import serializers

from academic_core.models import (
    Announcement,
    Assignment,
    AttendanceRecord,
    ClassSession,
    Course,
    CourseMaterial,
    MessMenu,
    Student,
)


class CourseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Course
        fields = ['code', 'name', 'credits', 'drive_link']


class StudentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Student
        fields = ['roll_number', 'name', 'section', 'email', 'date_of_birth']


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

    class Meta:
        model = Assignment
        fields = ['id', 'course', 'title', 'description', 'due_date', 'created_at']


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
