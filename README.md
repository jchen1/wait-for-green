# Wait for Green

GitHub Action that waits for commit statuses and checks to complete.

## Example usage

```yaml
name: Merge Gate
on: 
  pull_request: {}
jobs:
  wait-for-green: # make sure the action works on a clean machine without building
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: jchen1/wait-for-green@v1
        id: wait-for-green
        with:
          token: '${{ secrets.GITHUB_TOKEN }}'
          ignored_checks: 'wait-for-green'
      - name: Fail if checks have failed
        if: steps.wait-for-green.outputs.success != 'true'
        run: echo "Status checks failed with status ${{ steps.wait-for-green.outputs.success }}!" && exit 1

```

## Options

- `token` (**required**): GitHub token with `repo` scope. You probably want `secrets.GITHUB_TOKEN` here.
- `commit`: The commit-ish to check. Defaults to `$GITHUB_HEAD_REF`, then `$GITHUB_SHA`.
- `ignored_checks`: Either a comma-separated list of check/status names to ignore or a regex, wrapped in `/.../`.

## Output

- `success`: Either `true` if all statuses and checks succeed or are skipped, or `false` if any fail or are cancelled.
