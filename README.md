# Wait for Green

GitHub Action that waits for commit statuses and checks to complete. This is useful when you have a lot of conditional jobs and want to have a single required check to gate merges.

## Example usage

```yaml
name: Merge Gate
on: 
  pull_request: {}
jobs:
  wait-for-green:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: jchen1/wait-for-green@v1.0.3
        id: wait-for-green
        with:
          token: '${{ secrets.GITHUB_TOKEN }}'
          # Ignore the job we're running on lest we create an infinite loop
          ignored_checks: 'wait-for-green'
      - name: Fail if checks have failed
        if: steps.wait-for-green.outputs.success != 'true'
        run: echo "Status checks failed with status ${{ steps.wait-for-green.outputs.success }}!" && exit 1

```

## Options

- `token` (**required**): GitHub token with `repo` scope. You probably want `secrets.GITHUB_TOKEN` here.
- `commit`: The commit-ish to check. Defaults to `$GITHUB_HEAD_REF`, then `$GITHUB_SHA`.
- `ignored_checks`: Either a comma-separated list of check/status names to ignore or a regex, wrapped in `/.../`.
- `check_interval`: How often to check for status checks, in seconds. Defaults to 10. Useful if you are running this action in many places and are getting rate limited.
- `max_attempts`: How many times to check statuses and checks before timing out. Defaults to 1000.

## Output

- `success`: Either `true` if all statuses and checks succeed or are skipped, or `false` if any fail or are cancelled.
