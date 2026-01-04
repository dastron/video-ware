# React Hooks ESLint Setup

## What Was Done

To prevent infinite loops and other React Hooks issues, we've configured ESLint with the official React Hooks plugin.

## Changes Made

### 1. Installed Dependencies

```bash
yarn add -D eslint-plugin-react-hooks
```

### 2. Updated ESLint Configuration

Modified `eslint.config.mjs` to include:

```javascript
import reactHooks from "eslint-plugin-react-hooks";

// In the React/Next.js files section:
{
  files: ["webapp/**/*.{jsx,tsx}", "app/**/*.{jsx,tsx}"],
  plugins: {
    "react-hooks": reactHooks
  },
  rules: {
    "react-hooks/rules-of-hooks": "error",      // Enforces Rules of Hooks
    "react-hooks/exhaustive-deps": "warn"       // Checks effect dependencies
  }
}
```

### 3. Created Best Practices Guide

Added `.kiro/steering/react-hooks-best-practices.md` with:
- Common pitfalls and solutions
- Debugging techniques
- Code examples
- When to disable rules

## What These Rules Catch

### `react-hooks/rules-of-hooks` (error)

Enforces the fundamental Rules of Hooks:
- ✅ Only call Hooks at the top level (not in loops, conditions, or nested functions)
- ✅ Only call Hooks from React function components or custom Hooks

### `react-hooks/exhaustive-deps` (warn)

Validates dependency arrays for:
- `useEffect`
- `useCallback`
- `useMemo`
- `useLayoutEffect`

**Catches issues like:**
- Missing dependencies that can cause stale closures
- Dependencies that cause infinite loops
- Unnecessary dependencies that cause performance issues

## Example: The Bug We Fixed

**Before (caused infinite loop):**
```typescript
const loadWorkspaces = useCallback(async () => {
  const workspaces = await fetchWorkspaces();
  if (!currentWorkspace) {
    setCurrentWorkspace(workspaces[0]);
  }
}, [currentWorkspace]); // ❌ currentWorkspace in deps causes loop
```

**After (fixed):**
```typescript
const loadWorkspaces = useCallback(async () => {
  const workspaces = await fetchWorkspaces();
  setCurrentWorkspace(prev => {
    if (prev) return prev; // Already set
    return workspaces[0];
  });
}, []); // ✅ No dependencies needed
```

**ESLint would have warned us** about the dependency issue if it was configured earlier!

## Running the Linter

```bash
# Check all workspaces
yarn lint:check

# Fix auto-fixable issues
yarn lint

# Check specific workspace
yarn workspace @project/webapp lint
```

## Current Warnings

After setup, ESLint found 8 warnings (all non-critical):
- Unused imports (cleaned up)
- One ref warning in upload-context (acceptable pattern)
- Next.js image optimization suggestions

## Benefits

1. **Prevents infinite loops** - Catches dependency issues before they cause problems
2. **Catches stale closures** - Ensures effects use current values
3. **Improves performance** - Identifies unnecessary re-renders
4. **Better code quality** - Enforces React best practices
5. **Easier debugging** - Issues caught at lint time, not runtime

## Resources

- [React Hooks Rules](https://react.dev/reference/rules/rules-of-hooks)
- [exhaustive-deps Documentation](https://react.dev/reference/eslint-plugin-react-hooks/lints/exhaustive-deps)
- [Removing Effect Dependencies](https://react.dev/learn/removing-effect-dependencies)
- Project guide: `.kiro/steering/react-hooks-best-practices.md`

## Next Steps

1. **Review warnings** - Check the 8 warnings and decide if any need fixing
2. **Run before commits** - Consider adding to pre-commit hooks
3. **Team education** - Share the best practices guide with the team
4. **Monitor CI** - Ensure linting runs in CI/CD pipeline
