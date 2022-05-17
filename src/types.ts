import {GitHub} from '@actions/github/lib/utils';

export type Octokit = InstanceType<typeof GitHub>;

export type Config = {
  owner: string;
  repo: string;
  ref: string;
};

export enum Status {
  Unknown = 'unknown',
  Failure = 'failure',
  Canceled = 'canceled',
  Skipped = 'skipped',
  Pending = 'pending',
  Success = 'success'
}
