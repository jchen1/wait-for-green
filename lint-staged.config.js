module.exports = {
  'src/**/*.ts': [
    'npm run format',
    'npm run lint',
    () => 'tsc -p tsconfig.json',
    'npm run package',
    'git add dist'
  ],
  '__tests__/**/*.ts': ['npm run format']
};
