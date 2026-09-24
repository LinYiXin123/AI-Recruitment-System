from django.urls import include, path
from rest_framework.routers import DefaultRouter

from recruitment import auth, intake, interviews, views

router = DefaultRouter()
router.register("jobs", views.JobViewSet, basename="jobs")
router.register("tasks", views.TaskViewSet, basename="tasks")
router.register("imports", intake.ImportViewSet, basename="imports")
router.register("candidates", intake.CandidateViewSet, basename="candidates")
router.register("applications", intake.ApplicationViewSet, basename="applications")
router.register("documents", intake.DocumentViewSet, basename="documents")
router.register("interviews", interviews.InterviewViewSet, basename="interviews")
urlpatterns = [
    path("api/v1/auth/csrf/", auth.csrf),
    path("api/v1/auth/login/", auth.sign_in),
    path("api/v1/auth/experience/", auth.start_local_experience),
    path("api/v1/auth/logout/", auth.sign_out),
    path("api/v1/me/", views.me),
    path("api/v1/", include(router.urls)),
]
