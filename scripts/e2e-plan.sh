#!/bin/zsh
# End to end: where the plan is kept, with three computers and two people.
# A fresh fake GitHub (port 4011) and three isolated RepoBoard instances
# (3107 alex, 3108 alex's second computer, 3109 sam), each with its own HOME
# and database; nothing touches ~/.repoboard or a real repository.
#
#   scripts/e2e-plan.sh            the full scenario (tests/e2e/plan.mjs, then agent.mjs)
#   PRIVATE=1 scripts/e2e-plan.sh  the code repository private (tests/e2e/private.mjs)
#   GITLAB=1 scripts/e2e-plan.sh   the same story on a fake GitLab (tests/e2e/gitlab.mjs)
set -e
ROOT=${0:A:h:h}
E=${E2E_DIR:-${TMPDIR:-/tmp}/repoboard-e2e}
export E2E_DIR=$E
pkill -f "demo-github.mjs 4011" || true; pkill -f "demo-gitlab.mjs 4012" || true; pkill -f "next dev -p 310[789]" || true; sleep 1
rm -rf $E; mkdir -p $E/a/home $E/b/home $E/c/home
cd $ROOT
(DEMO_GITHUB_PRIVATE=${PRIVATE:-0} node scripts/demo-github.mjs 4011 > $E/gh.log 2>&1 &)
(node scripts/demo-gitlab.mjs 4012 > $E/gl.log 2>&1 &)
for x in a:3107 b:3108 c:3109; do n=${x%%:*}; p=${x##*:}
  (HOME=$E/$n/home DATABASE_URL=$E/$n/rb.db GITHUB_API_URL=http://127.0.0.1:4011 GITHUB_LOGIN_URL=http://127.0.0.1:4011 NEXT_DIST_DIR=.next-e2e-$n npx next dev -p $p > $E/$n.log 2>&1 &)
done
sleep 6
for p in 3107 3108 3109; do for i in $(seq 1 90); do curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$p/api/repo 2>/dev/null | grep -q 200 && break; sleep 2; done; done
for p in 3107 3108 3109; do curl -s -o /dev/null http://127.0.0.1:$p/api/plan; curl -s -o /dev/null http://127.0.0.1:$p/api/docs; curl -s -o /dev/null http://127.0.0.1:$p/api/board; done
result=0
if [[ "${GITLAB:-0}" == "1" ]]; then node tests/e2e/gitlab.mjs || result=1
elif [[ "${PRIVATE:-0}" == "1" ]]; then node tests/e2e/private.mjs || result=1
else node tests/e2e/plan.mjs || result=1; node tests/e2e/agent.mjs || result=1; fi
pkill -f "demo-github.mjs 4011" || true; pkill -f "demo-gitlab.mjs 4012" || true; pkill -f "next dev -p 310[789]" || true
git checkout -q tsconfig.json 2>/dev/null || true; rm -rf .next-e2e-a .next-e2e-b .next-e2e-c
exit $result
