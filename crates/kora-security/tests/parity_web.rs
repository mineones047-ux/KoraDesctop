//! Parity tests for [`kora_security::net`] — one test per `it()` of
//! `src/lib/__tests__/web-security.test.ts`, one assertion per `expect()`.
//!
//! The TS suite imports the real production module; so do these.
//!
//! Not ported: the file's `describe('URL Parsing Security')` block. It exercises the JS `URL`
//! class, not `web-security.ts`, so it belongs to the `web:fetch` channel port (ROADMAP §6.1).

use kora_security::net::{is_allowed_protocol, is_blocked_host};

// describe('isBlockedHost - Private/Localhost Addresses')

#[test]
fn blocks_localhost() {
    assert!(is_blocked_host("localhost"));
    assert!(is_blocked_host("localhost:3000"));
}

#[test]
fn blocks_ipv4_loopback() {
    assert!(is_blocked_host("127.0.0.1"));
    assert!(is_blocked_host("127.0.0.2"));
    assert!(is_blocked_host("127.255.255.255"));
}

#[test]
fn blocks_ipv6_loopback() {
    assert!(is_blocked_host("[::1]"));
}

#[test]
fn blocks_10_0_0_0_8_private_range() {
    assert!(is_blocked_host("10.0.0.1"));
    assert!(is_blocked_host("10.1.2.3"));
    assert!(is_blocked_host("10.255.255.255"));
}

#[test]
fn blocks_172_16_0_0_12_private_range() {
    assert!(is_blocked_host("172.16.0.1"));
    assert!(is_blocked_host("172.17.0.1"));
    assert!(is_blocked_host("172.31.255.255"));
}

#[test]
fn allows_172_0_0_0_16_and_172_32_0_0_16_not_private() {
    assert!(!is_blocked_host("172.15.0.1"));
    assert!(!is_blocked_host("172.32.0.1"));
}

#[test]
fn blocks_192_168_0_0_16_private_range() {
    assert!(is_blocked_host("192.168.0.1"));
    assert!(is_blocked_host("192.168.1.1"));
    assert!(is_blocked_host("192.168.255.255"));
}

#[test]
fn blocks_169_254_0_0_16_link_local() {
    assert!(is_blocked_host("169.254.0.1"));
    assert!(is_blocked_host("169.254.1.2"));
}

#[test]
fn blocks_0_0_0_0() {
    assert!(is_blocked_host("0.0.0.0"));
}

#[test]
fn blocks_ipv6_private_ranges() {
    assert!(is_blocked_host("[fc00::1]"));
    assert!(is_blocked_host("[fd12:3456:789a::1]"));
    assert!(is_blocked_host("[fe80::1]"));
}

// describe('isBlockedHost - Public Addresses')

#[test]
fn allows_public_ipv4_addresses() {
    assert!(!is_blocked_host("8.8.8.8"));
    assert!(!is_blocked_host("1.1.1.1"));
    assert!(!is_blocked_host("142.250.80.46"));
    assert!(!is_blocked_host("151.101.1.140"));
}

#[test]
fn allows_public_hostnames() {
    assert!(!is_blocked_host("google.com"));
    assert!(!is_blocked_host("api.openai.com"));
    assert!(!is_blocked_host("github.com"));
}

#[test]
fn allows_public_ipv6_addresses() {
    assert!(!is_blocked_host("[2001:4860:4860::8888]"));
}

// describe('Protocol Validation')

#[test]
fn allows_http_and_https() {
    assert!(is_allowed_protocol("http:"));
    assert!(is_allowed_protocol("https:"));
}

#[test]
fn blocks_dangerous_protocols() {
    assert!(!is_allowed_protocol("file:"));
    assert!(!is_allowed_protocol("ftp:"));
    assert!(!is_allowed_protocol("smb:"));
    assert!(!is_allowed_protocol("ldap:"));
    assert!(!is_allowed_protocol("gopher:"));
    assert!(!is_allowed_protocol("data:"));
    assert!(!is_allowed_protocol("javascript:"));
}
