# ESLint Linter Warnings Report

**Generated:** 2025-10-15  
**Total Warnings:** 502  
**Total Errors:** 0

## Summary by Category

### Warning Types
1. **`@typescript-eslint/no-explicit-any`**: 397 occurrences
   - Using `any` type instead of specific types
   - Reduces type safety

2. **`@typescript-eslint/no-unused-vars`**: 93 occurrences
   - Variables, parameters, or imports defined but not used
   - Includes unused error variables in catch blocks

3. **`react-refresh/only-export-components`**: 6 occurrences
   - Files exporting both components and non-component values
   - Can break Fast Refresh in development

4. **`no-useless-escape`**: 3 occurrences
   - Unnecessary escape characters in strings/regex

5. **`no-empty`**: 2 occurrences
   - Empty block statements

## Detailed Warnings by File

### Client Components (UI)

#### `/workspace/client/src/components/ui/badge.tsx`
- **Line 36:17** - `react-refresh/only-export-components`
  - Exports both components and non-component values (likely variants or utilities)

#### `/workspace/client/src/components/ui/button.tsx`
- **Line 56:18** - `react-refresh/only-export-components`
  - Exports both components and non-component values

#### `/workspace/client/src/components/ui/form.tsx`
- **Line 175:3** - `react-refresh/only-export-components`
  - Exports both components and non-component values

#### `/workspace/client/src/components/ui/navigation-menu.tsx`
- **Line 119:3** - `react-refresh/only-export-components`
  - Exports both components and non-component values

#### `/workspace/client/src/components/ui/sidebar.tsx`
- **Line 770:3** - `react-refresh/only-export-components`
  - Exports both components and non-component values

#### `/workspace/client/src/components/ui/toggle.tsx`
- **Line 43:18** - `react-refresh/only-export-components`
  - Exports both components and non-component values

---

### Osprey Bridge

#### `/workspace/osprey-bridge/firehose-to-kafka/src/adapters/redis-adapter.ts`
- **Line 244:13** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 252:52** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 253:55** - `@typescript-eslint/no-explicit-any` - Uses `any` type

#### `/workspace/osprey-bridge/firehose-to-kafka/src/event-enricher.ts`
- **Line 36:37** - `@typescript-eslint/no-explicit-any` - Uses `any` type

---

### Server Middleware

#### `/workspace/server/middleware/rate-limit.ts`
- **Line 30:28** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 30:39** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 30:50** - `@typescript-eslint/no-explicit-any` - Uses `any` type

---

### Server Scripts

#### `/workspace/server/scripts/backfill-handles-batch.ts`
- **Line 54:41** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 61:18** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used

#### `/workspace/server/scripts/backfill-handles.ts`
- **Line 66:16** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used

#### `/workspace/server/scripts/init-search-extensions.ts`
- **Line 16:21** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 31:21** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 54:14** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used
- **Line 54:21** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 76:14** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used
- **Line 76:21** - `@typescript-eslint/no-explicit-any` - Uses `any` type

---

### Server Services

#### `/workspace/server/services/appview-jwt.ts`
- **Line 31:44** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 68:12** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 210:64** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 217:13** - `@typescript-eslint/no-unused-vars` - `header` is assigned but never used
- **Line 295:12** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 359:5** - `@typescript-eslint/no-unused-vars` - `method` is defined but never used (should use `_method`)
- **Line 359:13** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 360:5** - `@typescript-eslint/no-unused-vars` - `headerB64` is defined but never used
- **Line 361:5** - `@typescript-eslint/no-unused-vars` - `payloadB64` is defined but never used
- **Line 362:5** - `@typescript-eslint/no-unused-vars` - `signatureB64` is defined but never used
- **Line 373:5** - `@typescript-eslint/no-unused-vars` - `method` is defined but never used
- **Line 373:13** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 374:5** - `@typescript-eslint/no-unused-vars` - `token` is defined but never used

#### `/workspace/server/services/auth.ts`
- **Line 5:15** - `@typescript-eslint/no-unused-vars` - `KeyObject` is defined but never used
- **Line 22:44** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 54:7** - `@typescript-eslint/no-unused-vars` - `MAX_SESSION_EXPIRY_DAYS` is assigned but never used
- **Line 116:64** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 123:13** - `@typescript-eslint/no-unused-vars` - `header` is assigned but never used

#### `/workspace/server/services/backfill.ts`
- **Line 237:46** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 328:27** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 340:24** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 531:10** - `@typescript-eslint/no-explicit-any` - Uses `any` type

#### `/workspace/server/services/cache.ts`
- **Line 48:36** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 365:14** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used

#### `/workspace/server/services/console-wrapper.ts`
- **Lines 11-36** - Multiple `@typescript-eslint/no-explicit-any` warnings (12 total)
  - Console wrapper methods using `any` for flexible logging

#### `/workspace/server/services/constellation-integration.ts`
- **Line 76:40** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 121:48** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 234:16** - `@typescript-eslint/no-unused-vars` - `jsonError` is defined but never used
- **Line 310:14** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used
- **Line 321:34** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 397:14** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used

#### `/workspace/server/services/database-health.ts`
- **Line 75:32** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 76:32** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 118:21** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 171:69** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 187:21** - `@typescript-eslint/no-explicit-any` - Uses `any` type

#### `/workspace/server/services/did-resolver.ts`
- **Line 14:24** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 30:19** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 104:32** - `@typescript-eslint/no-explicit-any` - Uses `any` type

#### `/workspace/server/services/event-processor.ts`
- **Line 2:10** - `@typescript-eslint/no-unused-vars` - `lexiconValidator` is defined but never used
- **Line 7:10** - `@typescript-eslint/no-unused-vars` - `logAggregator` is defined but never used
- **Line 10:3** - `@typescript-eslint/no-unused-vars` - `InsertUser` is defined but never used
- **Line 22:3** - `@typescript-eslint/no-unused-vars` - `InsertQuote` is defined but never used
- **Line 46:31** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- Additional warnings continue throughout file (multiple `any` and unused variable warnings)

