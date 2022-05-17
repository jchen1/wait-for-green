import {GitHub} from '@actions/github/lib/utils';

export type Octokit = InstanceType<typeof GitHub>;

export type Config = {
  owner: string;
  repo: string;
  ref: string;
};

export enum Status {
  Unknown = 'Unknown',
  Failure = 'Failure',
  Canceled = 'Canceled',
  Skipped = 'Skipped',
  Pending = 'Pending',
  Success = 'Success'
}
