# Failure & Security Injection Test Results

- generated_at: 2026-04-09T17:00:23.624Z
- scenarios_run: 6
- passed: 4
- failed: 2
- verdict: RESILIENCE_ISSUE

## Scenario Results

| # | ID | Category | Status | Detail |
|---|-----|----------|--------|--------|
| 1 | llm_provider_timeout | failure | PASS | timeout injection flag set/reverted successfully |
| 2 | supabase_unavailable | failure | PASS | supabase URL was replaced |
| 3 | memory_queue_overflow | failure | PASS | queue overflow flag set/reverted |
| 4 | api_health_degraded | failure | FAIL | health check failed: fetch failed |
| 5 | security_injection_xss | security | FAIL | discordService.ts not found for sanitization check |
| 6 | security_injection_sqli | security | PASS | parameterized patterns found (0 files) |

## Failure Injection Scenarios

- [x] llm_provider_timeout: timeout injection flag set/reverted successfully
- [x] supabase_unavailable: supabase URL was replaced
- [x] memory_queue_overflow: queue overflow flag set/reverted
- [ ] api_health_degraded: health check failed: fetch failed

## Security Injection Scenarios

- [ ] security_injection_xss: discordService.ts not found for sanitization check
- [x] security_injection_sqli: parameterized patterns found (0 files)

## Conclusion

2개 시나리오 실패. 개별 실패 원인 분석 후 재실행 필요.
