"""验收专用数据库：仅重建明确保留的本地测试库。"""

import os
import subprocess
import sys

import psycopg
from psycopg import sql

if os.environ.get("PGDATABASE") != "recruitment_e2e" or os.environ.get("DJANGO_DEBUG") != "1":
    raise SystemExit("只允许初始化本地 recruitment_e2e 验收数据库。")
if os.environ.get("PGHOST") not in ["127.0.0.1", "localhost"]:
    raise SystemExit("验收库必须位于本机。")
with psycopg.connect(dbname="postgres", autocommit=True) as conn:
    conn.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier("recruitment_e2e")))
    conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier("recruitment_e2e")))
subprocess.run([sys.executable, "manage.py", "migrate", "--noinput"], check=True)
subprocess.run([sys.executable, "manage.py", "seed_local"], check=True)
