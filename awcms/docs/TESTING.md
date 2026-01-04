
# Testing Guide

## Overview

AWCMS uses a combination of linting, build verification, and manual testing to ensure code quality.

---

## Automated Checks

### Linting

```bash
# Check for linting issues
npm run lint

# Auto-fix linting issues
npm run lint:fix
```

ESLint configuration uses `eslint-config-react-app` with rules for:

- React hooks
- Unused variables
- Best practices

### Build Verification

```bash
# Verify production build succeeds
npm run build
```

A successful build ensures:

- No syntax errors
- All imports resolve
- No TypeScript errors (in type-checked files)

### Security Audit

```bash
# Check for vulnerabilities
npm audit

# Expected output
found 0 vulnerabilities ✓
```

---

## Manual Testing Checklist

### Authentication

- [ ] User can register with email
- [ ] User can login with email/password
- [ ] User can logout
- [ ] Password reset works
- [ ] 2FA setup works
- [ ] 2FA login works
- [ ] Session persists after page refresh

### Content Management

- [ ] Create article with TipTap editor
- [ ] Edit existing article
- [ ] Delete article (soft delete)
- [ ] Upload featured image
- [ ] Categories and tags work
- [ ] SEO fields save correctly

### RBAC

- [ ] Super admin sees all menus
- [ ] Regular user sees limited menus
- [ ] Permission-protected actions are blocked
- [ ] Role assignment works

### UI/UX

- [ ] Theme toggle (light/dark) works
- [ ] Language switch works
- [ ] Mobile responsive
- [ ] Toast notifications appear
- [ ] Loading states display

---

## Browser Testing

Test on the following browsers:

| Browser | Version | Status |
| ------- | ------- | ------ |
| Chrome | Latest | ✓ Required |
| Firefox | Latest | ✓ Required |
| Safari | Latest | ✓ Required |
| Edge | Latest | ✓ Required |
| Mobile Safari | Latest | ✓ Required |
| Mobile Chrome | Latest | ✓ Required |

---

## Performance Testing

### Lighthouse Audit

Run Lighthouse in Chrome DevTools:

| Metric | Target |
| ------ | ------ |
| Performance | > 80 |
| Accessibility | > 90 |
| Best Practices | > 90 |
| SEO | > 90 |

### Bundle Analysis

```bash
# Build with analysis
npm run build -- --analyzer
```

Current bundle sizes:

- vendor-react: ~164 KB (gzip: ~54 KB)
- vendor-supabase: ~181 KB (gzip: ~46 KB)
- vendor-ui: ~111 KB (gzip: ~36 KB)
- index: ~1,562 KB (gzip: ~446 KB)

---

## Unit Testing (Vitest)

AWCMS uses **Vitest** for unit and integration testing.

### Running Tests

```bash
# Run all tests
npm run test

# Run tests in watch mode
npm run test -- --watch

# Run tests with coverage
npm run test -- --coverage
```

### Test Configuration

Configuration is in `vitest.config.js`:

- **Environment**: `jsdom` (simulates browser)
- **Setup**: `src/setupTests.js` (Testing Library matchers)
- **Path Alias**: `@` → `src/`

### Current Test Coverage

| Module | File | Tests |
| :--- | :--- | :--- |
| Data Layer | `UnifiedDataManager.test.js` | Online/Offline mode |
| Security | `PermissionContext.test.jsx` | ABAC policy evaluation |

### Writing New Tests

```javascript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });
});
```

---

## Future Testing Plans

### Planned Additions

1. **E2E Tests** (Playwright)
   - Auth flow
   - CRUD operations
   - Cross-browser testing

---

## Reporting Bugs

When reporting bugs, include:

1. Steps to reproduce
2. Expected behavior
3. Actual behavior
4. Browser/OS information
5. Console errors (if any)
6. Screenshots/videos

Submit issues at: GitHub Issues
