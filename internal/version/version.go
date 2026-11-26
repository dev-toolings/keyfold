// Package version reports the build version and commit.
package version

import "runtime/debug"

// Version is the release tag, optionally set by the linker.
var Version = "dev"

// Commit is the short revision, optionally set by the linker.
var Commit string

func init() {
	if Commit != "" {
		return
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		for _, setting := range info.Settings {
			if setting.Key == "vcs.revision" {
				Commit = setting.Value[:min(7, len(setting.Value))]
				return
			}
		}
	}
}

// Display returns the version with its commit when available.
func Display() string {
	if Commit == "" {
		return Version
	}
	return Version + " (commit " + Commit + ")"
}
