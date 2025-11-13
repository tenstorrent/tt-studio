# Impact Report: Removal of Stagewise Libraries

**Generated:** 2025-11-13  
**Project:** TT Studio Frontend  
**Analyzed Libraries:**
- `@stagewise/toolbar` (v0.5.2)
- `@stagewise/toolbar-react` (v0.5.2)
- `@stagewise-plugins/react` (v0.5.2)

---

## Executive Summary

**Overall Impact: MINIMAL** ✅

The removal of the stagewise libraries will have **minimal to no impact** on the TT Studio project. These packages are:
1. Already commented out and not actively used in the codebase
2. Listed only as development dependencies
3. Officially deprecated by the upstream maintainers
4. Not imported or used anywhere in the active codebase

---

## Current State Analysis

### 1. Package Dependencies

**Location:** `app/frontend/package.json`

```json
"devDependencies": {
  "@stagewise-plugins/react": "^0.5.1",
  "@stagewise/toolbar-react": "^0.5.1",
  ...
}
```

- **Total devDependencies:** 21 packages
- **Stagewise packages:** 2 direct dependencies + 1 transitive dependency
- **Percentage of devDependencies:** ~9.5%

### 2. Package Details

#### @stagewise/toolbar (v0.5.2)
- **License:** AGPL-3.0-only
- **Status:** ⚠️ DEPRECATED
- **Description:** "stagewise toolbar SDK for AI Agent interaction."
- **Deprecation Message:** "This package is deprecated and has been replaced by the stagewise CLI. Get started with the CLI here: https://stagewise.io/docs"

#### @stagewise/toolbar-react (v0.5.2)
- **License:** AGPL-3.0-only
- **Status:** ⚠️ DEPRECATED
- **Dependencies:** Requires `@stagewise/toolbar@0.5.2`
- **Peer Dependencies:** `@types/react@>=18.0.0`, `react@>=18.0.0`

#### @stagewise-plugins/react (v0.5.2)
- **License:** AGPL-3.0-only
- **Status:** ⚠️ DEPRECATED
- **Peer Dependencies:** `@stagewise/toolbar@0.5.2`

### 3. Code Usage Analysis

**File:** `app/frontend/src/App.tsx`

```typescript
// Development toolbar imports commented out - remove if not needed
// import { StagewiseToolbar } from "@stagewise/toolbar-react";
// import ReactPlugin from "@stagewise-plugins/react";
```

```typescript
{/* Development toolbar commented out - remove if not needed
{import.meta.env.DEV && (
  <StagewiseToolbar
    config={{
      plugins: [ReactPlugin],
    }}
  />
)} */}
```

**Status:** All imports and usage are commented out

**Search Results:**
- No active imports found across the codebase
- No active usage found in any TypeScript/JavaScript files
- No references in configuration files (vite.config.ts, etc.)

### 4. Git History

**Added:** Commit `69c812c` (July 11, 2025)
- Added stagewise dependencies to package.json
- Integrated StagewiseToolbar into App component
- Enabled for development mode only

**Commented Out:** Commit `9d35059` (rc-v2.1.0)
- Commented out development toolbar imports
- Added note: "remove if not needed"
- Part of cleanup removing unused dependencies (@llm-ui, react-code-blocks, @dnd-kit)

---

## Impact Assessment

### ✅ NO IMPACT Areas

1. **Runtime Functionality**
   - No impact on production builds
   - No impact on application features
   - No impact on user-facing functionality

2. **Development Experience**
   - No active development tools using these packages
   - No debugging workflows affected
   - No hot-reload or HMR dependencies

3. **Build Process**
   - No impact on Vite build configuration
   - No impact on TypeScript compilation
   - No impact on production bundle size (already tree-shaken)

4. **Testing**
   - No test files importing these packages
   - No test utilities depending on stagewise

5. **Documentation**
   - No references in README files
   - No mentions in project documentation
   - No references in code comments (except removal note)

### ⚠️ CONSIDERATIONS

