import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

/**
 * Outbound requests to addresses configured by users (MCP server URLs,
 * upstream OAuth endpoints) must not reach the cloud instance metadata
 * services: from there, an editor could obtain the credentials of the host
 * MetaMCP runs on. Private networks stay reachable (internal MCP servers are
 * a normal use); link-local addresses and the known metadata endpoints are
 * refused. ALLOW_LINK_LOCAL_EGRESS=true lifts the restriction.
 *
 * The check resolves the host name before the request; it is a safeguard,
 * not a full SSRF firewall (restrict egress at the network level for that).
 */

const blocked = new BlockList();
blocked.addSubnet("169.254.0.0", 16, "ipv4"); // link-local, AWS/GCP/Azure/OCI metadata
blocked.addSubnet("0.0.0.0", 8, "ipv4"); // "this host"
blocked.addAddress("100.100.100.200", "ipv4"); // Alibaba Cloud metadata
blocked.addSubnet("fe80::", 10, "ipv6"); // link-local
blocked.addAddress("fd00:ec2::254", "ipv6"); // AWS metadata over IPv6

export class EgressBlockedError extends Error {
  constructor(host: string) {
    super(
      `Connections to ${host} are not allowed: it is a link-local or cloud metadata address.`,
    );
    this.name = "EgressBlockedError";
  }
}

export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) return blocked.check(mapped[1], "ipv4");
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) return blocked.check(address, "ipv6");
  return false;
}

export async function assertEgressAllowed(target: string | URL): Promise<void> {
  if (process.env.ALLOW_LINK_LOCAL_EGRESS === "true") return;
  const url = typeof target === "string" ? new URL(target) : target;
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new EgressBlockedError(host);
    return;
  }
  // Unresolvable names are left to fail in the request itself
  const addresses = await lookup(host, { all: true, verbatim: true }).catch(
    () => [],
  );
  if (addresses.some(({ address }) => isBlockedAddress(address))) {
    throw new EgressBlockedError(host);
  }
}

/** fetch() that refuses metadata / link-local destinations (see above). */
export const guardedFetch: typeof fetch = async (input, init) => {
  const target =
    input instanceof Request
      ? input.url
      : input instanceof URL
        ? input
        : String(input);
  await assertEgressAllowed(target);
  return fetch(input, init);
};
