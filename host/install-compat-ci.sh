#!/usr/bin/env bash
#
# Install the Telegram plugin compatibility CI into a Paperclip host repository.
#
# Usage:
#   ./install-compat-ci.sh <owner/repo> [options]
#
# Options:
#   --branch <name>   Branch to create (default: ci/plugin-telegram-compat)
#   --base <ref>      Base branch for the pull request (default: repo default)
#   --no-pr           Push the branch but do not open a pull request
#   --dry-run         Print what would be done and make no write call
#
# The script copies two paths from this bundle into the target repository:
#
#   .github/workflows/plugin-telegram-compat.yml
#   tests/plugin-telegram-compat/**
#
# It creates a branch, commits the files through the GitHub contents API and
# opens a pull request. It never pushes to the base branch directly, and it
# never writes a credential into a git remote or a URL: authentication comes
# from the GitHub CLI, which reads GH_TOKEN or the caller's own `gh auth`
# session.

set -euo pipefail

usage() {
  sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 1
}

target_repo=""
branch="ci/plugin-telegram-compat"
base_ref=""
open_pr=1
dry_run=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch)
      branch="${2:?--branch needs a value}"
      shift 2
      ;;
    --base)
      base_ref="${2:?--base needs a value}"
      shift 2
      ;;
    --no-pr)
      open_pr=0
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    -*)
      die "unknown option: $1"
      ;;
    *)
      [ -z "$target_repo" ] || die "only one target repository may be given"
      target_repo="$1"
      shift
      ;;
  esac
done

[ -n "$target_repo" ] || {
  usage
  die "a target repository is required, for example: ./install-compat-ci.sh owner/repo"
}

case "$target_repo" in
  */*) ;;
  *) die "target repository must be given as owner/repo" ;;
esac

command -v gh >/dev/null 2>&1 || die "the GitHub CLI (gh) is required"

bundle_root="$(cd "$(dirname "$0")/.." && pwd)"
host_root="$bundle_root/host"

[ -d "$host_root/tests/plugin-telegram-compat" ] || die "bundle is missing host/tests/plugin-telegram-compat"
[ -f "$host_root/.github/workflows/plugin-telegram-compat.yml" ] || die "bundle is missing host/.github/workflows/plugin-telegram-compat.yml"

repo_info="$(gh api "repos/$target_repo")"
default_branch="$(gh api "repos/$target_repo" --jq '.default_branch')"
[ -n "$base_ref" ] || base_ref="$default_branch"

push_permission="$(printf '%s' "$repo_info" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("permissions",{}).get("push",False))')"

printf 'target repository : %s\n' "$target_repo"
printf 'base branch       : %s\n' "$base_ref"
printf 'new branch        : %s\n' "$branch"
printf 'push permission   : %s\n' "$push_permission"
printf 'files to install  :\n'
printf '  %s\n' ".github/workflows/plugin-telegram-compat.yml"
(
  cd "$host_root/tests/plugin-telegram-compat"
  find . -type f -not -path "./node_modules/*" | sed 's|^\./|  tests/plugin-telegram-compat/|' | sort
)

if [ "$dry_run" -eq 1 ]; then
  printf '\ndry run: nothing was written.\n'
  exit 0
fi

[ "$push_permission" = "True" ] || die "the token has no push permission on $target_repo"

base_sha="$(gh api "repos/$target_repo/commits/$base_ref" --jq '.sha' 2>/dev/null || true)"
if ! printf '%s' "$base_sha" | grep -Eq '^[0-9a-f]{40}$'; then
  die "the target repository has no commit on $base_ref; push one commit first"
fi

if gh api "repos/$target_repo/git/ref/heads/$branch" --jq '.object.sha' >/dev/null 2>&1; then
  printf 'branch %s already exists; it will be reused.\n' "$branch"
else
  gh api --method POST "repos/$target_repo/git/refs" -f "ref=refs/heads/$branch" -f "sha=$base_sha" >/dev/null
  printf 'created branch %s at %s.\n' "$branch" "$base_sha"
fi

put_file() {
  repo_path="$1"
  file="$2"
  b64="$(base64 <"$file" | tr -d '\n')"
  current_sha=""
  if current_sha="$(gh api "repos/$target_repo/contents/$repo_path?ref=$branch" --jq '.sha' 2>/dev/null)"; then
    :
  else
    current_sha=""
  fi
  if [ -n "$current_sha" ]; then
    gh api --method PUT "repos/$target_repo/contents/$repo_path" \
      -f "message=ci: add $repo_path" -f "content=$b64" -f "branch=$branch" -f "sha=$current_sha" >/dev/null
  else
    gh api --method PUT "repos/$target_repo/contents/$repo_path" \
      -f "message=ci: add $repo_path" -f "content=$b64" -f "branch=$branch" >/dev/null
  fi
  printf 'wrote %s\n' "$repo_path"
}

put_file ".github/workflows/plugin-telegram-compat.yml" "$host_root/.github/workflows/plugin-telegram-compat.yml"

(
  cd "$host_root/tests/plugin-telegram-compat"
  find . -type f -not -path "./node_modules/*" -print0 | sort -z
) | while IFS= read -r -d '' file; do
  relative="${file#./}"
  put_file "tests/plugin-telegram-compat/$relative" "$host_root/tests/plugin-telegram-compat/$relative"
done

if [ "$open_pr" -eq 0 ]; then
  printf '\nbranch pushed: %s @ %s\n' "$target_repo" "$branch"
  exit 0
fi

pr_body_file="$(mktemp)"
cat >"$pr_body_file" <<'MD'
Installs the Telegram plugin compatibility job for the pinned `paperclip-plugin-telegram` release.

The job installs the pinned plugin against the pinned Paperclip SDK, typechecks the
plugin's published types against that SDK, runs the compatibility tests, and reports
the upstream contribution state and the pinned-versus-published release status in the
job summary. The pin is a literal version and never resolves `latest`.

The same job runs green in `sdkwala/paperclip-telegram-compat`
(`.github/workflows/plugin-telegram-compat.yml`); this copy differs only in the
`FIXTURE_DIR` path.
MD

pr_url="$(gh api --method POST "repos/$target_repo/pulls" \
  -f "title=ci: add the Telegram plugin compatibility job" \
  -f "head=$branch" -f "base=$base_ref" \
  -F "body=@$pr_body_file" --jq '.html_url')"
rm -f "$pr_body_file"

printf '\npull request: %s\n' "$pr_url"
