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
    path("api/v1/ai-screenings/<int:pk>/", ai_screening.detail),
    path("api/v1/ai-screenings/<int:pk>/questions/", ai_screening.save_questions),
    path("api/v1/question-templates/", question_bank.collection),
    path("api/v1/question-templates/export/", question_bank.export),
    path("api/v1/question-templates/<int:pk>/", question_bank.detail),
    path("api/v1/employer-brand/", employer_brand.workspace),
    path("api/v1/employer-brand/coordination/", employer_brand.coordination),
    path("api/v1/employer-brand/job-enterprise/", employer_brand.link_job),
    path("api/v1/employer-brand/issues/", employer_brand.create_issue),
    path(
        "api/v1/employer-brand/issues/<int:pk>/answer/",
        employer_brand.update_issue,
        {"action": "answer"},
    ),
    path(
        "api/v1/employer-brand/issues/<int:pk>/close/",
        employer_brand.update_issue,
        {"action": "close"},
    ),
    path(
        "api/v1/employer-brand/issues/<int:pk>/reassign/",
        employer_brand.update_issue,
        {"action": "reassign"},
    ),
    path("api/v1/employer-brand/enterprises/<int:pk>/ai-context/", employer_brand.ai_context),
    path("api/v1/employer-brand/enterprises/ai-options/", employer_brand.ai_options),
    path("api/v1/employer-brand/enterprises/save/", employer_brand.save_enterprise),
    path(
        "api/v1/employer-brand/enterprises/<int:pk>/delete/",
        employer_brand.delete_enterprise,
    ),
    path("api/v1/employer-brand/endorsements/save/", employer_brand.save_endorsement),
    path(
        "api/v1/employer-brand/endorsements/<int:pk>/delete/",
        employer_brand.set_endorsement_deleted,
        {"deleted": True},
    ),
    path(
        "api/v1/employer-brand/endorsements/<int:pk>/restore/",
        employer_brand.set_endorsement_deleted,
        {"deleted": False},
    ),
    path("api/v1/employer-brand/enterprise-suggestion/", employer_brand.suggest_enterprise),
    path("api/v1/", include(router.urls)),
]
