const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const script = readFileSync(`${__dirname}/limit-dev-host.cjs`, 'utf8');

test('监听补丁保留 HOST、可重复执行，且遇到未知上游实现时拒绝启动', () => {
  let source = 'server.listen(port, () => {';
  let writes = 0;
  const requireMock = Object.assign(() => ({
    readFileSync: () => source,
    writeFileSync: (_file, value) => { source = value; writes++; },
  }), { resolve: () => '/模拟依赖/index.js' });
  const run = () => runInNewContext(script, { require: requireMock });

  run();
  assert.match(source, /server\.listen\(port, opts\.host \|\| '127\.0\.0\.1'/);
  run();
  assert.equal(writes, 1);
  for (const changed of ['未知实现', 'server.listen(port, () => { server.listen(port, () => {']) {
    source = changed;
    assert.throws(run, /复核本机监听/);
    assert.equal(writes, 1);
  }
});
