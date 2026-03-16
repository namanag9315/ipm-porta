from django.contrib import admin

from academic_core.models import (
    Announcement,
    Assignment,
    AttendanceWaiverRequest,
    Batch,
    BlinkitPool,
    CabPool,
    Course,
    CourseMaterial,
    GradeDocument,
    Poll,
    PollOption,
    PollVote,
    SellPost,
    TermSettings,
)


@admin.register(Batch)
class BatchAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'is_active', 'created_at')
    list_filter = ('is_active',)
    search_fields = ('code', 'name')
    ordering = ('code',)


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ('title', 'posted_by', 'starts_at', 'expires_at', 'created_at')
    list_filter = ('starts_at', 'expires_at', 'created_at')
    search_fields = ('title', 'content', 'posted_by')
    ordering = ('-created_at',)


@admin.register(Assignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = ('title', 'course', 'due_date', 'due_time', 'created_at')
    list_filter = ('course', 'due_date', 'due_time')
    search_fields = ('title', 'description', 'course__code', 'course__name')
    ordering = ('due_date', '-created_at')


@admin.register(Poll)
class PollAdmin(admin.ModelAdmin):
    list_display = ('title', 'batch', 'target_type', 'target_course', 'created_by', 'expires_at', 'created_at')
    list_filter = ('batch', 'target_type', 'created_at', 'expires_at')
    search_fields = ('title', 'description', 'created_by', 'target_course__code', 'target_course__name')
    ordering = ('-created_at',)


@admin.register(PollOption)
class PollOptionAdmin(admin.ModelAdmin):
    list_display = ('poll', 'text', 'created_at')
    search_fields = ('poll__title', 'text')
    ordering = ('poll', 'id')


@admin.register(PollVote)
class PollVoteAdmin(admin.ModelAdmin):
    list_display = ('poll', 'option', 'student', 'created_at')
    list_filter = ('poll', 'created_at')
    search_fields = ('poll__title', 'option__text', 'student__roll_number', 'student__name')
    ordering = ('-created_at',)


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'credits', 'drive_link')
    search_fields = ('code', 'name')
    ordering = ('code',)


@admin.register(CourseMaterial)
class CourseMaterialAdmin(admin.ModelAdmin):
    list_display = (
        'title',
        'course',
        'sort_order',
        'is_published',
        'created_by',
        'created_at',
    )
    list_filter = ('course', 'is_published', 'created_at')
    search_fields = ('title', 'description', 'course__code', 'course__name')
    ordering = ('course__code', 'sort_order', '-created_at')


@admin.register(AttendanceWaiverRequest)
class AttendanceWaiverRequestAdmin(admin.ModelAdmin):
    list_display = ('student', 'course', 'status', 'submitted_at')
    list_filter = ('status', 'course', 'submitted_at')
    search_fields = (
        'student__roll_number',
        'student__name',
        'course__code',
        'course__name',
        'reason',
        'review_notes',
    )
    ordering = ('-submitted_at',)


@admin.register(CabPool)
class CabPoolAdmin(admin.ModelAdmin):
    list_display = (
        'destination',
        'departure_date',
        'time_window',
        'available_seats',
        'creator',
        'is_active',
        'created_at',
    )
    list_filter = ('departure_date', 'is_active', 'created_at')
    search_fields = ('destination', 'time_window', 'creator__roll_number', 'creator__name')
    ordering = ('-created_at',)


@admin.register(BlinkitPool)
class BlinkitPoolAdmin(admin.ModelAdmin):
    list_display = (
        'order_type',
        'hostel_block',
        'order_deadline',
        'creator',
        'is_active',
        'created_at',
    )
    list_filter = ('order_type', 'hostel_block', 'is_active', 'created_at')
    search_fields = ('hostel_block', 'creator__roll_number', 'creator__name')
    ordering = ('-created_at',)


@admin.register(SellPost)
class SellPostAdmin(admin.ModelAdmin):
    list_display = ('title', 'expected_price', 'creator', 'is_active', 'created_at')
    list_filter = ('is_active', 'created_at')
    search_fields = ('title', 'description', 'creator__roll_number', 'creator__name')
    ordering = ('-created_at',)


@admin.register(TermSettings)
class TermSettingsAdmin(admin.ModelAdmin):
    list_display = (
        'batch',
        'current_term_name',
        'timetable_sheet_url',
        'attendance_sheet_url',
        'mess_menu_sheet_url',
        'birthday_sheet_url',
        'updated_at',
    )
    search_fields = ('batch__code', 'batch__name', 'current_term_name')
    ordering = ('batch__code',)


@admin.register(GradeDocument)
class GradeDocumentAdmin(admin.ModelAdmin):
    list_display = ('batch', 'term_name', 'document', 'uploaded_at')
    list_filter = ('batch', 'term_name', 'uploaded_at')
    search_fields = ('term_name', 'batch__code', 'batch__name')
    ordering = ('-uploaded_at',)
