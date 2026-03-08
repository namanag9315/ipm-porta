from django.contrib import admin

from academic_core.models import Announcement, Assignment, Course, CourseMaterial


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = ('title', 'posted_by', 'starts_at', 'expires_at', 'created_at')
    list_filter = ('starts_at', 'expires_at', 'created_at')
    search_fields = ('title', 'content', 'posted_by')
    ordering = ('-created_at',)


@admin.register(Assignment)
class AssignmentAdmin(admin.ModelAdmin):
    list_display = ('title', 'course', 'due_date', 'created_at')
    list_filter = ('course', 'due_date')
    search_fields = ('title', 'description', 'course__code', 'course__name')
    ordering = ('due_date', '-created_at')


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
