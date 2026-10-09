import json

from django.core.management.base import BaseCommand, CommandError

from recruitment.feishu_departments import DepartmentSyncError, sync_departments


class Command(BaseCommand):
    help = "预览飞书可访问部门目录；加 --apply 才保存，不修改角色授权或职位归属。"

    def add_arguments(self, parser):
        parser.add_argument("--organization", required=True, type=int, help="明确的本地组织 ID")
        parser.add_argument("--apply", action="store_true", help="完整校验后原子保存目录")
        parser.add_argument(
            "--bind-local", help="显式绑定一个既有部门：本地部门ID=飞书open_department_id"
        )

    def handle(self, *args, **options):
        bind_local = None
        if options["bind_local"]:
            try:
                local_id, external_id = options["bind_local"].split("=", 1)
                if not external_id or int(local_id) <= 0:
                    raise ValueError
                bind_local = (int(local_id), external_id)
            except ValueError as exc:
                raise CommandError(
                    "--bind-local 格式应为：本地部门ID=飞书open_department_id"
                ) from exc
        try:
            records = sync_departments(
                options["organization"], apply=options["apply"], bind_local=bind_local
            )
        except DepartmentSyncError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(
            json.dumps(
                {
                    "applied": options["apply"],
                    "organization": options["organization"],
                    "bind_local": options["bind_local"],
                    "department_count": len(records),
                    "departments": [
                        {"open_department_id": key, **record}
                        for key, record in sorted(records.items())
                    ],
                },
                ensure_ascii=False,
            )
        )
