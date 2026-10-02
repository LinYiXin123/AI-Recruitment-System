import csv
from collections.abc import Mapping

from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.decorators import api_view
from rest_framework.exceptions import PermissionDenied
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response

from .access import member
from .errors import Conflict
from .models import DepartmentRole, QuestionTemplate, QuestionTemplateEvent


class QuestionSerializer(serializers.ModelSerializer):
    request_key = serializers.UUIDField(write_only=True)

    class Meta:
        model = QuestionTemplate
        fields = [
            "id",
            "request_key",
            "content",
            "job_title",
            "dimension",
            "difficulty",
            "reference_answer",
            "version",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "version", "created_at", "updated_at"]
        extra_kwargs = {
            "job_title": {"default": ""},
            "dimension": {"default": ""},
            "difficulty": {"default": QuestionTemplate.Difficulty.MEDIUM},
            "reference_answer": {"default": ""},
        }

    def to_internal_value(self, data):
        if isinstance(data, Mapping):
            for field in ("content", "job_title", "dimension", "difficulty", "reference_answer"):
                if field in data and not isinstance(data[field], str):
                    raise serializers.ValidationError({field: "请填写文本。"})
        return super().to_internal_value(data)


class VersionInput(serializers.Serializer):
    version = serializers.IntegerField(min_value=1)


class FilterInput(serializers.Serializer):
    q = serializers.CharField(max_length=200, allow_blank=True, required=False)
    job_title = serializers.CharField(max_length=120, allow_blank=True, required=False)
    dimension = serializers.ChoiceField(
        choices=QuestionTemplate.Dimension.choices, allow_blank=True, required=False
    )
    difficulty = serializers.ChoiceField(
        choices=QuestionTemplate.Difficulty.choices, allow_blank=True, required=False
    )


def can_manage(membership):
    return DepartmentRole.objects.filter(
        membership=membership,
        department__organization=membership.organization,
        role__in=[DepartmentRole.Role.HR, DepartmentRole.Role.SUPERVISOR],
    ).exists()


def require_editor(membership):
    if not can_manage(membership):
        raise PermissionDenied("仅 HR 或招聘主管可维护面试题库。")


def visible_questions(membership):
    return QuestionTemplate.objects.filter(
        organization=membership.organization, deleted_at__isnull=True
    )


def filtered_questions(request, membership):
    serializer = FilterInput(data=request.query_params)
    serializer.is_valid(raise_exception=True)
    filters = serializer.validated_data
    rows = visible_questions(membership)
    query = filters.pop("q", "")
    if query:
        rows = rows.filter(
            Q(content__icontains=query)
            | Q(job_title__icontains=query)
            | Q(reference_answer__icontains=query)
        )
    return rows.filter(**{key: value for key, value in filters.items() if value})


@api_view(["GET", "POST"])
def collection(request):
    membership = member(request)
    if request.method == "GET":
        paginator = PageNumberPagination()
        rows = paginator.paginate_queryset(filtered_questions(request, membership), request)
        return Response(
            {
                "items": QuestionSerializer(rows, many=True).data,
                "count": paginator.page.paginator.count,
                "page": paginator.page.number,
                "page_size": paginator.page_size,
                "can_manage": can_manage(membership),
                "job_titles": list(
                    visible_questions(membership)
                    .exclude(job_title="")
                    .order_by("job_title")
                    .values_list("job_title", flat=True)
                    .distinct()
                ),
            }
        )

    require_editor(membership)
    serializer = QuestionSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    data = serializer.validated_data
    request_key = data.pop("request_key")
    with transaction.atomic():
        question, created = QuestionTemplate.objects.select_for_update().get_or_create(
            organization=membership.organization, request_key=request_key, defaults=data
        )
        if question.deleted_at or any(
            getattr(question, field) != value for field, value in data.items()
        ):
            raise Conflict("这次新增请求已经处理，内容已变化，请刷新题库后确认。")
        if created:
            QuestionTemplateEvent.objects.create(
                question=question, actor=membership, action="created", version=question.version
            )
    return Response(QuestionSerializer(question).data, status=201 if created else 200)


@api_view(["GET", "PATCH", "DELETE"])
def detail(request, pk):
    membership = member(request)
    if request.method == "GET":
        question = get_object_or_404(visible_questions(membership), pk=pk)
        return Response(QuestionSerializer(question).data)

    require_editor(membership)
    version = VersionInput(data=request.data)
    version.is_valid(raise_exception=True)
    with transaction.atomic():
        question = get_object_or_404(visible_questions(membership).select_for_update(), pk=pk)
        if version.validated_data["version"] != question.version:
            raise Conflict()
        if request.method == "DELETE":
            question.deleted_at = timezone.now()
            action = "deleted"
        else:
            serializer = QuestionSerializer(question, data=request.data, partial=True)
            serializer.is_valid(raise_exception=True)
            # 创建请求标识固定，更新时只接受题目内容字段。
            serializer.validated_data.pop("request_key", None)
            for field, value in serializer.validated_data.items():
                setattr(question, field, value)
            action = "updated"
        question.version += 1
        question.save()
        QuestionTemplateEvent.objects.create(
            question=question, actor=membership, action=action, version=question.version
        )
    return Response(
        {"deleted": True} if request.method == "DELETE" else QuestionSerializer(question).data
    )


@api_view(["GET"])
def export(request):
    membership = member(request)
    rows = filtered_questions(request, membership)
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = 'attachment; filename="question-bank.csv"'
    response.write("\ufeff")
    writer = csv.writer(response)
    writer.writerow(["题目内容", "适用职位", "考察维度", "难度", "参考答案要点"])
    for question in rows.iterator():
        values = [
            question.content,
            question.job_title,
            question.dimension,
            question.difficulty,
            question.reference_answer,
        ]
        writer.writerow(
            [
                "'" + value
                if value.lstrip(" \t\r\n\ufeff").startswith(("=", "+", "-", "@"))
                or value.startswith(("\t", "\r", "\n"))
                else value
                for value in values
            ]
        )
    return response
