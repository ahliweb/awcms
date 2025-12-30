# Contributing to AWCMS

Thank you for your interest in contributing to AWCMS! This document provides guidelines and instructions for contributing.

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20.x or higher
- npm 10.x or higher
- Basic understanding of React 18, Supabase, and TailwindCSS

### Development Setup

```bash
git clone https://github.com/ahliweb/awcms.git
cd awcms
npm install
cp .env.example .env.local
npm run dev
```

---

## 📋 Contribution Types

### Bug Reports

1. Search existing issues first
2. Use the bug report template
3. Include reproduction steps
4. Provide environment details (Node version, browser, OS)

### Feature Requests

1. Check if the feature aligns with project goals
2. Describe the use case clearly
3. Consider multi-tenant implications

### Code Contributions

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make changes following our guidelines
4. Submit a pull request

---

## 🔧 Development Guidelines

### Code Style

- **Language**: JavaScript ES2022+ (NO TypeScript in Admin Panel)
- **React**: Functional components with hooks only
- **Styling**: TailwindCSS 4 utilities only
- **Formatting**: Use Prettier with default settings

### Component Guidelines

```jsx
// Use functional components
function MyComponent({ prop1, prop2 }) {
  const { t } = useTranslation();
  const { hasPermission } = usePermissions();
  
  return (
    <div className="p-4">
      {/* Component content */}
    </div>
  );
}

export default MyComponent;
```

### Multi-Tenancy Rules

- Always use `useTenant()` for tenant context
- All new tables MUST have `tenant_id` column
- Enable RLS on all tables
- Never bypass RLS except for Platform Admin features

### ABAC Compliance

- Check permissions before rendering sensitive UI
- Use `hasPermission('scope.resource.action')` format
- Document required permissions in component comments

---

## 📝 Pull Request Process

1. **Update Documentation**: If your change affects behavior, update relevant docs
2. **Test Locally**: Ensure `npm run build` passes
3. **Security Check**: Run `npm audit` for vulnerabilities
4. **PR Description**: Clearly describe changes and motivation
5. **Review**: Wait for maintainer review

### PR Title Format

```
[TYPE] Brief description

Types: feat, fix, docs, refactor, perf, test, chore
Example: [feat] Add user avatar upload to profile page
```

---

## 🔐 Security Guidelines

- Never commit `.env.local` or credentials
- Report security vulnerabilities privately
- Follow OWASP guidelines for web security
- Use Supabase RLS for data access control

---

## 📚 Documentation Contributions

- Follow Markdown best practices
- Include code examples where helpful
- Keep documents concise and scannable
- Update INDEX.md if adding new docs

---

## 💬 Communication

- Use GitHub Issues for bug reports and features
- Be respectful and constructive
- Follow our Code of Conduct

---

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.
