TaskTracker
# Cursor Active Rules (Enforced)

This directory contains the ONLY rules that are automatically enforced
by Cursor for this repository.

Any rule not present in this directory is NOT enforced unless explicitly
referenced by the user.

---

## Enforced Rules

### Safety / Hard Stop (Highest Priority)

- database-safety-protection.mdc  
  Prevents destructive database or environment operations without
  explicit approval.

- cursor-rules-location.mdc  
  Defines where enforceable Cursor rules are allowed to live.

These rules cannot be bypassed.

---

### Security / Correctness

- security-best-practices.mdc  
  Secure coding, boundary validation, safe error handling.

---

### Framework Constraints

- nextjs-best-practices.mdc  
  Applies ONLY to Next.js App Router usage.

- typescript-best-practices.mdc  
  Strict typing, guards, and type safety.

---

### Precedence Control

- precedence.mdc  
  Defines how rule conflicts are resolved.
  Higher-tier rules always override lower-tier rules.

---

## Dormant Rules

Additional rules exist in the repository under:

