#!/usr/bin/env node
/** Private entry owned by the Python single-file runtime packaging. */

const selectorName = 'DSH_SUBPROCESS_RUNNER'
const selection = process.env[selectorName]

if (selection === undefined) {
  // runExecutable serves a plugin child that spawned process.execPath with its
  // own script before falling back to the dsh CLI.
  const { runExecutable } = await import('@deepseek-ai/dsh/lib/bin.js')
  await runExecutable()
} else {
  Reflect.deleteProperty(process.env, selectorName)
  const { runSelectedSubprocessRunner } = await import('@deepseek-ai/dsh-subprocess-local/runner')
  await runSelectedSubprocessRunner(selection)
}
