from django.urls import include, path
from rest_framework.routers import DefaultRouter

from recruitment import auth, views

router = DefaultRouter()
router.register("jobs", views.JobViewSet, basename="jobs")
router.register("tasks", views.TaskViewSet, basename="tasks")
urlpatterns = [
    path("api/v1/auth/csrf/", auth.csrf),
    path("api/v1/auth/login/", auth.sign_in),
    path("api/v1/auth/logout/", auth.sign_out),
    path("api/v1/me/", views.me),
    path("api/v1/", include(router.urls)),
]
