export type ResolutionTimelineAction =
  | 'await_proposal'
  | 'dispute_window'
  | 'escalation'
  | 'finalizable'
  | 'expirable'
  | 'terminal';

export interface ResolutionTimeline {
  disputeWindowEndsAt?: bigint;
  escalationEndsAt?: bigint;
  resolutionDeadline: bigint;
  nextAction: ResolutionTimelineAction;
}

export function resolutionTimeline(input: {
  now: bigint;
  closeTime: bigint;
  resolutionGrace: bigint;
  proposedAt?: bigint;
  disputeWindow?: bigint;
  disputeOpenedAt?: bigint;
  escalationTimeout?: bigint;
  terminal?: boolean;
}): ResolutionTimeline {
  const resolutionDeadline = input.closeTime + input.resolutionGrace;
  if (input.terminal) return { resolutionDeadline, nextAction: 'terminal' };

  const disputeWindowEndsAt = input.proposedAt !== undefined && input.disputeWindow !== undefined
    ? input.proposedAt + input.disputeWindow
    : undefined;
  const escalationEndsAt = input.disputeOpenedAt !== undefined && input.escalationTimeout !== undefined
    ? input.disputeOpenedAt + input.escalationTimeout
    : undefined;

  let nextAction: ResolutionTimelineAction = 'await_proposal';
  if (escalationEndsAt !== undefined) nextAction = input.now >= escalationEndsAt ? 'expirable' : 'escalation';
  else if (disputeWindowEndsAt !== undefined) nextAction = input.now < disputeWindowEndsAt ? 'dispute_window' : 'finalizable';
  else if (input.now >= resolutionDeadline) nextAction = 'expirable';

  return { disputeWindowEndsAt, escalationEndsAt, resolutionDeadline, nextAction };
}
