package vault

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"keyfold/internal/wordlist"
)

func TestTOTPCodeRFC6238(t *testing.T) {
	// RFC 6238 appendix B, SHA-1, T = 59 s: 94287082, last six digits.
	at := time.Unix(59, 0)
	for _, spec := range []string{
		"GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
		"otpauth://totp/fake?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&digits=8",
	} {
		code, err := TOTPCode(spec, at)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.HasSuffix("94287082", code) {
			t.Errorf("%s: code %s", spec, code)
		}
	}
}

func TestWithValueKeepsTwentyRevisions(t *testing.T) {
	it := Item{Value: "fake-0"}
	for i := 1; i <= 25; i++ {
		it = WithValue(it, fmt.Sprintf("fake-%d", i), fmt.Sprint(i))
	}
	it = WithValue(it, "fake-25", "26") // unchanged value: no revision
	if len(it.History) != MaxHistory || it.History[0].Value != "fake-24" || it.History[0].ChangedAt != "25" {
		t.Fatalf("history = %d entries, first %+v", len(it.History), it.History[0])
	}
}

func TestGenerators(t *testing.T) {
	if len(wordlist.Words) != 7776 {
		t.Fatalf("wordlist has %d words", len(wordlist.Words))
	}
	if p := Passphrase(6); len(strings.Split(p, "-")) < 6 {
		t.Fatalf("passphrase %q", p)
	}
	p := Password(64, false)
	if len(p) != 64 || strings.ContainsAny(p, symbols) {
		t.Fatalf("password %q", p)
	}
}
