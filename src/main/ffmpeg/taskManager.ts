import type { ChildProcessWithoutNullStreams } from 'node:child_process'

const tasks = new Map<string, ChildProcessWithoutNullStreams>()
const cancelledTasks = new Set<string>()

export function registerTask(taskId: string, process: ChildProcessWithoutNullStreams): void {
  tasks.set(taskId, process)
  process.once('close', () => tasks.delete(taskId))
}

export function cancelTask(taskId: string): boolean {
  const process = tasks.get(taskId)
  if (!process) return false
  cancelledTasks.add(taskId)
  process.kill('SIGTERM')
  tasks.delete(taskId)
  return true
}

export function wasTaskCancelled(taskId: string): boolean {
  return cancelledTasks.has(taskId)
}

export function clearTaskCancellation(taskId: string): void {
  cancelledTasks.delete(taskId)
}
