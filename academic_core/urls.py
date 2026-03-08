from django.urls import path

from academic_core.views import (
    admin_ai_arrange_materials,
    admin_ai_generate_announcement,
    admin_announcement_detail,
    admin_announcements,
    admin_course_material_detail,
    admin_course_materials,
    admin_course_detail,
    admin_courses,
    admin_run_sync,
    change_student_password,
    get_dashboard_extras,
    get_mess_menu,
    get_or_update_student_profile,
    get_student_attendance,
    get_student_readings,
    get_student_timetable,
    login_admin,
    logout_admin,
)

urlpatterns = [
    path('attendance/<str:roll_number>/', get_student_attendance, name='student-attendance'),
    path('timetable/<str:roll_number>/', get_student_timetable, name='student-timetable'),
    path('readings/<str:roll_number>/', get_student_readings, name='student-readings'),
    path('mess-menu/', get_mess_menu, name='mess-menu'),
    path('dashboard-extras/', get_dashboard_extras, name='dashboard-extras'),
    path('profile/<str:roll_number>/', get_or_update_student_profile, name='student-profile'),
    path(
        'profile/<str:roll_number>/change-password/',
        change_student_password,
        name='student-change-password',
    ),
    path('admin/login/', login_admin, name='admin-login'),
    path('admin/logout/', logout_admin, name='admin-logout'),
    path('admin/run-sync/', admin_run_sync, name='admin-run-sync'),
    path('admin/courses/', admin_courses, name='admin-courses'),
    path('admin/courses/<str:course_code>/', admin_course_detail, name='admin-course-detail'),
    path('admin/announcements/', admin_announcements, name='admin-announcements'),
    path(
        'admin/announcements/<int:announcement_id>/',
        admin_announcement_detail,
        name='admin-announcement-detail',
    ),
    path('admin/course-materials/', admin_course_materials, name='admin-course-materials'),
    path(
        'admin/course-materials/<int:material_id>/',
        admin_course_material_detail,
        name='admin-course-material-detail',
    ),
    path(
        'admin/ai/generate-announcement/',
        admin_ai_generate_announcement,
        name='admin-ai-generate-announcement',
    ),
    path(
        'admin/ai/arrange-materials/',
        admin_ai_arrange_materials,
        name='admin-ai-arrange-materials',
    ),
]
