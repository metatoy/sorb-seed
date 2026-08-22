#!/usr/bin/env node
// `sorb-seed render-worker` — E3 hosted-capture on-demand render worker entry.
// hosted-bridge-modes-exploration-plan.md §3 E3.
//
// This is the thin callable seam a cloud off-box runner (queue dispatcher)
// invokes to run render jobs — mirrors sorb-cloud's `runnerEntry.mjs`
// NDJSON-over-stdout child-runner contract so the pattern is consistent
// across the two repos:
//
//   Input:  NDJSON on stdin — one `RenderJobInput` JSON object per line
//           (see worker.js JSDoc). For a one-shot call from a shell, pass
//           `--job='<json>'` or `--job-file=<path>` instead.
//   Output: NDJSON on stdout — one line per job:
//             {"t":"result","data":<RenderJobResult>}
//             {"t":"error","message":"...","job":<the input job>}
//           Diagnostics/logs go to STDERR only — stdout is reserved for the
//           protocol so a queue can pipe it straight into JSON.parse per line.
//
// The Playwright page pool persists across jobs read from stdin, so a queue
// that batches multiple jobs for the SAME url into one process invocation
// gets pagePool.js's navigation-skip reuse. It is closed once stdin ends (or
// after the single --job/--job-file run), so the process exits cleanly.

import { readFileSync } from 'node:fs'
import { renderJob } from './worker.js'
import { createPagePool } from './pagePool.js'

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

async function runOneJob(job, pool) {
  try {
    const data = await renderJob(job, { pagePool: async () => pool })
    emit({ t: 'result', data })
  } catch (e) {
    emit({ t: 'error', message: e && e.message ? e.message : String(e), job })
  }
}

async function readStdinJobs() {
  let buf = ''
  const jobs = []
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) {
    buf += chunk
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line.trim()) jobs.push(JSON.parse(line))
    }
  }
  if (buf.trim()) jobs.push(JSON.parse(buf))
  return jobs
}

export async function main(argv = process.argv) {
  const pool = createPagePool()
  try {
    const jobFileArg = argv.find((a) => a.startsWith('--job-file='))
    const jobArg = argv.find((a) => a.startsWith('--job='))

    if (jobFileArg || jobArg) {
      const raw = jobFileArg
        ? readFileSync(jobFileArg.slice('--job-file='.length), 'utf-8')
        : jobArg.slice('--job='.length)
      await runOneJob(JSON.parse(raw), pool)
      return
    }

    const jobs = await readStdinJobs()
    for (const job of jobs) await runOneJob(job, pool)
  } finally {
    await pool.closeAll()
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    process.stderr.write((e && e.stack ? e.stack : String(e)) + '\n')
    process.exit(1)
  })
}