1. **License Cleanup**
   - Packages use AGPL-3.0-only license
   - Removal eliminates potential AGPL licensing concerns
   - May need to regenerate third-party-licenses.txt

2. **Development Dependencies**
   - Will reduce total devDependency count by 3 packages
   - Will slightly reduce node_modules size
   - Will reduce npm install time marginally

3. **Future Intent**
   - Code comments suggest "remove if not needed"
   - No indication of future planned usage
   - Upstream packages are deprecated (no future updates)

---

## Removal Steps

### Recommended Actions

1. **Remove from package.json**
   ```bash
   npm uninstall @stagewise/toolbar-react @stagewise-plugins/react
   ```

2. **Clean up App.tsx**
   - Remove commented import lines
   - Remove commented JSX block
   - Update file comments if necessary

3. **Regenerate licenses** (optional)
   ```bash
   npm run generate-license
   ```

4. **Verify build**
   ```bash
   npm run build
   npm run type-check
   npm run lint
   ```

### Files to Modify

1. `app/frontend/package.json` - Remove devDependencies entries
2. `app/frontend/package-lock.json` - Will auto-update on npm uninstall
3. `app/frontend/src/App.tsx` - Remove commented code (lines 10-12, 30-37)

---

## Risk Assessment

**Risk Level: VERY LOW** 🟢

| Risk Category | Level | Notes |
|---------------|-------|-------|
| Breaking Changes | None | No active usage |
| Build Failures | None | Not in build chain |
| Runtime Errors | None | Not imported anywhere |
| Developer Workflow | None | No active development tools |
| Rollback Difficulty | Very Low | Git revert if needed |

---

## Recommendations

### Primary Recommendation: **PROCEED WITH REMOVAL** ✅

**Rationale:**
1. Packages are already commented out and unused
2. Upstream packages are officially deprecated
3. No active functionality depends on these libraries
4. Reduces dependency footprint and potential security/licensing concerns
5. Aligns with project's recent cleanup efforts (commit 9d35059)

### Additional Benefits

1. **Cleaner dependency tree** - Reduces devDependencies by ~9.5%
2. **License simplification** - Removes AGPL-3.0 licensed packages
3. **Faster installs** - Marginally faster npm install times
4. **Maintenance reduction** - No need to track deprecated packages
5. **Code clarity** - Removes commented-out code and confusion

### No Action Required

- No code refactoring needed
- No feature replacements needed
- No documentation updates required (no existing docs reference these)
- No migration guide needed

---

## Testing Checklist

Before finalizing removal, verify:

- [ ] `npm install` completes successfully
- [ ] `npm run build` succeeds
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] Development server starts (`npm run dev`)
- [ ] Production build works (`npm run preview`)
- [ ] No TypeScript errors
- [ ] No runtime console errors

---

## Appendix: Package Statistics

### Installation Size Impact
- **Current node_modules entries:** 3 stagewise packages
- **Estimated size:** ~500KB (combined)
- **Reduction:** Minimal impact on total node_modules size

### Security Considerations
- No known vulnerabilities in these versions
- Deprecated packages won't receive security updates
- Removal eliminates future vulnerability exposure

### Dependency Graph
```
@stagewise/toolbar-react@0.5.2
└── @stagewise/toolbar@0.5.2

@stagewise-plugins/react@0.5.2
└── @stagewise/toolbar@0.5.2 (peer)
```

---

## Conclusion

The removal of `@stagewise/toolbar`, `@stagewise/toolbar-react`, and `@stagewise-plugins/react` is **safe and recommended**. These packages are:

- ✅ Not actively used in the codebase
- ✅ Already commented out with removal suggestion
- ✅ Officially deprecated by maintainers
- ✅ Only development dependencies (no production impact)
- ✅ Safe to remove without code changes (beyond cleanup)

**Estimated effort:** 15 minutes  
**Risk:** Very Low  
**Impact:** Positive (cleaner dependencies, reduced licensing complexity)

---

**Report prepared by:** Automated analysis  
**Last updated:** 2025-11-13
