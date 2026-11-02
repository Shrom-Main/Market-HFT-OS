/**
 * POC-001: Stage 1 — Governed HTTP Collector (Milestone 1)
 *
 * Implements a lean, destination-pinned HTTP collector for market data acquisition.
 *
 * Security & Reliability Invariants:
 * 1. Strict Protocol & Port Locking:
 *    - Protocol locked to 'https:' exclusively (E-MCP-SCHEME-DENIED).
 *    - Port locked to 443 exclusively (E-MCP-PORT-DENIED).
 * 2. Pre-Resolution IP Classification & DNS Rebinding Defeat:
 *    - Integrates with NetworkSecurityPolicy (4-tier IANA/RFC 6890 classification).
 *    - Conservative Rule: If ANY candidate IP returned by DNS is prohibited (private,
 *      loopback, cloud metadata, link-local, unallocated), the entire request fails closed
 *      immediately before any TCP socket is opened (E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED).
 * 3. Deterministic Candidate Ordering & Bounded Single Retry:
 *    - IPv4 addresses precede IPv6 addresses, sorted lexicographically to eliminate
 *      nondeterministic OS resolver selection.
 *    - Primary candidate IP literal is connected first.
 *    - On network-level socket failure (ECONNREFUSED, ETIMEDOUT, ENETUNREACH, EHOSTUNREACH),
 *      at most ONE retry is attempted to a pre-validated secondary IP literal.
 *    - Retry connects strictly to the secondary IP literal and NEVER re-queries DNS.
 * 4. True IP-Literal Socket Pinning:
 *    - Passes pinned IP literal directly to OS connect() via `host: pinnedIpLiteral`.
 *    - Explicitly sets `servername: parsedUrl.hostname` (TLS SNI ClientHello) and
 *      `Host: parsedUrl.host` header.
 *    - Validates TLS certificate identity strictly against `parsedUrl.hostname` via
 *      `tls.checkServerIdentity()`.
 *    - Disables cross-destination connection pooling via `agent: false`.
 * 5. DNS Cancellation & No-Late-Connect Invariant:
 *    - Enforces `dns_timeout_ms` (default 3000ms).
 *    - When timeout fires, cancellation flag is set; late-resolving DNS queries can NEVER
 *      initiate a TCP/TLS socket connection.
 * 6. Dual Streaming Caps & Bounded Decompression:
 *    - Streaming wire byte cap (`max_payload_bytes`, default 512 KB) terminates socket in-flight.
 *    - Decompressed body cap (`max_decompressed_bytes`, default 1 MB) protects memory from
 *      decompression bombs (gzip, deflate, br).
 *    - Bounded Operational Limitation Note: Streaming byte caps protect process memory;
 *      CPU-time exhaustion during decompression is an inherent software boundary acknowledged
 *      as a bounded operational limit.
 * 7. Hop-by-Hop Redirect Revalidation:
 *    - Limit: maximum 3 hops (E-MCP-MAX-REDIRECTS-EXCEEDED).
 *    - Every redirect target undergoes full HTTPS scheme, port 443, DNS re-resolution,
 *      and IP re-classification before opening a new socket.
 *    - Strips sensitive headers (Authorization, Cookie, Proxy-Authorization) across origin changes.
 * 8. Zero-Seam Production Invariant:
 *    - Production connector contains zero test seams, zero registration functions, and
 *      zero injection parameters. Testing is achieved strictly via test-only module spies.
 */

import * as https from 'node:https';
import * as http from 'node:http';
import * as tls from 'node:tls';
import * as dns from 'node:dns';
import * as net from 'node:net';
import * as zlib from 'node:zlib';
import { Readable } from 'node:stream';
import {
  NetworkSecurityPolicy,
  IpClassificationResult
} from './network_security_policy.js';

export interface GovernedHttpOptions {
  readonly method?: 'GET';
  readonly headers?: Record<string, string>;
  readonly max_payload_bytes?: number; // Wire bytes cap, default 524_288 (512 KB)
  readonly max_decompressed_bytes?: number; // Decompressed bytes cap, default 1_048_576 (1 MB)
  readonly timeout_ms?: number; // Overall request timeout, default 10_000 (10s)
  readonly dns_timeout_ms?: number; // DNS lookup timeout, default 3_000 (3s)
  readonly allow_redirects?: boolean; // Default false
}

export interface GovernedHttpResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly bodyText: string;
  readonly bytesRead: number;
  readonly pinnedIp: string;
  readonly redirectHops: number;
}

export class GovernedHttpConnector {
  private static defaultPolicy: NetworkSecurityPolicy | null = null;

  /**
   * Intrinsic fail-closed seam injection scanner.
   * Scans for both symbol-keyed properties and named injection keys across own and prototype chain.
   */
  public static assertNoSeamInjection(options: unknown): void {
    if (!options || typeof options !== 'object') {
      return;
    }

    // 1. Reject any symbol-keyed properties (e.g. legacy internal seam symbols)
    const symbols = Object.getOwnPropertySymbols(options);
    if (symbols.length > 0) {
      throw new Error(
        'E-MCP-TEST-SEAM-FORBIDDEN: Symbol-keyed seam options are strictly prohibited on production GovernedHttpConnector.'
      );
    }

    // 2. Reject named injection keys across own properties and prototype chain
    const FORBIDDEN_SEAM_KEYS = [
      'socketFactory',
      'onResourceAllocated',
      'policy',
      'dnsResolver'
    ] as const;

    for (const key of FORBIDDEN_SEAM_KEYS) {
      if (key in (options as object)) {
        throw new Error(
          `E-MCP-TEST-SEAM-FORBIDDEN: Injected '${key}' is strictly prohibited on production GovernedHttpConnector.`
        );
      }
    }
  }

  private static getPolicy(): NetworkSecurityPolicy {
    if (!GovernedHttpConnector.defaultPolicy) {
      GovernedHttpConnector.defaultPolicy = new NetworkSecurityPolicy();
    }
    return GovernedHttpConnector.defaultPolicy;
  }

  /**
   * Main production entry point for governed HTTP data acquisition.
   * Strictly limited to clean GovernedHttpOptions.
   */
  public static async fetch(
    targetUrl: string,
    options: GovernedHttpOptions = {}
  ): Promise<GovernedHttpResponse> {
    GovernedHttpConnector.assertNoSeamInjection(options);
    return GovernedHttpConnector.executeFetchWithRedirects(targetUrl, options, 0);
  }

  /**
   * Internal transport execution method with redirect support.
   */
  private static async executeFetchWithRedirects(
    targetUrl: string,
    options: GovernedHttpOptions,
    currentHop: number
  ): Promise<GovernedHttpResponse> {
    const maxPayloadBytes = options.max_payload_bytes ?? 524_288;
    const maxDecompressedBytes = options.max_decompressed_bytes ?? 1_048_576;
    const timeoutMs = options.timeout_ms ?? 10_000;
    const dnsTimeoutMs = options.dns_timeout_ms ?? 3_000;
    const allowRedirects = options.allow_redirects ?? false;
    const policy = GovernedHttpConnector.getPolicy();

    // 1. URL Parsing & Scheme / Port Validation
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      throw new Error(`E-MCP-HOST-OR-SSRF-DENIED: Malformed URL '${targetUrl}'.`);
    }

    if (parsedUrl.protocol.toLowerCase() !== 'https:') {
      throw new Error(
        `E-MCP-SCHEME-DENIED: Scheme '${parsedUrl.protocol}' is denied. Only https: is permitted for network egress.`
      );
    }

    if (parsedUrl.port && parsedUrl.port !== '' && parsedUrl.port !== '443') {
      throw new Error(
        `E-MCP-PORT-DENIED: Port '${parsedUrl.port}' is denied. Network egress is strictly locked to port 443.`
      );
    }

    const rawHostname = parsedUrl.hostname.toLowerCase();
    const cleanHostname = rawHostname.replace(/^\[|\]$/g, '');

    // Check RFC 6761 / RFC 6762 / Cloud internal special names
    if (
      cleanHostname === 'localhost' ||
      cleanHostname.endsWith('.localhost') ||
      cleanHostname.endsWith('.local') ||
      cleanHostname.endsWith('.internal') ||
      cleanHostname === 'metadata.google.internal'
    ) {
      throw new Error(
        `E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED: Target host '${rawHostname}' resolved to private/loopback/metadata IP '127.0.0.1'. Network egress blocked to prevent DNS rebinding.`
      );
    }

    // 2. Resolve DNS Candidates or Classify Literal IP
    let candidateIps: string[] = [];

    if (net.isIP(cleanHostname) !== 0) {
      // Hostname is already an IP literal
      const ipClassification = policy.classifyIpAddress(cleanHostname);
      if (ipClassification.isProhibited) {
        throw new Error(
          `E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED: Target host '${rawHostname}' resolved to private/loopback/metadata IP '${cleanHostname}'. Network egress blocked to prevent DNS rebinding.`
        );
      }
      candidateIps = [cleanHostname];
    } else {
      // Hostname is a domain name — resolve DNS with cancellation guard
      candidateIps = await GovernedHttpConnector.resolveDnsCandidates(
        cleanHostname,
        dnsTimeoutMs
      );

      // Conservative Rule: Evaluate EVERY candidate IP against policy.
      // If ANY candidate is prohibited, fail closed immediately before opening any socket.
      for (const ip of candidateIps) {
        const normIp = ip.toLowerCase().replace(/^\[|\]$/g, '');
        const classification = policy.classifyIpAddress(normIp);
        if (classification.isProhibited) {
          throw new Error(
            `E-MCP-DNS-REBINDING-OR-PRIVATE-IP-DENIED: Target host '${rawHostname}' resolved to private/loopback/metadata IP '${normIp}'. Network egress blocked to prevent DNS rebinding.`
          );
        }
      }
    }

    if (candidateIps.length === 0) {
      throw new Error(`E-MCP-DNS-RESOLUTION-FAILED: No IP addresses resolved for '${rawHostname}'.`);
    }

    // 3. Deterministic Family Ordering: IPv4 first, then IPv6, with lexical tie-break
    const ipv4s = candidateIps.filter((ip) => net.isIPv4(ip)).sort((a, b) => a.localeCompare(b));
    const ipv6s = candidateIps.filter((ip) => net.isIPv6(ip)).sort((a, b) => a.localeCompare(b));
    const orderedCandidates = [...ipv4s, ...ipv6s];


    // 4. Bounded Connection Attempt & Single Retry to Secondary IP Literal
    const primaryIp = orderedCandidates[0];
    const secondaryIp = orderedCandidates.length > 1 ? orderedCandidates[1] : null;

    let attemptResult: {
      status: number;
      headers: Record<string, string>;
      bodyText: string;
      bytesRead: number;
      pinnedIp: string;
      destroySocket?: () => void;
    };

    try {
      attemptResult = await GovernedHttpConnector.executeSocketRequest(
        parsedUrl,
        primaryIp,
        options,
        maxPayloadBytes,
        maxDecompressedBytes,
        timeoutMs
      );
    } catch (primaryErr: unknown) {
      const err = primaryErr as { code?: string; message?: string };
      const isNetworkError =
        err &&
        (err.code === 'ECONNREFUSED' ||
          err.code === 'ETIMEDOUT' ||
          err.code === 'ENETUNREACH' ||
          err.code === 'EHOSTUNREACH' ||
          err.code === 'EADDRNOTAVAIL' ||
          (err.message && /ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH/i.test(err.message)));

      if (isNetworkError && secondaryIp) {
        // Attempt exactly one retry to the secondary pre-validated IP literal.
        // Invariant: Never re-query DNS or hostname on retry.
        try {
          attemptResult = await GovernedHttpConnector.executeSocketRequest(
            parsedUrl,
            secondaryIp,
            options,
            maxPayloadBytes,
            maxDecompressedBytes,
            timeoutMs
          );
        } catch (secondaryErr: unknown) {
          throw new Error(
            `E-MCP-CONNECTION-FAILED: Failed to connect to '${rawHostname}' on IP(s) [${primaryIp}, ${secondaryIp}]: ${
              secondaryErr instanceof Error ? secondaryErr.message : String(secondaryErr)
            }`
          );
        }
      } else {
        throw primaryErr;
      }
    }

