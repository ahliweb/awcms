from pathlib import Path
import os


CANDIDATES = [
    Path("awcms-public/smandapbun/.env.production"),
    Path("awcms-public/smandapbun/.env.remote"),
    Path("awcms-public/smandapbun/.env.local"),
    Path("awcms-public/smandapbun/.env"),
    Path("awcms/.env.production"),
    Path("awcms/.env.remote"),
    Path("awcms/.env.local"),
    Path("awcms/.env"),
]


def parse_env(path: Path) -> dict[str, str]:
    parsed: dict[str, str] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        parsed[key.strip()] = value.strip().strip('"').strip("'")
    return parsed


values = {
    "url": "",
    "key": "",
    "tenant_id": "",
    "url_source": "",
    "key_source": "",
    "tenant_source": "",
}

for candidate in CANDIDATES:
    if not candidate.exists():
        continue
    parsed = parse_env(candidate)
    if not values["url"]:
        value = parsed.get("PUBLIC_SUPABASE_URL", "").strip() or parsed.get("VITE_SUPABASE_URL", "").strip()
        if value:
            values["url"] = value
            values["url_source"] = str(candidate)
    if not values["key"]:
        value = (
            parsed.get("PUBLIC_SUPABASE_PUBLISHABLE_KEY", "").strip()
            or parsed.get("VITE_SUPABASE_PUBLISHABLE_KEY", "").strip()
            or parsed.get("VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY", "").strip()
        )
        if value:
            values["key"] = value
            values["key_source"] = str(candidate)
    if not values["tenant_id"]:
        value = (
            parsed.get("PUBLIC_TENANT_ID", "").strip()
            or parsed.get("VITE_PUBLIC_TENANT_ID", "").strip()
            or parsed.get("VITE_TENANT_ID", "").strip()
        )
        if value:
            values["tenant_id"] = value
            values["tenant_source"] = str(candidate)

if not values["url"]:
    value = (os.environ.get("SECRET_PUBLIC_SUPABASE_URL") or "").strip()
    if value:
        values["url"] = value
        values["url_source"] = "github_secret_or_var"

if not values["key"]:
    value = (os.environ.get("SECRET_PUBLIC_SUPABASE_KEY") or "").strip()
    if value:
        values["key"] = value
        values["key_source"] = "github_secret_or_var"

if not values["tenant_id"]:
    value = (os.environ.get("SECRET_PUBLIC_TENANT_ID") or "").strip()
    if value:
        values["tenant_id"] = value
        values["tenant_source"] = "github_secret_or_var"

missing = []
if not values["url"]:
    missing.append("PUBLIC_SUPABASE_URL/VITE_SUPABASE_URL")
if not values["key"]:
    missing.append("PUBLIC_SUPABASE_PUBLISHABLE_KEY/VITE_SUPABASE_PUBLISHABLE_KEY")
if not values["tenant_id"]:
    missing.append("PUBLIC_TENANT_ID/VITE_PUBLIC_TENANT_ID/VITE_TENANT_ID")

if missing:
    raise SystemExit(
        "Missing required Smandapbun public build env: "
        + ", ".join(missing)
        + ". Set the matching GitHub Actions secret or repository variable "
        + "(recommended: SMANDAPBUN_SUPABASE_URL, SMANDAPBUN_SUPABASE_KEY, SMANDAPBUN_TENANT_ID)."
    )

output_path = os.environ["GITHUB_OUTPUT"]
with open(output_path, "a", encoding="utf-8") as output:
    output.write(f"public_supabase_url={values['url']}\n")
    output.write(f"public_supabase_key={values['key']}\n")
    output.write(f"public_tenant_id={values['tenant_id']}\n")
    output.write(f"url_source={values['url_source']}\n")
    output.write(f"key_source={values['key_source']}\n")
    output.write(f"tenant_source={values['tenant_source']}\n")

for field in ("url", "key", "tenant_id"):
    print(f"::add-mask::{values[field]}")
