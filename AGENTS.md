# AGENTS.md — Launch OS Production Validation Rules

> **Last updated:** 2025-06-20
>
> This file is the single source of truth for how code changes must be
> validated before they reach production (`connect.launchmarketing.com`).
> Every contributor — human or AI — must follow these rules.

---

## 1. Production Deploy Path

| Step | Detail |
|------|--------|
| **Source** | GitHub `wyatt-lgtm/ad-launch` — `main` branch |
| **Host** | Render (Docker, auto-deploy on push) |
| **Dockerfile** | `nextjs_space/Dockerfile` (3-stage: deps → builder → runner) |
| **Docker context** | `nextjs_space/` |
| **Runtime** | Node 18 Alpine, standalone Next.js output |

## 2. Required Validation Before Merge / Push

Run **all three** checks from the repo root. A passing Yarn build is
**not** acceptable as production validation — Render uses npm.

### 2a. npm install

```bash
cd nextjs_space
npm ci --legacy-peer-deps
```

### 2b. npm build

```bash
cd nextjs_space
npm run build
```

### 2c. Docker build (mirrors Render exactly)

```bash
docker build -t launch-os-frontend:local nextjs_space/
```

All three must succeed with zero errors.

### Convenience scripts

```bash
# npm install + build (no Docker)
npm run prod:validate --prefix nextjs_space

# Docker build only
npm run prod:docker:build --prefix nextjs_space
```

## 3. What Is NOT Acceptable as Validation

- **Yarn-only builds** — Yarn 4 uses a different lockfile format and
  resolution strategy. A green Yarn build does not prove the npm/Docker
  path works.
- **Skipping the Docker build** — the multi-stage Dockerfile is the
  exact artifact Render deploys. If it doesn't build, production breaks.
- **`--force` or `--legacy-peer-deps` removal** — some transitive deps
  have peer-dep conflicts that npm resolves only with this flag. The
  Dockerfile uses it intentionally.

## 4. CI / GitHub Actions

The workflow at `.github/workflows/ci.yml` runs on every push to `main`
and on every pull request. It executes:

1. `npm ci --legacy-peer-deps`
2. `npm run build`
3. `docker build` using the production Dockerfile

Do **not** disable or bypass this workflow.

## 5. Environment Notes

### Abacus AI Agent VM

The Abacus development environment has Docker installed but the **Docker
daemon is not running**. Docker builds cannot be executed there. Always
validate Docker builds locally or rely on the GitHub Actions CI workflow.

### Required Environment Variables for Build

The Next.js build requires `DATABASE_URL` to be set (Prisma generation).
In CI, use a dummy Postgres connection string as a GitHub Actions secret.
See `render.yaml` for the full list of runtime env vars.

## 6. Key Constraints

- **Do not modify** `yarn.lock`, `node_modules/`, `.yarnrc.yml`, or
  Prisma dependency versions without explicit approval.
- **Do not add `--accept-data-loss`** to any Prisma command in the
  Dockerfile or scripts without explicit approval.
- **Preserve hook ordering** in React components (see commit `13c8d24`
  for the #310 fix pattern — all hooks must run before any early return).