    // 5. Hop-by-Hop Redirect Handling
    const statusCode = attemptResult.status;
    if (statusCode >= 300 && statusCode < 400) {
      // Explicitly destroy the first-hop socket before following redirect or failing
      attemptResult.destroySocket?.();

      if (!allowRedirects) {
        throw new Error(
          `E-MCP-REDIRECT-DENIED: Server returned redirect status ${statusCode} but redirects are disallowed.`
        );
      }

      if (currentHop >= 3) {
        throw new Error(`E-MCP-MAX-REDIRECTS-EXCEEDED: Maximum redirect limit (3) exceeded.`);
      }

      const locationHeader =
        attemptResult.headers['location'] || attemptResult.headers['Location'];
      if (!locationHeader) {
        throw new Error(
          `E-MCP-REDIRECT-FAILED: Server returned status ${statusCode} without a Location header.`
        );
      }

      // Resolve relative or protocol-relative redirect URL against current URL
      let nextUrl: URL;
      try {
        nextUrl = new URL(locationHeader, targetUrl);
      } catch {
        throw new Error(`E-MCP-HOST-OR-SSRF-DENIED: Malformed redirect URL '${locationHeader}'.`);
      }

      // Validate scheme and port for redirect target
      if (nextUrl.protocol.toLowerCase() !== 'https:') {
        throw new Error(
          `E-MCP-SCHEME-DENIED: Scheme '${nextUrl.protocol}' is denied. Only https: is permitted for network egress.`
        );
      }
      if (nextUrl.port && nextUrl.port !== '' && nextUrl.port !== '443') {
        throw new Error(
          `E-MCP-PORT-DENIED: Port '${nextUrl.port}' is denied. Network egress is strictly locked to port 443.`
        );
      }

      // Cross-origin sensitive header stripping
      const currentOrigin = new URL(targetUrl).origin;
      const nextOrigin = nextUrl.origin;
      const forwardedHeaders = { ...(options.headers ?? {}) };

      if (currentOrigin !== nextOrigin) {
        delete forwardedHeaders['authorization'];
        delete forwardedHeaders['Authorization'];
        delete forwardedHeaders['cookie'];
        delete forwardedHeaders['Cookie'];
        delete forwardedHeaders['proxy-authorization'];
        delete forwardedHeaders['Proxy-Authorization'];
      }

      const nextOptions: GovernedHttpOptions = {
        ...options,
        headers: forwardedHeaders
      };

      return GovernedHttpConnector.executeFetchWithRedirects(
        nextUrl.toString(),
        nextOptions,
        currentHop + 1
      );
    }

