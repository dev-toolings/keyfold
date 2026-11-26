// Command dev-vault seeds or resets a local Keyfold development vault offline.
package main

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"time"

	"filippo.io/age"
	"golang.org/x/sys/unix"

	"keyfold/internal/store"
	"keyfold/internal/vault"
)

// This is a public fixture value, for local demo data only.
const demoPassword = "keyfold-demo-password"

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "[make]", err)
		os.Exit(1)
	}
}

func run() error {
	if len(os.Args) != 2 || (os.Args[1] != "seed" && os.Args[1] != "reset") {
		return errors.New("usage: dev-vault seed|reset")
	}
	data := os.Getenv("KEYFOLD_DEV_DATA")
	if data == "" {
		return errors.New("DATA must name a local Keyfold data directory")
	}
	dir, err := filepath.Abs(data)
	if err != nil {
		return err
	}
	reset := os.Args[1] == "reset"
	if reset {
		if _, err := os.Lstat(dir); errors.Is(err, os.ErrNotExist) {
			fmt.Printf("[make] no vault data at %s\n", dir)
			return nil
		} else if err != nil {
			return err
		}
	}
	st, err := store.OpenOffline(dir)
	group := 0
	if errors.Is(err, store.ErrInUse) {
		if group, err = makeDevGroup(dir); err != nil {
			return fmt.Errorf("%w (%v): stop the keyfold-server that uses %s, then run make %s again", store.ErrInUse, err, dir, os.Args[1])
		}
		if !reset {
			// Do not stop make dev for a seed that would refuse the vault anyway.
			probe, err := store.Open(dir)
			if err != nil {
				return err
			}
			if err := probe.SeedReady(); err != nil {
				return err
			}
		}
	} else if err != nil {
		return err
	}
	question, word := "", "reset"
	switch {
	case group != 0 && reset:
		question = fmt.Sprintf("make dev (PID %d) uses this vault: stop it, then permanently delete the vault at %q?", group, dir)
	case group != 0:
		question, word = fmt.Sprintf("make dev (PID %d) uses %q: stop it to write the demo vault?", group, dir), "stop"
	case reset:
		question = fmt.Sprintf("Permanently delete the vault at %q?", dir)
	}
	if question != "" {
		fmt.Fprintf(os.Stderr, "[make] %s Type %s to confirm: ", question, word)
		input := bufio.NewScanner(os.Stdin)
		if !input.Scan() || input.Text() != word {
			return errors.New(os.Args[1] + " canceled")
		}
	}
	if group != 0 {
		if st, err = stopMakeDev(group, dir); err != nil {
			return err
		}
	}
	if reset {
		if err := st.Reset(); err != nil {
			return err
		}
		fmt.Printf("[make] vault reset at %s\n", dir)
		return nil
	}
	if err := seed(st); err != nil {
		return err
	}
	fmt.Printf("[make] demo vault created at %s\n[make] demo unlock password: %s\n", dir, demoPassword)
	return nil
}

