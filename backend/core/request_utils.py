import ipaddress
from typing import Optional

from fastapi import Request

from ..config import settings


def _parse_ip(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    candidate = value.strip()
    try:
        return str(ipaddress.ip_address(candidate))
    except ValueError:
        return None


def _is_trusted_proxy(peer_ip: str) -> bool:
    trusted_entries = [p.strip() for p in settings.trusted_proxy_ips.split(",") if p.strip()]
    if not trusted_entries:
        return False

    try:
        peer_addr = ipaddress.ip_address(peer_ip)
    except ValueError:
        return False

    for entry in trusted_entries:
        try:
            if "/" in entry:
                if peer_addr in ipaddress.ip_network(entry, strict=False):
                    return True
            else:
                parsed_entry = _parse_ip(entry)
                if parsed_entry and peer_ip == parsed_entry:
                    return True
        except ValueError:
            continue
    return False


def get_client_ip(request: Request) -> str:
    """
    Get the client IP address.
    Proxy headers are trusted only when the TCP peer is a trusted proxy.
    """
    peer_ip = _parse_ip(request.client.host if request.client else None) or "127.0.0.1"

    # Never trust XFF/X-Real-IP from direct clients.
    if not _is_trusted_proxy(peer_ip):
        return peer_ip

    xff = request.headers.get("x-forwarded-for")
    if xff:
        # First valid IP in chain is treated as original client.
        for part in (p.strip() for p in xff.split(",")):
            parsed = _parse_ip(part)
            if parsed:
                return parsed

    real_ip = request.headers.get("x-real-ip")
    parsed_real_ip = _parse_ip(real_ip)
    if parsed_real_ip:
        return parsed_real_ip

    return peer_ip


def get_masked_ip(ip: str, ipv4_mask_bits: int, ipv6_mask_bits: int = 128) -> str:
    """Return normalized network identifier for session binding.

    Examples:
    - IPv4 /32 -> "203.0.113.9/32"
    - IPv4 /24 -> "203.0.113.0/24"
    - IPv6 /128 -> "2001:db8::1/128"
    """
    parsed_ip = _parse_ip(ip)
    if not parsed_ip:
        return ""

    address = ipaddress.ip_address(parsed_ip)
    if isinstance(address, ipaddress.IPv4Address):
        mask_bits = max(0, min(ipv4_mask_bits, 32))
    else:
        mask_bits = max(0, min(ipv6_mask_bits, 128))

    if mask_bits == 0:
        return ""

    network = ipaddress.ip_network(f"{address}/{mask_bits}", strict=False)
    return f"{network.network_address}/{mask_bits}"