import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cacheRunnerNodeExecutable,
  listRunnerNodeCandidates,
  nodeExecutableForRunner,
  resetCachedRunnerNodeExecutable,
} from "./runnerProcess";

test("listRunnerNodeCandidates：ZHIZHU_NODE 优先于 PATH node", () => {
  const prev = process.env.ZHIZHU_NODE;
  process.env.ZHIZHU_NODE = "C:\\Tools\\node.exe";
  try {
    const list = listRunnerNodeCandidates();
    assert.equal(list[0], "C:\\Tools\\node.exe");
    assert.ok(list.includes("node"));
  } finally {
    if (prev === undefined) {
      delete process.env.ZHIZHU_NODE;
    } else {
      process.env.ZHIZHU_NODE = prev;
    }
  }
});

test("nodeExecutableForRunner：probe 成功后缓存的路径优先于仅 exists 的首个候选", () => {
  resetCachedRunnerNodeExecutable();
  const prev = process.env.ZHIZHU_NODE;
  process.env.ZHIZHU_NODE = "C:\\Broken\\bundled-node.exe";
  try {
    cacheRunnerNodeExecutable("node");
    assert.equal(nodeExecutableForRunner(), "node");
  } finally {
    resetCachedRunnerNodeExecutable();
    if (prev === undefined) {
      delete process.env.ZHIZHU_NODE;
    } else {
      process.env.ZHIZHU_NODE = prev;
    }
  }
});

test("nodeExecutableForRunner：无缓存时须 node -v 成功才采用候选", () => {
  resetCachedRunnerNodeExecutable();
  const prev = process.env.ZHIZHU_NODE;
  process.env.ZHIZHU_NODE = "C:\\Definitely\\Not\\A\\Real\\Node.exe";
  try {
    const chosen = nodeExecutableForRunner();
    assert.equal(chosen, "node");
  } finally {
    resetCachedRunnerNodeExecutable();
    if (prev === undefined) {
      delete process.env.ZHIZHU_NODE;
    } else {
      process.env.ZHIZHU_NODE = prev;
    }
  }
});
