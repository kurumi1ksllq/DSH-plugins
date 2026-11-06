import { MAX_PAUSE_SECONDS, programPauseIssue, shellPauseSeconds } from './sleep-lint.mjs';
import { steeringPending } from './reachable.mjs';

const SHELL_TOOLS = new Set(['bash', 'pwsh', 'zsh']);
const LATER = 'Start long work with run_in_background (or let it move to the background), continue other steps, '
  + 'or end the turn; a finished job wakes you and the user can write to you meanwhile.';

export function reachabilityText(config) {
  return `## Reachability is enforced by the runtime

- A foreground command still running after ${config.foregroundSeconds} s, or still running when the user sends a message, moves to a background job by itself. A command reported as moved to the background after only a few seconds means a user message is waiting: finish the current step quickly and answer it.
- job_output waits end as soon as the user sends a message, and waiting again while that message is unread is refused.
- Pauses longer than ${MAX_PAUSE_SECONDS} s are refused: a real sleep or Start-Sleep command in the foreground, and a timer the program awaits in run_code. Text in strings, comments and arguments does not count. Polling one running job more than ${config.maxPollsPerProgram} times in one run_code program is refused.
- ask_user_question waits at most ${config.maxQuestionSeconds} s (timeout is in seconds; -1 is refused). An unanswered question becomes pending, the user can still answer it, and a message the user writes instead ends the wait.`;
}

// Returns the denial reason for one tool execution, or undefined to allow it.
export function reachabilityGuard(config, jobsOf = () => undefined, languageOf = () => undefined) {
  const polls = new Map();
  const countPoll = (rootCallId, jobId) => {
    const key = `${rootCallId}\u0000${jobId}`;
    const count = (polls.get(key) ?? 0) + 1;
    polls.delete(key);
    polls.set(key, count);
    if (polls.size > 500) polls.delete(polls.keys().next().value);
    return count;
  };
  return exec => {
    const args = exec.arguments ?? {};
    if (SHELL_TOOLS.has(exec.name) && args.run_in_background !== true && typeof args.command === 'string') {
      const seconds = shellPauseSeconds(args.command, exec.name === 'pwsh' ? 'powershell' : 'posix');
      if (seconds > MAX_PAUSE_SECONDS)
        return `Deep PTC refuses a ${seconds === Infinity ? 'endless' : `${seconds} s`} foreground pause. ${LATER}`;
    }
    if (exec.name === 'run_code' && typeof args.code === 'string') {
      const issue = programPauseIssue(args.code, languageOf());
      if (issue) return `Deep PTC refuses run_code programs that wait (${issue}; pauses up to ${MAX_PAUSE_SECONDS} s are allowed). ${LATER}`;
    }
    if (exec.name === 'job_output') {
      if (args.wait === true && steeringPending(exec.agent))
        return 'The user sent a new message. Do not wait now: finish this step, read the message and answer it. The job keeps running and you will be notified when it finishes.';
      const nested = exec.rootCallId !== undefined && exec.rootCallId !== exec.callId;
      const job = nested ? jobsOf()?.list?.(exec.agent?.id)?.find(row => row.id === args.job_id) : undefined;
      if (job?.status === 'running' && countPoll(exec.rootCallId, args.job_id) > config.maxPollsPerProgram)
        return `Deep PTC refuses polling job ${args.job_id} again inside this run_code program. ${LATER}`;
    }
    if (exec.name === 'ask_user_question' && typeof args.timeout === 'number'
      && (args.timeout === -1 || args.timeout > config.maxQuestionSeconds))
      return `Deep PTC limits ask_user_question to timeout <= ${config.maxQuestionSeconds} seconds. An unanswered question becomes pending and the user can still answer it later; continue independent work meanwhile.`;
    return undefined;
  };
}
