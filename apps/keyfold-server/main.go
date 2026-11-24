// Command keyfold-server serves the vault API and, optionally, the built web UI.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"keyfold/internal/api"
	"keyfold/internal/logger"
	"keyfold/internal/store"
)

// shutdownGrace is how long requests in flight get to finish after a stop signal.
const shutdownGrace = 15 * time.Second

func main() {
	listen := flag.String("listen", "127.0.0.1:8717", "listen address")
	data := flag.String("data", "./data", "vault data directory")
	web := flag.String("web", "", "directory of the built web UI to serve (optional)")
	maxBlob := flag.Int64("max-blob", api.DefaultMaxBlob, "largest attachment accepted, in bytes")
	allowedHosts := flag.String("allowed-hosts", os.Getenv("KEYFOLD_ALLOWED_HOSTS"),
		"comma separated host names accepted besides loopback ones: the names a TLS reverse proxy answers to (default $KEYFOLD_ALLOWED_HOSTS)")
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
	opts := api.Options{MaxBlob: *maxBlob, Hosts: hostList(*allowedHosts)}
	if *web != "" {
		if info, err := os.Stat(*web); err == nil && info.IsDir() {
			opts.Web = spa(*web)
		} else {
			slog.Warn("web dir not found, serving the API only", "dir", *web)
		}
	}
	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		slog.Error("listen", "err", err)
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	slog.Info("keyfold-server listening", "url", "http://"+*listen, "data", *data, "allowedHosts", opts.Hosts)
	if err := serve(ctx, api.New(st, opts), ln); err != nil {
		slog.Error("server stopped", "err", err)
		os.Exit(1)
	}
	slog.Info("keyfold-server stopped")
}

// serve answers requests on ln until ctx ends, then stops accepting and lets
// the requests in flight finish for up to shutdownGrace. It bounds how long a
// client may take to send its headers or hold an idle connection, but not a
// body: an attachment upload can be long.
func serve(ctx context.Context, h http.Handler, ln net.Listener) error {
	srv := &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 2 * time.Minute}
	failed := make(chan error, 1)
	go func() { failed <- srv.Serve(ln) }()
	select {
	case err := <-failed:
		return err
	case <-ctx.Done():
	}
	grace, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	if err := srv.Shutdown(grace); err != nil {
		return err
	}
	if err := <-failed; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// hostList splits the -allowed-hosts value into lower case host names.
func hostList(v string) []string {
	return strings.FieldsFunc(strings.ToLower(v), func(r rune) bool { return r == ',' || r == ' ' })
}

// backupTo archives the data directory into a new 0600 file. The archive is
// written under a ".partial" name and renamed once whole and flushed: a backup
// that fails, or is killed, leaves no file to be taken for a good one, and can
// be run again. It refuses a name already taken, before the work and again
// before the rename: a guard against a slip of the operator, not against a
// file made on purpose in between. A rename, unlike a hard link, works on
// every file system a backup may go to.
func backupTo(dir, file string) error {
	taken := func() error {
		if _, err := os.Lstat(file); err == nil {
			return fmt.Errorf("%s exists: a backup never writes over a file", file)
		}
		return nil
	}
	if err := taken(); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(file), filepath.Base(file)+".partial-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name()) // no-op after the rename
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
	if err := taken(); err != nil {
		return err
	}
	if err := os.Rename(f.Name(), file); err != nil {
		return err
	}
	d, err := os.Open(filepath.Dir(file))
	if err == nil {
		err = d.Sync()
		d.Close()
	}
	if err != nil {
		return fmt.Errorf("%s is written, but its directory could not be flushed to disk: %w", file, err)
	}
	return nil
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
