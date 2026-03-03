// Tests for @cg3/equip library
// Node 18+ built-in test runner, zero dependencies

"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const {
  Equip,
  detectPlatforms,
  readMcpEntry,
  buildHttpConfig,
  buildHttpConfigWithAuth,
  buildStdioConfig,
  installMcpJson,
  uninstallMcp,
  installRules,
  uninstallRules,
  parseRulesVersion,
  markerPatterns,
  createManualPlatform,
  platformName,
  KNOWN_PLATFORMS,
} = require("../index");

// ─── Helpers ─────────────────────────────────────────────────

function tmpPath(prefix = "equip-test") {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function mockPlatform(overrides = {}) {
  return {
    platform: "claude-code",
    version: "1.0.0",
    configPath: tmpPath("config") + ".json",
    rulesPath: tmpPath("rules") + ".md",
    hasCli: false,
    existingMcp: null,
    rootKey: "mcpServers",
    ...overrides,
  };
}

function cleanup(...paths) {
  for (const p of paths) {
    try { fs.unlinkSync(p); } catch {}
    try { fs.unlinkSync(p + ".bak"); } catch {}
  }
}

const RULES_CONTENT = `<!-- test:v1.0.0 -->
## Test Rules
Always do the thing.
<!-- /test -->`;

// ─── Equip Class ─────────────────────────────────────────────

describe("Equip class", () => {
  it("requires name", () => {
    assert.throws(() => new Equip({}), /name is required/);
  });

  it("requires serverUrl or stdio", () => {
    assert.throws(() => new Equip({ name: "test" }), /serverUrl or stdio/);
  });

  it("creates instance with serverUrl", () => {
    const e = new Equip({ name: "test", serverUrl: "https://example.com/mcp" });
    assert.equal(e.name, "test");
    assert.equal(e.serverUrl, "https://example.com/mcp");
  });

  it("detect returns platforms array", () => {
    const e = new Equip({ name: "test", serverUrl: "https://example.com/mcp" });
    const platforms = e.detect();
    assert.ok(Array.isArray(platforms));
  });

  it("buildConfig returns HTTP config", () => {
    const e = new Equip({ name: "test", serverUrl: "https://example.com/mcp" });
    const config = e.buildConfig("claude-code", "key123");
    assert.equal(config.url, "https://example.com/mcp");
    assert.equal(config.headers.Authorization, "Bearer key123");
  });

  it("buildConfig returns VS Code config with type", () => {
    const e = new Equip({ name: "test", serverUrl: "https://example.com/mcp" });
    const config = e.buildConfig("vscode", "key123");
    assert.equal(config.type, "http");
    assert.equal(config.url, "https://example.com/mcp");
  });

  it("buildConfig returns Windsurf config with serverUrl", () => {
    const e = new Equip({ name: "test", serverUrl: "https://example.com/mcp" });
    const config = e.buildConfig("windsurf", "key123");
    assert.equal(config.serverUrl, "https://example.com/mcp");
    assert.ok(!config.url);
  });

  it("buildConfig returns stdio config", () => {
    const e = new Equip({
      name: "test",
      serverUrl: "https://example.com/mcp",
      stdio: { command: "npx", args: ["-y", "test-mcp"], envKey: "TEST_KEY" },
    });
    const config = e.buildConfig("claude-code", "key123", "stdio");
    assert.ok(config.env.TEST_KEY === "key123");
  });

  it("installMcp and uninstallMcp roundtrip", () => {
    const e = new Equip({ name: "myserver", serverUrl: "https://example.com/mcp" });
    const p = mockPlatform();
    cleanup(p.configPath);
    e.installMcp(p, "key123");
    const entry = e.readMcp(p);
    assert.ok(entry);
    assert.equal(entry.url, "https://example.com/mcp");

    e.uninstallMcp(p);
    assert.equal(e.readMcp(p), null);
    cleanup(p.configPath);
  });

  it("installRules and uninstallRules roundtrip", () => {
    const e = new Equip({
      name: "test",
      serverUrl: "https://example.com/mcp",
      rules: { content: RULES_CONTENT, version: "1.0.0", marker: "test" },
    });
    const p = mockPlatform();
    cleanup(p.rulesPath);

    const r1 = e.installRules(p);
    assert.equal(r1.action, "created");
    const content = fs.readFileSync(p.rulesPath, "utf-8");
    assert.ok(content.includes("test:v1.0.0"));

    e.uninstallRules(p);
    assert.ok(!fs.existsSync(p.rulesPath) || !fs.readFileSync(p.rulesPath, "utf-8").includes("test:v"));
    cleanup(p.rulesPath);
  });

  it("installRules skips without rules config", () => {
    const e = new Equip({ name: "test", serverUrl: "https://example.com/mcp" });
    const p = mockPlatform();
    const r = e.installRules(p);
    assert.equal(r.action, "skipped");
  });
});

// ─── HTTP Config ─────────────────────────────────────────────

describe("buildHttpConfig", () => {
  it("returns url for standard platforms", () => {
    const c = buildHttpConfig("https://x.com/mcp", "claude-code");
    assert.equal(c.url, "https://x.com/mcp");
    assert.ok(!c.serverUrl);
    assert.ok(!c.type);
  });

  it("returns serverUrl for windsurf", () => {
    const c = buildHttpConfig("https://x.com/mcp", "windsurf");
    assert.equal(c.serverUrl, "https://x.com/mcp");
    assert.ok(!c.url);
  });

  it("returns type + url for vscode", () => {
    const c = buildHttpConfig("https://x.com/mcp", "vscode");
    assert.equal(c.type, "http");
    assert.equal(c.url, "https://x.com/mcp");
  });
});

// ─── MCP JSON ────────────────────────────────────────────────

describe("installMcpJson", () => {
  it("creates config with correct server name", () => {
    const p = mockPlatform();
    cleanup(p.configPath);
    installMcpJson(p, "myserver", { url: "https://example.com" }, false);
    const data = JSON.parse(fs.readFileSync(p.configPath, "utf-8"));
    assert.ok(data.mcpServers.myserver);
    assert.equal(data.mcpServers.myserver.url, "https://example.com");
    cleanup(p.configPath);
  });

  it("uses servers root key for vscode", () => {
    const p = mockPlatform({ platform: "vscode", rootKey: "servers" });
    cleanup(p.configPath);
    installMcpJson(p, "myserver", { type: "http", url: "https://example.com" }, false);
    const data = JSON.parse(fs.readFileSync(p.configPath, "utf-8"));
    assert.ok(data.servers.myserver);
    assert.ok(!data.mcpServers);
    cleanup(p.configPath);
  });

  it("preserves existing entries", () => {
    const p = mockPlatform();
    fs.writeFileSync(p.configPath, JSON.stringify({ mcpServers: { other: { url: "https://other.com" } } }));
    installMcpJson(p, "myserver", { url: "https://example.com" }, false);
    const data = JSON.parse(fs.readFileSync(p.configPath, "utf-8"));
    assert.ok(data.mcpServers.myserver);
    assert.ok(data.mcpServers.other);
    cleanup(p.configPath);
  });
});

// ─── Rules ───────────────────────────────────────────────────

describe("installRules (function)", () => {
  it("creates rules file", () => {
    const p = mockPlatform();
    cleanup(p.rulesPath);
    const r = installRules(p, { content: RULES_CONTENT, version: "1.0.0", marker: "test" });
    assert.equal(r.action, "created");
    assert.ok(fs.readFileSync(p.rulesPath, "utf-8").includes("test:v1.0.0"));
    cleanup(p.rulesPath);
  });

  it("uses fileName for standalone file", () => {
    const dir = tmpPath("rules-dir");
    const p = mockPlatform({ platform: "cline", rulesPath: dir });
    const r = installRules(p, { content: RULES_CONTENT, version: "1.0.0", marker: "test", fileName: "test.md" });
    assert.equal(r.action, "created");
    assert.ok(fs.readFileSync(path.join(dir, "test.md"), "utf-8").includes("test:v1.0.0"));
    cleanup(path.join(dir, "test.md"));
    try { fs.rmdirSync(dir); } catch {}
  });

  it("returns clipboard for clipboard platforms", () => {
    const p = mockPlatform({ platform: "cursor" });
    const r = installRules(p, { content: RULES_CONTENT, version: "1.0.0", marker: "test", clipboardPlatforms: ["cursor"] });
    assert.equal(r.action, "clipboard");
  });

  it("idempotent — skips if same version", () => {
    const p = mockPlatform();
    cleanup(p.rulesPath);
    installRules(p, { content: RULES_CONTENT, version: "1.0.0", marker: "test" });
    const r2 = installRules(p, { content: RULES_CONTENT, version: "1.0.0", marker: "test" });
    assert.equal(r2.action, "skipped");
    cleanup(p.rulesPath);
  });

  it("updates when version changes", () => {
    const p = mockPlatform();
    cleanup(p.rulesPath);
    installRules(p, { content: RULES_CONTENT, version: "1.0.0", marker: "test" });
    const newContent = RULES_CONTENT.replace("v1.0.0", "v2.0.0");
    const r2 = installRules(p, { content: newContent, version: "2.0.0", marker: "test" });
    assert.equal(r2.action, "updated");
    const final = fs.readFileSync(p.rulesPath, "utf-8");
    assert.ok(final.includes("v2.0.0"));
    assert.ok(!final.includes("v1.0.0"));
    cleanup(p.rulesPath);
  });
});

// ─── Platforms ───────────────────────────────────────────────

describe("platformName", () => {
  it("returns display names", () => {
    assert.equal(platformName("claude-code"), "Claude Code");
    assert.equal(platformName("vscode"), "VS Code");
    assert.equal(platformName("roo-code"), "Roo Code");
    assert.equal(platformName("unknown"), "unknown");
  });
});

describe("KNOWN_PLATFORMS", () => {
  it("includes all 6 platforms", () => {
    assert.equal(KNOWN_PLATFORMS.length, 6);
    assert.ok(KNOWN_PLATFORMS.includes("vscode"));
    assert.ok(KNOWN_PLATFORMS.includes("cline"));
    assert.ok(KNOWN_PLATFORMS.includes("roo-code"));
  });
});

describe("createManualPlatform", () => {
  it("throws for unknown platform", () => {
    assert.throws(() => createManualPlatform("unknown"), /Unknown platform/);
  });

  it("returns correct config for each platform", () => {
    for (const id of KNOWN_PLATFORMS) {
      const p = createManualPlatform(id);
      assert.equal(p.platform, id);
      assert.ok(p.configPath);
      assert.ok(p.rootKey);
    }
  });
});

// ─── Marker Patterns ────────────────────────────────────────

describe("markerPatterns", () => {
  it("creates correct regex for custom marker", () => {
    const { MARKER_RE, BLOCK_RE } = markerPatterns("myapp");
    assert.ok(MARKER_RE.test("<!-- myapp:v1.0.0 -->"));
    assert.ok(!MARKER_RE.test("<!-- other:v1.0.0 -->"));
  });
});

describe("parseRulesVersion", () => {
  it("parses version from marker", () => {
    assert.equal(parseRulesVersion("<!-- test:v1.2.3 -->", "test"), "1.2.3");
    assert.equal(parseRulesVersion("no marker here", "test"), null);
  });
});
