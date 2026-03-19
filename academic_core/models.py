from django.contrib.auth.hashers import check_password, make_password
from django.core.validators import RegexValidator
from django.db import models

WHATSAPP_10_DIGIT_VALIDATOR = RegexValidator(
    regex=r'^\d{10}$',
    message='Enter a valid 10 digit WhatsApp number.',
)


class Batch(models.Model):
    code = models.CharField(max_length=10, primary_key=True)
    name = models.CharField(max_length=50, blank=True, default='')
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['code']
        indexes = [
            models.Index(fields=['is_active', 'code']),
        ]

    def __str__(self) -> str:
        return self.code


class Student(models.Model):
    SECTION_CHOICES = [('A', 'A'), ('B', 'B')]

    roll_number = models.CharField(max_length=15, primary_key=True)
    batch = models.ForeignKey(Batch, on_delete=models.PROTECT, null=True, blank=True, related_name='students')
    name = models.CharField(max_length=100)
    section = models.CharField(max_length=1, choices=SECTION_CHOICES)
    email = models.EmailField(unique=True)
    upi_id = models.CharField(max_length=50, blank=True, null=True)
    password = models.CharField(max_length=128, blank=True, default='')
    date_of_birth = models.DateField(null=True, blank=True)
    is_ipmo = models.BooleanField(default=False, db_index=True)

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

    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, null=True, blank=True, related_name='class_sessions')
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
    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, null=True, blank=True, related_name='attendance_records')
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


class AttendanceWaiverRequest(models.Model):
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='attendance_waivers')
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='attendance_waivers')
    reason = models.TextField(blank=True)
    supporting_file = models.FileField(upload_to='attendance_waivers/%Y/%m/')
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='pending', db_index=True)
    review_notes = models.TextField(blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=['student', 'submitted_at']),
            models.Index(fields=['course', 'status']),
        ]

    def __str__(self) -> str:
        return f'{self.student.roll_number} | {self.course.code} | {self.status}'


class StudentCourse(models.Model):
    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, null=True, blank=True, related_name='student_courses')
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
    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, null=True, blank=True, related_name='mess_menu_rows')
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
    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, null=True, blank=True, related_name='announcements')
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
    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, null=True, blank=True, related_name='assignments')
    course = models.ForeignKey(Course, on_delete=models.CASCADE, related_name='assignments')
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    due_date = models.DateField(db_index=True)
    due_time = models.TimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['due_date']),
            models.Index(fields=['course', 'due_date']),
        ]

    def __str__(self) -> str:
        return f'{self.course.code} - {self.title} ({self.due_date})'


class Poll(models.Model):
    TARGET_TYPE_CHOICES = [
        ('ALL', 'All Students in Batch'),
        ('SECTION_A', 'Section A'),
        ('SECTION_B', 'Section B'),
        ('COURSE', 'Specific Course'),
    ]

    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, null=True, blank=True, related_name='polls')
    title = models.CharField(max_length=220)
    description = models.TextField(blank=True)
    target_type = models.CharField(max_length=12, choices=TARGET_TYPE_CHOICES, default='ALL', db_index=True)
    target_course = models.ForeignKey(
        Course,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='polls',
    )
    created_by = models.CharField(max_length=100)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=['batch', 'target_type']),
            models.Index(fields=['expires_at', 'created_at']),
        ]

    def __str__(self) -> str:
        return self.title


class PollOption(models.Model):
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='options')
    text = models.CharField(max_length=220)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['poll', 'id']),
        ]

    def __str__(self) -> str:
        return f'{self.poll_id} - {self.text}'


class PollVote(models.Model):
    poll = models.ForeignKey(Poll, on_delete=models.CASCADE, related_name='votes')
    option = models.ForeignKey(PollOption, on_delete=models.CASCADE, related_name='votes')
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='poll_votes')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('poll', 'student')]
        indexes = [
            models.Index(fields=['poll', 'option']),
            models.Index(fields=['student', 'poll']),
        ]

    def __str__(self) -> str:
        return f'{self.student_id} -> {self.poll_id}:{self.option_id}'


class PeerTransaction(models.Model):
    creditor = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name='money_to_receive',
    )
    debtor = models.ForeignKey(
        Student,
        on_delete=models.CASCADE,
        related_name='money_to_pay',
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.CharField(max_length=255)
    is_settled = models.BooleanField(default=False, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=['debtor', 'is_settled']),
            models.Index(fields=['creditor', 'is_settled']),
        ]

    def __str__(self) -> str:
        return f'{self.debtor_id} owes {self.creditor_id} Rs {self.amount}'


class TermSettings(models.Model):
    batch = models.OneToOneField(
        Batch,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='term_settings',
    )
    current_term_name = models.CharField(max_length=30, default='Term-IX')
    timetable_sheet_url = models.URLField(blank=True, default='')
    attendance_sheet_url = models.URLField(blank=True, default='')
    mess_menu_sheet_url = models.URLField(blank=True, default='')
    birthday_sheet_url = models.URLField(blank=True, default='')
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f'Term Settings ({self.current_term_name})'


class GradeDocument(models.Model):
    batch = models.ForeignKey(Batch, on_delete=models.CASCADE, null=True, blank=True, related_name='grade_documents')
    term_name = models.CharField(max_length=30)
    document = models.FileField(upload_to='grades/%Y/')
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=['term_name', '-uploaded_at']),
        ]

    def __str__(self) -> str:
        return f'{self.term_name} ({self.uploaded_at})'


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


class CabPool(models.Model):
    creator = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='cab_pools')
    destination = models.CharField(max_length=120)
    departure_date = models.DateField(db_index=True)
    time_window = models.CharField(max_length=60)
    available_seats = models.IntegerField()
    whatsapp_number = models.CharField(
        max_length=10,
        validators=[WHATSAPP_10_DIGIT_VALIDATOR],
    )
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=['is_active', 'departure_date']),
            models.Index(fields=['-created_at']),
        ]

    def __str__(self) -> str:
        return f'{self.destination} | {self.departure_date} | {self.creator.roll_number}'


class BlinkitPool(models.Model):
    ORDER_TYPE_CHOICES = [
        ('blinkit', 'Blinkit'),
        ('night_mess', 'Night Mess'),
    ]

    creator = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='blinkit_pools')
    hostel_block = models.CharField(max_length=80)
    order_type = models.CharField(max_length=20, choices=ORDER_TYPE_CHOICES, default='blinkit')
    order_deadline = models.TimeField()
    whatsapp_number = models.CharField(
        max_length=10,
        validators=[WHATSAPP_10_DIGIT_VALIDATOR],
    )
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=['is_active', '-created_at']),
        ]

    def __str__(self) -> str:
        return f'{self.hostel_block} | {self.creator.roll_number}'


class SellPost(models.Model):
    creator = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='sell_posts')
    title = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    expected_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    whatsapp_number = models.CharField(
        max_length=10,
        validators=[WHATSAPP_10_DIGIT_VALIDATOR],
    )
    is_active = models.BooleanField(default=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        indexes = [
            models.Index(fields=['is_active', '-created_at']),
        ]

    def __str__(self) -> str:
        return f'{self.title} | {self.creator.roll_number}'
