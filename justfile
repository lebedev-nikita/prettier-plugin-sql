install:
  npm install

test:
  npm run test

publish: install test
  npm publish --access public