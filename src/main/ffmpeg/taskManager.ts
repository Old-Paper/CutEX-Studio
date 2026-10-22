import type { ChildProcessWithoutNullStreams } from 'node:child_process'

const tasks = new Map<string, ChildProcessWithoutNullStreams>()
const cancelledTasks = new Set<string>()

export function registerTask(taskId: string, process: ChildProcessWithoutNullStreams): void {
  tasks.set(taskId, process)
  process.once('close', () => { if (tasks.get(taskId) === process) tasks.delete(taskId) })
  if (cancelledTasks.has(taskId)) process.kill('SIGTERM')
}

export function cancelTask(taskId: string): boolean {
  const process = tasks.get(taskId)
  cancelledTasks.add(taskId)
  if (!process) return true
  process.kill('SIGTERM')
  tasks.delete(taskId)
  return true
}

export function cancelAllTasks(): void {
  for (const id of tasks.keys()) cancelTask(id)
}

export function wasTaskCancelled(taskId: string): boolean {
  return cancelledTasks.has(taskId)
}

export function clearTaskCancellation(taskId: string): void {
  cancelledTasks.delete(taskId)
}
