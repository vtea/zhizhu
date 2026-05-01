/** Runner 队列任务多账号循环协作：用户停止时置位，避免 kill 当前子进程后仍继续下一账号。 */

let runnerLoopUserCancelRequested = false;

export function signalRunnerLoopTaskCancel(): void {
  runnerLoopUserCancelRequested = true;
}

export function clearRunnerLoopTaskCancel(): void {
  runnerLoopUserCancelRequested = false;
}

export function isRunnerLoopTaskCancelRequested(): boolean {
  return runnerLoopUserCancelRequested;
}
