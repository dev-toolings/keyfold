package hosts

import "testing"

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
