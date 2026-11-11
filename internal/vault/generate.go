package vault

import (
	"crypto/rand"
	"errors"
	"math/big"
	"strings"
	"time"

	"github.com/pquerna/otp"
	"github.com/pquerna/otp/totp"

	"keyfold/internal/wordlist"
)

const (
	alnum   = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
	symbols = "!@#$%^&*()-_=+[]{};:,.?/"
	// MaxHistory is the number of previous values an item keeps.
	MaxHistory = 20
)

func pick(n int) int {
	i, err := rand.Int(rand.Reader, big.NewInt(int64(n)))
	if err != nil {
		panic(err) // crypto/rand never fails on supported platforms
	}
	return int(i.Int64())
}

// Password returns length random characters: letters and digits, plus
// symbols when asked. Same alphabet as generatePassword in packages/vault-core.
func Password(length int, withSymbols bool) string {
	set := alnum
	if withSymbols {
		set += symbols
	}
	b := make([]byte, length)
	for i := range b {
		b[i] = set[pick(len(set))]
	}
	return string(b)
}

// Passphrase returns n words of the EFF large wordlist joined by "-".
func Passphrase(n int) string {
	w := make([]string, n)
	for i := range w {
		w[i] = wordlist.Words[pick(len(wordlist.Words))]
	}
	return strings.Join(w, "-")
}

// TOTPCode returns the current code of an item's TOTP field: an otpauth://
// URI, or a bare base32 secret (six digits, 30 s, SHA-1).
func TOTPCode(spec string, now time.Time) (string, error) {
	opts := totp.ValidateOpts{Period: 30, Digits: otp.DigitsSix, Algorithm: otp.AlgorithmSHA1}
	secret := spec
	if strings.HasPrefix(spec, "otpauth://") {
		k, err := otp.NewKeyFromURL(spec)
		if err != nil {
			return "", err
		}
		secret = k.Secret()
		opts.Period, opts.Digits, opts.Algorithm = uint(k.Period()), k.Digits(), k.Algorithm()
		if opts.Period == 0 || opts.Digits < 6 || opts.Digits > 8 {
			return "", errors.New("otpauth URI: digits must be 6 to 8 and period positive")
		}
	}
	return totp.GenerateCodeCustom(strings.ToUpper(strings.ReplaceAll(secret, " ", "")), now, opts)
}

// WithValue returns it holding value. A changed value pushes the old one on
// top of History, which keeps the MaxHistory most recent. Same rule as
// withValue in packages/vault-core.
func WithValue(it Item, value, now string) Item {
	if it.Value != "" && it.Value != value {
		it.History = append([]Revision{{Value: it.Value, ChangedAt: now}}, it.History...)
		if len(it.History) > MaxHistory {
			it.History = it.History[:MaxHistory]
		}
	}
	it.Value = value
	return it
}
