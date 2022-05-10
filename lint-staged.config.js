module.exports = {
  'src/**/*.ts': [
    'npm run format',
    'npm run lint',
    () => 'rm -rf lib',
    () => 'npm run build',
    'npm run package',
    'git add dist'
  ],
  '__tests__/**/*.ts': ['npm run format']
};
