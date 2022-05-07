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

function stringToStatus(status: string): Status {
  // todo: skipped? canceled?
  switch (status) {
    case 'success':
      return Status.Success;
    case 'failure':
      return Status.Failure;
    case 'pending':
      return Status.Pending;
    default:
      return Status.Unknown;
  }
}

function combinedStatusToStatus(
  status: GetResponseDataTypeFromEndpointMethod<
    Octokit['rest']['repos']['getCombinedStatusForRef']
  >
): Status {
  const statusByContext: Record<string, [number, Status]> = {};
  status.statuses.forEach(simpleStatus => {
    const ts = new Date(simpleStatus.updated_at).getTime();
    const existing = statusByContext[simpleStatus.context];
    if (!existing || existing[0] < ts) {
      const newStatus = stringToStatus(simpleStatus.state);
      statusByContext[simpleStatus.context] = [
        new Date(simpleStatus.updated_at).getTime(),
        newStatus
      ];
      core.info(
        `${existing ? 'Updating' : 'Creating'} context ${
          simpleStatus.context
        } with status ${newStatus}`
      );
    } else {
      core.info(
        `Status with context ${simpleStatus.context} has superseding status, skipping...`
      );
    }
  });

  const statusValues = Object.values(statusByContext).map(x => x[1]);
  if (statusValues.includes(Status.Pending) || statusValues.length === 0) {
    return Status.Pending;
  }
  if (statusValues.every(val => val === Status.Success)) {
    return Status.Success;
  }
  if (statusValues.includes(Status.Failure)) {
    return Status.Failure;
  }

  core.warning(`Unknown statuses: ${JSON.stringify(statusByContext, null, 2)}`);
  return Status.Unknown;
}

const MAX_ATTEMPTS = 100;
const SLEEP_TIME_MS = 10000;

async function checkChecks(octokit: Octokit, config: Config): Promise<Status> {
  const checks = await octokit.rest.checks.listForRef(config);
  core.info(JSON.stringify(checks.data, null, 2));
  return Status.Success;
}

async function checkStatuses(
  octokit: Octokit,
  config: Config
): Promise<Status> {
  const statuses = await octokit.rest.repos.getCombinedStatusForRef(config);
  return combinedStatusToStatus(statuses.data);
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
    const ref = core.getInput('commit') || process.env['GITHUB_SHA'];

    if (!ref) {
      throw new Error('Neither `inputs.commit` nor `$GITHUB_SHA` are set!');
    }

    // todo: ignore certain actions?
    const config: Config = {
      owner,
      repo,
      ref
    };

    let success = false;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const [checks, statuses] = await Promise.all([
        checkChecks(octokit, config),
        checkStatuses(octokit, config)
      ]);

      core.info(`attempt ${attempt}: checks=${checks}, statuses=${statuses}`);
      if (checks === Status.Success && statuses === Status.Success) {
        success = true;
        break;
      }

      await sleep(SLEEP_TIME_MS);
    }

    core.setOutput('success', success);
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
