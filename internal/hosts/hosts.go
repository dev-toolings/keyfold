// Package hosts tells loopback host names from the others. The server and the
// CLI both treat plain HTTP on a loopback name as safe, and nothing else.
package hosts

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// Name returns the host of a Host header or URL authority: lower case,
// without its port or the brackets of an IPv6 address.
func Name(hostport string) string {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	return strings.ToLower(strings.Trim(host, "[]"))
}

// Loopback reports whether name is localhost or a loopback IP address.
func Loopback(name string) bool {
	ip := net.ParseIP(name)
	return name == "localhost" || (ip != nil && ip.IsLoopback())
}

// Local reports whether r came directly from a loopback client to a loopback host.
func Local(r *http.Request) bool {
	if !remoteIP(r).IsLoopback() || !Loopback(Name(r.Host)) {
		return false
	}
	for name := range r.Header {
		switch http.CanonicalHeaderKey(name) {
		case "Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Real-Ip":
			return false
		}
	}
	return true
}

// Client returns the peer IP, or the last IP appended by a loopback proxy.
func Client(r *http.Request) string {
	ip := remoteIP(r)
	if ip.IsLoopback() {
		if values := r.Header.Values("X-Forwarded-For"); len(values) > 0 {
			last := values[len(values)-1]
			last = strings.TrimSpace(last[strings.LastIndexByte(last, ',')+1:])
			if forwarded := net.ParseIP(last); forwarded != nil {
				return forwarded.String()
			}
		}
	}
	if !ip.IsValid() {
		return ""
	}
	return ip.WithZone("").String()
}

func remoteIP(r *http.Request) netip.Addr {
	ip, _ := netip.ParseAddr(Name(r.RemoteAddr))
	return ip.Unmap()
}
