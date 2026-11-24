// Command keyfold-server serves the vault API and, optionally, the built web UI.
package main

import (
	"flag"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"keyfold/internal/api"
	"keyfold/internal/logger"
	"keyfold/internal/store"
)

func main() {
	listen := flag.String("listen", "127.0.0.1:8717", "listen address")
	data := flag.String("data", "./data", "vault data directory")
	web := flag.String("web", "", "directory of the built web UI to serve (optional)")
	maxBlob := flag.Int64("max-blob", api.DefaultMaxBlob, "largest attachment accepted, in bytes")
	disableTOTP := flag.Bool("disable-totp", false, "turn the second factor off and exit (recovery, needs disk access)")
	backup := flag.String("backup", "", "write the whole data directory to this new archive `file` and exit (a server may be running)")
	restore := flag.String("restore", "", "recreate the data directory from a -backup archive `file` and exit (the directory must be missing or empty)")
	flag.Parse()
	slog.SetDefault(logger.New(os.Getenv("KEYFOLD_ENV"), os.Stdout))

	if *backup != "" {
		if err := backupTo(*data, *backup); err != nil {
			slog.Error("backup", "err", err)
			os.Exit(1)
		}
		slog.Info("backup written", "data", *data, "file", *backup)
		return
	}
	if *restore != "" {
		if err := restoreFrom(*data, *restore); err != nil {
			slog.Error("restore", "err", err)
			os.Exit(1)
		}
		slog.Info("vault restored", "data", *data, "file", *restore)
		return
	}

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
	if err := st.Lock(); err != nil {
		slog.Error("lock data dir", "err", err, "data", *data)
		os.Exit(1)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/", api.New(st, *maxBlob))
	if *web != "" {
		if info, err := os.Stat(*web); err == nil && info.IsDir() {
			mux.Handle("/", spa(*web))
		} else {
			slog.Warn("web dir not found, serving the API only", "dir", *web)
		}
	}
	slog.Info("keyfold-server listening", "url", "http://"+*listen, "data", *data)
	slog.Error("server stopped", "err", http.ListenAndServe(*listen, mux))
	os.Exit(1)
}

// backupTo archives the data directory into a new 0600 file. It never writes
// over a file. The archive is written under a ".partial" name and gets its
// own once whole and flushed: a backup that fails, or is killed, leaves no
// file to be taken for a good one, and can be run again.
func backupTo(dir, file string) error {
	f, err := os.CreateTemp(filepath.Dir(file), filepath.Base(file)+".partial-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if err := store.Backup(dir, f); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Link(f.Name(), file); err != nil { // fails when file exists
		return err
	}
	d, err := os.Open(filepath.Dir(file))
	if err != nil {
		return err
	}
	defer d.Close()
	return d.Sync()
}

func restoreFrom(dir, file string) error {
	f, err := os.Open(file)
	if err != nil {
		return err
	}
	defer f.Close()
	return store.Restore(dir, f)
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
