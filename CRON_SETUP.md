# Cron verification and Vercel setup

Checked on 15 October 2026. The scheduler passes local behavioral tests, but production scheduling is not yet verified.

## What was verified

| Check | Result |
| --- | --- |
| `vercel.json` | `/api/cron`, `0 6 * * *` (daily at 06:00 UTC / 11:30 AM IST) |
| Live `/login` | HTTP 200 |
| Live `/api/cron` without authorization | HTTP 401, as expected |
| Live `/api/cron` with the local `.env` cron secret | HTTP 401; production does not accept this local credential |
| Database referenced by local `.env` | Reachable; no company records, settings record, or queued tasks at inspection time |
| Automated tests | 69 passed, including eight new scheduler tests in `tests/cron.test.ts` |
| TypeScript | `npm run typecheck` passed |
| Vercel project settings and scheduled invocation logs | Not accessible in this session; no authenticated Vercel connection was available |

The authenticated 401 can mean that production has a different secret, is missing the secret, or runs a deployment with older configuration. A different valid production secret could still allow Vercel's own requests to succeed. This test alone does not establish that scheduled Vercel invocations are failing. Likewise, the local database observation is not proof that production uses the same database.

## Required Vercel setup

1. In **Vercel → Project → Settings → Environment Variables**, verify `CRON_SECRET` is set for **Production**. Store only its value, without the `Bearer ` prefix. To use the local verification command below, it must match the value in local `.env`. Vercel adds the authorization header automatically when invoking cron. [Vercel authentication documentation](https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
2. Verify the production `DATABASE_URL` and permanent `APP_ENCRYPTION_KEY`. The full application also needs the setup token and storage variables described in `.env.example`. Set `APP_URL=https://job-assistant-nine.vercel.app`. Local `.env` values are not uploaded through Git.
3. In **Settings → Functions**, verify Fluid compute is enabled. The cron, state, and action routes request a 300-second maximum, and the worker targets a 200-second processing budget. Fluid compute supports 300 seconds on Hobby. [Function duration limits](https://vercel.com/docs/fluid-compute#default-settings-by-plan).
4. Deploy the current code to **Production** after changing environment variables. Vercel creates the schedule from `vercel.json` during deployment; there is no need to install a separate cron service. Preview deployments do not receive scheduled invocations. [Vercel cron deployment guide](https://vercel.com/docs/cron-jobs/quickstart).
5. Open **Settings → Cron Jobs** and verify that cron jobs are enabled and `/api/cron` appears with `0 6 * * *`.
6. In Folio, add companies with supported Ashby, Greenhouse, or Lever careers URLs. Open **Settings**, turn on **Check companies daily**, leave **Pause automation and sending** off, and save. Individual companies must also be unpaused. Daily search is **off by default**.
7. For reply tracking, configure Google credentials and connect Gmail in Folio. Environment variables alone do not connect a mailbox.

The existing daily schedule is compatible with Vercel Hobby. On Hobby it can run anywhere between **11:30 AM and 12:29:59 PM IST**, rather than exactly at 11:30. More frequent Vercel schedules require a suitable plan; do not change to `*/15 * * * *` on Hobby. [Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing).

## Verify after deployment

From this repository, run the command below. It triggers real pending checks, but the worker never sends application emails. It reads the local secret without printing it. If production intentionally uses a separate secret, use a protected local configuration containing that production value for this check.

```bash
node --input-type=module <<'NODE'
import { config } from 'dotenv';
config({ path: '.env', quiet: true });
if (!process.env.CRON_SECRET) throw new Error('CRON_SECRET is missing locally');
const response = await fetch('https://job-assistant-nine.vercel.app/api/cron', {
  headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
  redirect: 'manual',
  signal: AbortSignal.timeout(300000),
});
console.log('HTTP', response.status, await response.text());
if (!response.ok) process.exitCode = 1;
NODE
```

| Response | Meaning / next step |
| --- | --- |
| `200`, `processed: N`, `busy: false` | Worker completed this invocation. Inspect company results, tasks, and activity for individual failures. `processed` counts attempts, including failed tasks. |
| `200`, `processed: 0`, `busy: false` | No tasks processed: nothing due, daily search disabled, automation paused, or no eligible companies/mailbox. |
| `200`, `busy: true` | Another worker holds the database lease. Check its task results; this is not proof this request performed checks. |
| `401` | Missing or mismatched secret in the deployed environment or request; check Production scope and redeploy after edits. |
| `500` | Worker initialization or processing infrastructure failed; check database access, encryption configuration, and runtime logs. |
| `504` | Function timed out; check function duration and workload size. |

Then inspect **Vercel → Settings → Cron Jobs → View Logs** for `/api/cron`, including the next automatically scheduled invocation. A manual success verifies the endpoint but does not prove Vercel's schedule fired. The in-app worker status is also not cron-specific: browser polling and a local worker update the same heartbeat. [Vercel logs and error handling](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## How the worker runs

| Where | Trigger | Behavior |
| --- | --- | --- |
| Local `npm run dev` or `npm start` | Separate worker process, with a 2.5-second delay between runs | Runs while that command stays running; no OS crontab is required. |
| Vercel, workspace open | Authenticated `/api/state` polling about every seven seconds, plus queued scan/reply actions | Uses Next.js `after()` to process tasks after responding. |
| Vercel, workspace closed | Daily `/api/cron` request | Processes due company scans and reply checks without your computer being on. |

Daily scans are scheduled once per **UTC calendar day** at the first worker trigger that day. Opening the workspace before the daily cron can therefore start that day's scan earlier. Reply checks become eligible after 15 minutes, but still need a worker trigger: with the workspace closed and only the daily cron, they are not checked every 15 minutes.

The database lease prevents overlapping workers, task deduplication prevents repeated active scans, and abandoned running tasks become eligible for recovery after five minutes. Pending work left by the time budget waits for the next trigger; on a daily-only deployment that can mean the next day. Failed scans are recorded as failed and wait for a manual scan or the next daily scheduling cycle. Vercel does not automatically retry a failed cron invocation. Large company lists or frequent unattended reply checks need more frequent triggers or a dedicated worker. [Vercel cron error handling](https://vercel.com/docs/cron-jobs/manage-cron-jobs#cron-job-error-handling).

The tests use isolated PostgreSQL schemas, temporary MinIO object prefixes, and mocked job-board/Gmail responses. They verify worker behavior without contacting employers, sending email, or making paid AI requests. No production settings or application data were changed during this check.
