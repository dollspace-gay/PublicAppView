# ESLint Warnings Documentation

**Generated on:** 2025-10-15  
**Total Warnings:** 601  
**Total Errors:** 0

## Summary by Warning Type

### 1. `@typescript-eslint/no-explicit-any` (480 warnings)
Variables, parameters, or return types using `any` type instead of specific types.

### 2. `@typescript-eslint/no-unused-vars` (104 warnings)
Variables, imports, or parameters that are defined but never used.

### 3. `react-refresh/only-export-components` (6 warnings)
Files that export both components and non-component values, which breaks Fast Refresh.

### 4. `react-hooks/exhaustive-deps` (3 warnings)
React hooks with missing dependencies in their dependency arrays.

### 5. `no-useless-escape` (2 warnings)
Unnecessary escape characters in strings or regular expressions.

### 6. `no-empty` (2 warnings)
Empty block statements.

### 7. `prefer-const` (2 warnings)
Variables that could be declared as `const` instead of `let`.

### 8. `no-debugger` (2 warnings)
Debugger statements left in code.

---

## Detailed Warnings by File

### Client Source Files

#### `/workspace/client/src/components/firehose-status.tsx`
- **Line 3:10** - `@typescript-eslint/no-unused-vars`: `'CheckCircle2'` is defined but never used

#### `/workspace/client/src/components/logs-panel.tsx`
- **Line 11:29** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/client/src/components/osprey-status.tsx`
- **Line 323:10** - `@typescript-eslint/no-unused-vars`: `'formatUptime'` is defined but never used

#### `/workspace/client/src/components/pds-fetcher-status.tsx`
- **Line 31:29** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/client/src/components/sidebar.tsx`
- **Line 6:3** - `@typescript-eslint/no-unused-vars`: `'Settings'` is defined but never used

#### `/workspace/client/src/components/ui/badge.tsx`
- **Line 36:17** - `react-refresh/only-export-components`: Fast refresh only works when a file only exports components

#### `/workspace/client/src/components/ui/button.tsx`
- **Line 56:18** - `react-refresh/only-export-components`: Fast refresh only works when a file only exports components

#### `/workspace/client/src/components/ui/form.tsx`
- **Line 175:3** - `react-refresh/only-export-components`: Fast refresh only works when a file only exports components

#### `/workspace/client/src/components/ui/navigation-menu.tsx`
- **Line 119:3** - `react-refresh/only-export-components`: Fast refresh only works when a file only exports components

#### `/workspace/client/src/components/ui/sidebar.tsx`
- **Line 770:3** - `react-refresh/only-export-components`: Fast refresh only works when a file only exports components

#### `/workspace/client/src/components/ui/toggle.tsx`
- **Line 43:18** - `react-refresh/only-export-components`: Fast refresh only works when a file only exports components

#### `/workspace/client/src/hooks/use-toast.ts`
- **Line 15:7** - `@typescript-eslint/no-unused-vars`: `'actionTypes'` is assigned a value but only used as a type

#### `/workspace/client/src/lib/api.ts`
- **Line 75:10** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 77:12** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 117:16** - `@typescript-eslint/no-unused-vars`: `'e'` is defined but never used
- **Line 127:18** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 130:14** - `@typescript-eslint/no-unused-vars`: `'e'` is defined but never used
- **Line 145:32** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 146:31** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/client/src/lib/queryClient.ts`
- **Line 13:21** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 29:36** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/client/src/pages/admin-moderation.tsx`
- **Line 31:3** - `@typescript-eslint/no-unused-vars`: `'RefreshCw'` is defined but never used
- **Line 32:3** - `@typescript-eslint/no-unused-vars`: `'Zap'` is defined but never used
- **Line 102:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 140:38** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 159:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 251:9** - `@typescript-eslint/no-unused-vars`: `'getLabelColor'` is assigned a value but never used

#### `/workspace/client/src/pages/dashboard.tsx`
- **Line 16:23** - `@typescript-eslint/no-unused-vars`: `'useSearch'` is defined but never used
- **Line 52:20** - `@typescript-eslint/no-unused-vars`: `'setLocation'` is assigned a value but never used
- **Line 53:9** - `@typescript-eslint/no-unused-vars`: `'queryClient'` is assigned a value but never used
- **Line 82:40** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 100:25** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 106:36** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/client/src/pages/login.tsx`
- **Line 20:18** - `no-useless-escape`: Unnecessary escape character: \"

#### `/workspace/client/src/pages/user-panel.tsx`
- **Line 14:10** - `@typescript-eslint/no-unused-vars`: `'Badge'` is defined but never used

---

### Microcosm Bridge Files

#### `/workspace/microcosm-bridge/constellation-client/src/api-client.ts`
- **Line 123:16** - `@typescript-eslint/no-unused-vars`: `'jsonError'` is defined but never used

#### `/workspace/microcosm-bridge/constellation-client/src/enricher.ts`
- **Line 8:34** - `@typescript-eslint/no-unused-vars`: `'LinksCounts'` is defined but never used
- **Line 97:48** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/microcosm-bridge/constellation-client/src/health.ts`
- **Line 90:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

