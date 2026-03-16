"""
WSGI config for ipm_portal project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/6.0/howto/deployment/wsgi/
"""

import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'ipm_portal.settings')

application = get_wsgi_application()

try:
    from django.contrib.auth.models import User
    if not User.objects.filter(username='ADMIN').exists():
        User.objects.create_superuser('ADMIN', 'admin@ipm.com', 'admin123')
        print("Auto-created ADMIN superuser successfully on startup.")
except Exception as e:
    print(f"Skipping auto-admin creation: {e}")
