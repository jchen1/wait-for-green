import * as core from '@actions/core';
import * as github from '@actions/github';
import * as process from 'process';

import type {GetResponseDataTypeFromEndpointMethod} from '@octokit/types';

import {Config, Octokit, Status} from './types';
import {sleep} from './util';

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

function statusToMessage(status: Status): string {
  switch (status) {
    case Status.Success:
      return '🟢 Success';
    case Status.Failure:
      return '🔴 Failure';
    case Status.Pending:
      return '⏳ Pending';
    case Status.Canceled:
      return '🚫 Canceled';
    default:
      return status;
  }
}

function combinedStatusToStatus(
  status: GetResponseDataTypeFromEndpointMethod<
    Octokit['rest']['repos']['getCombinedStatusForRef']
  >,
  ignored: string
): Status {
  const statusByContext: Record<
    string,
    [typeof status['statuses'][number], Status]
  > = {};
  status.statuses.forEach(simpleStatus => {
    if (shouldIgnoreCheck(ignored, simpleStatus.context)) {
      return;
    }
    const ts = new Date(simpleStatus.updated_at).getTime();
    const existing = statusByContext[simpleStatus.context];
    if (!existing || new Date(existing[0].updated_at).getTime() < ts) {
      const newStatus = stringToStatus(simpleStatus.state);
      statusByContext[simpleStatus.context] = [simpleStatus, newStatus];
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

  core.summary.addHeading('Statuses', 2).addTable([
    [
      {data: 'Name', header: true},
      {data: 'Status', header: true}
    ],
    ...Object.keys(statusByContext)
      .sort()
      .map(key => [
        `<a href='${statusByContext[key][0].url}'>${key}</a>`,
        statusToMessage(statusByContext[key][1])
      ])
  ]);

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
  const checks = await octokit.paginate(octokit.rest.checks.listForRef, config);
  const statusByName: Record<
    string,
    [number, typeof checks.check_runs[number], Status]
  > = {};

  checks.check_runs.forEach(checkStatus => {
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

    const statusName = `${checkStatus.name}|${checkStatus.check_suite?.id}`;

    const unixTs = new Date(ts).getTime();
    const existing = statusByName[statusName];
    if (!existing || existing[0] < unixTs) {
      const newStatus = checkToStatus(
        checkStatus.conclusion ?? checkStatus.status
      );
      statusByName[statusName] = [unixTs, checkStatus, newStatus];
      core.info(
        `${existing ? 'updating' : 'found'} check ${
          checkStatus.name
        } with status ${newStatus} (${checkStatus.html_url})`
      );
    } else {
      core.info(
        `check ${checkStatus.name} has superseding status, skipping...`
      );
    }
  });

  core.summary.addHeading('Checks', 2).addTable([
    [
      {data: 'Name', header: true},
      {data: 'Status', header: true}
    ],
    ...Object.keys(statusByName)
      .sort()
      .map(key => [
        `<a href='${statusByName[key][1].html_url}'>${key}</a>`,
        statusToMessage(statusByName[key][2])
      ])
  ]);

  const statusValues = Object.values(statusByName).map(x => x[2]);
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
      val =>
        val === Status.Success ||
        val === Status.Skipped ||
        statusValues.length === 0
    )
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
      await core.summary.clear();

      const [checks, statuses] = await Promise.all([
        checkChecks(octokit, config, ignored),
        checkStatuses(octokit, config, ignored)
      ]);

      await core.summary.write();

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
      core.setFailed(error);
      core.error(error.stack || '');
    }
  }
}

run();
