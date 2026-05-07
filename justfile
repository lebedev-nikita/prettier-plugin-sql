install:
  npm install

test: install
  npm run test

publish: install test
  npm publish --access public