---

### Osprey Bridge Files

#### `/workspace/osprey-bridge/firehose-to-kafka/src/adapters/base-adapter.ts`
- **Line 33:9** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/osprey-bridge/firehose-to-kafka/src/adapters/firehose-adapter.ts`
- **Line 8:14** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 42:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 67:27** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 116:39** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/osprey-bridge/firehose-to-kafka/src/adapters/redis-adapter.ts`
- **Line 157:21** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 243:13** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 251:52** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 252:55** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 279:21** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/osprey-bridge/firehose-to-kafka/src/event-enricher.ts`
- **Line 15:14** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 36:37** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 54:23** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 96:33** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/osprey-bridge/firehose-to-kafka/src/health.ts`
- **Line 79:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 98:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/osprey-bridge/firehose-to-kafka/src/kafka-producer.ts`
- **Line 45:29** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 68:30** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/osprey-bridge/label-effector/src/kafka-consumer.ts`
- **Line 141:30** - `@typescript-eslint/no-explicit-any`: Unexpected any type

---

### Server Files

#### `/workspace/server/db.ts`
- **Line 98:27** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/server/index.ts`
- **Line 8:10** - `@typescript-eslint/no-unused-vars`: `'spawn'` is defined but never used
- **Line 70:13** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 178:44** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 214:17** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 276:49** - `@typescript-eslint/no-unused-vars`: `'dataPruningService'` is defined but never used

#### `/workspace/server/middleware/rate-limit.ts`
- **Line 30:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 30:39** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 30:50** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/server/routes.ts`
- **Line 41:3** - `@typescript-eslint/no-unused-vars`: `'searchLimiter'` is defined but never used
- **Line 72:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 123:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 130:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 155:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 203:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 212:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 227:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 230:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 243:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 250:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 267:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 275:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 293:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 300:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 333:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 340:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 361:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 368:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 384:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 391:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 411:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 418:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 438:24** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 445:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 485:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 492:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 515:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 521:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 560:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 572:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 591:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 597:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 644:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 654:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 673:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 684:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 702:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 713:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 733:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 743:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 761:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 771:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 808:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 818:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 836:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 846:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 866:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 876:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/scripts/create-oauth-client.ts`
- **Line 5:17** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 28:10** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/scripts/generate-keypair.ts`
- **Line 25:18** - `no-debugger`: Debugger statement found
- **Line 38:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/scripts/migrate.ts`
- **Line 78:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/scripts/setup-oauth.ts`
- **Line 69:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/actor.ts`
- **Line 28:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 66:23** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 83:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 106:31** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 111:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 257:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/backfill.ts`
- **Line 51:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 112:50** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 254:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 291:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/constellation-client.ts`
- **Line 15:27** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 86:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 132:14** - `@typescript-eslint/no-unused-vars`: `'jsonError'` is defined but never used
- **Line 203:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 238:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/content-moderation.ts`
- **Line 56:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 98:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/data-pruning.ts`
- **Line 30:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 42:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/feed-generator.ts`
- **Line 12:10** - `@typescript-eslint/no-unused-vars`: `'addMinutes'` is defined but never used
- **Line 38:8** - `prefer-const`: `'recentlyViewedThreshold'` should be const
- **Line 233:16** - `@typescript-eslint/no-unused-vars`: `'feedError'` is defined but never used
- **Line 333:37** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 400:41** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 412:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 443:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 467:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 481:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 504:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 522:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 590:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 609:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/firehose.ts`
- **Line 24:10** - `@typescript-eslint/no-unused-vars`: `'RepoStrongRef'` is defined but never used
- **Line 27:33** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 40:22** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 44:11** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 50:31** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 62:19** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 139:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 168:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 269:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 308:38** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 363:36** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 487:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 550:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 570:29** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 588:25** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 619:42** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 780:25** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 832:33** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 992:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 1005:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 1079:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/graph.ts`
- **Line 12:40** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 43:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 67:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 78:38** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 85:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 95:8** - `prefer-const`: `'followersResponse'` should be const
- **Line 133:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 157:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 168:38** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 175:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 244:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 266:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 303:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 386:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 416:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 477:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 495:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/kafka.ts`
- **Line 77:44** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 182:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 205:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 226:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 239:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/label-service.ts`
- **Line 7:10** - `@typescript-eslint/no-unused-vars`: `'AtpAgent'` is defined but never used
- **Line 119:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 162:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 222:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 304:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 345:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/notification.ts`
- **Line 37:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 79:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 100:38** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 110:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 164:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 188:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/oauth.ts`
- **Line 96:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 167:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/pds-data-fetcher.ts`
- **Line 165:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 221:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/redis-consumer.ts`
- **Line 30:33** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 93:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 144:32** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 177:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 205:30** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 223:30** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 250:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 296:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 394:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 472:31** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 589:21** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 625:21** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 712:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 881:20** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 1005:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 1017:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/settings.ts`
- **Line 5:32** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 7:7** - `@typescript-eslint/no-unused-vars`: `'DEFAULT_SETTINGS'` is defined but never used
- **Line 48:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 103:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 135:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 166:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/statistics.ts`
- **Line 109:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 195:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 240:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 283:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 326:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/subscription.ts`
- **Line 36:21** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 71:27** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 88:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 135:27** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 151:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 189:27** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 235:27** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 246:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 289:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 354:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 422:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/system-monitor.ts`
- **Line 159:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 173:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/timeline.ts`
- **Line 37:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 54:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 82:38** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 92:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 130:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 147:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 175:38** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 185:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 224:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 241:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 269:38** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 279:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 322:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 339:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 367:38** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 377:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 425:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 442:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 464:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/user-avatars.ts`
- **Line 10:14** - `no-debugger`: Debugger statement found
- **Line 91:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 114:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 148:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 175:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/video-service.ts`
- **Line 136:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 188:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 222:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 289:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 340:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/services/websocket.ts`
- **Line 9:10** - `@typescript-eslint/no-unused-vars`: `'randomUUID'` is defined but never used
- **Line 166:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 352:13** - `react-hooks/exhaustive-deps`: React Hook useEffect has missing dependencies
- **Line 376:13** - `react-hooks/exhaustive-deps`: React Hook useEffect has missing dependencies
- **Line 406:13** - `react-hooks/exhaustive-deps`: React Hook useEffect has missing dependencies

