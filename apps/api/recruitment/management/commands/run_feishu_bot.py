from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from recruitment.feishu_bot import build_long_connection_client


class Command(BaseCommand):
    help = "以飞书长连接方式接收私聊文字并发送本地联调回复。"

    def handle(self, *args, **options):
        if not settings.FEISHU_APP_ID or not settings.FEISHU_APP_SECRET:
            raise CommandError("请先在本机 .env 配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET。")

        self.stdout.write("正在连接飞书机器人；保持此终端运行后，在飞书私聊发送文字即可测试。")
        build_long_connection_client(settings.FEISHU_APP_ID, settings.FEISHU_APP_SECRET).start()
