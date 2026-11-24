package version

import "testing"

func TestDisplay(t *testing.T) {
	originalVersion, originalCommit := Version, Commit
	t.Cleanup(func() { Version, Commit = originalVersion, originalCommit })

	for _, tc := range []struct{ name, version, commit, want string }{
		{"release", "v0.1.0", "1a2b3c4", "v0.1.0 (commit 1a2b3c4)"},
		{"development", "dev", "1a2b3c4", "dev (commit 1a2b3c4)"},
		{"without commit", "dev", "", "dev"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			Version, Commit = tc.version, tc.commit
			if got := Display(); got != tc.want {
				t.Errorf("Display() = %q, want %q", got, tc.want)
			}
		})
	}
}
