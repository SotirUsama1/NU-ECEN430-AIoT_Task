#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
terraform_dir="$project_dir/terraform"
env_file="$project_dir/dashboard.env"
temp_env_file="$(mktemp "$project_dir/dashboard.env.tmp.XXXXXX")"
trap 'rm -f -- "$temp_env_file"' EXIT

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to build and run the dashboard container." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker is not available. Start Docker and retry." >&2
  exit 1
fi

home_dir="${HOME:?HOME must be set to locate AWS credentials and the SSH key}"
aws_config_dir="${AWS_CONFIG_DIR:-$home_dir/.aws}"
ssh_known_hosts="$home_dir/.ssh/known_hosts"
if [[ ! -d "$aws_config_dir" ]]; then
  echo "AWS config directory not found: $aws_config_dir (set AWS_CONFIG_DIR if it is elsewhere)." >&2
  exit 1
fi
if [[ ! -r "$ssh_known_hosts" ]]; then
  echo "SSH known-hosts file not found: $ssh_known_hosts. Connect to the EC2 serial-console endpoint once from this host and verify its fingerprint first." >&2
  exit 1
fi
aws_config_dir="$(cd -- "$aws_config_dir" && pwd)"

docker build -t sotirusama/aiot-ec2-serial-console-dashboard:latest "$project_dir"

terraform -chdir="$terraform_dir" apply "$@"
terraform -chdir="$terraform_dir" output -raw dashboard_env | sed 's/\r$//' > "$temp_env_file"
mv -- "$temp_env_file" "$env_file"
trap - EXIT

ssh_key_path="$(awk '/^BROWSER_SSH_KEY_PATH=/ { sub(/^BROWSER_SSH_KEY_PATH=/, ""); print; exit }' "$env_file")"
ssh_key_path="${ssh_key_path%$'\r'}"
if [[ "$ssh_key_path" == "~" ]]; then
  ssh_key_path="$home_dir"
elif [[ "$ssh_key_path" == "~/"* ]]; then
  ssh_key_path="$home_dir/${ssh_key_path#\~/}"
elif [[ "$ssh_key_path" != /* ]]; then
  ssh_key_path="$project_dir/$ssh_key_path"
fi

if [[ ! -r "$ssh_key_path" ]]; then
  echo "SSH private key is missing or unreadable: $ssh_key_path" >&2
  exit 1
fi

browser_ssh_state="$project_dir/.dashboard-ssh"
mkdir -p "$browser_ssh_state"
chmod 700 "$browser_ssh_state"

docker rm -f ec2-serial-console-dashboard >/dev/null 2>&1 || true
exec docker run --rm \
  --init \
  --name ec2-serial-console-dashboard \
  --user "$(id -u):$(id -g)" \
  --publish 127.0.0.1:3001:3001 \
  --env-file "$env_file" \
  --env BROWSER_SSH_KEY_PATH=/run/secrets/dashboard-ssh-key \
  --mount "type=bind,src=$ssh_key_path,dst=/run/secrets/dashboard-ssh-key,readonly" \
  --mount "type=bind,src=$aws_config_dir,dst=/home/node/.aws,readonly" \
  --mount "type=bind,src=$ssh_known_hosts,dst=/home/node/.ssh/known_hosts,readonly" \
  --mount "type=bind,src=$browser_ssh_state,dst=/run/dashboard-ssh" \
  sotirusama/aiot-ec2-serial-console-dashboard:latest
