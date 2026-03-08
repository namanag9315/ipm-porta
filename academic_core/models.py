from django.contrib.auth.hashers import check_password, make_password
from django.db import models


class Student(models.Model):
    SECTION_CHOICES = [('A', 'A'), ('B', 'B')]

    roll_number = models.CharField(max_length=15, primary_key=True)
    name = models.CharField(max_length=100)
    section = models.CharField(max_length=1, choices=SECTION_CHOICES)
    email = models.EmailField(unique=True)
    password = models.CharField(max_length=128, blank=True, default='')
    date_of_birth = models.DateField(null=True, blank=True)

    class Meta:
        indexes = [
            models.Index(fields=['section']),
        ]

    def __str__(self) -> str:
        return f'{self.roll_number} - {self.name}'

    def set_password(self, raw_password: str) -> None:
        self.password = make_password(raw_password)

    def check_password(self, raw_password: str) -> bool:
        return check_password(raw_password, self.password)


class Course(models.Model):
    code = models.CharField(max_length=10, primary_key=True)
    name = models.CharField(max_length=150)
    credits = models.IntegerField()
    drive_link = models.URLField(blank=True, null=True)

    class Meta:
        indexes = [
            models.Index(fields=['name']),
        ]

    def __str__(self) -> str:
        return f'{self.code} - {self.name}'


class ClassSession(models.Model):
    TARGET_SECTION_CHOICES = [('A', 'A'), ('B', 'B'), ('All', 'All')]

    date = models.DateField(db_index=True)
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    room = models.CharField(max_length=20)
    course = models.ForeignKey(Course, on_delete=models.CASCADE, null=True, blank=True)
    raw_text = models.CharField(max_length=255)
    is_exam = models.BooleanField(default=False)
    target_section = models.CharField(max_length=3, choices=TARGET_SECTION_CHOICES, default='All')

    class Meta:
        indexes = [
            models.Index(fields=['date', 'start_time']),
            models.Index(fields=['course', 'date']),
            models.Index(fields=['is_exam', 'date']),
        ]

    def __str__(self) -> str:
        course_code = self.course.code if self.course else 'N/A'
        return (
            f'{self.date} {self.start_time}-{self.end_time} | '
            f'{course_code} | {self.room}'
        )


class AttendanceRecord(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE)
    course = models.ForeignKey(Course, on_delete=models.CASCADE)
    total_delivered = models.IntegerField(default=0)
    total_attended = models.IntegerField(default=0)
    percentage = models.FloatField(default=0.0)
    last_updated = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ['student', 'course']
        indexes = [
            models.Index(fields=['last_updated']),
        ]

    def __str__(self) -> str:
        return f'{self.student.roll_number} | {self.course.code} | {self.percentage:.2f}%'


class StudentCourse(models.Model):
    student = models.ForeignKey(Student, on_delete=models.CASCADE)
    course = models.ForeignKey(Course, on_delete=models.CASCADE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['student', 'course']
        indexes = [
            models.Index(fields=['student', 'course']),
        ]

    def __str__(self) -> str:
        return f'{self.student.roll_number} -> {self.course.code}'


class MessMenu(models.Model):
    date = models.DateField(db_index=True)
    category = models.CharField(max_length=50)
    item_name = models.CharField(max_length=100)

    class Meta:
        indexes = [
            models.Index(fields=['date', 'category']),
        ]

    def __str__(self) -> str:
        return f'{self.date} | {self.category} | {self.item_name}'


class Announcement(models.Model):
    title = models.CharField(max_length=200)
    content = models.TextField()
    posted_by = models.CharField(max_length=100)
    starts_at = models.DateTimeField(null=True, blank=True, db_index=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    attachment = models.FileField(
        upload_to='announcement_attachments/%Y/%m/',
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=['-created_at']),
        ]

    def __str__(self) -> str:
        return f'{self.title} ({self.posted_by})'


class Assignment(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='assignments')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    due_date = models.DateField(db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['due_date']),
            models.Index(fields=['course', 'due_date']),
        ]

    def __str__(self) -> str:
        return f'{self.course.code} - {self.title} ({self.due_date})'


class CourseMaterial(models.Model):
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='materials')
    title = models.CharField(max_length=220)
    description = models.TextField(blank=True)
    drive_link = models.URLField(blank=True, null=True)
    file = models.FileField(upload_to='course_materials/%Y/%m/', blank=True, null=True)
    sort_order = models.PositiveIntegerField(default=0, db_index=True)
    is_published = models.BooleanField(default=True, db_index=True)
    created_by = models.CharField(max_length=100, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [
            models.Index(fields=['course', 'sort_order']),
            models.Index(fields=['course', 'is_published']),
        ]

    def __str__(self) -> str:
        return f'{self.course.code} | {self.title}'
