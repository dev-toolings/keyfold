package hosts

import (
	"net/http"
	"testing"
)

func TestNameAndLoopback(t *testing.T) {
	for _, c := range []struct {
		in, name string
		loopback bool
	}{
		{"localhost", "localhost", true},
		{"LocalHost:8717", "localhost", true},
		{"127.0.0.1:8717", "127.0.0.1", true},
		{"[::1]:8717", "::1", true},
		{"[::1]", "::1", true},
		{"Vault.Example:443", "vault.example", false},
		{"[2001:db8::1]", "2001:db8::1", false},
		{"[2001:db8::1]:443", "2001:db8::1", false},
		{"192.0.2.10", "192.0.2.10", false},
		{"localhost.evil.example", "localhost.evil.example", false},
	} {
		if got := Name(c.in); got != c.name || Loopback(got) != c.loopback {
			t.Errorf("Name(%q) = %q, loopback %v; want %q, loopback %v", c.in, got, Loopback(got), c.name, c.loopback)
		}
	}
}

func TestClient(t *testing.T) {
	for _, c := range []struct {
		name, remote string
		forwarded    []string
		want         string
	}{
		{"direct", "192.0.2.1:1234", nil, "192.0.2.1"},
		{"untrusted header", "192.0.2.1:1234", []string{"192.0.2.2"}, "192.0.2.1"},
		{"last address", "127.0.0.1:1234", []string{"192.0.2.1, 192.0.2.2"}, "192.0.2.2"},
		{"last header line", "[::1]:1234", []string{"192.0.2.1", "192.0.2.2, 2001:db8::1"}, "2001:db8::1"},
		{"invalid last address", "[::1]:1234", []string{"192.0.2.1, invalid"}, "::1"},
		{"empty last address", "[::1]:1234", []string{"192.0.2.1,"}, "::1"},
	} {
		t.Run(c.name, func(t *testing.T) {
			r := &http.Request{RemoteAddr: c.remote, Header: http.Header{"X-Forwarded-For": c.forwarded}}
			if got := Client(r); got != c.want {
				t.Errorf("Client = %q, want %q", got, c.want)
			}
		})
	}
}

func TestLocal(t *testing.T) {
	for _, c := range []struct {
		name, remote, host, header string
		want                       bool
	}{
		{"local", "127.0.0.1:1234", "LocalHost:8717", "", true},
		{"local IPv6", "[::1]:1234", "[::1]:8717", "", true},
		{"remote peer", "192.0.2.1:1234", "localhost", "", false},
		{"remote host", "127.0.0.1:1234", "vault.example", "", false},
		{"unparsable peer", "localhost:1234", "localhost", "", false},
		{"Forwarded", "127.0.0.1:1234", "localhost", "Forwarded", false},
		{"X-Forwarded-For", "127.0.0.1:1234", "localhost", "X-Forwarded-For", false},
		{"X-Forwarded-Host", "127.0.0.1:1234", "localhost", "X-Forwarded-Host", false},
		{"X-Forwarded-Proto", "127.0.0.1:1234", "localhost", "X-Forwarded-Proto", false},
		{"X-Real-IP", "127.0.0.1:1234", "localhost", "X-Real-IP", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			r := &http.Request{RemoteAddr: c.remote, Host: c.host, Header: make(http.Header)}
			if c.header != "" {
				r.Header.Set(c.header, "")
			}
			if got := Local(r); got != c.want {
				t.Errorf("Local = %v, want %v", got, c.want)
			}
		})
	}
}