#### `/workspace/server/storage.ts`
- **Line 94:8** - `@typescript-eslint/no-unused-vars`: `'InsertFirehoseCursor'` is defined but never used
- **Line 96:3** - `@typescript-eslint/no-unused-vars`: `'insertBookmarkSchema'` is defined but never used
- **Line 114:14** - `@typescript-eslint/no-unused-vars`: `'pool'` is defined but never used
- **Line 139:46** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 384:44** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 385:41** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 670:31** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 908:52** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 1065:23** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 2212:34** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 2396:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 2423:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 2441:23** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 2497:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 2510:16** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 2530:47** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 2746:50** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 2749:54** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 2752:44** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 2817:72** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 3307:23** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 3314:69** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 3330:23** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 3353:23** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 3653:14** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 3729:33** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/server/types/feed.ts`
- **Line 41:23** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 42:25** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 43:32** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 44:28** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 45:30** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 46:30** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 47:24** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 90:9** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 93:9** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 97:11** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 98:13** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 155:30** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/server/utils/sanitize.ts`
- **Line 50:22** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/server/utils/security.ts`
- **Line 92:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used
- **Line 163:27** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 164:19** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 165:35** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 294:12** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

#### `/workspace/server/vite.ts`
- **Line 83:16** - `@typescript-eslint/no-unused-vars`: `'error'` is defined but never used

---

### Test Files

#### `/workspace/test-client/at-protocol-client.ts`
- **Line 11:10** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 82:21** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 117:21** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 173:45** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 177:21** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 221:50** - `@typescript-eslint/no-explicit-any`: Unexpected any type
- **Line 225:21** - `@typescript-eslint/no-explicit-any`: Unexpected any type

#### `/workspace/test-dataloader.ts`
- **Line 54:11** - `@typescript-eslint/no-unused-vars`: `'result2'` is assigned a value but never used

---

## Recommendations

### High Priority

1. **Address `any` types (480 warnings)**
   - Replace `any` with specific type definitions
   - Use generic types where appropriate
   - Create proper interfaces for complex objects
   - This is the largest category and improves type safety

2. **Remove unused variables (104 warnings)**
   - Delete unused imports
   - Remove unused function parameters or prefix with `_` if intentionally unused
   - Clean up dead code

3. **Remove debugger statements (2 warnings)**
   - Files: `server/scripts/generate-keypair.ts`, `server/services/user-avatars.ts`
   - These should not be in production code

### Medium Priority

4. **Fix React Hooks dependencies (3 warnings)**
   - File: `server/services/websocket.ts`
   - Add missing dependencies or use eslint-disable with explanation

5. **Fix React Fast Refresh issues (6 warnings)**
   - UI component files exporting both components and utilities
   - Consider separating utility exports into separate files

### Low Priority

6. **Fix escape sequences (2 warnings)**
   - Files: `client/src/pages/login.tsx`, `server/storage.ts`
   - Remove unnecessary backslashes

7. **Fix empty blocks (2 warnings)**
   - Add comments or implementation in empty catch/if blocks

8. **Use `const` where possible (2 warnings)**
   - Replace `let` with `const` for variables that aren't reassigned

---

## Files with Most Warnings

1. **server/routes.ts** - 53 warnings
2. **server/storage.ts** - 30 warnings  
3. **server/services/redis-consumer.ts** - 16 warnings
4. **server/services/firehose.ts** - 15 warnings
5. **server/services/timeline.ts** - 14 warnings

Focus on these files first for the biggest impact on warning reduction.

---

## Next Steps

1. Start with removing debugger statements (quick wins)
2. Clean up unused imports and variables
3. Systematically address `any` types by file, starting with the most critical paths
4. Fix React-specific warnings in client code
5. Consider adding stricter ESLint rules incrementally after addressing existing warnings
