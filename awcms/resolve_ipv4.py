
import socket
import sys

def get_ipv4(host):
    try:
        # Get all address info
        # AF_INET ensures we get IPv4
        addr_info = socket.getaddrinfo(host, 5432, family=socket.AF_INET, proto=socket.IPPROTO_TCP)
        
        # Extract the first IP address
        if addr_info:
            ip = addr_info[0][4][0]
            print(f"IPv4 for {host}: {ip}")
            return ip
            
    except Exception as e:
        print(f"Error resolving {host}: {e}")
        return None

if __name__ == "__main__":
    if len(sys.argv) > 1:
        get_ipv4(sys.argv[1])
    else:
        print("Usage: python3 resolve_ipv4.py <hostname>")
