from django.urls import include, path
from rest_framework.routers import DefaultRouter

from recruitment import ai_screening, auth, employer_brand, intake, interviews, question_bank, views

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
    path("api/v1/dashboard/", views.dashboard),
    path("api/v1/ai-screenings/", ai_screening.analyze),
    path("api/v1/ai-screenings/extract/", ai_screening.extract),
    path("api/v1/question-templates/", question_bank.collection),
    path("api/v1/question-templates/export/", question_bank.export),
    path("api/v1/question-templates/<int:pk>/", question_bank.detail),
    path("api/v1/employer-brand/", employer_brand.workspace),
    path("api/v1/employer-brand/enterprises/ai-options/", employer_brand.ai_options),
    path("api/v1/employer-brand/enterprises/save/", employer_brand.save_enterprise),
    path(
        "api/v1/employer-brand/enterprises/<int:pk>/delete/",
        employer_brand.delete_enterprise,
    ),
    path("api/v1/employer-brand/endorsements/save/", employer_brand.save_endorsement),
    path("api/v1/employer-brand/enterprise-suggestion/", employer_brand.suggest_enterprise),
    path("api/v1/", include(router.urls)),
]
