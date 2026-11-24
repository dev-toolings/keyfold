// Command keyfold-server serves the vault API and, optionally, the built web UI.
package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"keyfold/internal/api"
	"keyfold/internal/logger"
	"keyfold/internal/store"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:8717", "listen address")
	data := flag.String("data", "./data", "vault data directory")
	web := flag.String("web", "", "directory of the built web UI to serve (optional)")
	maxBlob := flag.Int64("max-blob", api.DefaultMaxBlob, "largest attachment accepted, in bytes")
	allowedHosts := flag.String("allowed-hosts", os.Getenv("KEYFOLD_ALLOWED_HOSTS"),
		"comma separated host names accepted besides loopback ones: the names a TLS reverse proxy answers to (default $KEYFOLD_ALLOWED_HOSTS)")
	disableTOTP := flag.Bool("disable-totp", false, "turn the second factor off and exit (recovery, needs disk access)")
	flag.Parse()
	slog.SetDefault(logger.New(os.Getenv("KEYFOLD_ENV"), os.Stdout))

	st, err := store.Open(*data)
	if err != nil {
		slog.Error("open data dir", "err", err)
		os.Exit(1)
	}
	if *disableTOTP {
		if err := st.ClearTOTP(); err != nil {
			slog.Error("disable TOTP", "err", err)
			os.Exit(1)
		}
		slog.Info("TOTP disabled", "data", *data)
		return
	}
	opts := api.Options{MaxBlob: *maxBlob, Hosts: hostList(*allowedHosts)}
	if *web != "" {
		if info, err := os.Stat(*web); err == nil && info.IsDir() {
			opts.Web = spa(*web)
		} else {
			slog.Warn("web dir not found, serving the API only", "dir", *web)
		}
	}
	slog.Info("keyfold-server listening", "url", "http://"+*listen, "data", *data, "allowedHosts", opts.Hosts)
	slog.Error("server stopped", "err", http.ListenAndServe(*listen, api.New(st, opts)))
	os.Exit(1)
}

// hostList splits the -allowed-hosts value into lower case host names.
func hostList(v string) []string {
	return strings.FieldsFunc(strings.ToLower(v), func(r rune) bool { return r == ',' || r == ' ' })
}

// spa serves the built UI and answers index.html for paths that are not
// files, so client-side routes such as /vault survive a page reload.
func spa(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, err := os.Stat(filepath.Join(dir, filepath.Clean("/"+r.URL.Path))); err != nil {
			http.ServeFile(w, r, filepath.Join(dir, "index.html"))
			return
		}
		files.ServeHTTP(w, r)
	})
}
