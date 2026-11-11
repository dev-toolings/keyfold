package vault

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
	"time"
)

// testdata/health.json is shared with packages/vault-core/src/stats.test.ts:
// both implementations must flag the same items.
func TestHealthSharedCases(t *testing.T) {
	data, err := os.ReadFile("testdata/health.json")
	if err != nil {
		t.Fatal(err)
	}
	var c struct {
		Now   time.Time `json:"now"`
		Items []Item    `json:"items"`
		Want  Health    `json:"want"`
	}
	if err := json.Unmarshal(data, &c); err != nil {
		t.Fatal(err)
	}
	if got := ComputeHealth(c.Items, c.Now); !reflect.DeepEqual(got, c.Want) {
		t.Fatalf("got  %+v\nwant %+v", got, c.Want)
	}
}
