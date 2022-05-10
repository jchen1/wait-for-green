module.exports = {
  'src/**/*.ts': [
    () => 'tsc -p tsconfig.json',
    'npm run format',
    'npm run lint',
    'npm run package'
  ],
  '__tests__/**/*.ts': ['npm run format']
};
