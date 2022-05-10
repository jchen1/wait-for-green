import * as core from '@actions/core';
import * as github from '@actions/github';
import {GitHub} from '@actions/github/lib/utils';
import type {GetResponseDataTypeFromEndpointMethod} from '@octokit/types';

import * as process from 'process';

type Octokit = InstanceType<typeof GitHub>;

type Config = {
  owner: string;
  repo: string;
  ref: string;
};

async function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(() => resolve(), ms);
  });
}

enum Status {
  Unknown = 'unknown',
  Failure = 'failure',
  Canceled = 'canceled',
  Skipped = 'skipped',
  Pending = 'pending',
  Success = 'success'
}

function shouldIgnoreCheck(ignored: string, checkName: string): boolean {
  if (ignored === '') {
    return false;
  }

  if (ignored.startsWith('/') && ignored.endsWith('/')) {
    return new RegExp(ignored.slice(1, -1)).test(checkName);
  }

  return ignored.split(',').includes(checkName);
}

function checkToStatus(status: string): Status {
  // todo: skipped? canceled?
  switch (status) {
    case 'success':
    case 'neutral':
      return Status.Success;
    case 'failure':
    case 'timed_out':
      return Status.Failure;
    case 'pending':
    case 'action_required':
    case 'queued':
    case 'in_progress':
      return Status.Pending;
    case 'skipped':
      return Status.Skipped;
    case 'canceled':
    case 'cancelled':
      return Status.Canceled;
    default:
      core.warning(`unhandled check status: ${status}`);
      return Status.Unknown;
  }
}

function stringToStatus(status: string): Status {
  switch (status) {
    case 'success':
      return Status.Success;
    case 'failure':
      return Status.Failure;
    case 'pending':
      return Status.Pending;
    default:
      core.warning(`unhandled status: ${status}`);
      return Status.Unknown;
  }
}

function combinedStatusToStatus(
  status: GetResponseDataTypeFromEndpointMethod<
    Octokit['rest']['repos']['getCombinedStatusForRef']
  >,
  ignored: string
): Status {
  const statusByContext: Record<string, [number, Status]> = {};
  status.statuses.forEach(simpleStatus => {
    if (shouldIgnoreCheck(ignored, simpleStatus.context)) {
      return;
    }
    const ts = new Date(simpleStatus.updated_at).getTime();
    const existing = statusByContext[simpleStatus.context];
    if (!existing || existing[0] < ts) {
      const newStatus = stringToStatus(simpleStatus.state);
      statusByContext[simpleStatus.context] = [
        new Date(simpleStatus.updated_at).getTime(),
        newStatus
      ];
      core.info(
        `${existing ? 'updating' : 'creating'} context ${
          simpleStatus.context
        } with status ${newStatus}`
      );
    } else {
      core.info(
        `status with context ${simpleStatus.context} has superseding status, skipping...`
      );
    }
  });

  const statusValues = Object.values(statusByContext).map(x => x[1]);
  if (
    statusValues.includes(Status.Failure) ||
    statusValues.includes(Status.Canceled)
  ) {
    return Status.Failure;
  }
  if (statusValues.includes(Status.Pending)) {
    return Status.Pending;
  }
  if (
    statusValues.every(
      val => val === Status.Success || val === Status.Skipped
    ) ||
    statusValues.length === 0
  ) {
    return Status.Success;
  }

  core.warning(`unknown statuses: ${JSON.stringify(statusByContext, null, 2)}`);
  return Status.Unknown;
}

async function checkChecks(
  octokit: Octokit,
  config: Config,
  ignored: string
): Promise<Status> {
  const checks = await octokit.rest.checks.listForRef(config);
  const statusByName: Record<string, [number, Status]> = {};

  checks.data.check_runs.forEach(checkStatus => {
    if (shouldIgnoreCheck(ignored, checkStatus.name)) {
      return;
    }

    const ts = checkStatus.completed_at ?? checkStatus.started_at;
    if (!ts) {
      core.warning(
        `no completed_at or started_at for check ${checkStatus.name}!`
      );
      return;
    }

    const unixTs = new Date(ts).getTime();
    const existing = statusByName[checkStatus.name];
    if (!existing || existing[0] < unixTs) {
      const newStatus = checkToStatus(
        checkStatus.conclusion ?? checkStatus.status
      );
      statusByName[checkStatus.name] = [unixTs, newStatus];
      core.info(
        `${existing ? 'updating' : 'found'} check ${
          checkStatus.name
        } with status ${newStatus}`
      );
    } else {
      core.info(
        `check ${checkStatus.name} has superseding status, skipping...`
      );
    }
  });

  const statusValues = Object.values(statusByName).map(x => x[1]);
  if (
    statusValues.includes(Status.Failure) ||
    statusValues.includes(Status.Canceled)
  ) {
    return Status.Failure;
  }
  if (statusValues.includes(Status.Pending) || statusValues.length === 0) {
    return Status.Pending;
  }
  if (
    statusValues.every(val => val === Status.Success || val === Status.Skipped)
  ) {
    return Status.Success;
  }

  core.warning(`Unknown checks: ${JSON.stringify(statusByName, null, 2)}`);
  return Status.Unknown;
}

async function checkStatuses(
  octokit: Octokit,
  config: Config,
  ignored: string
): Promise<Status> {
  const statuses = await octokit.rest.repos.getCombinedStatusForRef(config);
  return combinedStatusToStatus(statuses.data, ignored);
}

async function run(): Promise<void> {
  try {
    const octokit = github.getOctokit(core.getInput('token'));

    const owner = process.env['GITHUB_REPOSITORY_OWNER'];

    if (!owner) {
      throw new Error('`$GITHUB_REPOSITORY_OWNER` is not set!');
    }

    if (!process.env['GITHUB_REPOSITORY']) {
      throw new Error('`$GITHUB_REPOSITORY` is not set!');
    }

    const repo = process.env['GITHUB_REPOSITORY'].split('/')[1];
    const ref =
      core.getInput('commit') ||
      process.env['GITHUB_HEAD_REF'] ||
      process.env['GITHUB_SHA'];

    if (!ref) {
      throw new Error(
        'None of `inputs.commit`, `$GITHUB_HEAD_REF`, or`$GITHUB_SHA` are set!'
      );
    }

    const config: Config = {
      owner,
      repo,
      ref
    };

    const ignored = core.getInput('ignored_checks');
    const checkIntervalMs =
      1000 * parseInt(core.getInput('check_interval') || '10', 10);
    const maxAttempts = parseInt(core.getInput('max_attempts') || '1000', 10);

    if (isNaN(checkIntervalMs)) {
      throw new Error(
        `check_interval is not a number: ${core.getInput('check_interval')}`
      );
    }

    if (isNaN(maxAttempts)) {
      throw new Error(
        `max_attempts is not a number: ${core.getInput('max_attempts')}`
      );
    }

    core.info(`checking statuses & checks for ${owner}/${repo}@${ref}...`);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const [checks, statuses] = await Promise.all([
        checkChecks(octokit, config, ignored),
        checkStatuses(octokit, config, ignored)
      ]);

      core.info(`attempt ${attempt}: checks=${checks}, statuses=${statuses}`);
      if (checks === Status.Success && statuses === Status.Success) {
        core.info(`setting output \`success\` to \`true\``);
        core.setOutput('success', true);
        return;
      } else if (checks === Status.Failure || statuses === Status.Failure) {
        core.info(`setting output \`success\` to \`false\``);
        core.setOutput('success', false);
        return;
      }

      await sleep(checkIntervalMs);
    }

    core.warning('timed out waiting for checks to complete');
    core.setOutput('success', false);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

run();
