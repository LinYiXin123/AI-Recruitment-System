from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from recruitment.feishu_bot import OpenAICompatibleChat, build_long_connection_client


class Command(BaseCommand):
    help = "以飞书长连接方式接收私聊文字并调用已配置的大模型回复。"

    def handle(self, *args, **options):
        if not settings.FEISHU_APP_ID or not settings.FEISHU_APP_SECRET:
            raise CommandError("请先在本机 .env 配置 FEISHU_APP_ID 和 FEISHU_APP_SECRET。")
        if not all((settings.LLM_API_BASE_URL, settings.LLM_API_KEY, settings.LLM_MODEL)):
            raise CommandError("请先在本机 .env 配置 LLM_API_BASE_URL、LLM_API_KEY 和 LLM_MODEL。")

        chat = OpenAICompatibleChat(
            base_url=settings.LLM_API_BASE_URL,
            api_key=settings.LLM_API_KEY,
            model=settings.LLM_MODEL,
        )
        self.stdout.write("正在连接飞书机器人；保持此终端运行后，私聊文字会交给模型生成回复。")
        build_long_connection_client(
            settings.FEISHU_APP_ID,
            settings.FEISHU_APP_SECRET,
            chat.reply,
        ).start()
