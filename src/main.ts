import * as core from '@actions/core';
import * as github from '@actions/github';
import {GitHub} from '@actions/github/lib/utils';

import * as process from 'process';

type Octokit = InstanceType<typeof GitHub>;

type Config = {
  owner: string;
  repo: string;
  ref: string;
};

async function checkChecks(octokit: Octokit, config: Config): Promise<boolean> {
  const checks = await octokit.rest.checks.listForRef(config);
  core.info(JSON.stringify(checks, null, 2));
  return true;
}

async function checkStatuses(
  octokit: Octokit,
  config: Config
): Promise<boolean> {
  const statuses = await octokit.rest.repos.getCombinedStatusForRef(config);
  core.info(JSON.stringify(statuses, null, 2));
  return true;
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

    const config: Config = {
      owner,
      repo,
      ref
    };

    await Promise.all([
      checkChecks(octokit, config),
      checkStatuses(octokit, config)
    ]);

    core.setOutput('success', true);
  } catch (error) {
    if (error instanceof Error) core.setFailed(error.message);
  }
}

run();