#### `/workspace/server/services/firehose.ts`
- **Line 9:3** - `@typescript-eslint/no-unused-vars` - `InsertNotification` is defined but never used
- **Line 10:3** - `@typescript-eslint/no-unused-vars` - `InsertUser` is defined but never used
- **Line 29:3** - `@typescript-eslint/no-unused-vars` - `InsertQuote` is defined but never used
- **Line 46:31** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- Extensive additional warnings for `any` types and unused variables throughout

#### `/workspace/server/services/graph.ts`
- **Line 172:16** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used
- **Line 318:16** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used
- Multiple `any` type warnings throughout

#### `/workspace/server/services/kafka-consumer.ts`
- **Line 34:27** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 53:21** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 72:14** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used
- Additional warnings continue throughout

#### `/workspace/server/services/labels.ts`
- Multiple `any` type warnings
- **Line 1087:14** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used
- **Line 1242:14** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used
- Additional warnings throughout

#### `/workspace/server/services/log-aggregator.ts`
- **Line 11:31** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 12:30** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- Additional warnings for `any` types

#### `/workspace/server/services/moderation.ts`
- Extensive `any` type warnings throughout
- Multiple unused variable warnings for `error` parameters

#### `/workspace/server/services/notifications.ts`
- Multiple `any` type warnings
- **Line 180:14** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used

#### `/workspace/server/services/oauth.ts`
- Multiple `any` type warnings
- Multiple unused variable warnings

#### `/workspace/server/services/osprey-integration.ts`
- **Line 77:14** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used
- Multiple `any` type warnings

#### `/workspace/server/services/post.ts`
- Extensive `any` type warnings throughout file
- Multiple `react-hooks/exhaustive-deps` warnings
- Multiple unused variable warnings

#### `/workspace/server/services/redis-consumer.ts`
- **Line 24:27** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- Multiple additional `any` type warnings

#### `/workspace/server/services/redis.ts`
- **Line 64:14** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used
- Multiple `any` type warnings

#### `/workspace/server/services/threads.ts`
- Extensive `any` type warnings (150+ occurrences in this file alone)
- Multiple unused variable warnings
- **Line 3901:17** - `no-empty` - Empty block statement
- **Line 4709:61** - `no-useless-escape` - Unnecessary escape character: `\/`

#### `/workspace/server/storage.ts`
- **Line 137:46** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 910:52** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- Multiple additional `any` type warnings

#### `/workspace/server/types/feed.ts`
- **Lines 41-47** - Multiple `@typescript-eslint/no-explicit-any` warnings (7 occurrences)
- **Lines 90-155** - Additional `any` type warnings (5 occurrences)

#### `/workspace/server/utils/sanitize.ts`
- **Line 50:22** - `@typescript-eslint/no-explicit-any` - Uses `any` type

#### `/workspace/server/utils/security.ts`
- **Line 92:12** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used
- **Line 163:27** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 164:19** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 165:35** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 294:12** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used

#### `/workspace/server/vite.ts`
- **Line 83:16** - `@typescript-eslint/no-unused-vars` - `error` is defined but never used

---

### Test Files

#### `/workspace/test-client/at-protocol-client.ts`
- **Line 11:10** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 82:21** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 117:21** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 173:45** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 177:21** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 221:50** - `@typescript-eslint/no-explicit-any` - Uses `any` type
- **Line 225:21** - `@typescript-eslint/no-explicit-any` - Uses `any` type

#### `/workspace/test-dataloader.ts`
- **Line 54:11** - `@typescript-eslint/no-unused-vars` - `result2` is assigned but never used

---

## Recommendations

### Priority 1: Code Quality
1. **Replace `any` Types** (397 warnings)
   - Define proper TypeScript interfaces and types
   - Consider using `unknown` for truly dynamic data
   - Use type guards for runtime type checking

2. **Remove Unused Variables** (93 warnings)
   - Delete unused imports and variables
   - Prefix intentionally unused parameters with underscore (e.g., `_error`)
   - Consider if unused error variables should be logged

### Priority 2: Developer Experience
1. **Fix Fast Refresh Issues** (6 warnings)
   - Split UI component files to separate component exports from utility exports
   - Create separate files for constants, variants, and helper functions

### Priority 3: Minor Issues
1. **Fix Escape Characters** (3 warnings)
   - Remove unnecessary escape characters in regex/strings

2. **Remove Empty Blocks** (2 warnings)
   - Add comments explaining why blocks are intentionally empty
   - Or remove empty catch/if blocks

## Files with Most Warnings

1. **`/workspace/server/services/threads.ts`** - ~200+ warnings
2. **`/workspace/server/services/post.ts`** - ~50+ warnings
3. **`/workspace/server/services/moderation.ts`** - ~40+ warnings
4. **`/workspace/server/services/event-processor.ts`** - ~30+ warnings
5. **`/workspace/server/services/firehose.ts`** - ~30+ warnings

These files should be prioritized for refactoring to reduce technical debt.

---

## ESLint Configuration

The project uses the following linting rules (from `eslint.config.js`):

- **TypeScript**: `@typescript-eslint/parser` with strict rules
- **React**: React 17+ configuration (no need for React import)
- **React Hooks**: Enforces rules of hooks and dependency arrays
- **Prettier**: Integrated for code formatting
- **Max Warnings**: Set to 0 (no warnings allowed in CI)

All warnings are currently set to "warn" level rather than "error", which allows the build to proceed but should be addressed to meet the `--max-warnings 0` requirement.
