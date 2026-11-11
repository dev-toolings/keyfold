// Package wordlist holds the EFF large wordlist (7776 words, five dice per
// word), by the Electronic Frontier Foundation, under CC BY 3.0 US:
// https://www.eff.org/dice. packages/vault-core reads the same file.
package wordlist

import (
	_ "embed"
	"strings"
)

//go:embed eff_large_wordlist.txt
var raw string

// Words is the list, in its original order.
var Words = strings.Fields(raw)
