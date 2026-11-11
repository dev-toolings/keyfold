package vault

import (
	"math"
	"regexp"
	"slices"
	"time"
)

// The vault health indicators, by the same rules as packages/vault-core/src/stats.ts
// (the web dashboard). testdata/health.json holds cases both test suites check.
const (
	StaleDays   = 90 // not modified for more days than this: due for renewal
	ShortLength = 16 // a password shorter than this is short
	WeakBits    = 60 // a password estimated below this is weak
)

var (
	secretKinds   = []string{"login", "token", "ssh-passphrase"} // compared for reuse
	passwordKinds = []string{"login", "ssh-passphrase"}          // length and strength matter
	effWord       = regexp.MustCompile(`^[a-z]+$`)
	lower         = regexp.MustCompile(`[a-z]`)
	upper         = regexp.MustCompile(`[A-Z]`)
	digit         = regexp.MustCompile(`[0-9]`)
	other         = regexp.MustCompile(`[^a-zA-Z0-9]`)
)

// Health lists, by name, the items each indicator flags. Never a value.
type Health struct {
	Items  int      `json:"items"`
	Stale  []string `json:"stale"`
	Reused []string `json:"reused"`
	Short  []string `json:"short"`
	Weak   []string `json:"weak"`
	NoTOTP []string `json:"no_totp"`
}

// StrengthBits estimates a value's entropy: length times log2 of the
// character classes used, or 12.9 bits per word of an EFF passphrase.
func StrengthBits(v string) float64 {
	if words := splitDash(v); len(words) >= 4 && !slices.ContainsFunc(words, func(w string) bool { return !effWord.MatchString(w) }) {
		return float64(len(words)) * math.Log2(7776)
	}
	pool := 0
	for re, n := range map[*regexp.Regexp]int{lower: 26, upper: 26, digit: 10, other: 33} {
		if re.MatchString(v) {
			pool += n
		}
	}
	if pool == 0 {
		return 0
	}
	return float64(len([]rune(v))) * math.Log2(float64(pool))
}

func splitDash(v string) []string {
	var out []string
	start := 0
	for i := 0; i <= len(v); i++ {
		if i == len(v) || v[i] == '-' {
			out = append(out, v[start:i])
			start = i + 1
		}
	}
	return out
}

// ComputeHealth applies every indicator to items (in the current format).
func ComputeHealth(items []Item, now time.Time) Health {
	h := Health{Items: len(items), Stale: []string{}, Reused: []string{}, Short: []string{}, Weak: []string{}, NoTOTP: []string{}}
	byValue := map[string][]string{}
	for _, it := range items {
		if updated, err := time.Parse(time.RFC3339, it.UpdatedAt); err == nil && int(now.Sub(updated).Hours()/24) > StaleDays {
			h.Stale = append(h.Stale, it.Name)
		}
		if slices.Contains(secretKinds, it.Kind) && it.Value != "" {
			byValue[it.Value] = append(byValue[it.Value], it.Name)
		}
		if slices.Contains(passwordKinds, it.Kind) && it.Value != "" {
			if len([]rune(it.Value)) < ShortLength {
				h.Short = append(h.Short, it.Name)
			}
			if StrengthBits(it.Value) < WeakBits {
				h.Weak = append(h.Weak, it.Name)
			}
		}
		if it.Kind == "login" && len(it.URLs) > 0 && it.TOTP == "" {
			h.NoTOTP = append(h.NoTOTP, it.Name)
		}
	}
	for _, names := range byValue {
		if len(names) > 1 {
			h.Reused = append(h.Reused, names...)
		}
	}
	for _, l := range [][]string{h.Stale, h.Reused, h.Short, h.Weak, h.NoTOTP} {
		slices.Sort(l)
	}
	return h
}
