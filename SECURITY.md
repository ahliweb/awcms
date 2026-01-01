# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| latest | ✅ |

## Reporting a Vulnerability

If you discover a security vulnerability within AWCMS, please do the following:

1. **Do NOT** create a public GitHub issue.
2. Send an email to: **<security@ahliweb.com>**
3. Include the following information:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

## Response Timeline

- **Acknowledgement**: Within 48 hours
- **Initial Assessment**: Within 5 business days
- **Resolution**: Aim for fix within 14 days for critical issues

## Security Best Practices

When deploying AWCMS:

- Always use HTTPS in production
- Keep all dependencies up to date
- Restrict CORS origins via VITE_CORS_ALLOWED_ORIGINS
- Use strong, unique passwords
- Enable Two-Factor Authentication (2FA) for admin accounts
- Regularly review Supabase RLS policies
- Monitor audit logs for suspicious activity

Thank you for helping keep AWCMS and its users safe!
