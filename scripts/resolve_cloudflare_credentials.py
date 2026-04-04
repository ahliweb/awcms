from pathlib import Path
import os
import re


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
    "token": "",
    "account_id": "",
    "token_source": "",
    "account_source": "",
}

for candidate in CANDIDATES:
    if not candidate.exists():
        continue
    parsed = parse_env(candidate)
    if not values["token"]:
        token = parsed.get("CLOUDFLARE_API_TOKEN", "").strip()
        if token:
            values["token"] = token
            values["token_source"] = str(candidate)
    if not values["account_id"]:
        account_id = parsed.get("CLOUDFLARE_ACCOUNT_ID", "").strip() or parsed.get("R2_ACCOUNT_ID", "").strip()
        if account_id:
            values["account_id"] = account_id
            values["account_source"] = str(candidate)
    if not values["account_id"]:
        endpoint = parsed.get("R2_S3_API_ENDPOINT", "").strip()
        match = re.search(r"https://([a-f0-9]{32})\.", endpoint)
        if match:
            values["account_id"] = match.group(1)
            values["account_source"] = f"{candidate} (derived from R2_S3_API_ENDPOINT)"

if not values["token"]:
    token = (os.environ.get("SECRET_CF_API_TOKEN") or "").strip()
    if token:
        values["token"] = token
        values["token_source"] = "github_secret"

if not values["account_id"]:
    account_id = (os.environ.get("SECRET_CF_ACCOUNT_ID") or "").strip()
    if account_id:
        values["account_id"] = account_id
        values["account_source"] = "github_actions_secret_or_var"

output_path = os.environ["GITHUB_OUTPUT"]
with open(output_path, "a", encoding="utf-8") as output:
    output.write(f"api_token={values['token']}\n")
    output.write(f"account_id={values['account_id']}\n")
    output.write(f"token_source={values['token_source']}\n")
    output.write(f"account_source={values['account_source']}\n")

if values["token"]:
    print(f"::add-mask::{values['token']}")

if values["account_id"]:
    print(f"Resolved Cloudflare account id: {values['account_id']}")
else:
    print(
        "Cloudflare account id not resolved from env files, secrets, or repository variables; "
        "preflight will derive it when the token only has one accessible account."
    )
