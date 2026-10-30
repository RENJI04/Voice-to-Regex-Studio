# Renex development roadmap

The roadmap is intentionally incremental. Each phase should preserve working
behavior, verify compatibility, and avoid claiming later controls before they
exist.

1. **Renex rebrand and architecture foundation** — establish the product
   identity, accurate documentation, shared contracts, and low-risk module
   boundaries.
2. **Production backend** — implement deployable API routes, runtime
   configuration, health checks, provider timeouts, and production error
   handling.
3. **Security foundation** — define trust boundaries and add SSRF defenses,
   allowlisting, rate limiting, quotas, redaction, and abuse controls.
4. **Authentication and user data** — add identity, authorization, durable user
   storage, and account lifecycle behavior.
5. **Regex core engine** — formalize regex models, parsing, engine capabilities,
   and reusable execution contracts.
6. **Advanced testing engine** — expand test cases, assertions, datasets,
   property checks, and reproducible result reporting.
7. **Regex security and ReDoS analyzer** — add structured vulnerability
   analysis, deterministic diagnostics, and risk reporting.
8. **Regex linter and auto-fix** — detect correctness and readability issues and
   provide reviewable fixes.
9. **Regex optimization engine** — measure and improve patterns while preserving
   their intended language.
10. **AI provider platform** — add production provider adapters, policy,
    capability discovery, reliability, and cost controls.
11. **Local AI and privacy modes** — support local inference and explicit data
    handling modes.
12. **AI agent and self-correction** — add controlled iterative generation,
    testing, and repair workflows.
13. **AI evaluation and model comparison** — compare providers and models on
    versioned datasets and quality metrics.
14. **Advanced regex editor** — add language-aware editing, diagnostics,
    navigation, and developer productivity features.
15. **Visual regex tools** — add diagrams and interactive views that stay tied
    to source positions and engine semantics.
16. **Multi-engine and conversion system** — execute and convert across regex
    engines with explicit compatibility reporting.
17. **Projects, history, and collaboration** — add durable projects, versioned
    history, sharing, and team workflows.
18. **Import, export, and developer ecosystem** — add portable formats, SDKs,
    CLI support, APIs, and extension points.
19. **Platform integrations** — connect Renex to editors, CI systems, source
    hosts, and developer workflows.
20. **Production polish and v1.0 release** — complete accessibility,
    observability, performance, documentation, reliability, and release
    readiness work.

Phase 1 does not implement any Phase 2 or later system. The next phase should
start by writing the production API contract and threat-boundary assumptions
before selecting backend infrastructure.