// makeDevGroup returns the process group of the make dev whose keyfold-server
// holds the lock of dir, run from the current directory (the repository root,
// where make reset runs). Any other holder is an error: only that make dev,
// which the developer restarts anyway, is stopped. It reads /proc, so Linux only.
func makeDevGroup(dir string) (int, error) {
	var lock unix.Stat_t
	if err := unix.Stat(filepath.Join(dir, ".lock"), &lock); err != nil {
		return 0, err
	}
	locks, err := os.ReadFile("/proc/locks")
	if err != nil {
		return 0, err
	}
	// Lines read "1: FLOCK ADVISORY WRITE <pid> <major>:<minor>:<inode> 0 EOF";
	// a process waiting for the lock has "->" before FLOCK.
	file := fmt.Sprintf("%02x:%02x:%d", unix.Major(uint64(lock.Dev)), unix.Minor(uint64(lock.Dev)), lock.Ino)
	for line := range strings.Lines(string(locks)) {
		fields := strings.Fields(line)
		if len(fields) < 6 || fields[1] != "FLOCK" || fields[5] != file {
			continue
		}
		pid, err := strconv.Atoi(fields[4])
		if err != nil {
			return 0, err
		}
		group, err := unix.Getpgid(pid)
		if err != nil {
			return 0, err
		}
		if group == unix.Getpgrp() {
			return 0, fmt.Errorf("its holder (PID %d) runs in this process group", pid)
		}
		cmdline, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", group))
		if err != nil {
			return 0, err
		}
		args := strings.Split(strings.TrimRight(string(cmdline), "\x00"), "\x00")
		cwd, err := os.Getwd()
		if err != nil {
			return 0, err
		}
		// Getwd may return $PWD through a symlink, /proc gives the real path.
		if cwd, err = filepath.EvalSymlinks(cwd); err != nil {
			return 0, err
		}
		makeDir, err := os.Readlink(fmt.Sprintf("/proc/%d/cwd", group))
		if err != nil {
			return 0, err
		}
		if filepath.Base(args[0]) != "make" || !slices.Contains(args[1:], "dev") || makeDir != cwd {
			return 0, fmt.Errorf("its holder (PID %d) was not started by make dev in %s", pid, cwd)
		}
		return group, nil
	}
	return 0, errors.New("no process holding its lock was found")
}

// stopMakeDev interrupts the make dev process group, as Ctrl-C in its terminal
// does, and returns dir once its keyfold-server has released the lock. The
// server may take up to its 15 second shutdown grace to finish requests.
func stopMakeDev(group int, dir string) (*store.Store, error) {
	// The confirmation may have waited: check the holder is still that make dev.
	if again, err := makeDevGroup(dir); err != nil || again != group {
		return nil, fmt.Errorf("make dev (PID %d) no longer holds %s: run make %s again", group, dir, os.Args[1])
	}
	if err := unix.Kill(-group, unix.SIGINT); err != nil {
		return nil, fmt.Errorf("stop make dev (PID %d): %w", group, err)
	}
	for deadline := time.Now().Add(20 * time.Second); ; time.Sleep(100 * time.Millisecond) {
		st, err := store.OpenOffline(dir)
		if !errors.Is(err, store.ErrInUse) {
			return st, err
		}
		if time.Now().After(deadline) {
			return nil, fmt.Errorf("make dev (PID %d) still holds %s after 20 seconds: stop it with Ctrl-C, then run make %s again", group, dir, os.Args[1])
		}
	}
}

func seed(st *store.Store) error {
	id, err := age.GenerateX25519Identity()
	if err != nil {
		return err
	}
	wrapped, err := vault.WrapIdentity(id, demoPassword)
	if err != nil {
		return err
	}

	items := []vault.Item{
		{Name: "Acme Mail", Kind: "login", Folder: "Travail", Favorite: true,
			Username: "demo@example.test", Value: "fake-mail-password", URLs: []string{"https://mail.example.test"}},
		{Name: "Acme API", Kind: "token", Folder: "Travail", Value: "fake-demo-api-token"},
		{Name: "Notes de voyage", Kind: "note", Folder: "Personnel", Note: "Exemple fictif pour la démo."},
		{Name: "Profil de démo", Kind: "identity", Folder: "Personnel",
			Fields: []vault.Field{{Name: "Nom", Value: "Alex Démo"}, {Name: "E-mail", Value: "demo@example.test"}}},
	}
	now := time.Now().UTC().Format(time.RFC3339)
	entries := make([]store.Entry, 0, len(items))
	for index, item := range items {
		item.V = vault.ItemVersion
		item.CreatedAt = now
		item.UpdatedAt = now
		ciphertext, err := vault.EncryptItem(item, id.Recipient())
		if err != nil {
			return err
		}
		entries = append(entries, store.Entry{ID: fmt.Sprintf("%032x", index+1), Ciphertext: ciphertext})
	}
	return st.Seed(wrapped, id.Recipient().String(), entries)
}
