const { readFileSync, writeFileSync } = require('node:fs');

// Umi 4.7.19 的开发代理漏传监听地址；升级后复核此补丁是否仍有必要。
const file = require.resolve('@umijs/bundler-utoopack');
const source = readFileSync(file, 'utf8');
const before = 'server.listen(port, () => {';
const after = "server.listen(port, opts.host || '127.0.0.1', () => {";

if (!source.includes(after)) {
  if (source.split(before).length !== 2) {
    throw new Error('开发服务器实现已变化，请先复核本机监听设置再启动。');
  }
  writeFileSync(file, source.replace(before, after));
}
