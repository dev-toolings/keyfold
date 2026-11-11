package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

// envFlags collects repeated -env VAR=kf://name/field flags.
type envFlags []string

func (e *envFlags) String() string     { return strings.Join(*e, ",") }
func (e *envFlags) Set(v string) error { *e = append(*e, v); return nil }

// cmdRun starts a command with secrets in its environment. They never appear
// in an argument list nor on disk. It returns the command's exit code.
func cmdRun(c *client, args []string, stdin *os.File, stdout, stderr io.Writer) (int, error) {
	fs := flag.NewFlagSet("run", flag.ContinueOnError)
	fs.SetOutput(stderr)
	var envs envFlags
	fs.Var(&envs, "env", "VAR=kf://name/field, repeatable")
	if err := fs.Parse(args); err != nil {
		return 0, err
	}
	if fs.NArg() == 0 || len(envs) == 0 {
		return 0, errors.New("usage: kf run -env VAR=kf://name/field [-env ...] -- command [args]")
	}
	refs := map[string]string{}
	for _, e := range envs {
		k, ref, ok := strings.Cut(e, "=")
		if !ok || k == "" {
			return 0, fmt.Errorf("-env %q: want VAR=kf://name/field", e)
		}
		if _, _, err := parseRef(ref); err != nil {
			return 0, err
		}
		refs[k] = ref
	}
	_, entries, err := c.open()
	if err != nil {
		return 0, err
	}
	env := os.Environ()
	now := time.Now()
	for k, ref := range refs {
		v, err := resolve(entries, ref, now)
		if err != nil {
			c.logout()
			return 0, err
		}
		env = append(env, k+"="+v)
	}
	c.logout() // the session is not needed while the command runs

	cmd := exec.Command(fs.Arg(0), fs.Args()[1:]...)
	cmd.Env, cmd.Stdin, cmd.Stdout, cmd.Stderr = env, stdin, stdout, stderr
	err = cmd.Run()
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode(), nil
	}
	return 0, err
}
