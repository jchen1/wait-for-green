module.exports = {
  'src/**/*.ts': [
    // 'npm run format',
    // 'npm run lint',
    // 'rm -rf lib',
    files => {
      console.log('FILES', files);
      return 'tsc';
    },
    'npm run package',
    'git add dist'
  ],
  '__tests__/**/*.ts': ['npm run format']
};
