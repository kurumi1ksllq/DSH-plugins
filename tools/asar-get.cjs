#!/usr/bin/env node
// Read one file out of an Electron app.asar without extracting it.
//   node asar-get.cjs /dsh/node_modules/@deepseek-ai/dsh-web/lib/index.js
//   node asar-get.cjs --list "/dsh/node_modules/@deepseek-ai/dsh-web/"
//   ASAR=E:/other/app.asar node asar-get.cjs /path/inside/asar
const fs = require('fs');

const ASAR = process.env.ASAR || 'E:/DeepSeekHarness/resources/app.asar';
const target = process.argv[2];
if (!target) {
  console.error('usage: node asar-get.cjs <path-inside-asar | --list <prefix>>');
  process.exit(2);
}

const fd = fs.openSync(ASAR, 'r');
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const headerSize = head.readUInt32LE(12);
const headerBuf = Buffer.alloc(headerSize);
fs.readSync(fd, headerBuf, 0, headerSize, 16);
const tree = JSON.parse(headerBuf.toString('utf8'));
const base = 16 + headerSize;

function walk(node, prefix, out) {
  for (const key of Object.keys(node.files || {})) {
    const child = node.files[key];
    const path = `${prefix}/${key}`;
    if (child.files) walk(child, path, out);
    else out.push(path);
  }
  return out;
}

if (target === '--list') {
  const prefix = (process.argv[3] || '/').replace(/\/+$/, '');
  const all = walk(tree, '', []);
  for (const path of all.filter((p) => p.startsWith(prefix))) console.log(path);
  process.exit(0);
}

let node = tree;
for (const part of target.split('/').filter(Boolean)) {
  node = node?.files?.[part];
  if (!node) {
    console.error(`not found in asar: ${target}`);
    process.exit(1);
  }
}
if (node.files) {
  console.error(`${target} is a directory; use --list ${target}/`);
  process.exit(1);
}
const buf = Buffer.alloc(node.size);
fs.readSync(fd, buf, 0, node.size, base + parseInt(node.offset));
process.stdout.write(buf.toString('utf8'));
