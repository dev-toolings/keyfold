// Package hosts tells loopback host names from the others. The server and the
// CLI both treat plain HTTP on a loopback name as safe, and nothing else.
package hosts

import (
	"net"
	"strings"
)

// Name returns the host of a Host header or URL authority: lower case,
// without its port.
func Name(hostport string) string {
	host := hostport
	if h, _, err := net.SplitHostPort(hostport); err == nil {
		host = h
	}
	return strings.ToLower(host)
}

// Loopback reports whether name is localhost or a loopback IP address.
func Loopback(name string) bool {
	ip := net.ParseIP(name)
	return name == "localhost" || (ip != nil && ip.IsLoopback())
}