    return {
      status: attemptResult.status,
      headers: attemptResult.headers,
      bodyText: attemptResult.bodyText,
      bytesRead: attemptResult.bytesRead,
      pinnedIp: attemptResult.pinnedIp,
      redirectHops: currentHop
    };
  }

  /**
   * Performs parallel DNS lookups for IPv4 and IPv6 with timeout and strict cancellation guard.
   * Late resolving results are discarded and cannot initiate socket connections.
   */
  private static async resolveDnsCandidates(
    hostname: string,
    dnsTimeoutMs: number
  ): Promise<string[]> {
    let isDnsAborted = false;
    let timerHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timerHandle = setTimeout(() => {
        isDnsAborted = true;
        reject(
          new Error(
            `E-MCP-DNS-TIMEOUT: DNS resolution timed out after ${dnsTimeoutMs}ms for '${hostname}'.`
          )
        );
      }, dnsTimeoutMs);
    });

    const lookupPromise = (async (): Promise<string[]> => {
      const v4Promise = dns.promises.resolve4(hostname).catch(() => [] as string[]);
      const v6Promise = dns.promises.resolve6(hostname).catch(() => [] as string[]);
      const [v4List, v6List] = await Promise.all([v4Promise, v6Promise]);
      const rawAddresses = [
        ...v4List.map((a) => ({ address: a, family: 4 })),
        ...v6List.map((a) => ({ address: a, family: 6 }))
      ];

      // If timeout fired while resolution was running, drop results immediately
      if (isDnsAborted) {
        return [];
      }

      if (!rawAddresses || rawAddresses.length === 0) {
        throw new Error(`E-MCP-DNS-RESOLUTION-FAILED: No IP addresses resolved for '${hostname}'.`);
      }

      return rawAddresses.map((entry) => entry.address);
    })();

    try {
      return await Promise.race([lookupPromise, timeoutPromise]);
    } finally {
      if (timerHandle) {
        clearTimeout(timerHandle);
      }
    }
  }

  /**
   * Executes a socket request pinned to a specific IP literal, with TLS SNI and cert check.
   */
  private static executeSocketRequest(
    parsedUrl: URL,
    pinnedIp: string,
    options: GovernedHttpOptions,
    maxPayloadBytes: number,
    maxDecompressedBytes: number,
    timeoutMs: number
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    bodyText: string;
    bytesRead: number;
    pinnedIp: string;
    destroySocket?: () => void;
  }> {
    return new Promise((resolve, reject) => {
      let activeRequest: http.ClientRequest | null = null;
      let activeSocket: net.Socket | tls.TLSSocket | null = null;
      let activeDecompressor: zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null = null;
      let isSettled = false;
      let requestTimer: NodeJS.Timeout | undefined;

      const cleanup = () => {
        if (requestTimer) {
          clearTimeout(requestTimer);
          requestTimer = undefined;
        }
      };

      const fail = (err: Error) => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        if (activeDecompressor) {
          try {
            activeDecompressor.destroy();
          } catch {}
        }
        if (activeSocket) {
          try {
            activeSocket.destroy();
          } catch {}
        }
        if (activeRequest) {
          try {
            activeRequest.destroy();
          } catch {}
        }
        reject(err);
      };

      requestTimer = setTimeout(() => {
        fail(new Error(`E-MCP-LATENCY-TIMEOUT: Network request exceeded timeout (${timeoutMs}ms).`));
      }, timeoutMs);

      const cleanHostname = parsedUrl.hostname.toLowerCase().replace(/^\[|\]$/g, '');
      const isLiteralIp = net.isIP(cleanHostname) !== 0;
      const targetHostName = isLiteralIp ? cleanHostname : parsedUrl.hostname;

      const requestHeaders: Record<string, string> = {
        ...(options.headers ?? {}),
        Host: parsedUrl.host,
        'Accept-Encoding': 'gzip, deflate, br',
        'User-Agent': options.headers?.['User-Agent'] ?? options.headers?.['user-agent'] ?? 'POC-001-Governed-Collector/1.0'
      };

      const requestOptions: https.RequestOptions = {
        host: pinnedIp, // True IP-literal socket pinning — bypasses libc getaddrinfo
        port: 443,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method ?? 'GET',
        headers: requestHeaders,
        servername: isLiteralIp ? undefined : parsedUrl.hostname, // Omit SNI for IP literals (RFC 6066 §3)
        agent: false, // Prevents cross-destination connection pooling
        checkServerIdentity: (host, cert) => {
          // Strictly validate TLS certificate against unbracketed target hostname/IP
          const certErr = tls.checkServerIdentity(targetHostName, cert);
          return certErr;
        }
      };

      const handleResponse = (res: http.IncomingMessage) => {
        const rawHeaders: Record<string, string> = {};
        for (const [key, val] of Object.entries(res.headers)) {
          if (Array.isArray(val)) {
            rawHeaders[key.toLowerCase()] = val.join(', ');
          } else if (val !== undefined) {
            rawHeaders[key.toLowerCase()] = val;
          }
        }

        let wireBytesRead = 0;
        let decompressedBytesRead = 0;
        const rawChunks: Buffer[] = [];
        const decompressedChunks: Buffer[] = [];

        const contentEncoding = (rawHeaders['content-encoding'] || '').toLowerCase().trim();
        let decompressStream: zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null = null;

        if (contentEncoding === 'gzip' || contentEncoding === 'x-gzip') {
          decompressStream = zlib.createGunzip();
        } else if (contentEncoding === 'deflate') {
          decompressStream = zlib.createInflate();
        } else if (contentEncoding === 'br') {
          decompressStream = zlib.createBrotliDecompress();
        }
        activeDecompressor = decompressStream;
        if (decompressStream) {
          decompressStream.on('data', (chunk: Buffer) => {
            decompressedBytesRead += chunk.length;
            if (decompressedBytesRead > maxDecompressedBytes) {
              fail(
                new Error(
                  `E-MCP-DECOMPRESSED-PAYLOAD-TOO-LARGE: Decompressed response exceeded max_decompressed_bytes cap (${maxDecompressedBytes} bytes). Connection terminated.`
                )
              );
              return;
            }
            decompressedChunks.push(chunk);
          });

          decompressStream.on('error', (err: Error) => {
            fail(new Error(`E-MCP-DECOMPRESSION-ERROR: Stream decompression failed: ${err.message}`));
          });

          decompressStream.on('end', () => {
            if (isSettled) return;
            isSettled = true;
            cleanup();
            const bodyBuffer = Buffer.concat(decompressedChunks);
            const destroySocket = () => {
              if (activeSocket) {
                try { activeSocket.destroy(); } catch {}
              }
              if (activeRequest) {
                try { activeRequest.destroy(); } catch {}
              }
            };
            resolve({
              status: res.statusCode ?? 0,
              headers: rawHeaders,
              bodyText: bodyBuffer.toString('utf8'),
              bytesRead: wireBytesRead,
              pinnedIp,
              destroySocket
            });
          });
        }

        res.on('data', (chunk: Buffer) => {
          wireBytesRead += chunk.length;
          if (wireBytesRead > maxPayloadBytes) {
            fail(
              new Error(
                `E-MCP-STREAM-PAYLOAD-TOO-LARGE: Streamed response exceeded max_payload_bytes cap (${maxPayloadBytes} bytes) in-flight. Connection terminated.`
              )
            );
            return;
          }
          rawChunks.push(chunk);
          if (decompressStream && !decompressStream.destroyed) {
            decompressStream.write(chunk);
          }
        });

        res.on('end', () => {
          if (decompressStream) {
            decompressStream.end();
          } else {
            if (isSettled) return;
            isSettled = true;
            cleanup();
            const bodyBuffer = Buffer.concat(rawChunks);
            const destroySocket = () => {
              if (activeSocket) {
                try { activeSocket.destroy(); } catch {}
              }
              if (activeRequest) {
                try { activeRequest.destroy(); } catch {}
              }
            };
            resolve({
              status: res.statusCode ?? 0,
              headers: rawHeaders,
              bodyText: bodyBuffer.toString('utf8'),
              bytesRead: wireBytesRead,
              pinnedIp,
              destroySocket
            });
          }
        });

        res.on('error', (err: Error) => {
          fail(err);
        });
      };

      try {
        const req = https.request(requestOptions, handleResponse);
        activeRequest = req;
        if ((req as any).socket) {
          activeSocket = (req as any).socket;
        }

        req.on('socket', (sock) => {
          activeSocket = sock;
        });

        req.on('error', (err: Error) => {
          if (/certificate|altnames|hostname/i.test(err.message)) {
            fail(
              new Error(
                `E-MCP-TLS-CERT-INVALID: TLS certificate validation failed for '${targetHostName}': ${err.message}`
              )
            );
          } else {
            fail(err);
          }
        });

        req.end();
      } catch (err: unknown) {
        fail(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
