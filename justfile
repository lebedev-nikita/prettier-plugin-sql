install:
  npm install

test:
  npm run test

build:
  npm run build
publish: install test build
  npm publish --access public