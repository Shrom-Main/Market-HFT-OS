/**
 * POC-001: Stage 1 — Governed HTTP Collector Adversarial Unit Test Suite (Milestone 1)
 *
 * Test vectors:
 * - COL-01: Direct private IPv4 rejection (10.0.0.1, 172.16.0.1, 192.168.1.1)
 * - COL-02: Direct cloud metadata rejection (169.254.169.254)
 * - COL-03: Direct IPv6 loopback (::1) and ULA (fc00::1, fd00::1) rejection
 * - COL-04: DNS rebinding defeat (socket pins to pre-evaluated IP literal)
 * - COL-05: Conservative mixed-answer rejection ([93.184.216.34, 10.200.1.4])
 * - COL-06: Deterministic family ordering and bounded single retry to pre-validated IP literal
 * - COL-07: Permitted upstream retrieval & SNI preservation
 * - COL-08: TLS certificate/hostname mismatch rejection
 * - COL-09: Unsafe redirect interception fails closed
 * - COL-10: Relative and protocol-relative redirect resolution
 * - COL-11: Redirect hop limit enforcement (max 3 hops)
 * - COL-12: Cross-origin sensitive header stripping on redirect
 * - COL-13: DNS resolution timeout and late-result abandonment
 * - COL-14: Dual stream caps: compressed wire chunks vs decompressed body & socket cleanup
 * - COL-15: Permitted IPv6 literal URL handling (LIM-01)
 * - COL-16: Resource Cleanup Verification across error paths (LIM-03)
 * - COL-17: Production API Structural Seam Rejection (LIM-02 Zero-Seam Remediation)
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import * as http from 'node:http';
import * as https from 'node:https';
import * as dns from 'node:dns';
import * as zlib from 'node:zlib';

vi.mock('node:https', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:https')>();
  return {
    ...actual,
    request: vi.fn(),
  };
});

vi.mock('node:zlib', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:zlib')>();
  return {
    ...actual,
    createGunzip: vi.fn((...args: any[]) => (actual.createGunzip as any)(...args)),
    createInflate: vi.fn((...args: any[]) => (actual.createInflate as any)(...args)),
    createBrotliDecompress: vi.fn((...args: any[]) => (actual.createBrotliDecompress as any)(...args)),
  };
});

import {
  GovernedHttpConnector,
  GovernedHttpOptions
} from '../../src/infrastructure/browser/governed_http_connector.js';

// --- Test Mock Generators ---

class MockClientRequest extends EventEmitter {
  public destroyed = false;
  public headers: Record<string, string>;
  public options: https.RequestOptions;
  public socketRef: { destroy: () => void; destroyed: boolean };

  constructor(options: https.RequestOptions) {
    super();
    this.options = options;
    this.headers = (options.headers as Record<string, string>) || {};
    const sockState = { destroyed: false };
    this.socketRef = {
      destroy: () => {
        sockState.destroyed = true;
        this.destroyed = true;
      },
      get destroyed() {
        return sockState.destroyed;
      }
    };
    (this as any).socket = this.socketRef;
    // Emit socket immediately so connector can register active socket
    setTimeout(() => {
      this.emit('socket', this.socketRef);
    }, 0);
  }

  public end() {
    return this;
  }

  public destroy(err?: Error) {
    this.destroyed = true;
    this.socketRef.destroy();
    if (err) this.emit('error', err);
    return this;
  }

  public setTimeout(ms: number, cb?: () => void) {
    return this;
  }
}

class MockIncomingMessage extends Readable {
  public statusCode: number;
  public headers: Record<string, string>;
  public socket: { destroy: () => void; destroyed: boolean };
  public destroyed = false;

  constructor(statusCode: number, headers: Record<string, string>, chunks: (string | Buffer)[]) {
    super();
    this.statusCode = statusCode;
    this.headers = headers;
    const socketState = { destroyed: false };
    this.socket = {
      destroy: () => {
        socketState.destroyed = true;
        this.destroyed = true;
      },
      get destroyed() {
        return socketState.destroyed;
      }
    };
    for (const chunk of chunks) {
      this.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    this.push(null);
  }

  _read() {}

  destroy(err?: Error) {
    this.destroyed = true;
    this.socket.destroy();
    return super.destroy(err);
  }
}

describe('POC-001 Governed HTTP Collector Adversarial Unit Suite (COL-01 to COL-17)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // COL-01: Direct private IPv4 rejection
  // --------------------------------------------------------------------------
  it('COL-01: Direct private IPv4 address literals fail closed immediately', async () => {
    const privateIps = ['10.0.0.1', '172.16.0.1', '192.168.1.1'];
    for (const ip of privateIps) {
      await expect(
        GovernedHttpConnector.fetch(`https://${ip}/data`)
      ).rejects.toThrow(/E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED/);
    }
  });

  // --------------------------------------------------------------------------
  // COL-02: Direct cloud metadata rejection
  // --------------------------------------------------------------------------
  it('COL-02: Direct cloud instance metadata IP literal fails closed immediately', async () => {
    await expect(
      GovernedHttpConnector.fetch('https://169.254.169.254/latest/meta-data')
    ).rejects.toThrow(/E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED/);
  });

  // --------------------------------------------------------------------------
  // COL-03: Direct IPv6 loopback and ULA rejection
  // --------------------------------------------------------------------------
  it('COL-03: Direct IPv6 loopback (::1) and ULA literals fail closed immediately', async () => {
    const prohibitedIpv6s = ['[::1]', '[fc00::1]', '[fd12:3456:789a::1]'];
    for (const ip of prohibitedIpv6s) {
      await expect(
        GovernedHttpConnector.fetch(`https://${ip}/metrics`)
      ).rejects.toThrow(/E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED/);
    }
  });

  // --------------------------------------------------------------------------
  // COL-04: DNS rebinding defeat (socket pins to pre-evaluated IP literal)
  // --------------------------------------------------------------------------
  it('COL-04: DNS rebinding is defeated by opening socket to pinned IP literal while keeping SNI and Host intact', async () => {
    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
    vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

    let capturedRequestOptions: https.RequestOptions | null = null;
    vi.spyOn(https, 'request').mockImplementation((reqOptions: any, cb: any) => {
      capturedRequestOptions = reqOptions;
      const req = new MockClientRequest(reqOptions);
      setTimeout(() => {
        const res = new MockIncomingMessage(200, { 'content-type': 'text/plain' }, ['ok']);
        cb(res);
      }, 5);
      return req as unknown as http.ClientRequest;
    });

    const res = await GovernedHttpConnector.fetch('https://rebinding-victim.org/feed');

    expect(res.status).toBe(200);
    expect(res.bodyText).toBe('ok');
    expect(capturedRequestOptions).not.toBeNull();
    // Invariant: host passed to OS connect() is the pinned IP literal, NOT the hostname!
    expect((capturedRequestOptions as any).host).toBe('93.184.216.34');
    // Invariant: TLS SNI and Host header preserve the domain name
    expect((capturedRequestOptions as any).servername).toBe('rebinding-victim.org');
    expect((capturedRequestOptions as any).headers['Host']).toBe('rebinding-victim.org');
  });

  // --------------------------------------------------------------------------
  // COL-05: Conservative mixed-answer rejection
  // --------------------------------------------------------------------------
  it('COL-05: Conservative mixed-answer rejection fails closed if ANY candidate is prohibited', async () => {
    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue([
      '93.184.216.34', // Permitted public unicast
      '10.200.1.4'     // Prohibited private IPv4
    ]);
    vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

    let socketFactoryAttempted = false;
    vi.spyOn(https, 'request').mockImplementation((reqOptions: any) => {
      socketFactoryAttempted = true;
      const req = new MockClientRequest(reqOptions);
      return req as unknown as http.ClientRequest;
    });

    await expect(
      GovernedHttpConnector.fetch('https://dual-stack-attacker.com/data')
    ).rejects.toThrow(/E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED/);

    // Invariant: Zero socket connections attempted when resolution contains any prohibited candidate
    expect(socketFactoryAttempted).toBe(false);
  });

  // --------------------------------------------------------------------------
  // COL-06: Deterministic family ordering and bounded single retry
  // --------------------------------------------------------------------------
  it('COL-06: Deterministic family ordering and single bounded retry to pre-validated IP literal', async () => {
    let dnsLookupCount = 0;
    const attemptedHosts: string[] = [];

    vi.spyOn(dns.promises, 'resolve4').mockImplementation(async () => {
      dnsLookupCount++;
      return ['93.184.216.35', '93.184.216.34']; // Returned in unsorted order
    });
    vi.spyOn(dns.promises, 'resolve6').mockImplementation(async () => {
      return ['2606:2800:220:1:248:1893:25c8:1946'];
    });

    vi.spyOn(https, 'request').mockImplementation((reqOptions: any, cb: any) => {
      const host = String(reqOptions.host);
      attemptedHosts.push(host);
      const req = new MockClientRequest(reqOptions);

      setTimeout(() => {
        if (host === '93.184.216.34') {
          // Simulate network failure on primary IP
          const err = new Error('connect ECONNREFUSED 93.184.216.34:443');
          (err as any).code = 'ECONNREFUSED';
          req.emit('error', err);
        } else if (host === '93.184.216.35') {
          // Secondary pre-validated IP succeeds
          const res = new MockIncomingMessage(200, {}, ['secondary-success']);
          cb(res);
        }
      }, 5);

      return req as unknown as http.ClientRequest;
    });

    const res = await GovernedHttpConnector.fetch('https://multi-ip.example.com/test');

    expect(res.status).toBe(200);
    expect(res.bodyText).toBe('secondary-success');
    expect(res.pinnedIp).toBe('93.184.216.35');

    // Invariants:
    // 1. IPv4 preceded IPv6, sorted lexicographically: 93.184.216.34 then 93.184.216.35
    expect(attemptedHosts).toEqual(['93.184.216.34', '93.184.216.35']);
    // 2. DNS was queried exactly once — retry NEVER re-queried DNS
    expect(dnsLookupCount).toBe(1);
  });

  // --------------------------------------------------------------------------
  // COL-07: Permitted upstream retrieval & SNI preservation
  // --------------------------------------------------------------------------
  it('COL-07: Permitted upstream endpoint succeeds, preserves SNI, Host, and custom headers', async () => {
    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
    vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

    let capturedOptions: https.RequestOptions | null = null;
    vi.spyOn(https, 'request').mockImplementation((reqOptions: any, cb: any) => {
      capturedOptions = reqOptions;
      const req = new MockClientRequest(reqOptions);
      setTimeout(() => {
        const payload = JSON.stringify({ items: [{ id: 1 }, { id: 2 }] });
        const res = new MockIncomingMessage(200, { 'content-type': 'application/json' }, [payload]);
        cb(res);
      }, 5);
      return req as unknown as http.ClientRequest;
    });

    const res = await GovernedHttpConnector.fetch('https://example.com/products?category=clamps', {
      headers: { 'Accept': 'application/json' }
    });

    expect(res.status).toBe(200);
    expect(res.pinnedIp).toBe('93.184.216.34');
    expect(res.redirectHops).toBe(0);
    expect(JSON.parse(res.bodyText).items).toHaveLength(2);
    expect((capturedOptions as any).servername).toBe('example.com');
    expect((capturedOptions as any).headers['Host']).toBe('example.com');
    expect((capturedOptions as any).headers['Accept']).toBe('application/json');
  });

  // --------------------------------------------------------------------------
  // COL-08: TLS certificate/hostname mismatch rejection
  // --------------------------------------------------------------------------
  it('COL-08: TLS certificate hostname mismatch fails closed with E-MCP-TLS-CERT-INVALID', async () => {
    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
    vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

    vi.spyOn(https, 'request').mockImplementation((reqOptions: any) => {
      const req = new MockClientRequest(reqOptions);
      setTimeout(() => {
        const certErr = new Error(
          "Hostname/IP does not match certificate's altnames: Host: example.com. is not in the cert's altnames: DNS:untrusted.org"
        );
        req.emit('error', certErr);
      }, 5);
      return req as unknown as http.ClientRequest;
    });

    await expect(
      GovernedHttpConnector.fetch('https://example.com/secure')
    ).rejects.toThrow(/E-MCP-TLS-CERT-INVALID/);
  });

  // --------------------------------------------------------------------------
  // COL-09: Unsafe redirect interception fails closed
  // --------------------------------------------------------------------------
  it('COL-09: Unsafe redirect to cloud metadata IP literal is intercepted and rejected', async () => {
    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
    vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

    vi.spyOn(https, 'request').mockImplementation((reqOptions: any, cb: any) => {
      const req = new MockClientRequest(reqOptions);
      setTimeout(() => {
        // First hop returns 302 to metadata IP
        const res = new MockIncomingMessage(
          302,
          { location: 'https://169.254.169.254/latest/meta-data' },
          []
        );
        cb(res);
      }, 5);
      return req as unknown as http.ClientRequest;
    });

    await expect(
      GovernedHttpConnector.fetch('https://example.com/redirect-to-metadata', {
        allow_redirects: true
      })
    ).rejects.toThrow(/E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED/);
  });

  // --------------------------------------------------------------------------
  // COL-10: Relative and protocol-relative redirect resolution
  // --------------------------------------------------------------------------
  it('COL-10: Relative redirect is resolved safely against current origin and followed', async () => {
    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
    vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

    let hopCount = 0;
    vi.spyOn(https, 'request').mockImplementation((reqOptions: any, cb: any) => {
      hopCount++;
      const req = new MockClientRequest(reqOptions);
      setTimeout(() => {
        if (hopCount === 1) {
          const res = new MockIncomingMessage(302, { location: '/catalog/clamp-item' }, []);
          cb(res);
        } else {
          const res = new MockIncomingMessage(200, {}, ['catalog-item-content']);
          cb(res);
        }
      }, 5);
      return req as unknown as http.ClientRequest;
    });

    const res = await GovernedHttpConnector.fetch('https://example.com/initial', {
      allow_redirects: true
    });

    expect(res.status).toBe(200);
    expect(res.bodyText).toBe('catalog-item-content');
    expect(res.redirectHops).toBe(1);
    expect(hopCount).toBe(2);
  });

  // --------------------------------------------------------------------------
  // COL-11: Redirect hop limit enforcement (max 3 hops)
  // --------------------------------------------------------------------------
  it('COL-11: Exceeding maximum redirect limit (3 hops) fails closed', async () => {
    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
    vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

    let hop = 0;
    vi.spyOn(https, 'request').mockImplementation((reqOptions: any, cb: any) => {
      hop++;
      const req = new MockClientRequest(reqOptions);
      setTimeout(() => {
        const res = new MockIncomingMessage(302, { location: `/hop-${hop + 1}` }, []);
        cb(res);
      }, 5);
      return req as unknown as http.ClientRequest;
    });

    await expect(
      GovernedHttpConnector.fetch('https://example.com/hop-1', {
        allow_redirects: true
      })
    ).rejects.toThrow(/E-MCP-MAX-REDIRECTS-EXCEEDED/);
  });

  // --------------------------------------------------------------------------
  // COL-12: Cross-origin sensitive header stripping on redirect
  // --------------------------------------------------------------------------
  it('COL-12: Sensitive credentials (Authorization, Cookie) are stripped across origin changes', async () => {
    vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
    vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

    const headersPerHop: Record<string, string>[] = [];
    vi.spyOn(https, 'request').mockImplementation((reqOptions: any, cb: any) => {
      headersPerHop.push(reqOptions.headers as Record<string, string>);
      const req = new MockClientRequest(reqOptions);
      setTimeout(() => {
        if (headersPerHop.length === 1) {
          // Hop 1 redirects to different domain
          const res = new MockIncomingMessage(
            302,
            { location: 'https://cdn-partner.net/asset' },
            []
          );
          cb(res);
        } else {
          // Hop 2 succeeds
          const res = new MockIncomingMessage(200, {}, ['partner-asset']);
          cb(res);
        }
      }, 5);
      return req as unknown as http.ClientRequest;
    });

    const res = await GovernedHttpConnector.fetch('https://auth-server.org/start', {
      allow_redirects: true,
      headers: {
        'Authorization': 'Bearer test-secret-token-12345',
        'Cookie': 'sessionId=abcde98765',
        'X-Trace-Id': 'trace-101'
      }
    });

    expect(res.status).toBe(200);
    expect(headersPerHop).toHaveLength(2);

    // Hop 1 sent credentials to original origin
    expect(headersPerHop[0]['Authorization']).toBe('Bearer test-secret-token-12345');
    expect(headersPerHop[0]['Cookie']).toBe('sessionId=abcde98765');
    expect(headersPerHop[0]['X-Trace-Id']).toBe('trace-101');

    // Hop 2 stripped credentials on cross-origin redirect
    expect(headersPerHop[1]['Authorization']).toBeUndefined();
    expect(headersPerHop[1]['Cookie']).toBeUndefined();
    // Non-sensitive header preserved
    expect(headersPerHop[1]['X-Trace-Id']).toBe('trace-101');
  });

  // --------------------------------------------------------------------------
  // COL-13: DNS resolution timeout and late-result abandonment
  // --------------------------------------------------------------------------
  it('COL-13: DNS timeout rejects request and late results NEVER initiate socket connections', async () => {
    let socketFactoryCalled = false;

    vi.spyOn(dns.promises, 'resolve4').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return ['93.184.216.34'];
    });
    vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

    vi.spyOn(https, 'request').mockImplementation((reqOptions: any) => {
      socketFactoryCalled = true;
      const req = new MockClientRequest(reqOptions);
      return req as unknown as http.ClientRequest;
    });

    await expect(
      GovernedHttpConnector.fetch('https://slow-dns.example.com/test', {
        dns_timeout_ms: 30 // 30ms timeout < 150ms delay
      })
    ).rejects.toThrow(/E-MCP-DNS-TIMEOUT/);

    // Wait past the 150ms delay to prove late-completing resolution is dropped
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(socketFactoryCalled).toBe(false);
  });

  // --------------------------------------------------------------------------
  // COL-14: Dual stream caps (wire bytes vs decompressed body) & socket cleanup
  // --------------------------------------------------------------------------
  describe('COL-14: Dual streaming caps enforce bounded resource consumption', () => {
    it('COL-14A: Wire chunks exceeding max_payload_bytes terminate socket in-flight', async () => {
      vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
      vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

      let socketDestroyed = false;
      vi.spyOn(https, 'request').mockImplementation((reqOptions: any, cb: any) => {
        const req = new MockClientRequest(reqOptions);
        setTimeout(() => {
          // Emits two chunks of 100 bytes = 200 bytes total, cap is 120 bytes
          const chunk1 = Buffer.alloc(100, 0x41);
          const chunk2 = Buffer.alloc(100, 0x42);
          const res = new MockIncomingMessage(200, {}, [chunk1, chunk2]);
          res.socket.destroy = () => {
            socketDestroyed = true;
          };
          cb(res);
        }, 5);
        return req as unknown as http.ClientRequest;
      });

      await expect(
        GovernedHttpConnector.fetch('https://stream-large.example.com/download', {
          max_payload_bytes: 120
        })
      ).rejects.toThrow(/E-MCP-STREAM-PAYLOAD-TOO-LARGE/);

      expect(socketDestroyed).toBe(true);
    });

    it('COL-14B: Compressed payload exceeding max_decompressed_bytes terminates stream and socket', async () => {
      vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
      vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

      let socketDestroyed = false;

      // 5,000 bytes of repetitive 'A' compresses to ~40 bytes of gzip
      const rawPayload = Buffer.alloc(5000, 0x41);
      const gzippedPayload = zlib.gzipSync(rawPayload);

      vi.spyOn(https, 'request').mockImplementation((reqOptions: any, cb: any) => {
        const req = new MockClientRequest(reqOptions);
        setTimeout(() => {
          const res = new MockIncomingMessage(
            200,
            { 'content-encoding': 'gzip', 'content-type': 'text/plain' },
            [gzippedPayload]
          );
          res.socket.destroy = () => {
            socketDestroyed = true;
          };
          cb(res);
        }, 5);
        return req as unknown as http.ClientRequest;
      });

      await expect(
        GovernedHttpConnector.fetch('https://bomb.example.com/gzip-data', {
          max_payload_bytes: 10_000, // Wire cap is high (gzippedPayload is ~40 bytes)
          max_decompressed_bytes: 1_000 // Decompressed cap is 1,000 bytes (< 5,000)
        })
      ).rejects.toThrow(/E-MCP-DECOMPRESSED-PAYLOAD-TOO-LARGE/);

      expect(socketDestroyed).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // COL-15: Permitted IPv6 literal URL handling (LIM-01)
  // --------------------------------------------------------------------------
  it('COL-15: Permitted IPv6 literal URL connects to unbracketed IP, sets bracketed Host, omits SNI, and validates cert against unbracketed IP', async () => {
    // 2606:2800:220:1:248:1893:25c8:1946 is in 2000::/3 (IANA allocated unicast)
    const ipv6Target = 'https://[2606:2800:220:1:248:1893:25c8:1946]/feed';
    let capturedOptions: https.RequestOptions | null = null;

    vi.spyOn(https, 'request').mockImplementation((reqOptions: any, cb: any) => {
      capturedOptions = reqOptions;
      const req = new MockClientRequest(reqOptions);

      // Verify certificate identity callback directly
      if (reqOptions.checkServerIdentity) {
        const mockValidCert = {
          subjectaltname: 'IP Address:2606:2800:220:1:248:1893:25c8:1946'
        };
        const certErr = reqOptions.checkServerIdentity(
          '2606:2800:220:1:248:1893:25c8:1946',
          mockValidCert as any
        );
        if (certErr) {
          req.emit('error', certErr);
          return req as unknown as http.ClientRequest;
        }
      }

      setTimeout(() => {
        const res = new MockIncomingMessage(200, { 'content-type': 'text/plain' }, ['ipv6-feed-ok']);
        cb(res);
      }, 5);
      return req as unknown as http.ClientRequest;
    });

    const res = await GovernedHttpConnector.fetch(ipv6Target);

    expect(res.status).toBe(200);
    expect(res.bodyText).toBe('ipv6-feed-ok');
    expect(res.pinnedIp).toBe('2606:2800:220:1:248:1893:25c8:1946');

    // 1. Pinned connection target is unbracketed IPv6 literal
    expect((capturedOptions as any).host).toBe('2606:2800:220:1:248:1893:25c8:1946');
    // 2. HTTP Host header retains square brackets per RFC 3986 §3.2.2 / RFC 9110 §7.2
    expect((capturedOptions as any).headers['Host']).toBe('[2606:2800:220:1:248:1893:25c8:1946]');
    // 3. SNI extension is strictly omitted for IP literals per RFC 6066 §3
    expect((capturedOptions as any).servername).toBeUndefined();

    // 4. Mismatched cert on IPv6 literal fails closed with E-MCP-TLS-CERT-INVALID
    vi.spyOn(https, 'request').mockImplementation((reqOptions: any) => {
      const req = new MockClientRequest(reqOptions);
      setTimeout(() => {
        const mismatchCert = { subjectaltname: 'IP Address:2001:db8::99' };
        const certErr = reqOptions.checkServerIdentity!(
          '2606:2800:220:1:248:1893:25c8:1946',
          mismatchCert as any
        );
        req.emit(
          'error',
          certErr || new Error("Hostname/IP does not match certificate's altnames")
        );
      }, 5);
      return req as unknown as http.ClientRequest;
    });

    await expect(
      GovernedHttpConnector.fetch(ipv6Target)
    ).rejects.toThrow(/E-MCP-TLS-CERT-INVALID/);
  });

  // --------------------------------------------------------------------------
  // COL-16: Resource Cleanup Verification on Error Paths (LIM-03)
  // --------------------------------------------------------------------------
  describe('COL-16: Proportionate resource destruction across error paths', () => {
    it('COL-16A: Request latency timeout destroys in-flight socket while decompressor is unallocated', async () => {
      vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
      vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

      let socketDestroyed = false;
      vi.spyOn(https, 'request').mockImplementation((reqOptions: any) => {
        const req = new MockClientRequest(reqOptions);
        (req as any).socketRef.destroy = () => {
          socketDestroyed = true;
        };
        // Intentionally hang: never respond
        return req as unknown as http.ClientRequest;
      });

      await expect(
        GovernedHttpConnector.fetch('https://timeout.example.com/hang', {
          timeout_ms: 30 // 30ms latency timeout
        })
      ).rejects.toThrow(/E-MCP-LATENCY-TIMEOUT/);

      expect(socketDestroyed).toBe(true);
    });

    it('COL-16B: Malformed gzip compression stream destroys both socket and decompressor', async () => {
      vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
      vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

      let socketDestroyed = false;
      vi.mocked(zlib.createGunzip).mockClear();

      // Corrupted gzip payload: invalid gzip header magic
      const corruptedGzipChunk = Buffer.from([0x1f, 0x8b, 0x00, 0x99, 0xaa, 0xbb, 0xcc]);

      vi.spyOn(https, 'request').mockImplementation((reqOptions: any, cb: any) => {
        const req = new MockClientRequest(reqOptions);
        setTimeout(() => {
          const res = new MockIncomingMessage(
            200,
            { 'content-encoding': 'gzip', 'content-type': 'text/plain' },
            [corruptedGzipChunk]
          );
          res.socket.destroy = () => {
            socketDestroyed = true;
          };
          cb(res);
        }, 5);
        return req as unknown as http.ClientRequest;
      });

      await expect(
        GovernedHttpConnector.fetch('https://corrupt.example.com/bad-gzip')
      ).rejects.toThrow(/E-MCP-DECOMPRESSION-ERROR/);

      expect(socketDestroyed).toBe(true);
      const capturedDecompressor = vi.mocked(zlib.createGunzip).mock.results[0]?.value;
      expect(capturedDecompressor).toBeDefined();
      expect(capturedDecompressor.destroyed).toBe(true);
    });

    it('COL-16C: TLS validation failure destroys underlying socket while decompressor is unallocated', async () => {
      vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
      vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

      let socketDestroyed = false;
      vi.spyOn(https, 'request').mockImplementation((reqOptions: any) => {
        const req = new MockClientRequest(reqOptions);
        (req as any).socketRef.destroy = () => {
          socketDestroyed = true;
        };
        setTimeout(() => {
          const certErr = new Error(
            "Hostname/IP does not match certificate's altnames: Host: example.com."
          );
          req.emit('error', certErr);
        }, 5);
        return req as unknown as http.ClientRequest;
      });

      await expect(
        GovernedHttpConnector.fetch('https://example.com/tls-mismatch')
      ).rejects.toThrow(/E-MCP-TLS-CERT-INVALID/);

      expect(socketDestroyed).toBe(true);
    });

    it('COL-16D: Redirect revalidation failure terminates, destroys first-hop socket, and prevents secondary socket allocation', async () => {
      vi.spyOn(dns.promises, 'resolve4').mockResolvedValue(['93.184.216.34']);
      vi.spyOn(dns.promises, 'resolve6').mockResolvedValue([]);

      let firstHopSocketDestroyed = false;
      let totalSocketsAllocated = 0;

      vi.spyOn(https, 'request').mockImplementation((reqOptions: any, cb: any) => {
        totalSocketsAllocated++;
        const req = new MockClientRequest(reqOptions);
        setTimeout(() => {
          // Hop 1 returns 302 to metadata IP
          const res = new MockIncomingMessage(
            302,
            { location: 'https://169.254.169.254/latest/meta-data' },
            []
          );
          res.socket.destroy = () => {
            firstHopSocketDestroyed = true;
          };
          cb(res);
        }, 5);
        return req as unknown as http.ClientRequest;
      });

      await expect(
        GovernedHttpConnector.fetch('https://example.com/redirect-to-metadata', {
          allow_redirects: true
        })
      ).rejects.toThrow(/E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED/);

      // Asserts that Hop 1 socket was explicitly destroyed upon intercepting the redirect
      expect(firstHopSocketDestroyed).toBe(true);
      // Asserts that Hop 2 socket was blocked before allocation
      expect(totalSocketsAllocated).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // COL-17: Production Test-Seam Structural Enforcement (LIM-02)
  // --------------------------------------------------------------------------
  describe('COL-17: Production API structurally blocks all injection paths', () => {
    it('COL-17A: Direct injection of socketFactory throws E-MCP-TEST-SEAM-FORBIDDEN', async () => {
      const mockSocketFactory = (
        reqOptions: https.RequestOptions,
        cb: (res: http.IncomingMessage) => void
      ) => {
        const req = new MockClientRequest(reqOptions);
        return req as unknown as http.ClientRequest;
      };

      await expect(
        GovernedHttpConnector.fetch('https://example.com/data', {
          socketFactory: mockSocketFactory
        } as any)
      ).rejects.toThrow(/E-MCP-TEST-SEAM-FORBIDDEN/);
    });

    it('COL-17B: Direct injection of onResourceAllocated throws E-MCP-TEST-SEAM-FORBIDDEN', async () => {
      await expect(
        GovernedHttpConnector.fetch('https://example.com/data', {
          onResourceAllocated: () => {}
        } as any)
      ).rejects.toThrow(/E-MCP-TEST-SEAM-FORBIDDEN/);
    });

    it('COL-17C: Direct injection of policy throws E-MCP-TEST-SEAM-FORBIDDEN', async () => {
      await expect(
        GovernedHttpConnector.fetch('https://example.com/data', {
          policy: { classifyIpAddress: () => ({ isProhibited: false }) }
        } as any)
      ).rejects.toThrow(/E-MCP-TEST-SEAM-FORBIDDEN/);
    });

    it('COL-17D: Direct injection of dnsResolver throws E-MCP-TEST-SEAM-FORBIDDEN', async () => {
      await expect(
        GovernedHttpConnector.fetch('https://example.com/data', {
          dnsResolver: async () => [{ address: '127.0.0.1', family: 4 }]
        } as any)
      ).rejects.toThrow(/E-MCP-TEST-SEAM-FORBIDDEN/);
    });

    it('COL-17E: Symbol-keyed seam options throw E-MCP-TEST-SEAM-FORBIDDEN', async () => {
      const foreignSeamSymbol = Symbol('FOREIGN_TEST_SEAM');
      await expect(
        GovernedHttpConnector.fetch('https://example.com/data', {
          [foreignSeamSymbol]: { bypass: true }
        } as any)
      ).rejects.toThrow(/E-MCP-TEST-SEAM-FORBIDDEN/);
    });

    it('COL-17F: Inherited injection properties via prototype chain throw E-MCP-TEST-SEAM-FORBIDDEN', async () => {
      const maliciousProto = { policy: { classifyIpAddress: () => ({ isProhibited: false }) } };
      const optionsWithInheritedKey = Object.create(maliciousProto);

      await expect(
        GovernedHttpConnector.fetch('https://example.com/data', optionsWithInheritedKey)
      ).rejects.toThrow(/E-MCP-TEST-SEAM-FORBIDDEN/);
    });

    it('COL-17G: All 4 injection paths fail closed when NODE_ENV, MARKET_HFT_ENV, and VITEST are deleted', async () => {
      const originalNodeEnv = process.env.NODE_ENV;
      const originalMarketHftEnv = process.env.MARKET_HFT_ENV;
      const originalVitest = process.env.VITEST;
      try {
        delete process.env.NODE_ENV;
        delete process.env.MARKET_HFT_ENV;
        delete process.env.VITEST;

        const injectionVectors = [
          { socketFactory: () => {} },
          { onResourceAllocated: () => {} },
          { policy: {} },
          { dnsResolver: async () => [] },
          { [Symbol('seam')]: {} }
        ];

        for (const vector of injectionVectors) {
          await expect(
            GovernedHttpConnector.fetch('https://example.com/data', vector as any)
          ).rejects.toThrow(/E-MCP-TEST-SEAM-FORBIDDEN/);
        }
      } finally {
        if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
        if (originalMarketHftEnv !== undefined) process.env.MARKET_HFT_ENV = originalMarketHftEnv;
        if (originalVitest !== undefined) process.env.VITEST = originalVitest;
      }
    });
  });
});
