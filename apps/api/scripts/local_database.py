"""复用 PostgreSQL 可执行文件，为本项目启动独立的本机数据库。"""

import secrets
import shutil
import subprocess
import sys
from pathlib import Path

import psycopg

root = Path(__file__).resolve().parents[3]
api = root / "apps/api"
state = root / ".local"
state.mkdir(mode=0o700, exist_ok=True)
env_file = api / ".env"
if not env_file.exists():
    password = secrets.token_urlsafe(32)
    values = {
        "DJANGO_DEBUG": "1",
        "DJANGO_SECRET_KEY": secrets.token_urlsafe(64),
        "PGDATABASE": "recruitment",
        "PGUSER": "recruitment",
        "PGPASSWORD": password,
        "PGHOST": "127.0.0.1",
        "PGPORT": "55432",
        "LOCAL_ACCOUNT_PASSWORD": secrets.token_urlsafe(18),
    }
    env_file.write_text("".join(f"{key}={value}\n" for key, value in values.items()))
    env_file.chmod(0o600)
else:
    values = dict(
        line.split("=", 1)
        for line in env_file.read_text().splitlines()
        if line and not line.startswith("#")
    )
if values.get("PGHOST") != "127.0.0.1" or values.get("PGPORT") != "55432":
    raise SystemExit("已有环境配置指向其他数据库，本脚本不会启动或改动它。")
executable_suffix = ".exe" if sys.platform == "win32" else ""
portable_bin_dir = state / "postgres-bin" / "pgsql" / "bin"
portable_pg_ctl = portable_bin_dir / f"pg_ctl{executable_suffix}"
pg_ctl_path = Path(shutil.which("pg_ctl")) if shutil.which("pg_ctl") else None
bin_dir = portable_bin_dir if portable_pg_ctl.exists() else None
if not bin_dir and pg_ctl_path:
    bin_dir = pg_ctl_path.parent
if not bin_dir and shutil.which("brew"):
    prefix = subprocess.check_output(["brew", "--prefix", "postgresql@18"], text=True).strip()
    bin_dir = Path(prefix) / "bin"


def postgres_command(name):
    return str(bin_dir / f"{name}{executable_suffix}")


if not bin_dir or not Path(postgres_command("pg_ctl")).exists():
    raise SystemExit("未找到 PostgreSQL 18，可先使用根目录 Compose 数据库方案。")
pg_data = state / "postgres"
if not (pg_data / "PG_VERSION").exists():
    password_file = state / "postgres-password"
    password_file.write_text(values["PGPASSWORD"])
    password_file.chmod(0o600)
    try:
        subprocess.run(
            [
                postgres_command("initdb"),
                "-D",
                str(pg_data),
                "-U",
                values["PGUSER"],
                "--auth=scram-sha-256",
                f"--pwfile={password_file}",
            ],
            check=True,
        )
    finally:
        password_file.unlink(missing_ok=True)
status = subprocess.run(
    [postgres_command("pg_ctl"), "-D", str(pg_data), "status"], capture_output=True
)
if status.returncode:
    subprocess.run(
        [
            postgres_command("pg_ctl"),
            "-D",
            str(pg_data),
            "-l",
            str(state / "postgres.log"),
            "-o",
            "-p 55432 -h 127.0.0.1",
            "start",
        ],
        check=True,
    )
with psycopg.connect(
    dbname="postgres",
    user=values["PGUSER"],
    password=values["PGPASSWORD"],
    host=values["PGHOST"],
    port=values["PGPORT"],
    autocommit=True,
) as conn:
    if not conn.execute(
        "SELECT 1 FROM pg_database WHERE datname = %s", ("recruitment",)
    ).fetchone():
        conn.execute("CREATE DATABASE recruitment")
access_file = state / "体验账号.txt"
access_file.write_text(
    "仅本机开发体验，账号与组织均为虚构。\n后台：http://localhost:5174/\n"
    "HR：local_hr\n用人负责人：local_manager\n另一个 HR：local_other_hr\n"
    f"本地密码：{values.get('LOCAL_ACCOUNT_PASSWORD', '尚未设置')}\n"
)
access_file.chmod(0o600)
print("独立 PostgreSQL 已就绪，端口 55432。环境和体验账号保存在忽略提交的本机文件中。")
