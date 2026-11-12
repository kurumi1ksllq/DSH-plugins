// English query -> role ids, captured AFTER #196 replaced substring matching with
// word-boundary matching (the fix for wrong answers: `api` used to match
// "fastapi", `ci` matched 81 rows inside "specializing", `go` matched "django").
//
// History: the first fixture held main's answers under SUBSTRING matching. Four of
// the 22 queries changed when matching became boundary-aware, and every change was
// a false hit disappearing:
//   test: -ruby-reviewer ("latest")   api: -fastapi-reviewer, -rapid-prototyper
//   rust: -kuaishou-strategist etc.   go: -django-reviewer, -rust-build-resolver
//
// This fixture is the lock: English behaviour may only change deliberately.
export const ENGLISH_BASELINE = {
  "security": [
    "csharp-reviewer",
    "database-reviewer",
    "django-reviewer",
    "fastapi-reviewer",
    "network-config-reviewer",
    "php-reviewer",
    "python-reviewer",
    "ruby-reviewer",
    "typescript-reviewer",
    "vue-reviewer",
    "blockchain-security-auditor",
    "cloud-security-architect",
    "penetration-tester",
    "security-architect"
  ],
  "django": [
    "django-reviewer",
    "django-build-resolver"
  ],
  "a11y": [
    "a11y-architect"
  ],
  "database": [
    "database-reviewer"
  ],
  "review": [
    "commit-reviewer",
    "cpp-reviewer",
    "csharp-reviewer",
    "database-reviewer",
    "django-reviewer",
    "fastapi-reviewer",
    "flutter-reviewer",
    "fsharp-reviewer",
    "go-reviewer",
    "java-reviewer",
    "kotlin-reviewer",
    "mle-reviewer",
    "network-config-reviewer",
    "php-reviewer",
    "python-reviewer",
    "rag-pipeline-reviewer",
    "react-reviewer",
    "ruby-reviewer",
    "rust-reviewer",
    "swift-reviewer",
    "typescript-reviewer",
    "vue-reviewer",
    "harmonyos-app-resolver",
    "marketing-agent",
    "silent-failure-hunter",
    "pr-test-analyzer",
    "ui-finish-gate-reviewer"
  ],
  "test": [
    "fastapi-reviewer",
    "gan-evaluator",
    "e2e-runner",
    "pr-test-analyzer",
    "tdd-guide",
    "prompt-engineer",
    "ux-researcher",
    "statistician",
    "penetration-tester",
    "mcp-builder",
    "tool-evaluator"
  ],
  "perf": [
    "performance-optimizer",
    "cpp-reviewer",
    "csharp-reviewer",
    "database-reviewer",
    "flutter-reviewer",
    "fsharp-reviewer",
    "go-reviewer",
    "php-reviewer",
    "python-reviewer",
    "react-reviewer",
    "vue-reviewer",
    "frontend-developer",
    "ui-designer"
  ],
  "react": [
    "react-reviewer",
    "vue-reviewer",
    "react-build-resolver",
    "frontend-developer"
  ],
  "python": [
    "python-reviewer",
    "django-build-resolver"
  ],
  "api": [
    "vue-reviewer",
    "harmonyos-app-resolver",
    "docs-lookup",
    "technical-writer",
    "api-platform-engineer",
    "privacy-engineer",
    "wechat-mini-program-developer"
  ],
  "design": [
    "a11y-architect",
    "code-architect",
    "gan-planner",
    "homelab-architect",
    "network-architect",
    "database-reviewer",
    "swift-reviewer",
    "type-design-analyzer",
    "api-platform-engineer",
    "ui-designer",
    "ui-finish-gate-reviewer",
    "ux-researcher",
    "visual-storyteller",
    "statistician",
    "cloud-security-architect",
    "security-architect",
    "search-relevance-engineer",
    "mcp-builder",
    "workflow-architect"
  ],
  "plan": [
    "gan-planner",
    "homelab-architect",
    "marketing-agent",
    "finops-engineer",
    "douyin-strategist",
    "sprint-prioritizer"
  ],
  "doc": [
    "code-explorer",
    "doc-updater",
    "docs-lookup",
    "technical-writer",
    "document-generator"
  ],
  "migration": [
    "database-reviewer",
    "django-reviewer",
    "django-build-resolver"
  ],
  "build": [
    "cpp-build-resolver",
    "dart-build-resolver",
    "django-build-resolver",
    "go-build-resolver",
    "java-build-resolver",
    "kotlin-build-resolver",
    "pytorch-build-resolver",
    "react-build-resolver",
    "rust-build-resolver",
    "swift-build-resolver",
    "data-engineer",
    "rag-pipeline-engineer",
    "ai-engineer",
    "anthropologist",
    "geographer",
    "psychologist",
    "bilibili-content-strategist",
    "kuaishou-strategist",
    "threat-intelligence-analyst",
    "lsp-index-engineer",
    "mcp-builder"
  ],
  "debug": [],
  "frontend": [
    "frontend-developer"
  ],
  "backend": [],
  "cloud": [
    "devops-automator",
    "finops-engineer",
    "cloud-security-architect",
    "3d-and-scene-developer"
  ],
  "mobile": [],
  "rust": [
    "rust-reviewer",
    "rust-build-resolver",
    "rust-refactoring-specialist"
  ],
  "go": [
    "homelab-architect",
    "go-reviewer",
    "go-build-resolver",
    "platform-engineer",
    "china-market-localization-strategist",
    "product-manager"
  ]
}
